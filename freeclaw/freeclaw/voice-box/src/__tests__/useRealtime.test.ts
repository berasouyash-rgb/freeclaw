// ─── useRealtime hidden-tab performance tests ─────────────────────
// Locks in the optimization that reduced wasted API calls:
//   1. Fallback polls are SKIPPED while the tab is hidden
//   2. Polls still fire normally while the tab is visible
//   3. Visibility-return triggers an immediate (debounced) refresh
//   4. No polling while realtime is connected and healthy
//   5. Realtime postgres_changes events still deliver normally
//   6. Channel is torn down when the last subscriber unmounts

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtime } from "../lib/useRealtime";

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

	it("skips fallback polls while the tab is hidden", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["hidden_poll"], onChange, 0));

		// Force the fallback-polling path (channel not subscribed)
		act(() => {
			simulateStatus("hidden_poll", "CHANNEL_ERROR");
		});
		setHidden(true);

		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("fires fallback polls when the tab is visible", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["visible_poll"], onChange, 0));

		// hidden defaults to false — do NOT call setHidden here, so the POLL path
		// is tested in isolation (a visibilitychange would schedule a VISIBLE refresh).
		act(() => {
			simulateStatus("visible_poll", "CHANNEL_ERROR");
		});

		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onChange).toHaveBeenCalledWith(
			"visible_poll",
			expect.objectContaining({ eventType: "POLL" }),
		);
	});

	it("refreshes immediately when the tab becomes visible again", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["vis_refresh"], onChange, 0));

		act(() => {
			simulateStatus("vis_refresh", "CHANNEL_ERROR");
		});
		setHidden(true);
		act(() => {
			vi.advanceTimersByTime(20_000);
		});
		expect(onChange).not.toHaveBeenCalled();

		act(() => {
			setHidden(false);
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});
		expect(onChange).toHaveBeenCalledWith(
			"vis_refresh",
			expect.objectContaining({ eventType: "VISIBLE" }),
		);
	});

	it("does not poll while realtime is connected and healthy", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["connected"], onChange, 0));

		act(() => {
			simulateStatus("connected", "SUBSCRIBED");
		});
		// Advance exactly 10s — below the inline 30s staleness threshold in
		// useRealtime.ts's stalenessCheck (Date.now() - lastEventAt > 30000),
		// so polling must NOT re-enable. Keep this advance below that 30s
		// inline threshold or this test silently changes meaning.
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("still delivers realtime postgres_changes events", () => {
		const onChange = vi.fn();
		const { unmount } = renderHook(() => useRealtime(["events"], onChange, 0));

		act(() => {
			simulateStatus("events", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-events")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});

		expect(onChange).toHaveBeenCalledWith(
			"events",
			expect.objectContaining({ eventType: "INSERT" }),
		);
		unmount();
	});

	it("tears down the channel when the last subscriber unmounts", () => {
		const onChange = vi.fn();
		const { unmount } = renderHook(() =>
			useRealtime(["teardown"], onChange, 0),
		);
		expect(mock.createChannel).toHaveBeenCalledWith("rt-teardown");

		unmount();
		expect(mock.removeChannel).toHaveBeenCalled();
	});

	it("delivers debounced events to EVERY subscriber on the same key", () => {
		// Regression test for the per-subscriber timer fix: two subscribers on the
		// same table with different debounceMs must BOTH receive the event. A
		// shared timer map (old design) let the last-writer win and dropped A.
		const onChangeA = vi.fn();
		const onChangeB = vi.fn();
		const { unmount: unmountA } = renderHook(() =>
			useRealtime(["multi"], onChangeA, 0),
		);
		const { unmount: unmountB } = renderHook(() =>
			useRealtime(["multi"], onChangeB, 100),
		);

		act(() => {
			simulateStatus("multi", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-multi")?.changeCb({ eventType: "INSERT" });
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

	it("stops fallback polling once the channel recovers and connects", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["recover"], onChange, 0));

		// Fallback polling starts on channel error
		act(() => {
			simulateStatus("recover", "CHANNEL_ERROR");
		});
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onChange).toHaveBeenCalledWith(
			"recover",
			expect.objectContaining({ eventType: "POLL" }),
		);

		// Realtime connects → polling must stop (clearInterval path)
		act(() => {
			simulateStatus("recover", "SUBSCRIBED");
		});
		act(() => {
			vi.advanceTimersByTime(20_000);
		});
		const pollCalls = onChange.mock.calls.filter(
			(c) => c[1]?.eventType === "POLL",
		).length;
		expect(pollCalls).toBe(1); // no further POLL ticks after recovery
	});

	it("re-enables polling when a SUBSCRIBED channel goes stale (30s silence)", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["stale"], onChange, 0));

		act(() => {
			simulateStatus("stale", "SUBSCRIBED");
		});
		// Staleness threshold is 30s: poll starts on the first staleness tick past
		// 30s (t=40s) and ticks at 50s → POLL fires. The t=50s staleness tick also
		// hits the `if (entry.poll) return` guard (no second interval).
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(onChange).toHaveBeenCalledWith(
			"stale",
			expect.objectContaining({ eventType: "POLL" }),
		);
	});

	it("coalesces duplicate realtime events within the debounce window", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["coalesce"], onChange, 1000));

		act(() => {
			simulateStatus("coalesce", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-coalesce")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		// Second event while the first timer is pending → the pending timer is
		// cleared and replaced (clearTimeout path), so only ONE callback fires.
		act(() => {
			mock.channels.get("rt-coalesce")?.changeCb({ eventType: "UPDATE" });
		});
		act(() => {
			vi.advanceTimersByTime(1100);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith(
			"coalesce",
			expect.objectContaining({ eventType: "UPDATE" }),
		);
	});

	it("coalesces duplicate visibility returns within the debounce window", () => {
		const onChange = vi.fn();
		renderHook(() => useRealtime(["vis_coalesce"], onChange, 1000));

		act(() => {
			setHidden(true);
		});
		// First return schedules a VISIBLE refresh
		act(() => {
			setHidden(false);
		});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		// Second return while the timer is pending → pending timer cleared
		act(() => {
			setHidden(false);
		});
		act(() => {
			vi.advanceTimersByTime(1100);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith(
			"vis_coalesce",
			expect.objectContaining({ eventType: "VISIBLE" }),
		);
	});

	it("resubscribes when the table key changes and tears down the old channel", () => {
		const onChange = vi.fn();
		const { rerender, unmount } = renderHook(
			({ tables }) => useRealtime(tables, onChange, 0),
			{ initialProps: { tables: ["key_a"] } },
		);

		act(() => {
			simulateStatus("key_a", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-key_a")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});
		expect(onChange).toHaveBeenCalledWith(
			"key_a",
			expect.objectContaining({ eventType: "INSERT" }),
		);

		// Switch tables → old channel torn down, new one created
		rerender({ tables: ["key_b"] });
		act(() => {
			simulateStatus("key_b", "SUBSCRIBED");
		});
		act(() => {
			mock.channels.get("rt-key_b")?.changeCb({ eventType: "INSERT" });
		});
		act(() => {
			vi.advanceTimersByTime(10);
		});
		expect(onChange).toHaveBeenCalledWith(
			"key_b",
			expect.objectContaining({ eventType: "INSERT" }),
		);

		unmount();
	});

	it("tears down a channel with an active polling fallback", () => {
		const onChange = vi.fn();
		const { unmount } = renderHook(() =>
			useRealtime(["teardown_poll"], onChange, 0),
		);

		// Start fallback polling via channel error
		act(() => {
			simulateStatus("teardown_poll", "CHANNEL_ERROR");
		});
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onChange).toHaveBeenCalledWith(
			"teardown_poll",
			expect.objectContaining({ eventType: "POLL" }),
		);

		// Unmount while the poll interval and staleness check are both live →
		// teardown must clear the poll interval, staleness check, and listener.
		act(() => {
			unmount();
		});
	});
});
