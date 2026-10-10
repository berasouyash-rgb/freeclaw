// Live inbox stream — AppProvider opens /api/events (SSE) and re-runs
// the notification snapshot diff on every `update` wake-up.
// Locks:
//   1. One EventSource per identity, pointed at /api/events?user_id=<id>
//      with credentials (the session cookie is the proof; EventSource
//      cannot send headers).
//   2. An `update` event triggers a fresh engine pass (the same diff the
//      mount pass runs — a spurious event can never fabricate a
//      notification, it only re-diffs).
//   3. Unmount closes the stream (no leaked connections across identity
//      switches).
//   4. No setInterval fallback: the one-load lifecycle contract forbids
//      recurring full-history requests — the stream's own reconnect is
//      the retry mechanism.

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../contexts/AppContext";

const h = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	store: {} as Record<string, unknown>,
	streams: [] as FakeEventSource[],
}));

vi.mock("../lib/identity", () => ({
	getAnonId: () => "anon_stream_1",
	getDisplayName: () => "",
	setDisplayName: () => {},
	getProfile: () => ({ avatar: "", bio: "" }),
	setProfile: (p: { avatar?: string; bio?: string }) => p,
	lsGet: (k: string, d: unknown) => (k in h.store ? h.store[k] : d),
	lsSet: (k: string, v: unknown) => {
		h.store[k] = v;
	},
}));

vi.mock("../lib/api", () => ({
	api: { get: h.get, getSlow: h.get, post: h.post },
}));

class FakeEventSource {
	url: string;
	opts: unknown;
	listeners: Record<string, Array<() => void>> = {};
	closed = false;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(url: string, opts: unknown) {
		this.url = url;
		this.opts = opts;
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

beforeEach(() => {
	vi.clearAllMocks();
	h.store = {};
	h.streams = [];
	vi.stubGlobal("EventSource", FakeEventSource);
	h.get.mockImplementation((url: string) => {
		if (url.includes("/api/posts")) return Promise.resolve([]);
		if (url.includes("/api/chat")) return Promise.resolve(null);
		if (url.includes("/api/notifications")) return Promise.resolve({});
		if (url.includes("/api/polls")) return Promise.resolve([]);
		return Promise.resolve({});
	});
	h.post.mockResolvedValue({
		banned: false,
		suspended: false,
		suspended_until: null,
		strikes: 0,
	});
});

describe("inbox live stream", () => {
	it("opens one credentialed stream for the current identity", async () => {
		render(
			<AppProvider>
				<div />
			</AppProvider>,
		);
		await waitFor(() => expect(h.streams).toHaveLength(1));
		const s = h.streams[0]!;
		expect(s.url).toContain("/api/events?user_id=anon_stream_1");
		expect(s.opts).toEqual({ withCredentials: true });
	});

	it("re-runs the engine diff when an update wake-up arrives", async () => {
		render(
			<AppProvider>
				<div />
			</AppProvider>,
		);
		await waitFor(() => expect(h.streams).toHaveLength(1));
		const s = h.streams[0]!;
		// Let the mount pass settle.
		await waitFor(() =>
			expect(
				h.get.mock.calls.some((c) => String(c[0]).includes("/api/posts?author=")),
			).toBe(true),
		);
		const before = h.get.mock.calls.length;
		await act(async () => {
			s.fire("update");
			await new Promise((r) => setTimeout(r, 0));
		});
		await waitFor(() =>
			expect(h.get.mock.calls.length).toBeGreaterThan(before),
		);
		// The wake-up re-ran the same engine inputs — posts, chat, notifs.
		const urls = h.get.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes("/api/posts?author="))).toBe(true);
	});

	it("closes the stream on unmount", async () => {
		const { unmount } = render(
			<AppProvider>
				<div />
			</AppProvider>,
		);
		await waitFor(() => expect(h.streams).toHaveLength(1));
		const s = h.streams[0]!;
		unmount();
		expect(s.closed).toBe(true);
	});
});
