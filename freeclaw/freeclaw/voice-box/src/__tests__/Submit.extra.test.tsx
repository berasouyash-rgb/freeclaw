// Submit extra coverage — validation gates + server verdicts
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Submit from "../pages/Submit";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	pushNotif: vi.fn(),
	fireConfetti: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	uploadImage: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		post: mocks.post,
		uploadImage: mocks.uploadImage,
		postSlow: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		postLong: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		put: vi.fn(async () => ({})),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		pushNotif: mocks.pushNotif,
		accountStatus: null,
	}),
}));

vi.mock("../components/Confetti", () => ({
	fireConfetti: mocks.fireConfetti,
}));

function mockPublishFlow() {
	let published: Record<string, unknown> | null = null;
	mocks.post.mockImplementation(
		(url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve({
					decision: "approved",
					reason: "",
					risk_score: 0,
					checks: { privacy: { pass: true, issues: [] }, safety: { pass: true, issues: [] }, spam: { pass: true, issues: [] }, quality: { pass: true, issues: [] } },
					analysis: { priority: "low", department: "Facilities", summary: "x", estimated_resolution_time: "1d", llm_analyzed: false },
				});
			if (String(url).includes("/api/posts")) {
				published = body ?? null;
				return Promise.resolve({ id: "post_1", title: body?.title ?? "" });
			}
			return Promise.resolve({});
		},
	);
	return () => published;
}

function renderPage() {
	return render(<MemoryRouter><Submit /></MemoryRouter>);
}

function fillAndPublish(title: string, description: string) {
	fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), { target: { value: title } });
	fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), { target: { value: description } });
	fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockImplementation((url: string) => {
		if (String(url).includes("/api/categories"))
			return Promise.resolve({ categories: ["Academics", "Facilities", "Food", "Other"] });
		return Promise.resolve([]);
	});
	localStorage.clear();
});

describe("Submit extra — validation gates + server verdict", () => {
	it("rejects a too-short title", async () => {
		mockPublishFlow();
		renderPage();
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), { target: { value: "The locker door hinge is loose and slams." } });
		fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/Title must be at least 5/i), "err");
		});
		expect(mocks.post).not.toHaveBeenCalledWith("/api/posts", expect.anything());
	}, 20000);

	it("rejects a too-short description", async () => {
		mockPublishFlow();
		renderPage();
		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), { target: { value: "Broken locker" } });
		fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/Description must be at least 10/i), "err");
		});
		expect(mocks.post).not.toHaveBeenCalledWith("/api/posts", expect.anything());
	}, 20000);

	it("holds high_risk content for review", async () => {
		mockPublishFlow();
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve({ decision: "high_risk", reason: "Personal email detected", risk_score: 0.9,
					checks: { privacy: { pass: false, issues: ["email"] }, safety: { pass: true, issues: [] }, spam: { pass: true, issues: [] }, quality: { pass: true, issues: [] } },
					analysis: null });
			if (String(url).includes("/api/posts")) return Promise.resolve({ id: "post_1", title: body?.title ?? "" });
			return Promise.resolve({});
		});
		renderPage();
		fillAndPublish("Broken locker AC issue", "The locker door hinge is loose and slams loudly every time it opens near my class.");
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/Content held for review/i), "err");
		});
		expect(mocks.post).not.toHaveBeenCalledWith("/api/posts", expect.anything());
	}, 20000);

	it("queues revision-flagged post for review", async () => {
		mockPublishFlow();
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve({ decision: "revision", reason: "Needs clearer details", risk_score: 0.3,
					checks: { privacy: { pass: true, issues: [] }, safety: { pass: true, issues: [] }, spam: { pass: true, issues: [] }, quality: { pass: false, issues: ["vague"] } },
					analysis: null });
			if (String(url).includes("/api/posts")) return Promise.resolve({ id: "post_2", title: body?.title ?? "" });
			return Promise.resolve({});
		});
		renderPage();
		fillAndPublish("Broken locker AC issue 2", "The locker door hinge is loose and slams loudly every time it opens near class.");
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/posts", expect.objectContaining({ pending_review: true }));
		}, { timeout: 15000 });
	}, 20000);

	it("proceeds when advisory pre-publish check is unavailable", async () => {
		mockPublishFlow();
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish")) return Promise.reject(new Error("timeout"));
			if (String(url).includes("/api/posts")) return Promise.resolve({ id: "post_3", title: body?.title ?? "" });
			return Promise.resolve({});
		});
		renderPage();
		fillAndPublish("Window draft issue 3", "The window pane is cracked and lets wind through every winter day.");
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/Moderation check is taking longer/i), "info");
		}, { timeout: 15000 });
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/posts", expect.anything());
		}, { timeout: 15000 });
	}, 20000);

	it("restores a saved draft and notifies", async () => {
		localStorage.setItem("vb:drafts", JSON.stringify({
			title: "Saved draft title text",
			desc: "Saved draft description that must be restored correctly for coverage",
			category: "Academics", tags: "tag1, tag2", type: "problem",
			savedAt: new Date().toISOString(),
		}));
		renderPage();
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/Draft restored/i), "info");
		});
		expect((screen.getByRole("textbox", { name: "Title *" }) as HTMLInputElement).value).toBe("Saved draft title text");
	}, 20000);
});