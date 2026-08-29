// ═══════════════════════════════════════════════════════════════════
// Submit page — publish payload integrity
// ═══════════════════════════════════════════════════════════════════
// Locks the /submit contract:
//   1. Title and description are sent SEPARATELY — the title is never
//      duplicated into the description and description words never
//      leak into the title (regression: both fields were re-derived
//      from the combined masked text, corrupting stored posts).
//   2. Profanity masking still applies per field.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
	api: { get: mocks.get, post: mocks.post, uploadImage: mocks.uploadImage },
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

vi.mock("../lib/speech", () => ({
	speechSupported: false,
	startDictation: vi.fn(),
}));

// ModerateContent stays REAL — this test guards its per-field usage in submit().

const APPROVED = {
	decision: "approved",
	reason: "",
	risk_score: 0,
	checks: {
		privacy: { pass: true, issues: [] },
		safety: { pass: true, issues: [] },
		spam: { pass: true, issues: [] },
		quality: { pass: true, issues: [] },
	},
	analysis: {
		priority: "low",
		department: "Facilities",
		summary: "x",
		estimated_resolution_time: "1d",
		llm_analyzed: false,
	},
};

function mockPublishFlow() {
	let published: Record<string, unknown> | null = null;
	mocks.post.mockImplementation(
		(url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve(APPROVED);
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
	return render(
		<MemoryRouter>
			<Submit />
		</MemoryRouter>,
	);
}

function fillAndPublish(title: string, description: string) {
	// Atomic change events: typing char-by-char with userEvent races the
	// controlled input under CI load. The behavior under test is the publish
	// payload, not keystroke simulation, so set values in one shot.
	fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
		target: { value: title },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
		target: { value: description },
	});
	fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockImplementation((url: string) => {
		if (String(url).includes("/api/categories"))
			return Promise.resolve({
				categories: ["Academics", "Facilities", "Food", "Other"],
			});
		return Promise.resolve([]);
	});
	localStorage.clear();
});

describe("Submit — publish payload integrity", () => {
	it("keeps title and description distinct when publishing", {
		timeout: 20000,
	}, async () => {
		const getPublished = mockPublishFlow();
		renderPage();

		fillAndPublish(
			"Broken locker 114 rattles at night",
			"The locker door hinge is loose and slams loudly every time someone opens it near my class.",
		);

		await waitFor(
			() => {
				expect(mocks.post).toHaveBeenCalledWith(
					"/api/posts",
					expect.any(Object),
				);
			},
			{ timeout: 10000 },
		);
		const payload = getPublished() as Record<string, unknown>;

		// Title is exactly the typed title — no description words bleed in.
		expect(payload.title).toBe("Broken locker 114 rattles at night");
		// Description is exactly the typed description — no title duplication.
		expect(payload.description).toBe(
			"The locker door hinge is loose and slams loudly every time someone opens it near my class.",
		);
		expect(payload.title).not.toContain("hinge");
		expect(payload.description).not.toContain("Broken locker 114");
	});

	it("masks profanity per field without merging them", {
		timeout: 20000,
	}, async () => {
		const getPublished = mockPublishFlow();
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is fucking annoying, the door keeps slamming.",
		);

		await waitFor(
			() => {
				expect(mocks.post).toHaveBeenCalledWith(
					"/api/posts",
					expect.any(Object),
				);
			},
			{ timeout: 10000 },
		);
		const payload = getPublished() as Record<string, unknown>;

		expect(payload.title).toBe("Broken locker rattles");
		expect(payload.description).toBe(
			"This is f****** annoying, the door keeps slamming.",
		);
	});
});

describe("Submit — poll link selector", () => {
	it("only shows the current user's own posts in the link dropdown", async () => {
		// Mock API to return posts from different authors
		mocks.get.mockImplementation((url: string) => {
			if (String(url).includes("/api/posts")) {
				return Promise.resolve([
					{
						id: "my-post-1",
						title: "My broken lift",
						author_id: "anon-test",
						status: "open",
						type: "problem",
					},
					{
						id: "other-post-1",
						title: "Someone else's complaint",
						author_id: "anon-other",
						status: "open",
						type: "problem",
					},
					{
						id: "my-post-2",
						title: "Another one of mine",
						author_id: "anon-test",
						status: "open",
						type: "problem",
					},
				]);
			}
			if (String(url).includes("/api/categories")) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		});

		// Start on the poll tab
		render(
			<MemoryRouter initialEntries={["/submit?type=poll"]}>
				<Submit />
			</MemoryRouter>,
		);

		// Wait for the link dropdown to populate
		await waitFor(() => {
			expect(screen.getByText(/My broken lift/)).toBeInTheDocument();
		});

		// The other user's post should NOT appear
		expect(screen.queryByText(/Someone else's complaint/)).toBeNull();

		// Both of the user's posts should appear
		expect(screen.getByText(/My broken lift/)).toBeInTheDocument();
		expect(screen.getByText(/Another one of mine/)).toBeInTheDocument();
	});
});
