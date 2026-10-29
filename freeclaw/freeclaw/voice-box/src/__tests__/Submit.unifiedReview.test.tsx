// ═══════════════════════════════════════════════════════════════════
// Submit — ONE review surface
// ═══════════════════════════════════════════════════════════════════
// The reported bug: a draft showed "content review" flags and, directly
// below, a separate green "AI review — safe to publish" panel. Two panels
// making two claims about one draft cannot both be acted on. The page now
// renders a single card: verdict, risk score, the four checks, the gate's
// flags, and the AI suggestions — all inside `data-testid="unified-review"`.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** The merged review the server now returns from `/api/moderate`. */
const REVIEW = {
	decision: "safe",
	risk_score: 6,
	reason: "Content passed all checks",
	blocked: false,
	code: null,
	checks: {
		privacy: { pass: true, issues: [] },
		safety: { pass: true, issues: [] },
		spam: { pass: true, issues: [] },
		quality: { pass: true, issues: [] },
	},
	analysis: {
		priority: "low",
		department: "Facilities",
		category: "Facilities",
		summary: "Broken water fountain",
		estimated_resolution_time: "1-3 days",
		llm_analyzed: true,
		engines: ["safety-gate", "analysis-model"],
	},
};

const DEEP_CLEAN = {
	safe: true,
	overallSeverity: "none",
	flags: [],
	maskedText: "",
	score: 0,
	serverBlocked: false,
	action: "ALLOW_ACTION",
	policy: null,
	context: null,
	relevance: null,
	checked: true,
	aiChecked: true,
	aiTimedOut: false,
	emotion: null,
	supportNeeded: false,
	review: REVIEW,
};

const FAST_CLEAN = { ...DEEP_CLEAN, aiChecked: false, review: null };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockImplementation((url: string) => {
		if (String(url).includes("/api/categories"))
			return Promise.resolve({
				categories: ["Facilities", "Academics", "Other"],
			});
		if (String(url).includes("/api/posts"))
			return Promise.resolve({ posts: [] });
		return Promise.resolve({});
	});
	mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
		if (String(url).includes("/api/assist"))
			return Promise.resolve({
				category: "Facilities",
				confidence: 0.55,
				tags: ["water"],
				improved_title: "",
			});
		if (String(url).includes("/api/moderate"))
			return Promise.resolve(body?.aiJudge === true ? DEEP_CLEAN : FAST_CLEAN);
		return Promise.resolve({});
	});
});

describe("Submit — unified review card", () => {
	it("renders the verdict, score, checks and suggestions in one card", async () => {
		render(
			<MemoryRouter>
				<Submit />
			</MemoryRouter>,
		);

		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Water fountain on floor two is broken" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: {
				value:
					"The fountain outside room 204 has been dry since Monday and students are walking to another floor.",
			},
		});

		const card = await screen.findByTestId("unified-review", {}, { timeout: 10000 });

		// One verdict, stated once.
		expect(
			within(card).getByText(/AI review — safe to publish/i),
		).toBeTruthy();
		expect(screen.getAllByText(/AI review — safe to publish/i)).toHaveLength(1);

		// Score + every check the server reported, in the same card.
		expect(within(card).getByText(/Risk score/i)).toBeTruthy();
		expect(within(card).getByText("6/100")).toBeTruthy();
		for (const label of ["Personal info", "Safety", "Spam", "Quality"]) {
			expect(within(card).getByText(label)).toBeTruthy();
		}

		// Suggestions live inside the same surface, not a second panel.
		await waitFor(
			() => {
				expect(within(card).getByText(/AI suggestions/i)).toBeTruthy();
			},
			{ timeout: 10000 },
		);

		// The old duplicate green banner is gone while the card is showing.
		expect(screen.queryByText(/No issues found — the AI reviewed your draft/i)).toBeNull();
		expect(screen.queryByText(/Quick checks passed/i)).toBeNull();
	});

	it("keeps the single card when the gate itself flags the draft", async () => {
		mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/assist")) return Promise.resolve({});
			if (String(url).includes("/api/moderate")) {
				if (body?.aiJudge === true) {
					return Promise.resolve({
						...DEEP_CLEAN,
						safe: false,
						serverBlocked: true,
						overallSeverity: "high",
						flags: [
							{
								category: "threat",
								severity: "high",
								message: "Threats are not allowed here.",
								matched: "",
							},
						],
						review: {
							...REVIEW,
							decision: "high_risk",
							risk_score: 80,
							reason: "Threats are not allowed here.",
							blocked: true,
							checks: {
								...REVIEW.checks,
								safety: { pass: false, issues: ["Threats are not allowed here."] },
							},
						},
					});
				}
				return Promise.resolve(FAST_CLEAN);
			}
			return Promise.resolve({});
		});

		render(
			<MemoryRouter>
				<Submit />
			</MemoryRouter>,
		);

		fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
			target: { value: "Message for a classmate" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Description *" }), {
			target: { value: "Rahul, I hate you and I know where you sit every day." },
		});

		const card = await screen.findByTestId("unified-review", {}, { timeout: 10000 });
		expect(within(card).getByText(/AI review — blocked/i)).toBeTruthy();
		// The gate's own message is inside the same card (the reason line and
		// the merged flag list may both state it — same surface, one verdict).
		expect(within(card).getAllByText(/Threats are not allowed here/i).length).toBeGreaterThan(0);
		// ...and the page makes no contradicting green claim anywhere.
		expect(screen.queryByText(/AI review — safe to publish/i)).toBeNull();
		expect(screen.queryByText(/No issues found — the AI reviewed your draft/i)).toBeNull();
	});
});
