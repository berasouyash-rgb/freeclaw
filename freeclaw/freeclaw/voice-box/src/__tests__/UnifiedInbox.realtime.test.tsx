// Admin UnifiedInbox — live threads without a refresh click
// (evolution 2026-10-05). chat_messages / chat_threads are outside the
// anon realtime contract, so the subscription can never deliver: new
// conversations and replies appeared only after a manual refresh. A
// visible-only peek revalidates the thread list (and the open thread's
// messages) with fresh reads — never a mark_read write, never a loader.

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnifiedInbox from "../pages/admin/UnifiedInbox";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	getFresh: vi.fn(),
	put: vi.fn(),
	post: vi.fn(),
	useRealtime: vi.fn(),
	setSearchParams: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getFresh: mocks.getFresh,
		put: mocks.put,
		post: mocks.post,
	},
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: mocks.useRealtime,
}));

vi.mock("../components/admin/chat-utils", () => ({
	CopyButton: () => null,
	DownloadButton: () => null,
	QUICK_REPLIES: [],
}));

vi.mock("../components/ui", () => ({
	PromptDialog: () => null,
}));

vi.mock("../components/admin/DraftProposal", () => ({
	default: () => null,
}));

vi.mock("../lib/markdown", () => ({
	renderMarkdown: (s: string) => s,
}));

vi.mock("react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-router")>();
	return {
		...actual,
		useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
		Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
			<a href={to}>{children}</a>
		),
	};
});

const T1 = {
	thread_id: "thread-1",
	title: "Canteen prices",
	updated_at: "2026-09-01T10:00:00Z",
	last_at: "2026-09-01T10:00:00Z",
	unread: 1,
};

function threadsImpl(threads: unknown[]) {
	mocks.get.mockImplementation(async (url: unknown) => {
		if (typeof url === "string" && url.includes("threads=1")) return { threads };
		return { messages: [], thread: {} };
	});
	mocks.getFresh.mockImplementation(async (url: unknown) => {
		if (typeof url === "string" && url.includes("threads=1")) return { threads };
		return { messages: [], thread: {} };
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.put.mockResolvedValue({ ok: true });
});

async function renderInbox() {
	render(
		<MemoryRouter>
			<UnifiedInbox />
		</MemoryRouter>,
	);
	await waitFor(() => {
		expect(screen.getByText("Canteen prices")).toBeTruthy();
	});
}

describe("UnifiedInbox — visible peek", () => {
	it("lists a conversation that starts after mount, with no clicks", async () => {
		threadsImpl([T1]);
		await renderInbox();
		const getsBefore = mocks.get.mock.calls.length + mocks.getFresh.mock.calls.length;

		// A student starts a new conversation on another device.
		const T2 = { ...T1, thread_id: "thread-2", title: "Bus delay" };
		threadsImpl([T2, T1]);

		await waitFor(() => {
			expect(screen.getByText("Bus delay")).toBeTruthy();
		}, { timeout: 15000 });
		const getsAfter = mocks.get.mock.calls.length + mocks.getFresh.mock.calls.length;
		expect(getsAfter).toBeGreaterThan(getsBefore);
		// The peek reads only — read state is written by explicit
		// open/send paths, never by the background tick.
		expect(mocks.put).not.toHaveBeenCalled();
	}, 20000);
});
