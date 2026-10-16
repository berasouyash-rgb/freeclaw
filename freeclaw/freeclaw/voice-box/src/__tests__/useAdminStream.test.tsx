// useAdminStream — admin console live wake-ups over ticket-authed SSE.
// Locks:
//   1. With an admin session, it fetches a ticket (normal authed POST)
//      then opens exactly one credentialed EventSource carrying it.
//   2. An `update` event calls the page's freshness callback.
//   3. Unmount closes the stream (no leaked connections across tabs).
//   4. Without an admin session it opens nothing (server enforces too).
//   5. Five consecutive failures with no open stop the loop — the
//      console's explicit refresh buttons remain.

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminStream } from "../hooks/useAdminStream";

const h = vi.hoisted(() => ({
	post: vi.fn(),
	hasAdminSession: vi.fn(),
	streams: [] as Array<{
		url: string;
		listeners: Record<string, Array<() => void>>;
		closed: boolean;
		onerror: (() => void) | null;
		onopen: (() => void) | null;
		fire: (name: string) => void;
	}>,
}));

vi.mock("../lib/api", () => ({
	api: { post: h.post },
	hasAdminSession: (...a: unknown[]) =>
		(h.hasAdminSession as (...args: unknown[]) => unknown)(...a),
}));

class FakeEventSource {
	url: string;
	listeners: Record<string, Array<() => void>> = {};
	closed = false;
	onerror: (() => void) | null = null;
	onopen: (() => void) | null = null;
	constructor(url: string) {
		this.url = url;
		h.streams.push(this);
	}
	addEventListener(name: string, cb: () => void) {
		(this.listeners[name] ||= []).push(cb);
	}
	removeEventListener() {}
	close() {
		this.closed = true;
	}
	fire(name: string) {
		for (const cb of this.listeners[name] || []) cb();
	}
}

function Probe({ onUpdate }: { onUpdate: () => void }) {
	useAdminStream(onUpdate);
	return null;
}

beforeEach(() => {
	vi.clearAllMocks();
	h.streams = [];
	vi.stubGlobal("EventSource", FakeEventSource);
	h.hasAdminSession.mockReturnValue(true);
	h.post.mockResolvedValue({ ticket: "t".repeat(64), expires_in: 300 });
	vi.useRealTimers();
});

describe("useAdminStream", () => {
	it("fetches a ticket then opens one credentialed stream carrying it", async () => {
		const cb = vi.fn();
		render(<Probe onUpdate={cb} />);
		await vi.waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/admin-events", {
			action: "ticket",
		}));
		await vi.waitFor(() => expect(h.streams).toHaveLength(1));
		expect(h.streams[0]!.url).toContain(`/api/admin-events?ticket=${"t".repeat(64)}`);
	});

	it("wakes the page callback on update events", async () => {
		const cb = vi.fn();
		render(<Probe onUpdate={cb} />);
		await vi.waitFor(() => expect(h.streams).toHaveLength(1));
		await act(async () => {
			h.streams[0]!.fire("update");
		});
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("closes the stream on unmount", async () => {
		const { unmount } = render(<Probe onUpdate={() => {}} />);
		await vi.waitFor(() => expect(h.streams).toHaveLength(1));
		unmount();
		expect(h.streams[0]!.closed).toBe(true);
	});

	it("opens nothing without an admin session", async () => {
		h.hasAdminSession.mockReturnValue(false);
		render(<Probe onUpdate={() => {}} />);
		await new Promise((r) => setTimeout(r, 30));
		expect(h.post).not.toHaveBeenCalled();
		expect(h.streams).toHaveLength(0);
	});

	it("stops reconnecting after five consecutive failures", async () => {
		vi.useFakeTimers();
		try {
			render(<Probe onUpdate={() => {}} />);
			// Each cycle: ticket fetch → stream → error. Five errors total
			// (the initial connect plus four reconnects), then silence.
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(6_000);
				const s = h.streams[h.streams.length - 1];
				expect(s).toBeTruthy();
				await act(async () => {
					s!.onerror?.();
				});
			}
			const postsAfterGiveUp = h.post.mock.calls.length;
			await vi.advanceTimersByTimeAsync(30_000);
			expect(h.post.mock.calls.length).toBe(postsAfterGiveUp);
			expect(h.streams).toHaveLength(5);
		} finally {
			vi.useRealTimers();
		}
	});
});
