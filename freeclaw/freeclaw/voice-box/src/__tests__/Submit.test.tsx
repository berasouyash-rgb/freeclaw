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


// ModerateContent stays REAL — submit() sends RAW fields and the pre-send
// gate blocks on critical/privacy/profanity (school zero-tolerance).

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
	it("ignores a second rapid publish click — one action, one post", {
		timeout: 20000,
	}, async () => {
		// The posts endpoint HANGS: the first submit parks mid-flight (as on
		// a real slow network), so the cooldown — stamped only on success —
		// cannot save us. Only the synchronous ref guard stops the twin.
		let postsCalls = 0;
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve(APPROVED);
			if (String(url).includes("/api/posts")) {
				postsCalls += 1;
				return new Promise(() => {});
			}
			return Promise.resolve({});
		});
		renderPage();


		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Canteen queue too long" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "The lunch queue takes the whole break every single day." },
		});
		const btn = screen.getByRole("button", { name: /publish anonymously/i });
		// Two raw dispatches inside ONE act() block: no flush between them,
		// so both land pre-paint — the exact real-world race (React state
		// cannot help here; only the synchronous ref guard can).
		act(() => {
			btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		await new Promise((r) => setTimeout(r, 300));
		expect(postsCalls).toBe(1);
	});

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

	it("sends title and description RAW — masking is the server's job at insert", {
		timeout: 20000,
	}, async () => {
		const getPublished = mockPublishFlow();
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is really annoying, the door keeps slamming.",
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

		// Raw text crosses the wire; api/_posts.js is the authority at insert.
		// Client-side masking here would blind the pre-publish gate to the
		// real content.
		expect(payload.title).toBe("Broken locker rattles");
		expect(payload.description).toBe(
			"This is really annoying, the door keeps slamming.",
		);
	});

	it("blocks publish while a profanity body is refused by the pre-send gate", {
		timeout: 20000,
	}, async () => {
		mockPublishFlow();
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is fucking annoying, the door keeps slamming.",
		);

		await waitFor(
			() => {
				expect(mocks.post).not.toHaveBeenCalledWith(
					"/api/posts",
					expect.any(Object),
				);
				expect(mocks.toast).toHaveBeenCalledWith(
					expect.stringContaining("safety guidelines"),
					"err",
				);
			},
			{ timeout: 10000 },
		);
	});

	it("survives a flagless /api/moderate response without crashing the page", {
		timeout: 20000,
	}, async () => {
		// REGRESSION: the live check blindly read `moderation.flags`, so a
		// response without a flags array (mock, proxy, older server) threw
		// during render and unmounted the entire page. The page must stay up
		// and the local scan must cover the gap.
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/moderate"))
				return Promise.resolve({ checked: true });
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve(APPROVED);
			return Promise.resolve({});
		});
		renderPage();

		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Contact me about the room" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "Call me on my number 123-456-7890 any time" },
		});

		// Page stays mounted and the local fallback still flags the PII.
		await waitFor(
			() => {
				expect(
					screen.getByRole("button", {
						name: "Content has issues that must be fixed first",
					}),
				).toBeDisabled();
			},
			{ timeout: 10000 },
		);
		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/posts",
			expect.anything(),
		);
	});

	it("disables publish while a PII body is blocked by the pre-send gate", {
		timeout: 20000,
	}, async () => {
		mockPublishFlow();
		renderPage();


		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Contact me about the room" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "Call me on my number 123-456-7890 any time" },
		});

		// Moderation runs debounced off the inputs — wait for the gate.
		await waitFor(
			() => {
				expect(
					screen.getByRole("button", {
						name: "Content has issues that must be fixed first",
					}),
				).toBeDisabled();
			},
			{ timeout: 10000 },
		);

		// Nothing may reach the server while the gate is red.
		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/posts",
			expect.anything(),
		);
	});

	it("does not force a normal report into review when the advisory check times out", async () => {
		let published: Record<string, unknown> | null = null;
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.reject(new Error("network timeout"));
			if (String(url).includes("/api/posts")) {
				published = body ?? null;
				return Promise.resolve({ id: "post_timeout", title: body?.title ?? "" });
			}
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Bullying incident reported in the hallway",
			"A student keeps disturbing classmates during the break and I want the teacher to know.",
		);

		await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
			"/api/posts",
			expect.any(Object),
		));
		expect(published).not.toBeNull();
		const payload = published as unknown as Record<string, unknown>;
		expect(payload.pending_review).toBe(false);
	});
});

	it("celebrates only published posts — never a held one", async () => {
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve({ ...APPROVED, decision: "revision", reason: "needs a human look" });
			if (String(url).includes("/api/posts"))
				return Promise.resolve({ id: "post_held", title: body?.title ?? "" });
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Someone keeps taking my lunch",
			"This has happened three times this week near the canteen counter.",
		);

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/posts", expect.any(Object));
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Submitted — a moderator will review it before it goes public",
			"ok",
		);
		// A held post is not live: no celebration for it.
		expect(mocks.fireConfetti).not.toHaveBeenCalled();
	});

	it("opens the existing post on a deduped resubmit instead of celebrating a twin", async () => {
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve(APPROVED);
			if (String(url).includes("/api/posts"))
				return Promise.resolve({ id: "post_9", title: body?.title ?? "", status: "reported", deduped: true });
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Canteen water tastes bad",
			"The water in the canteen has a strange taste every single day.",
		);

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/posts", expect.any(Object));
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Already published — opened your existing post",
			"ok",
		);
	});

	it("honours a server-held status even when the client pre-gate saw nothing wrong", async () => {
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve(APPROVED);
			if (String(url).includes("/api/posts"))
				return Promise.resolve({ id: "post_held", title: body?.title ?? "", status: "pending_review" });
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Someone keeps taking my lunch",
			"This has happened three times this week near the canteen counter.",
		);

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/posts", expect.any(Object));
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Submitted — a moderator will review it before it goes public",
			"ok",
		);
		expect(mocks.fireConfetti).not.toHaveBeenCalled();
	});

describe("Submit — poll link selector", () => {
	it("only shows the current user's own problems and suggestions in the link dropdown", async () => {
		// Mock API to return posts from different authors and types
		mocks.get.mockImplementation((url: string) => {
			if (String(url).includes("/api/posts")) {
				// The public API masks author_id unless the caller supplies viewer.
				// Reproduce that real response so the selector cannot pass by
				// comparing against an accidentally unmasked fixture.
				const hasViewer = new URL(url, "http://voicebox.test").searchParams.get("viewer") === "anon-test";
				const isSuggestion = String(url).includes("type=suggestion");
				return Promise.resolve([
					{
						id: isSuggestion ? "my-sug-1" : "my-post-1",
						title: isSuggestion ? "My suggestion" : "My broken lift",
						author_id: hasViewer ? "anon-test" : "anon-te...",
						status: "open",
						type: isSuggestion ? "suggestion" : "problem",
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
						author_id: hasViewer ? "anon-test" : "anon-te...",
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

		await waitFor(() => {
			expect(mocks.get).toHaveBeenCalledWith(
				"/api/posts?type=problem&viewer=anon-test",
			);
			expect(mocks.get).toHaveBeenCalledWith(
				"/api/posts?type=suggestion&viewer=anon-test",
			);
		});

		// Wait for the link dropdown to populate
		await waitFor(() => {
			expect(screen.getByText(/My broken lift/)).toBeInTheDocument();
		});

		// The other user's post should NOT appear
		expect(screen.queryByText(/Someone else's complaint/)).toBeNull();

		// Both of the user's posts and their suggestion appear — once each.
		expect(screen.getAllByText(/My broken lift/)).toHaveLength(1);
		expect(screen.getAllByText(/Another one of mine/)).toHaveLength(1);
		expect(screen.getByText(/My suggestion/)).toBeInTheDocument();
	});
});

describe("Submit — attach a poll to a problem or suggestion", () => {
	it("creates the poll linked to the new post in one publish", async () => {
		mockPublishFlow();
		renderPage();


		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Broken locker rattles" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "This is really annoying, the door keeps slamming every hour." },
		});
		fireEvent.click(screen.getByRole("button", { name: /Attach a poll/ }));
		fireEvent.change(screen.getByPlaceholderText("What should we ask?"), {
			target: { value: "Should we fix it this week?" },
		});
		fireEvent.change(screen.getByLabelText("Attach poll option 1"), {
			target: { value: "Yes" },
		});
		fireEvent.change(screen.getByLabelText("Attach poll option 2"), {
			target: { value: "No" },
		});
		fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/polls",
				expect.objectContaining({
					title: "Should we fix it this week?",
					post_id: "post_1",
				}),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith("Post and poll published", "ok");
	});

	it("publishes the post alone with an honest error when the poll fails", async () => {
		mockPublishFlow();
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish")) return Promise.resolve(APPROVED);
			if (String(url).includes("/api/polls"))
				return Promise.reject(new Error("poll store down"));
			if (String(url).includes("/api/posts"))
				return Promise.resolve({ id: "post_1", title: body?.title ?? "" });
			return Promise.resolve({});
		});
		renderPage();


		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Broken locker rattles" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "This is really annoying, the door keeps slamming every hour." },
		});
		fireEvent.click(screen.getByRole("button", { name: /Attach a poll/ }));
		fireEvent.change(screen.getByPlaceholderText("What should we ask?"), {
			target: { value: "Should we fix it this week?" },
		});
		fireEvent.change(screen.getByLabelText("Attach poll option 1"), {
			target: { value: "Yes" },
		});
		fireEvent.change(screen.getByLabelText("Attach poll option 2"), {
			target: { value: "No" },
		});
		fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("Post published, but the poll failed"),
				"err",
			);
		});
	});

	it("recovers Publish after a validation error instead of deadlocking", async () => {
		mockPublishFlow();
		renderPage();

		// Too short: validation refuses AND releases the submit guard.
		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Hi" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "The lunch queue takes the whole break every single day." },
		});
		fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Title must be at least 5 characters",
				"err",
			);
		});
		// Fix and publish: the second attempt must still go through.
		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Canteen queue too long" },
		});
		fireEvent.click(screen.getByRole("button", { name: /publish anonymously/i }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/posts", expect.any(Object));
		});
	});
});

describe("Submit - appeal recourse for safety blocks", () => {
	it("offers an appeal when the live gate blocks the write", {
		timeout: 20000,
	}, async () => {
		mockPublishFlow();
		renderPage();


		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Contact me about the room" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "Call me on my number 123-456-7890 any time" },
		});

		// Live gate goes red → appeal panel appears carrying the blocked text.
		await waitFor(
			() => {
				expect(screen.getByTestId("appeal-panel")).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);
		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/posts",
			expect.anything(),
		);

		// Filing reaches /api/appeals with the blocked post, nothing publishes.
		fireEvent.click(screen.getByRole("button", { name: /appeal this decision/i }));
		await waitFor(
			() => {
				expect(mocks.post).toHaveBeenCalledWith(
					"/api/appeals",
					expect.objectContaining({
						surface: "post",
						author_id: "anon-test",
					}),
				);
			},
			{ timeout: 10000 },
		);
		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/posts",
			expect.anything(),
		);
	});

	it("tells the truth when pre-publish blocks: not submitted, draft kept, dismissable", {
		timeout: 20000,
	}, async () => {
		const HIGH_RISK = {
			...APPROVED,
			decision: "high_risk",
			reason: "Personal information detected — remove addresses, phone numbers, or emails",
			risk_score: 90,
			checks: {
				...APPROVED.checks,
				privacy: { pass: false, issues: ["phone number"] },
			},
		};
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve(HIGH_RISK);
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is really annoying, the door keeps slamming.",
		);

		await waitFor(
			() => {
				expect(screen.getByText(/AI review — blocked/i)).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);
		// Truth: nothing was submitted or held — the draft is intact.
		expect(screen.getByText(/not submitted/i)).toBeInTheDocument();
		expect(
			screen.getByRole("textbox", { name: "Title *" }),
		).toHaveValue("Broken locker rattles");
		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/posts",
			expect.anything(),
		);
		// Cancel path: dismissing the panel keeps the draft for editing.
		fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
		expect(screen.queryByText(/AI review — blocked/i)).toBeNull();
		expect(
			screen.getByRole("textbox", { name: "Title *" }),
		).toHaveValue("Broken locker rattles");
	});

	it("offers an appeal when the server 403s a safety block", {		timeout: 20000,
	}, async () => {
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve(APPROVED);
			if (String(url).includes("/api/posts"))
				return Promise.reject(
					new Error(
						"This content violates our safety guidelines and cannot be published.",
					),
				);
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is really annoying, the door keeps slamming.",
		);

		await waitFor(
			() => {
				expect(screen.getByTestId("appeal-panel")).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);
	});
});

describe("Submit - type-mode Transform into complaint", () => {
	const DRAFT = {
		engine: "local",
		draft: {
			title: "Broken taps in block C washroom",
			description:
				"The washroom taps in block C have been broken since Monday.",
			category: "Facilities",
			tags: ["block-c"],
			priority: "medium",
			details: ["block C", "since Monday"],
		},
	};

	function mockTransform() {
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/assist"))
				return Promise.resolve(DRAFT);
			return Promise.resolve({});
		});
	}

	function typeModeWithDesc(text: string) {

		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: text },
		});
	}

	it("offers Turn into complaint on a typed paragraph and shows the draft card", async () => {
		mockTransform();
		renderPage();
		typeModeWithDesc(
			"block c washroom ke saare taps monday se toote hain, please fix karo",
		);
		const btn = screen.getByRole("button", { name: /turn into complaint/i });
		expect(btn).toBeEnabled();
		fireEvent.click(btn);
		expect(
			await screen.findByText("Broken taps in block C washroom"),
		).toBeInTheDocument();
		// Extracted details render as facts, category + tags as chips.
		expect(screen.getByText(/block C · since Monday/)).toBeInTheDocument();
		expect(screen.getByText(/#block-c/)).toBeInTheDocument();
		// The typed-text path uses the structure_complaint task, not voice.
		expect(mocks.post).toHaveBeenCalledWith(
			expect.stringContaining("/api/assist"),
			expect.objectContaining({ task: "structure_complaint" }),
		);
	});

	it("applies the draft into the form for review, details stay display-only", async () => {
		mockTransform();
		renderPage();
		typeModeWithDesc("block c washroom taps are broken since monday, fix please");
		fireEvent.click(
			screen.getByRole("button", { name: /turn into complaint/i }),
		);
		await screen.findByText("Broken taps in block C washroom");
		fireEvent.click(
			screen.getByRole("button", { name: /use this — review & publish/i }),
		);
		expect(
			(screen.getByRole("textbox", { name: "Title *" }) as HTMLInputElement)
				.value,
		).toBe("Broken taps in block C washroom");
		expect(
			(
				screen.getByRole("textbox", {
					name: "Description *",
				}) as HTMLTextAreaElement
			).value,
		).toBe("The washroom taps in block C have been broken since Monday.");
		// Card dismissed after apply — details were never form fields.
		expect(
			screen.queryByText("Broken taps in block C washroom"),
		).not.toBeInTheDocument();
	});

	it("stays disabled until a full sentence is typed", () => {
		mockTransform();
		renderPage();
		typeModeWithDesc("short");
		expect(
			screen.getByRole("button", { name: /turn into complaint/i }),
		).toBeDisabled();
	});
});

// ═══════════════════════════════════════════════════════════════════
// The publish session reads two untrusted shapes — the live verdict
// from /api/moderate and the advisory verdict from /api/pre-publish —
// and renders both. Two rules keep that safe, and both were broken:
//
//   1. A verdict is a claim about ONE exact string. Applying it to
//      whatever is on screen invents facts (a block for text that was
//      already fixed, a green check for text no check had seen).
//   2. A response is not a schema. A partial/older/proxied shape must
//      degrade to "unknown", never throw during render — a render
//      throw unmounts the whole page, taking the form, the appeal
//      panel and the publish button with it, with no error UI.
// ═══════════════════════════════════════════════════════════════════
describe("Submit — untrusted pre-publish and live-verdict shapes", () => {
	const CLEAN = (text: string) => ({
		checked: true,
		safe: true,
		overallSeverity: "none",
		flags: [],
		maskedText: text,
		score: 0,
		serverBlocked: false,
	});
	const PII_BLOCK = (text: string) => ({
		checked: true,
		safe: false,
		overallSeverity: "high",
		flags: [
			{
				category: "privacy",
				severity: "high",
				message: "Phone number detected — remove personal contact info.",
				matched: "123-456-7890",
			},
		],
		maskedText: text,
		score: 70,
		serverBlocked: true,
	});

	it("survives a partial /api/pre-publish checks object without crashing the page", {
		timeout: 20000,
	}, async () => {
		// REGRESSION: the checks grid indexed all four check keys
		// (`check.pass`, `check.issues.length`). A verdict that reports only
		// some of them threw during render, and React unmounted the entire
		// page — the exact failure shape behind "the page rendered <div />".
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve({
					decision: "high_risk",
					reason: "Personal information detected",
					risk_score: 90,
					// `issues` missing, safety/spam/quality absent entirely.
					checks: { privacy: { pass: false } },
				});
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is really annoying, the door keeps slamming.",
		);

		await waitFor(
			() => {
				expect(screen.getByText(/AI review — blocked/i)).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);
		// Page alive, draft intact, nothing published.
		expect(
			screen.getByRole("heading", { name: /submit anonymously/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("textbox", { name: "Title *" }),
		).toHaveValue("Broken locker rattles");
		// Only the check the server actually reported is shown — an absent
		// check is "not verified", never a green pass.
		expect(screen.getByText("Personal info")).toBeInTheDocument();
		expect(screen.queryByText("Safety")).toBeNull();
		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/posts",
			expect.anything(),
		);
	});

	it("never claims 'safe to publish' for a verdict it does not understand", {
		timeout: 20000,
	}, async () => {
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				// No `decision` at all — the one field the panel's verdict words
				// are derived from.
				return Promise.resolve({ reason: "", risk_score: 0 });
			// Publish parks in flight so the panel stays on screen.
			if (String(url).includes("/api/posts")) return new Promise(() => {});
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is really annoying, the door keeps slamming.",
		);

		await waitFor(
			() => {
				expect(
					screen.getByText(/AI review — could not confirm/i),
				).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);
		// The old heading fell through to "safe to publish" for any value it
		// did not recognise — a green light nobody issued.
		expect(screen.queryByText(/safe to publish/i)).toBeNull();
		expect(screen.queryByText(/all checks passed/i)).toBeNull();
	});

	it("drops the live block the moment the flagged text is edited away", {
		timeout: 20000,
	}, async () => {
		// A verdict only describes the text it was computed for. The gate used
		// to keep applying the last verdict to whatever was on screen, so
		// deleting the flagged phone number left the page accusing the author
		// ("Fix issues first", appeal panel and all) for a debounce + a
		// round-trip after the text was already clean.
		mocks.post.mockImplementation(
			(url: string, body?: Record<string, unknown>) => {
				if (String(url).includes("/api/assist")) return Promise.resolve({});
				if (String(url).includes("/api/moderate")) {
					const text = String(body?.text ?? "");
					return Promise.resolve(
						/\d{3}-\d{3}-\d{4}/.test(text) ? PII_BLOCK(text) : CLEAN(text),
					);
				}
				return Promise.resolve({});
			},
		);
		renderPage();

		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Contact me about the room" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "Call me on my number 123-456-7890 any time" },
		});

		await waitFor(
			() => {
				expect(
					screen.getByRole("button", {
						name: "Content has issues that must be fixed first",
					}),
				).toBeDisabled();
			},
			{ timeout: 10000 },
		);
		expect(screen.getByTestId("appeal-panel")).toBeInTheDocument();

		// The author removes the phone number. No verdict has been returned for
		// this text yet, so the page may not claim it is blocked.
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: {
				value: "The whiteboard in room 12 is cracked and unusable for group work.",
			},
		});
		expect(
			screen.queryByRole("button", {
				name: "Content has issues that must be fixed first",
			}),
		).toBeNull();
		expect(screen.queryByTestId("appeal-panel")).toBeNull();
		expect(screen.queryByText(/content blocked/i)).toBeNull();
	});

	it("drops a pre-publish panel once the author edits the text it reviewed", {
		timeout: 20000,
	}, async () => {
		mocks.post.mockImplementation((url: string) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/pre-publish"))
				return Promise.resolve({
					...APPROVED,
					decision: "high_risk",
					reason: "Personal information detected",
					risk_score: 90,
					checks: {
						...APPROVED.checks,
						privacy: { pass: false, issues: ["phone number"] },
					},
				});
			return Promise.resolve({});
		});
		renderPage();

		fillAndPublish(
			"Broken locker rattles",
			"This is really annoying, the door keeps slamming.",
		);

		await waitFor(
			() => {
				expect(screen.getByText(/AI review — blocked/i)).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);

		// The panel describes the text that was reviewed. Once the author
		// rewrites that text, the risk score and the reason are about words
		// that no longer exist — the panel must not keep asserting them.
		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Broken locker rattles in the gym" },
		});

		expect(screen.queryByText(/AI review — blocked/i)).toBeNull();
		expect(screen.queryByText(/Personal information detected/i)).toBeNull();
		expect(screen.queryByText(/risk score/i)).toBeNull();
	});

	it("survives a duplicate-list row that has no status field", {
		timeout: 20000,
	}, async () => {
		// The "similar posts" panel prints a row's status. A row without one
		// (partial row, older server) crashed the render and unmounted the
		// page — the same untrusted-shape class as the checks grid above.
		mocks.post.mockImplementation(() => Promise.resolve({}));
		mocks.get.mockImplementation((url: string) => {
			if (String(url).includes("/api/categories"))
				return Promise.resolve({
					categories: ["Academics", "Facilities", "Food", "Other"],
				});
			if (String(url).includes("/api/posts"))
				return Promise.resolve([
					{
						id: "post_existing",
						title: "Broken locker rattles in the gym",
						description: "the locker door keeps slamming and rattling every break",
						category: "Academics",
						author_id: "someone-else",
						reactions: { support: 2 },
					},
				]);
			return Promise.resolve([]);
		});
		renderPage();

		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Broken locker rattles in the gym" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: {
				value: "the locker door keeps slamming and rattling every single break",
			},
		});

		await waitFor(
			() => {
				expect(screen.getByText(/similar post/i)).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);
		expect(
			screen.getByRole("heading", { name: /submit anonymously/i }),
		).toBeInTheDocument();
	});

	it("explains a poll block on the poll tab instead of only disabling Publish", {
		timeout: 20000,
	}, async () => {
		// The live verdict covers poll text — `liveText` includes the question
		// and every option — but the feedback panel was rendered inside the
		// non-poll branch. A poll author whose wording tripped the gate saw a
		// disabled "Fix issues first" button with nothing on screen saying why.
		mocks.post.mockImplementation(
			(url: string, body?: Record<string, unknown>) => {
				if (String(url).includes("/api/assist")) return Promise.resolve({});
				if (String(url).includes("/api/moderate")) {
					const text = String(body?.text ?? "");
					return Promise.resolve(
						/\d{3}-\d{3}-\d{4}/.test(text) ? PII_BLOCK(text) : CLEAN(text),
					);
				}
				return Promise.resolve({});
			},
		);
		renderPage();

		fireEvent.click(screen.getByRole("tab", { name: /poll/i }));
		fireEvent.change(screen.getByRole("textbox", { name: /poll question/i }), {
			target: { value: "Call 123-456-7890 about the library timing tomorrow" },
		});

		await waitFor(
			() => {
				expect(screen.getByText(/content blocked/i)).toBeInTheDocument();
			},
			{ timeout: 10000 },
		);
		expect(screen.getByText(/phone number detected/i)).toBeInTheDocument();
	});
});
