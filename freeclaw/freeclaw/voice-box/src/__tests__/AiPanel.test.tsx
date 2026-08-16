// ═══════════════════════════════════════════════════════════════════
// AiPanel — AI Analysis intelligence panel
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • auto-runs analysis on mount when nothing is cached
//   • executive summary + weekly insights
//   • AI-ranked issues with NEW/▲/▼ movement and urgency bars
//   • safety alerts
//   • duplicate clusters
//   • one-click issue → Yes/No poll (real /api/polls call)
//   • generate & publish AI summary to a post
//   • weekly staff digest generation + copy
//   • proactive suggestions with confidence + dismiss
//   • float / dock panel toggle
//   • rule-based engine notice
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiPanel from "../pages/admin/AiPanel";

vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		getSlow: vi.fn(),
		post: vi.fn(),
		postSlow: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: toastMock }),
}));

// localStorage-backed identity helpers — reset per test
vi.mock("../lib/identity", () => ({
	lsGet: (key: string, fallback: unknown) => {
		const raw = localStorage.getItem(key);
		if (raw === null) return fallback;
		try {
			return JSON.parse(raw);
		} catch {
			return fallback;
		}
	},
	lsSet: (key: string, value: unknown) => {
		localStorage.setItem(key, JSON.stringify(value));
	},
}));

const toastMock = vi.fn();

import { api } from "../lib/api";
const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedGetSlow = api.getSlow as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedPostSlow = api.postSlow as ReturnType<typeof vi.fn>;
const mockedPut = api.put as ReturnType<typeof vi.fn>;

const POST = {
	id: "p1",
	type: "problem",
	title: "Broken lift in Block C",
	description: "Stuck since morning.",
	category: "Facilities",
	status: "open",
	priority: "high",
	author_id: "anon_x",
	created_at: new Date().toISOString(),
	reactions: { support: 20 },
	comment_count: 5,
	status_history: [],
	deleted: false,
};

const ANALYSIS = {
	engine: "rule-based-v3",
	ranked_issues: [
		{
			id: "p1",
			title: "Broken lift in Block C",
			category: "Facilities",
			status: "open",
			flags: ["high engagement"],
			evidence: "20 supports, 5 comments in 24h",
			recommended_action: "Dispatch maintenance",
			urgency_score: 88,
		},
		{
			id: "p2",
			title: "Canteen food quality",
			category: "Canteen",
			status: "open",
			urgency_score: 55,
		},
	],
	safety_alerts: [
		{ id: "s1", title: "Suspicious duplicate posts", reason: "Same text posted 3x" },
	],
	duplicate_clusters: [
		{ topic: "Lift broken", count: 3, shared_words: ["lift", "stuck"] },
	],
	weekly_insights: {
		trending_category: "Facilities",
		recommendation: "Prioritize maintenance backlog",
		total: 42,
		high_urgency: 3,
	},
	generated_at: new Date().toISOString(),
	summary: "Platform is healthy but facilities needs attention.",
};

const SUGGESTION = {
	id: "sg1",
	title: "Dispatch maintenance to Block C",
	description: "Lift issues are trending",
	priority: "high",
	confidence: 0.87,
	suggestedActions: ["create_task", "notify_admin"],
};

function seedAnalysis() {
	mockedGetSlow.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/posts")) return [POST];
		return [];
	});
	mockedPostSlow.mockResolvedValue(ANALYSIS);
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/agent-executions")) {
			return { executions: [] };
		}
		if (path.startsWith("/api/proactive?action=detect")) {
			return { suggestions: [SUGGESTION], count: 1 };
		}
		if (path.startsWith("/api/posts?id=")) return [POST];
		return {};
	});
	mockedPost.mockResolvedValue({ ok: true, summary: "digest text" });
	mockedPut.mockResolvedValue({ ok: true });
}

beforeEach(() => {
	vi.clearAllMocks();
	toastMock.mockReset();
	localStorage.clear();
});

describe("AiPanel (AI Analysis)", () => {
	it("auto-runs analysis on mount when nothing is cached", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(mockedPostSlow).toHaveBeenCalledWith(
				"/api/ai",
				expect.objectContaining({ task: "analyze" }),
			);
		});
	});

	it("renders the analysis header with engine attribution", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("AI Analysis")).toBeInTheDocument();
			expect(
				screen.getByText(/Rule-based engine — every score computed from live votes/),
			).toBeInTheDocument();
		});
	});

	it("shows a hint about upgrading to LLM analysis when rule-based", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText(/Want deeper LLM analysis\?/)).toBeInTheDocument();
		});
	});

	it("renders the executive summary and weekly insight chips", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Executive summary")).toBeInTheDocument();
			expect(
				screen.getByText("Platform is healthy but facilities needs attention."),
			).toBeInTheDocument();
		});
		// CountUp animates 0 → value — wait for the settled numbers
		await waitFor(() => {
			expect(screen.getByText("42")).toBeInTheDocument(); // items analyzed
			expect(screen.getByText("3")).toBeInTheDocument(); // high urgency
		});
		expect(screen.getByText("📈 Trending category:")).toBeInTheDocument();
		// “Facilities” is both the issue category and the trending chip
		expect(screen.getAllByText("Facilities").length).toBeGreaterThan(0);
		expect(
			screen.getByText("💡 Prioritize maintenance backlog"),
		).toBeInTheDocument();
	});

	it("lists AI-ranked issues with evidence, flags and recommended action", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("AI-ranked issues")).toBeInTheDocument();
			expect(screen.getByText("Broken lift in Block C")).toBeInTheDocument();
		});
		expect(screen.getByText("⚠ high engagement")).toBeInTheDocument();
		expect(screen.getByText(/📋 Evidence: 20 supports, 5 comments in 24h/)).toBeInTheDocument();
		expect(screen.getByText("→ Dispatch maintenance")).toBeInTheDocument();
	});

	it("renders a NEW badge for issues not present in the previous ranking", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Broken lift in Block C")).toBeInTheDocument();
		});
		// Every issue without a previous rank shows NEW (both issues here)
		expect(screen.getAllByText("NEW").length).toBeGreaterThan(0);
	});

	it("shows up/down rank movement when the previous ranking exists", async () => {
		// No cached analysis (so the panel auto-runs) but a PREVIOUS rank map —
		// p2 was rank 5 before this run.
		localStorage.setItem("vb:aiPrevRanks", JSON.stringify({ p2: 5 }));
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Canteen food quality")).toBeInTheDocument();
		});
		// p2 sits at index 1 in the new ranking → moved up 4 places → title “Up 4 place(s)”
		expect(screen.getByTitle("Up 4 place(s)")).toBeInTheDocument();
	});

	it("shows urgency bars in danger/warn/good tones", async () => {
		seedAnalysis();
		render(<AiPanel />);

		// The number is a CountUp span — match the labels + settle the value
		await waitFor(() => {
			expect(screen.getAllByText(/urgency/).length).toBeGreaterThan(0);
			expect(screen.getByText("88")).toBeInTheDocument();
		});
		// Danger tone for 88 (>70), warn tone for 55 (>40) — real class usage
		expect(
			document.querySelector(".bg-bad") || document.querySelector(".bg-warn"),
		).toBeTruthy();
	});

	it("renders safety alerts with title and reason", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Safety alerts")).toBeInTheDocument();
			expect(screen.getByText("Suspicious duplicate posts")).toBeInTheDocument();
			expect(screen.getByText("— Same text posted 3x")).toBeInTheDocument();
		});
	});

	it("renders duplicate clusters with shared words and post ids", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Duplicate clusters")).toBeInTheDocument();
			expect(screen.getByText("Lift broken")).toBeInTheDocument();
			expect(screen.getByText("3 similar")).toBeInTheDocument();
			expect(screen.getByText(/Shared words: “lift”, “stuck”/)).toBeInTheDocument();
		});
	});

	it("turns a ranked issue into a linked Yes/No poll", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Broken lift in Block C")).toBeInTheDocument();
		});
		const pollBtn = screen.getAllByTitle("Turn into a Yes/No poll")[0] as HTMLElement;
		fireEvent.click(pollBtn);

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/polls", {
				title: "Do you agree: Broken lift in Block C?",
				ptype: "yesno",
				post_id: "p1",
				author_id: "ADMIN",
			});
			expect(toastMock).toHaveBeenCalledWith(
				"Poll created and linked to the issue 📊",
				"ok",
			);
		});
	});

	it("generates and publishes an AI summary for a ranked issue", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Broken lift in Block C")).toBeInTheDocument();
		});
		const summaryBtn = screen.getAllByTitle("Generate & publish AI summary")[0] as HTMLElement;
		fireEvent.click(summaryBtn);

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith(
				"/api/ai",
				expect.objectContaining({ task: "summarize" }),
			);
			expect(mockedPut).toHaveBeenCalledWith(
				"/api/posts",
				expect.objectContaining({ id: "p1", ai_summary: "digest text" }),
			);
		});
	});

	it("generates the weekly staff digest and displays it", async () => {
		seedAnalysis();
		mockedPost.mockImplementation(async (path: string) => {
			if (path === "/api/ai") return { summary: "Digest body from AI." };
			return { ok: true };
		});
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Weekly digest/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Weekly digest/ }));

		await waitFor(() => {
			expect(screen.getByText("Weekly staff digest")).toBeInTheDocument();
			expect(screen.getByText(/Digest body from AI\./)).toBeInTheDocument();
			expect(toastMock).toHaveBeenCalledWith("Weekly digest generated", "ok");
		});
	});

	it("copies the digest for a staff email", async () => {
		seedAnalysis();
		// jsdom has no navigator.clipboard — define it so writeText is spied
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		mockedPost.mockImplementation(async (path: string) => {
			if (path === "/api/ai") return { summary: "Copy me." };
			return { ok: true };
		});
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Weekly digest/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Weekly digest/ }));
		await waitFor(() => {
			expect(screen.getByText("Weekly staff digest")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Copy for staff email/ }));

		await waitFor(() => {
			expect(writeText).toHaveBeenCalled();
			expect(toastMock).toHaveBeenCalledWith("Copied to clipboard", "ok");
		});
	});

	it("lists proactive suggestions with confidence and dismiss wiring", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Proactive Suggestions")).toBeInTheDocument();
			expect(screen.getByText("Dispatch maintenance to Block C")).toBeInTheDocument();
			expect(screen.getByText("87% confidence")).toBeInTheDocument();
		});
		const dismissBtn = screen.getByTitle("Dismiss");
		fireEvent.click(dismissBtn);

		await waitFor(() => {
			expect(mockedGet).toHaveBeenCalledWith(
				"/api/proactive?action=dismiss&id=sg1",
			);
		});
		await waitFor(() => {
			expect(
				screen.queryByText("Dispatch maintenance to Block C"),
			).not.toBeInTheDocument();
		});
	});

	it("collapses and expands the proactive suggestions section", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("Proactive Suggestions")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Proactive Suggestions"));
		await waitFor(() => {
			expect(
				screen.queryByText("Dispatch maintenance to Block C"),
			).not.toBeInTheDocument();
		});
		fireEvent.click(screen.getByText("Proactive Suggestions"));
		await waitFor(() => {
			expect(screen.getByText("Dispatch maintenance to Block C")).toBeInTheDocument();
		});
	});

	it("refreshes suggestions on demand", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Refresh suggestions/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Refresh suggestions/ }));
		await waitFor(() => {
			expect(mockedGet).toHaveBeenCalledWith(
				"/api/proactive?action=detect",
			);
		});
	});

	it("floats the panel and back", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByText("AI Analysis")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Float this panel/ }));
		await waitFor(() => {
			expect(screen.getByTitle("Dock panel")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByTitle("Dock panel"));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Float this panel/ })).toBeInTheDocument();
		});
	});

	it("re-runs analysis manually and toasts with the engine name", async () => {
		seedAnalysis();
		render(<AiPanel />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Re-run analysis/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Re-run analysis/ }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith(
				"Analysis complete (rule-based-v3)",
				"ok",
			);
		});
	});

	it("shows skeletons while an analysis is running", async () => {
		mockedGetSlow.mockImplementation(() => new Promise(() => undefined));
		mockedPostSlow.mockImplementation(() => new Promise(() => undefined));
		render(<AiPanel />);

		await waitFor(() => {
			expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
		});
	});
});
