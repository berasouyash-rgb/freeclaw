import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ThreadDrawer from "../components/admin/ThreadDrawer";

vi.mock("../lib/api", () => ({
	api: { get: vi.fn() },
}));
vi.mock("../lib/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../lib/utils")>();
	return { ...mod, timeAgo: () => "2m ago" };
});

import { api } from "../lib/api";
const mockedGet = api.get as ReturnType<typeof vi.fn>;

const MSGS = [
	{ id: "m1", sender: "user", body: "I need help", created_at: "2026-07-02T09:00:00.000Z" },
	{ id: "m2", sender: "ai", body: "I am here", created_at: "2026-07-02T09:01:00.000Z" },
];

beforeEach(() => {
	vi.clearAllMocks();
	mockedGet.mockResolvedValue({ messages: MSGS });
});

describe("ThreadDrawer", () => {
	it("renders nothing when closed", () => {
		render(<ThreadDrawer threadId={null} onClose={vi.fn()} onOpenInbox={vi.fn()} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(mockedGet).not.toHaveBeenCalled();
	});

	it("loads and shows the chat directly on the dashboard", async () => {
		render(<ThreadDrawer threadId="thr_1" onClose={vi.fn()} onOpenInbox={vi.fn()} />);
		expect(await screen.findByText("I need help")).toBeInTheDocument();
		expect(screen.getByText("I am here")).toBeInTheDocument();
		expect(mockedGet).toHaveBeenCalledWith("/api/inbox?thread_id=thr_1");
	});

	it("reports load failures honestly with a retry", async () => {
		mockedGet.mockRejectedValueOnce(new Error("down"));
		render(<ThreadDrawer threadId="thr_1" onClose={vi.fn()} onOpenInbox={vi.fn()} />);
		expect(await screen.findByText("down")).toBeInTheDocument();
		mockedGet.mockResolvedValue({ messages: MSGS });
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("I need help")).toBeInTheDocument();
	});

	it("hands the thread to the full inbox for replies", async () => {
		const onOpenInbox = vi.fn();
		render(<ThreadDrawer threadId="thr_1" onClose={vi.fn()} onOpenInbox={onOpenInbox} />);
		await screen.findByText("I need help");
		fireEvent.click(screen.getByRole("button", { name: "Reply in inbox to thr_1" }));
		expect(onOpenInbox).toHaveBeenCalledWith("thr_1");
	});
});
