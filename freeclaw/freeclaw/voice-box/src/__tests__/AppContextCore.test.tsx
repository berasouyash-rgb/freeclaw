// ═══════════════════════════════════════════════════════════════════
// AppContext — core provider behavior
// ═══════════════════════════════════════════════════════════════════
// Locks provider contracts beyond saved-posts sync:
//   1. useApp throws outside <AppProvider>
//   2. theme toggle + persistence + <html class="dark">
//   3. bookmarks / recently-viewed / notifications / toasts / identity
//   4. heartbeat: ban + strike/warning detection → notif + toast
//   5. background notification engine: status/reply/comment/chat/poll
// ═══════════════════════════════════════════════════════════════════

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../contexts/AppContext";
import type { AccountStatus, PostData } from "../types";

const h = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	del: vi.fn(),
	lsSet: vi.fn(),
	anonSeq: ["anon-1", "anon-2", "anon-3", "anon-4"],
	store: {} as Record<string, unknown>,
}));

vi.mock("../lib/identity", () => ({
	getAnonId: () => h.anonSeq.shift() ?? "anon-1",
	getDisplayName: () => "",
	setDisplayName: () => {},
	getProfile: () => ({ avatar: "", bio: "" }),
	setProfile: (p: { avatar?: string; bio?: string }) => p,
	lsGet: (k: string, d: unknown) => (k in h.store ? h.store[k] : d),
	lsSet: (k: string, v: unknown) => {
		h.store[k] = v;
		h.lsSet(k, v);
	},
}));

vi.mock("../lib/api", () => ({
	api: { get: h.get, getSlow: h.get, post: h.post, del: h.del },
}));

function Probe() {
	const app = useApp();
	return (
		<div>
			<span data-testid="theme">{app.theme}</span>
			<span data-testid="toast">{app.toasts.map((t) => t.text).join("|")}</span>
			<span data-testid="notifs">
				{app.notifications
					.map((n) => (n.read ? "[R]" : "[U]") + n.kind + ":" + n.title)
					.join("|")}
			</span>
			<span data-testid="chat-unread">{app.chatUnread}</span>
			<span data-testid="status">{JSON.stringify(app.accountStatus)}</span>
			<span data-testid="recent">{app.recentlyViewed.join(",")}</span>
			<span data-testid="bookmarks">{app.bookmarks.join(",")}</span>
			<span data-testid="scale">{app.displayPrefs.uiScale}</span>
			<button onClick={() => app.toggleTheme()}>toggle-theme</button>
			<button
				onClick={() => app.setDisplayPrefs({ ...app.displayPrefs, uiScale: 85 })}
			>
				scale-85
			</button>
			<button onClick={() => app.toast("hello")}>toast-hello</button>
			<button
				onClick={() =>
					app.toast("action-toast", "err", { label: "Go", fn: () => {} })
				}
			>
				toast-action
			</button>
			<button onClick={() => app.addRecentlyViewed("p9")}>recent-p9</button>
			<button
				onClick={() => {
					for (let i = 0; i < 22; i++) app.addRecentlyViewed(`r${i}`);
				}}
			>
				recent-many
			</button>
			<button
				onClick={() =>
					app.pushNotif({
						kind: "info",
						title: "Manual",
						body: "b",
						link: "/x",
					})
				}
			>
				push
			</button>
			<button onClick={() => app.markNotifsRead()}>mark-read</button>
			<button onClick={() => app.clearNotifs()}>clear-notifs</button>
			<button onClick={() => app.retireNotifsForLink("/x")}>retire</button>
			<button onClick={() => app.refreshIdentity()}>refresh</button>
			<button onClick={() => app.toggleBookmark("b1")}>toggle-bookmark</button>
		</div>
	);
}

const benignStatus: AccountStatus = {
	banned: false,
	suspended: false,
	suspended_until: null,
	strikes: 0,
};

beforeEach(() => {
	vi.clearAllMocks();
	h.anonSeq = ["anon-1", "anon-2", "anon-3", "anon-4"];
	h.store = {};
	h.get.mockImplementation((url: string) => {
		if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
		if (url.includes("/api/posts")) return Promise.resolve([]);
		if (url.includes("/api/chat")) return Promise.resolve(null);
		if (url.includes("/api/polls")) return Promise.resolve([]);
		return Promise.resolve({});
	});
	h.post.mockImplementation((url: string) => {
		if (url === "/api/users") return Promise.resolve(benignStatus);
		return Promise.resolve({});
	});
	h.del.mockImplementation(() => Promise.resolve({}));
});

describe("AppProvider — core behavior", () => {
	it("does not install recurring heartbeat or notification poll timers", () => {
		const intervalSpy = vi.spyOn(globalThis, "setInterval");
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);

		const intervals = intervalSpy.mock.calls.map(([, delay]) => delay);
		expect(intervals).not.toContain(120_000);
		expect(intervals).not.toContain(180_000);
		intervalSpy.mockRestore();
	});

	it("throws when useApp is used outside the provider", () => {
		expect(() => render(<Probe />)).toThrow(
			/useApp must be used within <AppProvider>/,
		);
	});

	it("defaults theme from storage, toggles it and persists + reflects on <html>", async () => {
		h.store["vb:theme"] = "dark";
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		expect(screen.getByTestId("theme")).toHaveTextContent("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		await user.click(screen.getByRole("button", { name: "toggle-theme" }));
		expect(screen.getByTestId("theme")).toHaveTextContent("light");
		expect(h.lsSet).toHaveBeenCalledWith("vb:theme", "light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		await user.click(screen.getByRole("button", { name: "toggle-theme" }));
		expect(screen.getByTestId("theme")).toHaveTextContent("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("applies the UI scale to <html data-scale> and persists it", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		// Default is slightly smaller than the browser default (95%)
		expect(screen.getByTestId("scale")).toHaveTextContent("95");
		expect(document.documentElement.dataset.scale).toBe("95");

		await user.click(screen.getByRole("button", { name: "scale-85" }));
		expect(screen.getByTestId("scale")).toHaveTextContent("85");
		expect(document.documentElement.dataset.scale).toBe("85");
		expect(h.lsSet).toHaveBeenCalledWith("vb:display-prefs",
			expect.objectContaining({ uiScale: 85 }));
	});

	it("toggles a bookmark and persists locally + to /api/saved", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await user.click(screen.getByRole("button", { name: "toggle-bookmark" }));
		await waitFor(() =>
			expect(screen.getByTestId("bookmarks")).toHaveTextContent("b1"),
		);
		expect(h.lsSet).toHaveBeenCalledWith(
			"vb:bookmarks",
			expect.arrayContaining(["b1"]),
		);
		expect(h.post).toHaveBeenCalledWith(
			"/api/saved",
			expect.objectContaining({
				user_id: "anon-1",
				post_id: "b1",
				saved: true,
			}),
		);

		await user.click(screen.getByRole("button", { name: "toggle-bookmark" }));
		await waitFor(() =>
			expect(screen.getByTestId("bookmarks")).toHaveTextContent(""),
		);
		expect(h.post).toHaveBeenCalledWith(
			"/api/saved",
			expect.objectContaining({ saved: false }),
		);
	});

	it("addRecentlyViewed dedupes and caps at 20 entries", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await user.click(screen.getByRole("button", { name: "recent-p9" }));
		await user.click(screen.getByRole("button", { name: "recent-p9" }));
		const once = screen
			.getByTestId("recent")
			.textContent!.split(",")
			.filter((x) => x === "p9");
		expect(once).toHaveLength(1);

		await user.click(screen.getByRole("button", { name: "recent-many" }));
		const items = screen.getByTestId("recent").textContent!.split(",");
		expect(items).toHaveLength(20);
		expect(items[0]).toBe("r21");
		expect(items).not.toContain("r0");
		expect(items).not.toContain("r1");
	});

	it("pushNotif, markNotifsRead and clearNotifs manage notifications", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await user.click(screen.getByRole("button", { name: "push" }));
		await waitFor(() =>
			expect(screen.getByTestId("notifs")).toHaveTextContent("info:Manual"),
		);
		expect(screen.getByTestId("notifs").textContent).toContain("[U]");

		await user.click(screen.getByRole("button", { name: "mark-read" }));
		await waitFor(() =>
			expect(screen.getByTestId("notifs")).toHaveTextContent("[R]"),
		);

		await user.click(screen.getByRole("button", { name: "clear-notifs" }));
		await waitFor(() =>
			expect(screen.getByTestId("notifs")).toHaveTextContent(""),
		);
	});

	it("collapses an identical immediate re-push into one notification", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await user.click(screen.getByRole("button", { name: "push" }));
		await user.click(screen.getByRole("button", { name: "push" }));
		await waitFor(() =>
			expect(screen.getByTestId("notifs")).toHaveTextContent("info:Manual"),
		);
		// One entry, not two — a double-fire (double submit, re-mount replay)
		// must never read as "2 posts are live" for a single event.
		const parts = (screen.getByTestId("notifs").textContent || "").split("|");
		expect(parts.filter((p) => p.includes("info:Manual"))).toHaveLength(1);
	});

	it("retires notices pointing at a deleted post", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await user.click(screen.getByRole("button", { name: "push" }));
		await waitFor(() =>
			expect(screen.getByTestId("notifs")).toHaveTextContent("info:Manual"),
		);
		await user.click(screen.getByRole("button", { name: "retire" }));
		await waitFor(() =>
			expect(screen.getByTestId("notifs")).not.toHaveTextContent("info:Manual"),
		);
	});

	it("merges server-side admin notifications (warning/suspension/ban) into the list", async () => {
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/notifications"))
				return Promise.resolve({
					notifications: [
						{
							id: "notif_abc",
							type: "warning",
							title: "⚠️ You received a warning from admin",
							body: "Be nice",
							post_id: null,
							read: false,
							created_at: "2026-08-16T10:00:00.000Z",
						},
					],
				});
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("notifs").textContent).toContain("warning"),
		);
		// unread, server kind preserved (a warning must stay a warning so the
		// Notifications page can badge it — flattening to info hid severity
		// and crashed KIND_META lookups for unmapped kinds).
		expect(screen.getByTestId("notifs").textContent).toContain("[U]warning:");
	});

	it("does not re-sync server notifications on visibility change", async () => {
		let notifCalls = 0;
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/notifications")) {
				notifCalls++;
				return Promise.resolve({
					notifications: [
						{
							id: "notif_abc",
							type: "info",
							title: "Suspension lifted",
							body: "",
							post_id: null,
							read: false,
							created_at: "2026-08-16T10:00:00.000Z",
						},
					],
				});
			}
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("notifs").textContent).toContain("Suspension lifted"),
		);
		expect(notifCalls).toBe(1);
		document.dispatchEvent(new Event("visibilitychange"));
		expect(notifCalls).toBe(1);
	});

	it("mirrors mark-all-read to the server for admin-issued notifications", async () => {
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/notifications"))
				return Promise.resolve({
					notifications: [
						{
							id: "notif_abc",
							type: "warning",
							title: "⚠️ Warning",
							body: "",
							post_id: null,
							read: false,
							created_at: "2026-08-16T10:00:00.000Z",
						},
					],
				});
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("notifs").textContent).toContain("Warning"),
		);
		await user.click(screen.getByRole("button", { name: "mark-read" }));
		await waitFor(() =>
			expect(h.post).toHaveBeenCalledWith(
				"/api/notifications",
				expect.objectContaining({
					user_id: "anon-1",
					notification_id: "notif_abc",
				}),
			),
		);
	});

	it("clears the server notification store when notifications are cleared", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await user.click(screen.getByRole("button", { name: "clear-notifs" }));
		expect(h.del).toHaveBeenCalledWith(
			"/api/notifications?user_id=anon-1",
			expect.anything(),
		);
	});

	it("survives a server-notifications fetch failure in the notification engine", async () => {
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/notifications"))
				return Promise.reject(new Error("notifs down"));
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(h.lsSet).toHaveBeenCalledWith(
				"vb:notifSnapshot",
				expect.any(Object),
			),
		);
		// engine still completed its pass despite the notifications failure
		expect(screen.getByTestId("chat-unread")).toHaveTextContent("0");
	});

	it("renders toasts and auto-dismisses them (30s for action toasts)", async () => {
		vi.useFakeTimers({
			toFake: [
				"setTimeout",
				"clearTimeout",
				"setInterval",
				"clearInterval",
				"Date",
			],
		});
		try {
			render(
				<AppProvider>
					<Probe />
				</AppProvider>,
			);
			fireEvent.click(screen.getByRole("button", { name: "toast-hello" }));
			expect(screen.getByTestId("toast")).toHaveTextContent("hello");
			fireEvent.click(screen.getByRole("button", { name: "toast-action" }));
			expect(screen.getByTestId("toast")).toHaveTextContent(
				"hello|action-toast",
			);

			await act(async () => {
				vi.advanceTimersByTime(4000);
			});
			expect(screen.getByTestId("toast")).toHaveTextContent("action-toast");

			await act(async () => {
				vi.advanceTimersByTime(30000);
			});
			expect(screen.getByTestId("toast")).toHaveTextContent("");

			// A long-open page does not create a second heartbeat request.
			const usersCallsBefore = h.post.mock.calls.filter(
				(c) => c[0] === "/api/users",
			).length;
			await act(async () => {
				vi.advanceTimersByTime(121000);
			});
			const usersCallsAfter = h.post.mock.calls.filter(
				(c) => c[0] === "/api/users",
			).length;
			expect(usersCallsAfter).toBe(usersCallsBefore);
		} finally {
			vi.useRealTimers();
		}
	});

	it("refreshIdentity reloads identity and local state from storage", async () => {
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("bookmarks")).toHaveTextContent(""),
		);
		// Barrier: the mount-time saved-posts sync effect (union-merge + lsSet)
		// is async — let it settle BEFORE writing the store directly, otherwise
		// its `lsSet('vb:bookmarks', [])` can land after our write and clobber
		// what refreshIdentity is about to re-read (timing-sensitive under
		// coverage instrumentation).
		await waitFor(() =>
			expect(h.lsSet).toHaveBeenCalledWith("vb:bookmarks", []),
		);

		h.store["vb:bookmarks"] = ["bk1", "bk2"];
		h.store["vb:notifications"] = [
			{
				id: "n1",
				kind: "info",
				title: "Stored",
				body: "",
				at: "",
				read: true,
				link: "/x",
			},
		];
		h.store["vb:recentlyViewed"] = ["rv1"];

		await user.click(screen.getByRole("button", { name: "refresh" }));
		await waitFor(() =>
			expect(screen.getByTestId("bookmarks")).toHaveTextContent("bk1,bk2"),
		);
		expect(screen.getByTestId("notifs")).toHaveTextContent("Stored");
		expect(screen.getByTestId("recent")).toHaveTextContent("rv1");
	});

	it("logs a warning when the heartbeat request fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		h.post.mockImplementation((url: string) => {
			if (url === "/api/users")
				return Promise.reject(new Error("network down"));
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() => expect(warn).toHaveBeenCalled());
		expect(
			warn.mock.calls.some((c) => JSON.stringify(c).includes("network down")),
		).toBe(true);
		warn.mockRestore();
	});

	it("fires a ban notification + toast when the heartbeat detects a new ban", async () => {
		const statuses: AccountStatus[] = [
			{ banned: false, suspended: false, suspended_until: null, strikes: 0 },
			{ banned: true, suspended: false, suspended_until: null, strikes: 1 },
		];
		h.post.mockImplementation((url: string) => {
			if (url === "/api/users")
				return Promise.resolve(statuses.shift() ?? benignStatus);
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status")).toHaveTextContent('"banned":false'),
		);

		await user.click(screen.getByRole("button", { name: "refresh" }));
		await waitFor(() =>
			expect(screen.getByTestId("toast")).toHaveTextContent(
				"permanently banned",
			),
		);
		expect(screen.getByTestId("notifs").textContent).toContain("banned");
	});

	it("fires warning notifications + toasts when strikes increase (text and no-text paths)", async () => {
		const statuses: AccountStatus[] = [
			{ banned: false, suspended: false, suspended_until: null, strikes: 1 },
			{
				banned: false,
				suspended: false,
				suspended_until: null,
				strikes: 2,
				latest_warning: "Be nice",
			},
			{ banned: false, suspended: false, suspended_until: null, strikes: 3 },
		];
		h.post.mockImplementation((url: string) => {
			if (url === "/api/users")
				return Promise.resolve(statuses.shift() ?? benignStatus);
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status")).toHaveTextContent('"strikes":1'),
		);

		// anon-2 → strikes 2 with warning text
		await user.click(screen.getByRole("button", { name: "refresh" }));
		await waitFor(() =>
			expect(screen.getByTestId("toast")).toHaveTextContent("Be nice"),
		);

		// anon-3 → strikes 3 without warning text → generic strike toast
		await user.click(screen.getByRole("button", { name: "refresh" }));
		await waitFor(() =>
			expect(screen.getByTestId("toast")).toHaveTextContent("Strike 3 of 3"),
		);
		expect(screen.getByTestId("notifs").textContent).toContain("warning");
	});

	it("detects status/reply/comment/chat/poll changes and fires notifications", async () => {
		let postsCalls = 0;
		let chatCalls = 0;
		let pollListCalls = 0;
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) {
				postsCalls++;
				return postsCalls === 1
					? Promise.resolve([
							{
								id: "p1",
								status: "open",
								comment_count: 1,
								admin_reply: false,
								title: "Issue",
							},
						])
					: Promise.resolve([
							{
								id: "p1",
								status: "solved",
								comment_count: 3,
								admin_reply: true,
								title: "Issue",
							},
						]);
			}
			if (url.includes("/api/chat")) {
				chatCalls++;
				return chatCalls === 1
					? Promise.resolve({ messages: [] })
					: Promise.resolve({ messages: [{ sender: "admin", read: false }] });
			}
			if (url.includes("/api/polls?voter="))
				return Promise.resolve([{ poll_id: "poll1" }]);
			if (url.includes("/api/polls")) {
				pollListCalls++;
				return pollListCalls === 1
					? Promise.resolve([
							{
								id: "poll1",
								title: "Poll",
								archived: false,
								expires_at: "2099-01-01T00:00:00Z",
							},
						])
					: Promise.resolve([{ id: "poll1", title: "Poll", archived: true }]);
			}
			return Promise.resolve({});
		});

		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		// first check: no diffs → no notifications
		await waitFor(() => expect(postsCalls).toBeGreaterThanOrEqual(1));

		// second check (anonId change via refresh) → all diffs fire
		await user.click(screen.getByRole("button", { name: "refresh" }));
		await waitFor(
			() => {
				const notifs = screen.getByTestId("notifs").textContent ?? "";
				expect(notifs).toContain("solved");
				expect(notifs).toContain("Admin replied");
				expect(notifs).toContain("2 new comment");
				expect(notifs).toContain("New message from admin");
				expect(notifs).toContain("poll you voted in has ended");
			},
			{ timeout: 3000 },
		);
		expect(screen.getByTestId("chat-unread")).toHaveTextContent("1");

		// Visibility changes do not trigger another full notification pass.
		const callsBeforeVisibility = postsCalls;
		document.dispatchEvent(new Event("visibilitychange"));
		await act(async () => {
			await Promise.resolve();
		});
		expect(postsCalls).toBe(callsBeforeVisibility);
		const notifsAfter = screen.getByTestId("notifs").textContent ?? "";
		expect(notifsAfter).toContain("solved");
	});

	it("raises the inbox badge and a notification for AI replies, not just admin ones", async () => {		let chatCalls = 0;
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) {
				chatCalls++;
				return chatCalls === 1
					? Promise.resolve({ messages: [] })
					: Promise.resolve({
							messages: [{ sender: "ai", read: false }],
						});
			}
			return Promise.resolve({});
		});

		const user = userEvent.setup();
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() => expect(chatCalls).toBeGreaterThanOrEqual(1));

		await user.click(screen.getByRole("button", { name: "refresh" }));
		await waitFor(
			() => {
				expect(screen.getByTestId("chat-unread")).toHaveTextContent("1");
				expect(
					screen.getByTestId("notifs").textContent ?? "",
				).toContain("New reply in your inbox");
			},
			{ timeout: 3000 },
		);
	});

	it("pings the device once when updates piled up while the tab was hidden", async () => {
		const shown: Array<{ title: string }> = [];
		const Ctor = vi.fn(function (this: unknown, title: string) {
			shown.push({ title });
			return this;
		}) as unknown as typeof Notification;
		Object.defineProperty(Ctor, "permission", { value: "granted", configurable: true });
		vi.stubGlobal("Notification", Ctor);
		const hiddenDesc = Object.getOwnPropertyDescriptor(document, "hidden");
		Object.defineProperty(document, "hidden", { value: true, configurable: true });

		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat"))
				return Promise.resolve({ messages: [{ sender: "ai", read: false }] });
			return Promise.resolve({});
		});

		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		// Mount run skips while hidden — nothing shown, nothing raised.
		await act(async () => {
			await Promise.resolve();
		});
		expect(shown).toHaveLength(0);

		// Return + refresh identity re-runs the check with fresh items waiting.
		Object.defineProperty(document, "hidden", { value: false, configurable: true });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "refresh" }));
		await waitFor(
			() => {
				expect(screen.getByTestId("chat-unread")).toHaveTextContent("1");
			},
			{ timeout: 3000 },
		);
		expect(shown).toHaveLength(1);
		expect(shown[0]?.title).toMatch(/away|reply|inbox|update/i);

		if (hiddenDesc) Object.defineProperty(document, "hidden", hiddenDesc);
		vi.unstubAllGlobals();
	});
});

describe("AppProvider — edge paths", () => {
	function deferred<T>() {
		let resolve!: (value: T) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	it("does not fire a ban notification when the heartbeat resolves after unmount", async () => {
		const statuses: AccountStatus[] = [benignStatus];
		const beat2 = deferred<AccountStatus>();
		h.post.mockImplementation((url: string) => {
			if (url === "/api/users") {
				const s = statuses.shift();
				return s ? Promise.resolve(s) : beat2.promise;
			}
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		const { unmount } = render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status")).toHaveTextContent('"banned":false'),
		);

		// second anonId → new heartbeat effect holds a pending beat
		await user.click(screen.getByRole("button", { name: "refresh" }));
		unmount();
		await act(async () => {
			beat2.resolve({
				banned: true,
				suspended: false,
				suspended_until: null,
				strikes: 1,
			});
		});
		// cancelled beat must NOT push the ban notification
		expect(
			h.lsSet.mock.calls.filter((c) => c[0] === "vb:notifications"),
		).toHaveLength(0);
	});

	it("does not clobber local bookmarks when the saved-posts sync resolves after unmount", async () => {
		const d = deferred<{ saved: string[] }>();
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/saved")) return d.promise;
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		const { unmount } = render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		unmount();
		await act(async () => {
			d.resolve({ saved: ["srv1"] });
		});
		expect(
			h.lsSet.mock.calls.filter((c) => c[0] === "vb:bookmarks"),
		).toHaveLength(0);
	});

	it("writes no snapshot when the notification check resolves after unmount", async () => {
		const d = deferred<PostData[]>();
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts")) return d.promise;
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		const { unmount } = render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		unmount();
		await act(async () => {
			d.resolve([]);
		});
		expect(
			h.lsSet.mock.calls.filter((c) => c[0] === "vb:notifSnapshot"),
		).toHaveLength(0);
	});

	it("skips the notification engine while the tab is hidden", async () => {
		const originalHidden = document.hidden;
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => true,
		});
		let postsCalls = 0;
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts")) {
				postsCalls++;
				return Promise.resolve([]);
			}
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		try {
			render(
				<AppProvider>
					<Probe />
				</AppProvider>,
			);
			await act(async () => {
				await new Promise((r) => setTimeout(r, 10));
			});
			expect(postsCalls).toBe(0);
		} finally {
			Object.defineProperty(document, "hidden", {
				configurable: true,
				get: () => originalHidden,
			});
		}
	});

	it("survives a posts fetch failure in the notification engine", async () => {
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.reject(new Error("posts down"));
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/chat")) return Promise.resolve(null);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(h.lsSet).toHaveBeenCalledWith(
				"vb:notifSnapshot",
				expect.any(Object),
			),
		);
	});

	it("survives a chat fetch failure in the notification engine", async () => {
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/chat"))
				return Promise.reject(new Error("chat down"));
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(h.lsSet).toHaveBeenCalledWith(
				"vb:notifSnapshot",
				expect.any(Object),
			),
		);
		expect(screen.getByTestId("chat-unread")).toHaveTextContent("0");
	});

	it("survives a voter-polls fetch failure in the notification engine", async () => {
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/polls?voter="))
				return Promise.reject(new Error("voter down"));
			if (url.includes("/api/polls")) return Promise.resolve([]);
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) return Promise.resolve(null);
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(h.lsSet).toHaveBeenCalledWith(
				"vb:notifSnapshot",
				expect.any(Object),
			),
		);
	});

	it("survives a poll-list fetch failure and skips polls missing from the list", async () => {
		h.get.mockImplementation((url: string) => {
			if (url.includes("/api/polls?voter="))
				return Promise.resolve([{ poll_id: "ghost" }]);
			if (url.includes("/api/polls"))
				return Promise.reject(new Error("list down"));
			if (url.includes("/api/saved")) return Promise.resolve({ saved: [] });
			if (url.includes("/api/posts")) return Promise.resolve([]);
			if (url.includes("/api/chat")) return Promise.resolve(null);
			return Promise.resolve({});
		});
		render(
			<AppProvider>
				<Probe />
			</AppProvider>,
		);
		await waitFor(() =>
			expect(h.lsSet).toHaveBeenCalledWith(
				"vb:notifSnapshot",
				expect.any(Object),
			),
		);
	});
});
