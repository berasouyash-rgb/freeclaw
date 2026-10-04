// ─── useRealtime lifecycle tests ───────────────────────────────────
// Locks in the one-load page contract:
//   1. Failed/quiet channels never become recurring fallback polls
//   2. Visibility changes never trigger passive page refreshes
//   3. Realtime postgres_changes events still deliver normally
//   4. Bursts remain debounced without starving delivery
//   5. Channels are torn down when the last subscriber unmounts

import { act, renderHook as baseRenderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REALTIME_TABLES, useRealtime } from "../lib/useRealtime";

// The hook attaches its channel after a dynamic import() resolves, so every
// render must flush microtasks before channel assertions run.
async function renderHook(
	callback: (...args: any[]) => unknown,
	options?: any,
): Promise<any> {
	const result = baseRenderHook(callback, options);
	await act(async () => {});
	return result;
}

// ── Mock supabase channel ─────────────────────────────────────────
const mock = vi.hoisted(() => {
	const channels = new Map<
		string,
		{
			statusCb: (status: string) => void;
			changeCb: (payload: unknown) => void;
		}
	>();
	const createChannel = vi.fn((key: string) => {
		const entry = {
			statusCb: (_status: string) => {},
			changeCb: (_payload: unknown) => {},
		};
		const channel = {
			on: vi.fn(),
			subscribe: vi.fn(),
		};
		channel.on.mockImplementation(
			(_event: string, _opts: unknown, cb: (p: unknown) => void) => {
				entry.changeCb = cb;
				return channel;
			},
		);
		channel.subscribe.mockImplementation((cb: (status: string) => void) => {
			entry.statusCb = cb;
			return {};
		});
		channels.set(key, entry);
		return channel;
	});
	const removeChannel = vi.fn();
	return { createChannel, removeChannel, channels };
});

vi.mock("../lib/supabase", () => ({
	default: { channel: mock.createChannel, removeChannel: mock.removeChannel },
}));

describe("useRealtime — public contract", () => {
	it("exposes only the three anonymous-readable tables", async () => {
		expect([...REALTIME_TABLES].sort()).toEqual(["comments", "polls", "posts"]);
	});
});

describe("useRealtime — hidden-tab optimization", () => {
	let hidden = false;

	beforeEach(() => {
		vi.useFakeTimers();
		hidden = false;
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => hidden,
		});
		mock.channels.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const setHidden = (value: boolean) => {
		hidden = value;
		document.dispatchEvent(new Event("visibilitychange"));
	};

	const simulateStatus = (key: string, status: string) => {
		mock.channels.get(`rt-${key}`)?.statusCb(status);
	};

	it("skips fallback polls while the tab is hidden", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["posts"], onChange, 0));

		// Force the fallback-polling path (channel not subscribed)
		act(() => {
			simulateStatus("posts", "CHANNEL_ERROR");
		});
		setHidden(true);

		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("does not fire fallback polls while the tab is visible", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["comments"], onChange, 0));

		// A failed channel is not converted into a recurring page refresh.
		act(() => {
			simulateStatus("comments", "CHANNEL_ERROR");
		});

		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("still delivers while events arrive faster than the debounce window", async () => {
		// REGRESSION (user-reported: "it only refreshes once"). The debounce
		// was implemented as a pure reset-on-every-event timer. On a busy feed
		// — posts arriving faster than the 2.5s admin debounce — that timer is
		// reset before it ever fires, so the callback is STARVED indefinitely
		// and the list silently stops updating. The admin sees the first
		// refresh (during a quiet gap) and then nothing.
		//
		// A debounce needs a max-wait guarantee: a burst must coalesce, but a
		// sustained stream must still deliver.
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["posts"], onChange, 2500));

		act(() => {
			simulateStatus("posts", "SUBSCRIBED");
		});

		const change = mock.channels.get("rt-posts")?.changeCb;
		expect(change).toBeTypeOf("function");

		// 150 events, one every 100ms = 15s of continuous activity, which runs
		// past the 10s max-wait ceiling the implementation guarantees.
		act(() => {
			for (let i = 0; i < 150; i++) {
				change?.({ eventType: "UPDATE" });
				vi.advanceTimersByTime(100);
			}
		});

		// Coalesced (far fewer calls than 150 events)…
		expect(onChange.mock.calls.length).toBeGreaterThan(0);
		// …but not starved to zero.
		expect(onChange.mock.calls.length).toBeLessThan(150);
	});

	it("coalesces a short burst into a single delivery", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["polls"], onChange, 500));

		act(() => {
			simulateStatus("polls", "SUBSCRIBED");
		});
		const change = mock.channels.get("rt-polls")?.changeCb;

		act(() => {
			for (let i = 0; i < 5; i++) {
				change?.({ eventType: "UPDATE" });
				vi.advanceTimersByTime(50);
			}
			vi.advanceTimersByTime(600);
		});

		// 5 events inside the window => exactly one refresh, not five.
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("does not refresh when the tab becomes visible again", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["comments"], onChange, 0));

		act(() => {
			simulateStatus("comments", "CHANNEL_ERROR");
		});
		setHidden(true);
		act(() => {
			vi.advanceTimersByTime(20_000);
		});
		act(() => {
			setHidden(false);
			vi.advanceTimersByTime(10);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("does not poll while realtime is connected and healthy", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["polls"], onChange, 0));

		act(() => {
			simulateStatus("polls", "SUBSCRIBED");
		});
		// Advance exactly 10s — far below the 120s staleness threshold in
		// useRealtime.ts's stalenessCheck (Date.now() - lastEventAt > 120_000),
		// so polling must NOT re-enable. Keep this advance below that 120s
		// threshold or this test silently changes meaning.
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("still delivers realtime postgres_changes events", async () => {
		const onChange = vi.fn();
		const { unmount } = await renderHook(() => useRealtime(["polls"], onChange, 0));

		act(() => {
			simulateStatus("polls", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-polls")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});

		expect(onChange).toHaveBeenCalledWith(
			"polls",
			expect.objectContaining({ eventType: "INSERT" }),
		);
		unmount();
	});

	it("tears down the channel when the last subscriber unmounts", async () => {
		const onChange = vi.fn();
		const { unmount } = await renderHook(() =>
			useRealtime(["posts"], onChange, 0),
		);
		expect(mock.createChannel).toHaveBeenCalledWith("rt-posts");

		unmount();
		expect(mock.removeChannel).toHaveBeenCalled();
	});

	it("delivers debounced events to EVERY subscriber on the same key", async () => {
		// Regression test for the per-subscriber timer fix: two subscribers on the
		// same table with different debounceMs must BOTH receive the event. A
		// shared timer map (old design) let the last-writer win and dropped A.
		const onChangeA = vi.fn();
		const onChangeB = vi.fn();
		const { unmount: unmountA } = await renderHook(() =>
			useRealtime(["comments"], onChangeA, 0),
		);
		const { unmount: unmountB } = await renderHook(() =>
			useRealtime(["comments"], onChangeB, 100),
		);

		act(() => {
			simulateStatus("comments", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-comments")?.changeCb({ eventType: "INSERT" });
		});

		// Subscriber A (debounce 0) fires immediately; B (debounce 100) must wait.
		act(() => {
			vi.advanceTimersByTime(10);
		});
		expect(onChangeA).toHaveBeenCalledTimes(1);
		expect(onChangeB).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(90);
		});
		expect(onChangeB).toHaveBeenCalledTimes(1);
		expect(onChangeA).toHaveBeenCalledTimes(1); // A must not double-fire

		unmountA();
		unmountB();
	});

	it("does not start polling after a channel recovers", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["polls"], onChange, 0));

		act(() => {
			simulateStatus("polls", "CHANNEL_ERROR");
		});
		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		act(() => {
			simulateStatus("polls", "SUBSCRIBED");
		});
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("does not poll when a connected channel is quiet", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["posts"], onChange, 0));

		act(() => {
			simulateStatus("posts", "SUBSCRIBED");
		});
		act(() => {
			vi.advanceTimersByTime(185_000);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("coalesces duplicate realtime events within the debounce window", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["comments"], onChange, 1000));

		act(() => {
			simulateStatus("comments", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-comments")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		// Second event while the first timer is pending → the pending timer is
		// cleared and replaced (clearTimeout path), so only ONE callback fires.
		act(() => {
			mock.channels.get("rt-comments")?.changeCb({ eventType: "UPDATE" });
		});
		act(() => {
			vi.advanceTimersByTime(1100);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith(
			"comments",
			expect.objectContaining({ eventType: "UPDATE" }),
		);
	});

	it("does not start a recurring fallback poll after a channel error", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["posts"], onChange, 0));

		act(() => {
			simulateStatus("posts", "CHANNEL_ERROR");
		});
		act(() => {
			vi.advanceTimersByTime(185_000);
		});

		expect(onChange).not.toHaveBeenCalled();
	});

	it("does not refresh passive data when a hidden tab becomes visible", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["posts"], onChange, 0));

		act(() => {
			simulateStatus("posts", "SUBSCRIBED");
		});
		setHidden(true);
		act(() => {
			setHidden(false);
			vi.advanceTimersByTime(60_000);
		});

		expect(onChange).not.toHaveBeenCalled();
	});

	it("does not schedule work for repeated visibility changes", async () => {
		const onChange = vi.fn();
	await renderHook(() => useRealtime(["comments"], onChange, 1000));

		act(() => {
			setHidden(true);
		});
		act(() => {
			setHidden(false);
		});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		act(() => {
			setHidden(false);
		});
		act(() => {
			vi.advanceTimersByTime(1100);
		});

		expect(onChange).not.toHaveBeenCalled();
	});

	it("resubscribes when the table key changes and tears down the old channel", async () => {
		const onChange = vi.fn();
		const { rerender, unmount } = await renderHook(
			({ tables }) => useRealtime(tables, onChange, 0),
			{ initialProps: { tables: ["polls"] } },
		);

		act(() => {
			simulateStatus("polls", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-polls")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});
		expect(onChange).toHaveBeenCalledWith(
			"polls",
			expect.objectContaining({ eventType: "INSERT" }),
		);

		// Switch tables → old channel torn down, new one created.
		// The re-subscription attaches after a dynamic import(), so flush
		// microtasks before driving the new channel.
		await act(async () => {
			rerender({ tables: ["posts"] });
		});
		act(() => {
			simulateStatus("posts", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-posts")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});
		expect(onChange).toHaveBeenCalledWith(
			"posts",
			expect.objectContaining({ eventType: "INSERT" }),
		);

		unmount();
	});

	it("tears down a channel after a failed connection without polling", async () => {
		const onChange = vi.fn();
		const { unmount } = await renderHook(() =>
			useRealtime(["comments"], onChange, 0),
		);

		act(() => {
			simulateStatus("comments", "CHANNEL_ERROR");
		});
		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(onChange).not.toHaveBeenCalled();

		act(() => {
			unmount();
		});
		expect(mock.removeChannel).toHaveBeenCalled();
	});

	it("does not open channels for private or unsupported tables", async () => {
		for (const table of ["reports", "chat_messages", "poll_votes", "reactions"]) {
			const onChange = vi.fn();
			const { unmount } = await renderHook(() => useRealtime([table], onChange, 0));
			expect(mock.channels.has(`rt-${table}`)).toBe(false);
			act(() => {
				vi.advanceTimersByTime(30_000);
			});
			expect(onChange).not.toHaveBeenCalled();
			unmount();
		}
	});

	it("keeps the allowed tables live when mixed with private ones", async () => {
		// REGRESSION (the dead home feed): useRealtime(["posts","reactions",
		// "comments","polls","poll_votes"]) opened NO channel at all, because
		// the allowlist gate rejected the whole key over the private tables —
		// so posts/comments/polls silently lost realtime too. The allowed
		// subset must subscribe normally while the rest stay dark.
		const onChange = vi.fn();
		const { unmount } = await renderHook(() =>
			useRealtime(["posts", "reactions", "poll_votes"], onChange, 0),
		);
		expect(mock.channels.has("rt-posts")).toBe(true);
		expect(mock.channels.has("rt-posts,reactions,poll_votes")).toBe(false);

		act(() => {
			simulateStatus("posts", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-posts")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});
		expect(onChange).toHaveBeenCalledWith(
			"posts",
			expect.objectContaining({ eventType: "INSERT" }),
		);
		unmount();
	});

	it("does not open or poll tables outside the realtime publication", async () => {		// Admin-only tables (agent_*, settings, vitals, …) are neither in the
		// supabase_realtime publication nor readable by the anon key, so a
		// channel could never deliver. No dead WebSocket or poll loop is opened.
		const onChange = vi.fn();
		const { unmount } = await renderHook(() =>
			useRealtime(["agent_tasks", "agent_executions"], onChange, 0),
		);
		expect(mock.channels.has("rt-agent_tasks,agent_executions")).toBe(false);
		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(onChange).not.toHaveBeenCalled();
		unmount();
	});
});

// ─── debounceMs = 0 → "no debounce": every event is delivered ──────
// REGRESSION (vote latency): a trailing debounce delivers only the LAST
// payload in the window, so three polls updated together refreshed only the
// third. Callers that need per-event delivery (the fast lane for poll votes,
// which must land inside 100ms) pass 0 and get every event with no timer.
// All production call sites pass 1000–2000ms, so nothing else changes.
describe("useRealtime — debounceMs 0 means no debounce", () => {
	const simulateStatus = (key: string, status: string) => {
		mock.channels.get(`rt-${key}`)?.statusCb(status);
	};

	beforeEach(() => {
		vi.useFakeTimers();
		mock.channels.clear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("delivers every event of a synchronous burst, not just the last", async () => {
		const onChange = vi.fn();
		await renderHook(() => useRealtime(["polls"], onChange, 0));
		act(() => {
			simulateStatus("polls", "SUBSCRIBED");
		});
		const change = mock.channels.get("rt-polls")?.changeCb;
		expect(change).toBeTypeOf("function");

		act(() => {
			change?.({ eventType: "UPDATE", new: { id: "A" } });
			change?.({ eventType: "UPDATE", new: { id: "B" } });
			change?.({ eventType: "UPDATE", new: { id: "C" } });
			vi.advanceTimersByTime(10);
		});

		expect(onChange).toHaveBeenCalledTimes(3);
		const ids = onChange.mock.calls.map((c: unknown[]) => {
			const p = c[1] as { new?: { id?: string } };
			return p?.new?.id;
		});
		expect(ids).toEqual(["A", "B", "C"]);
	});
});

