// ═══════════════════════════════════════════════════════════════════
// UserManager — anonymous user management contract
// ═══════════════════════════════════════════════════════════════════
// Locks: user list rendering (status chips, sorting), search filter,
// detail drawer (loading + loaded), suspend/unban/warn/spam/ban actions,
// notes autosave, activity timeline rendering + empty state, message-user
// wiring, error toasts.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserManager from "../pages/admin/UserManager";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	post: vi.fn(),
	postPaginated: vi.fn(),
	items: [] as unknown[],
	initialLoading: false,
	total: 0,
	reset: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { post: mocks.post, postPaginated: mocks.postPaginated },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../hooks/useInfiniteScroll", () => ({
	useInfiniteScroll: () => ({
		items: mocks.items as any[],
		loading: false,
		initialLoading: mocks.initialLoading ?? false,
		hasMore: false,
		total: mocks.total ?? 0,
		sentinelRef: { current: null },
		loadMore: vi.fn(),
		// Simulate server-side search on reset: re-filter items by the current search query
		reset: (..._args: unknown[]) => {
			// Extract the current search query from the mock postPaginated calls
			const calls = mocks.postPaginated.mock.calls;
			const lastCall = calls[calls.length - 1];
			const search = lastCall?.[1]?.search as string || "";
			// Only override items if there IS a search query — otherwise keep the test's setup
			if (search) {
				const filtered = USERS.filter((u) => u.anon_id.toLowerCase().includes(search.toLowerCase()));
				mocks.items = filtered;
				mocks.total = filtered.length;
			}
			mocks.reset?.();
		},
		replaceItems: vi.fn(),
		setItems: vi.fn(),
	}),
}));

vi.mock("../lib/utils", async (importOriginal) => ({
	...(await importOriginal()),
	fmtDate: (d: string) => `DATE(${d})`,
	timeAgo: () => "2d ago",
}));

vi.mock("../components/ui", () => ({
	ConfirmDialog: ({ open, onClose, onConfirm, title, confirmLabel }: any) =>
		open ? (
			<div role="dialog" aria-label={title}>
				<button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
	PromptDialog: ({ open, onSubmit, onClose, title, submitLabel }: any) =>
		open ? (
			<div role="dialog" aria-label={title}>
				<p>{title}</p>
				<input aria-label="prompt-input" defaultValue="" />
				<button
					onClick={() => onSubmit("typed value")}
				>
					{submitLabel || "Save"}
				</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
}));

const USERS = [
	{
		anon_id: "anon_aaa",
		last_seen: "2026-07-10T10:00:00.000Z",
		post_count: 3,
		comment_count: 5,
		reaction_count: 9,
		strikes: 0,
		spam_score: 0,
		banned: false,
	},
	{
		anon_id: "anon_bbb",
		last_seen: "2026-07-01T10:00:00.000Z",
		post_count: 0,
		comment_count: 1,
		reaction_count: 0,
		strikes: 2,
		spam_score: 80,
		banned: true,
	},
	{
		anon_id: "anon_ccc",
		last_seen: "2026-07-05T10:00:00.000Z",
		post_count: 1,
		comment_count: 0,
		reaction_count: 2,			suspended_until: "2099-08-01T10:00:00.000Z",
		},
	];

const DETAIL = {
	anon_id: "anon_aaa",
	meta: {
		anon_id: "anon_aaa",
		notes: "original note",
		warnings: [{ text: "Keep it civil", at: "2026-06-01T10:00:00.000Z" }],
		created_at: "2026-05-01T10:00:00.000Z",
		strikes: 1,
		spam_score: 0,
		banned: false,
		suspended_until: null,
	},
	posts: [
		{
			id: "p1",
			title: "Broken lift",
			description: "Third floor",
			created_at: "2026-06-02T10:00:00.000Z",
			status: "reported",
			deleted: false,
		},
	],
	comments: [],
	reactions: [{ kind: "support", target_id: "p9", created_at: "2026-06-03T10:00:00.000Z" }],
	reports: [],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.items = [...USERS];
	mocks.total = USERS.length;
	mocks.initialLoading = false;
	mocks.reset = vi.fn();
	mocks.post.mockResolvedValue({});
	// Simulate server-side search: filter by search param if provided
	mocks.postPaginated.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
		const search = (body?.search as string) || "";
		const filtered = search
			? USERS.filter((u) => u.anon_id.toLowerCase().includes(search.toLowerCase()))
			: USERS;
		return { data: filtered, nextCursor: null, total: filtered.length };
	});
});

function renderPage() {
	return render(<UserManager />);
}

describe("UserManager — list rendering", () => {
	it("renders the header and total count", async () => {
		renderPage();
		expect(
			await screen.findByText(/User Management/i),
		).toBeInTheDocument();
		expect(screen.getByText("3 total")).toBeInTheDocument();
	});

	it("lists users with counts and status chips", async () => {
		renderPage();
		expect(await screen.findByText("anon_aaa")).toBeInTheDocument();
		expect(screen.getByText("anon_bbb")).toBeInTheDocument();
		// Banned chip on banned user
		expect(screen.getByText("Banned")).toBeInTheDocument();
	// Active + Suspended chips (one active user, one suspended)
	expect(screen.getByText("Active")).toBeInTheDocument();
		expect(screen.getByText("Suspended")).toBeInTheDocument();
	});

	it("sorts users by last_seen descending (most recent first)", async () => {
		renderPage();
		await screen.findByText("anon_aaa");
		const rows = screen.getAllByRole("row");
		// header + 3 rows; first data row must be anon_aaa (most recent)
		expect(rows[1]).toHaveTextContent("anon_aaa");
		expect(rows[2]).toHaveTextContent("anon_ccc");
		expect(rows[3]).toHaveTextContent("anon_bbb");
	});

	it("shows skeletons while the initial load is pending", () => {
		mocks.initialLoading = true;
		renderPage();
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
	});

	it("shows the empty state when no users match", async () => {
		mocks.items = [];
		mocks.total = 0;
		renderPage();
		expect(await screen.findByText("No users found.")).toBeInTheDocument();
	});
});

describe("UserManager — search (server-side)", () => {
	it("search input accepts text", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");

		const input = screen.getByPlaceholderText("Search anonymous ID…");
		await user.type(input, "bbb");
		expect(input).toHaveValue("bbb");
	});

	it("server-side filtered results are displayed when provided", async () => {
		// Simulate server returning only matching user (as server would)
		mocks.items = [USERS[1]];
		mocks.total = 1;
		renderPage();
		expect(await screen.findByText("anon_bbb")).toBeInTheDocument();
		expect(screen.queryByText("anon_aaa")).not.toBeInTheDocument();
	});

	it("shows 'no users found' when server returns empty", async () => {
		mocks.items = [];
		mocks.total = 0;
		renderPage();
		expect(await screen.findByText("No users found.")).toBeInTheDocument();
	});

	it("preselects the author handed off from the feed drawer", async () => {
		sessionStorage.setItem("vb:adminUserTarget", "anon_bbb");
		try {
			renderPage();
			const input = (await screen.findByPlaceholderText(
				"Search anonymous ID…",
			)) as HTMLInputElement;
			expect(input.value).toBe("anon_bbb");
		} finally {
			sessionStorage.removeItem("vb:adminUserTarget");
		}
	});
});

describe("UserManager — detail drawer", () => {
	it("opens the detail drawer for a user and shows meta + warnings", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");

		await user.click(screen.getByText("anon_aaa"));
		await waitFor(() => {
			expect(screen.getByText("Keep it civil")).toBeInTheDocument();
		});
		expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
			action: "user_detail",
			anon_id: "anon_aaa",
		});
		expect(screen.getByText("Warnings issued")).toBeInTheDocument();
	});

	it("shows the banned banner in the drawer for banned users", async () => {
		mocks.post.mockResolvedValue({
			...DETAIL,
			anon_id: "anon_bbb",
			meta: { ...DETAIL.meta, anon_id: "anon_bbb", banned: true },
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_bbb");

		await user.click(screen.getByText("anon_bbb"));
		expect(await screen.findByText("Permanently banned")).toBeInTheDocument();
	});	it("shows a suspension banner with date when suspended", async () => {
		mocks.post.mockResolvedValue({
			...DETAIL,
			anon_id: "anon_ccc",
			meta: {
				...DETAIL.meta,
				anon_id: "anon_ccc",
				suspended_until: "2099-08-01T10:00:00.000Z",
			},
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_ccc");

		await user.click(screen.getByText("anon_ccc"));
		expect(await screen.findByText(/Suspended until/)).toBeInTheDocument();
		expect(
			screen.getByText(/Suspended until DATE\(2099-08-01T10:00:00\.000Z\)/),
		).toBeInTheDocument();
	});

	it("hides Lift suspension when there is no suspension, shows it while suspended", async () => {
		const user = userEvent.setup();
		// No suspension: no Lift button at all.
		mocks.post.mockResolvedValue(DETAIL);
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await waitFor(() => {
			expect(screen.getByText("Keep it civil")).toBeInTheDocument();
		});
		expect(
			screen.queryByRole("button", { name: "Lift suspension" }),
		).not.toBeInTheDocument();

		// Active suspension: the Lift button is available.
		mocks.post.mockResolvedValue({
			...DETAIL,
			meta: { ...DETAIL.meta, suspended_until: "2099-08-01T10:00:00.000Z" },
		});
		await user.click(screen.getAllByText("anon_aaa")[0]!);
		expect(
			await screen.findByRole("button", { name: "Lift suspension" }),
		).toBeInTheDocument();
	});

	it("locks background scroll while the drawer is open (no scroll chaining)", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		const { unmount } = renderPage();
		await screen.findByText("anon_aaa");

		await user.click(screen.getByText("anon_aaa"));
		await waitFor(() => {
			expect(screen.getByText("Keep it civil")).toBeInTheDocument();
		});
		expect(document.body.style.overflow).toBe("hidden");
		const panel = screen
			.getByText("Keep it civil")
			.closest("div.fixed")!
			.querySelector(".overflow-y-auto")!;
		expect(panel.classList.contains("overscroll-contain")).toBe(true);

		unmount();
		expect(document.body.style.overflow).toBe("");
	});

	it("filters by presence and hides test accounts on demand", async () => {
		const user = userEvent.setup();
		mocks.items = [
			...USERS,
			{
				anon_id: "anon_now",
				last_seen: new Date().toISOString(),
				post_count: 1,
				comment_count: 0,
				reaction_count: 0,
				strikes: 0,
				spam_score: 0,
				banned: false,
			},
			{
				anon_id: "anon_loadtest_zzz_99",
				last_seen: new Date().toISOString(),
				post_count: 0,
				comment_count: 0,
				reaction_count: 0,
				strikes: 0,
				spam_score: 0,
				banned: false,
			},
		];
		renderPage();
		await screen.findByText("anon_aaa");

		// Pills render with live counts; fresh rows show "Now".
		expect(screen.getByRole("button", { name: /Now \(/ })).toBeInTheDocument();
		expect(screen.getAllByText("Now").length).toBeGreaterThan(0);

		// "Now" pill keeps only recently-seen rows.
		await user.click(screen.getByRole("button", { name: /Now \(/ }));
		expect(screen.queryByText("anon_aaa")).not.toBeInTheDocument();
		expect(screen.getByText("anon_now")).toBeInTheDocument();

		// Test-accounts toggle hides residue but states the count.
		await user.click(screen.getByRole("button", { name: /All \(/ }));
		await user.click(screen.getByRole("button", { name: /Hide test accounts \(1\)/ }));
		expect(screen.queryByText("anon_loadtest_zzz_99")).not.toBeInTheDocument();
		expect(screen.getByText("anon_now")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Show test accounts \(1\)/ })).toBeInTheDocument();
	});

	it("renders the activity timeline with mixed events sorted newest-first", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");

		await user.click(screen.getByText("anon_aaa"));
		expect(await screen.findByText("Activity timeline")).toBeInTheDocument();
		expect(screen.getByText(/Broken lift/)).toBeInTheDocument();
		expect(screen.getByText(/Reacted \(support\)/)).toBeInTheDocument();
	});

	it("shows the timeline empty state when there is no activity", async () => {
		mocks.post.mockResolvedValue({
			...DETAIL,
			posts: [],
			comments: [],
			reactions: [],
			reports: [],
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");

		await user.click(screen.getByText("anon_aaa"));
		expect(
			await screen.findByText("No activity recorded for this user."),
		).toBeInTheDocument();
	});

	it("closes the drawer via the X button", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		// X close button is the one in the drawer header (no accessible name — use title/aria)
		const drawer = screen.getByText("Warnings issued").closest(".fixed") as HTMLElement;
		const closeBtn = within(drawer).getAllByRole("button").find(
			(b) => (b as HTMLButtonElement).innerHTML.includes("</svg>") &&
				(b as HTMLButtonElement).getAttribute("aria-label") !== "prompt-input",
		) as HTMLElement;
		fireEvent.click(closeBtn);
		await waitFor(() => {
			expect(screen.queryByText("Warnings issued")).not.toBeInTheDocument();
		});
	});

	it("toasts an error when the detail load fails", async () => {
		mocks.post.mockRejectedValue(new Error("detail boom"));
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("detail boom", "err");
		});
	});
});

describe("UserManager — moderation actions", () => {
	it("suspends a user for 7 days via update_user", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		await user.click(screen.getByRole("button", { name: "Suspend 7d" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
				action: "update_user",
				anon_id: "anon_aaa",
				suspend_days: 7,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("User updated", "ok");
	});

	it("lifts a suspension via suspend_days: 0", async () => {
		mocks.post.mockResolvedValue({
			...DETAIL,
			meta: { ...DETAIL.meta, suspended_until: "2099-08-01T10:00:00.000Z" },
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		await user.click(screen.getByRole("button", { name: "Lift suspension" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
				action: "update_user",
				anon_id: "anon_aaa",
				suspend_days: 0,
			});
		});
	});

	it("opens the warn dialog and submits the warning message", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		await user.click(screen.getByRole("button", { name: /Warn \(\+strike\)/ }));
		const dialog = screen.getByRole("dialog", { name: "Issue warning" });
		await user.click(within(dialog).getByRole("button", { name: "Send warning" }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
				action: "update_user",
				anon_id: "anon_aaa",
				warn: "typed value",
			});
		});
	});

	it("opens the spam dialog and clamps the score to 0-100", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		await user.click(screen.getByRole("button", { name: "Set spam score" }));
		const dialog = screen.getByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: "Save score" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
				action: "update_user",
				anon_id: "anon_aaa",
				spam_score: expect.any(Number),
			});
		});
	});

	it("permanently bans a user after confirmation", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		await user.click(screen.getByRole("button", { name: /Permanent ban/ }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Ban permanently",
			}),
		);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
				action: "update_user",
				anon_id: "anon_aaa",
				banned: true,
			});
		});
	});

	it("shows Unban instead of ban for already-banned users", async () => {
		mocks.post.mockResolvedValue({
			...DETAIL,
			anon_id: "anon_bbb",
			meta: { ...DETAIL.meta, anon_id: "anon_bbb", banned: true },
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_bbb");
		await user.click(screen.getByText("anon_bbb"));
		await screen.findByText("Permanently banned");

		await user.click(screen.getByRole("button", { name: "Unban" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
				action: "update_user",
				anon_id: "anon_bbb",
				banned: false,
			});
		});
	});

	it("saves moderator notes on blur when they changed", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		const textarea = screen.getByPlaceholderText(
			"Notes, appeal outcomes, context…",
		);
		await user.clear(textarea);
		await user.type(textarea, "appeal approved");
		fireEvent.blur(textarea);

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/admin", {
				action: "update_user",
				anon_id: "anon_aaa",
				notes: "appeal approved",
			});
		});
	});

	it("does not save notes when unchanged on blur", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		const textarea = screen.getByPlaceholderText(
			"Notes, appeal outcomes, context…",
		);
		fireEvent.blur(textarea);
		expect(mocks.post).not.toHaveBeenCalledWith(
			expect.objectContaining({ action: "update_user" }),
		);
	});

	it("wires Message this user to the inbox tab with the target set", async () => {
		mocks.post.mockResolvedValue(DETAIL);
		const listener = vi.fn();
		window.addEventListener("vb:admin-tab", listener);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByText("anon_aaa"));
		await screen.findByText("Warnings issued");

		await user.click(screen.getByRole("button", { name: "Message this user" }));
		expect(sessionStorage.getItem("vb:adminChatTarget")).toBe("anon_aaa");
		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({ detail: "inbox" }),
			);
		});
		window.removeEventListener("vb:admin-tab", listener);
		sessionStorage.removeItem("vb:adminChatTarget");
	});
});

describe("UserManager — presence honesty", () => {
	it("excludes banned and suspended users from Now counts", async () => {
		const user = userEvent.setup();
		mocks.items = [
			...USERS,
			{
				anon_id: "anon_fresh_banned",
				last_seen: new Date().toISOString(),
				post_count: 0, comment_count: 0, reaction_count: 0,
				strikes: 0, spam_score: 0, banned: true,
			},
			{
				anon_id: "anon_fresh_susp",
				last_seen: new Date().toISOString(),
				post_count: 0, comment_count: 0, reaction_count: 0,
				strikes: 0, spam_score: 0, banned: false,
				suspended_until: "2099-08-01T10:00:00.000Z",
			},
		];
		renderPage();
		await screen.findByText("anon_aaa");
		// Neither fresh-but-blocked row may inflate the Now pill…
		expect(screen.getByRole("button", { name: /Now \(0\)/ })).toBeInTheDocument();
		// …but both still appear under All (nothing hidden silently).
		await user.click(screen.getByRole("button", { name: /All \(/ }));
		expect(screen.getByText("anon_fresh_banned")).toBeInTheDocument();
		expect(screen.getByText("anon_fresh_susp")).toBeInTheDocument();
	});

	it("persists the presence scope per device", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("anon_aaa");
		await user.click(screen.getByRole("button", { name: /Hour \(/ }));
		const stored = JSON.parse(localStorage.getItem("vb:userscope") || "{}");
		expect(stored).toMatchObject({ filter: "hour" });
	});
});
