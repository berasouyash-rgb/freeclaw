// ═══════════════════════════════════════════════════════════════════
// AdminAI — unified intelligence workspace (chat + side panels)
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • header + NVIDIA provider indicator + history/refresh/new-chat
//   • empty state with quick-action cards and quick chips
//   • SSE chat: user message posts to /api/ai-chat, streamed content
//     renders, done event finalizes, error event surfaces
//   • side tabs: Agents / Activity / Health / Tools / Audit / Memory /
//     KB / Reports / Learn
//   • suggestions: pending list, approve (executable), dismiss, generate,
//     pending/history toggle, critical confirm dialog
//   • health / tools / audit / memory loaders wired to real endpoints
//   • conversation history dialog + new conversation
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminAI from "../pages/admin/AdminAI";

vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		getSlow: vi.fn(),
		post: vi.fn(),
		postLong: vi.fn(),
		postSlow: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: toastMock }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

// Short-circuit the cinematic loader + story delay so tests don't wait for it
vi.mock("../components/ErrorBoundary", () => ({
	LoadingSpinner: () => <div data-testid="loading-spinner" />,
	prefersReducedMotion: () => false,
	VB_FULL_CYCLE_MS: 50,
}));

const toastMock = vi.fn();

import { api } from "../lib/api";
const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedPostLong = api.postLong as ReturnType<typeof vi.fn>;
const mockedPut = api.put as ReturnType<typeof vi.fn>;

/** Build an SSE response body that AdminAI's reader can consume. */
// jsdom's Blob has no .stream() — pass the plain string so Response creates
// its own readable stream (getReader() works in Node 18+).
function sseResponse(events: string[]) {
	return new Response(events.join("\n") + "\n", {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

const SUGGESTION = {
	id: 1,
	kind: "status_change",
	title: "Mark lift post as in progress",
	status: "pending",
	reasoning: "The post has high engagement and no action taken.",
	confidence: 0.86,
	created_at: new Date().toISOString(),
	critical: false,
	content: { from: "open", to: "in_progress" },
};

const SUGGESTION_CRITICAL = {
	...SUGGESTION,
	id: 2,
	kind: "escalation",
	title: "Escalate security incident",
	status: "pending",
	critical: true,
	confidence: 0.95,
	content: { status: "critical" },
};

const TOOL = {
	name: "hide_post",
	description: "Hide a reported post from the feed",
	category: "moderation",
	permissions: "admin",
	requiresApproval: true,
};

const AUDIT = {
	id: "a1",
	actor: "admin",
	action: "post.hidden",
	detail: "hid post-123",
	created_at: new Date().toISOString(),
};

const MEMORY = {
	id: "m1",
	agent_id: "facilities:lift",
	memory_type: "long_term",
	content: "Block C lift has recurring issues",
	created_at: new Date().toISOString(),
};

const HEALTH = {
	status: "healthy",
	uptime: 99.9,
	database: { status: "ok", latency_ms: 12 },
	cache: { size: 1024, hit_rate: 0.87 },
	circuit_breakers: { providers: { state: "closed", failures: 0 } },
};

const HISTORY_MSG = {
	role: "assistant",
	content: "Welcome back! Here's your prior session.",
	created_at: new Date().toISOString(),
};

function seedAdminAI(overrides: Partial<{ suggestions: unknown[]; history: unknown[] }> = {}) {
	mockedPostLong.mockImplementation(async (path: string) => {
		if (path === "/api/ai-chat") return overrides.history ?? [];
		return [];
	});
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/tool-registry")) return { tools: [TOOL] };
		if (path.startsWith("/api/audit-trail")) return { logs: [AUDIT] };
		if (path.startsWith("/api/memory?action=list")) return { memories: [MEMORY] };
		if (path.startsWith("/api/agent-team?action=reports")) {
			return { reports: [], stats: null };
		}
		if (path.startsWith("/api/learning?action=stats")) return { ok: true };
		if (path.startsWith("/api/learning?action=insights")) return { insights: [] };
		if (path.startsWith("/api/learning?action=records")) return { records: [] };
		if (path === "/api/agent") return overrides.suggestions ?? [SUGGESTION];
		return {};
	});
	mockedPost.mockImplementation(async (path: string) => {
		if (path === "/api/agent") return { created: 1 };
		if (path === "/api/rag") return { results: [] };
		return { ok: true };
	});
	mockedPut.mockResolvedValue({ ok: true });
	global.fetch = vi.fn(async (url: RequestInfo | URL) => {
		if (String(url) === "/api/health") {
			return new Response(JSON.stringify(HEALTH), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return sseResponse([
			`data: ${JSON.stringify({ ada_event: "content_delta", delta: "Hello" })}`,
			`data: ${JSON.stringify({ ada_event: "content_delta", delta: " world" })}`,
			`data: ${JSON.stringify({ ada_event: "done", text: "Hello world", model: "nemotron", provider: "nvidia" })}`,
		]);
	}) as unknown as typeof fetch;
}

async function openSideTab(name: string) {
	const tab = await screen.findByRole("button", { name: new RegExp(`^${name}`) });
	fireEvent.click(tab);
}

beforeEach(() => {
	vi.clearAllMocks();
	toastMock.mockReset();
	localStorage.clear();
	sessionStorage.clear();
	vi.unstubAllGlobals();
});

describe("AdminAI (intelligence workspace)", () => {
	it("renders the header with provider indicator and action buttons", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await waitFor(() => {
			expect(screen.getByText("Admin AI")).toBeInTheDocument();
			expect(screen.getByText("INTELLIGENCE CENTER")).toBeInTheDocument();
			expect(screen.getByText("NVIDIA")).toBeInTheDocument();
			expect(screen.getByRole("button", { name: /New chat/ })).toBeInTheDocument();
			expect(screen.getByTitle("Conversation history")).toBeInTheDocument();
			expect(screen.getByTitle("Refresh")).toBeInTheDocument();
		});
	});

	it("shows the empty state with quick-action cards and quick chips", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await waitFor(() => {
			expect(screen.getByText("Voice Box Admin AI")).toBeInTheDocument();
			expect(screen.getByText("Show system status")).toBeInTheDocument();
			expect(screen.getByText("List all tools")).toBeInTheDocument();
			expect(screen.getByText("Recent activity")).toBeInTheDocument();
			expect(screen.getByText("Search knowledge base")).toBeInTheDocument();
		});
	});

	it("loading history shows the spinner first, then the empty state", async () => {
		seedAdminAI();
		// loadHistory AND loadSessions both hit postLong — collect every pending
		// promise so releasing them all clears the loader (single-release misses one).
		const releases: (() => void)[] = [];
		mockedPostLong.mockImplementation(
			() =>
				new Promise((r) => {
					releases.push(() => r([]));
				}),
		);
		render(<AdminAI />);

		expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
		releases.forEach((r) => r());
		await waitFor(() => {
			expect(screen.getByText("Voice Box Admin AI")).toBeInTheDocument();
		});
	});

	it("loads prior conversation history and renders it as messages", async () => {
		seedAdminAI({ history: [HISTORY_MSG] });
		render(<AdminAI />);

		await waitFor(() => {
			expect(
				screen.getByText("Welcome back! Here's your prior session."),
			).toBeInTheDocument();
		});
	});

	it("sends a message through SSE and renders the streamed reply", async () => {
		seedAdminAI();
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		render(<AdminAI />);

		await waitFor(() => {
			expect(
				screen.getByPlaceholderText(/Ask about your platform/i),
			).toBeInTheDocument();
		});
		const textarea = screen.getByPlaceholderText(/Ask about your platform/i);
		fireEvent.change(textarea, { target: { value: "Check the lift post" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/ai-chat",
				expect.objectContaining({
					method: "POST",
					body: expect.stringContaining("Check the lift post"),
				}),
			);
		});
		await waitFor(() => {
			expect(screen.getByText("Hello world")).toBeInTheDocument();
		});
	});

	it("renders process steps and tool results from streamed events", async () => {
		seedAdminAI();
		global.fetch = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url) === "/api/health") {
				return new Response(JSON.stringify(HEALTH), { status: 200 });
			}
			return sseResponse([
				`data: ${JSON.stringify({ ada_event: "process_step", step_id: "s1", label: "Querying database", status: "done" })}`,
				`data: ${JSON.stringify({ ada_event: "tool_result", tool: "hide_post", args: { id: "p1" }, result: { ok: true } })}`,
				`data: ${JSON.stringify({ ada_event: "done", text: "Done" })}`,
			]);
		}) as unknown as typeof fetch;
		render(<AdminAI />);

		await waitFor(() => {
			expect(
				screen.getByPlaceholderText(/Ask about your platform/i),
			).toBeInTheDocument();
		});
		const textarea = screen.getByPlaceholderText(/Ask about your platform/i);
		fireEvent.change(textarea, { target: { value: "Run tool" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => {
			expect(screen.getByText("Querying database")).toBeInTheDocument();
			expect(screen.getByText(/hide_post/)).toBeInTheDocument();
		});
	});

	it("surfaces an error event from the stream instead of crashing", async () => {
		seedAdminAI();
		global.fetch = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url) === "/api/health") {
				return new Response(JSON.stringify(HEALTH), { status: 200 });
			}
			return sseResponse([
				`data: ${JSON.stringify({ ada_event: "error", message: "Provider timeout" })}`,
			]);
		}) as unknown as typeof fetch;
		render(<AdminAI />);

		await waitFor(() => {
			expect(
				screen.getByPlaceholderText(/Ask about your platform/i),
			).toBeInTheDocument();
		});
		const textarea = screen.getByPlaceholderText(/Ask about your platform/i);
		fireEvent.change(textarea, { target: { value: "Trigger error" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => {
			expect(screen.getByText("Error: Provider timeout")).toBeInTheDocument();
		});
	});

	it("renders thinking deltas while the assistant reasons", async () => {
		seedAdminAI();
		global.fetch = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url) === "/api/health") {
				return new Response(JSON.stringify(HEALTH), { status: 200 });
			}
			return sseResponse([
				`data: ${JSON.stringify({ ada_event: "thinking_delta", delta: "Analyzing the request…" })}`,
				`data: ${JSON.stringify({ ada_event: "content_delta", delta: "Final answer" })}`,
				`data: ${JSON.stringify({ ada_event: "done", text: "Final answer", thinking: "Analyzing the request…" })}`,
			]);
		}) as unknown as typeof fetch;
		render(<AdminAI />);

		await waitFor(() => {
			expect(
				screen.getByPlaceholderText(/Ask about your platform/i),
			).toBeInTheDocument();
		});
		const textarea = screen.getByPlaceholderText(/Ask about your platform/i);
		fireEvent.change(textarea, { target: { value: "Think" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => {
			expect(screen.getByText(/Analyzing the request…/)).toBeInTheDocument();
		});
	});

	it("new chat clears messages and starts a fresh session id", async () => {
		seedAdminAI({ history: [HISTORY_MSG] });
		render(<AdminAI />);

		await waitFor(() => {
			expect(
				screen.getByText("Welcome back! Here's your prior session."),
			).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /New chat/ }));

		await waitFor(() => {
			expect(screen.getByText("Voice Box Admin AI")).toBeInTheDocument();
			expect(
				screen.queryByText("Welcome back! Here's your prior session."),
			).not.toBeInTheDocument();
		});
	});

	it("switches to the Activity tab and lists pending suggestions", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Activity");
		await waitFor(() => {
			expect(screen.getByText("Mark lift post as in progress")).toBeInTheDocument();
			expect(screen.getByText("Status change")).toBeInTheDocument();
			expect(screen.getByText(/86%/)).toBeInTheDocument();
		});
	});

	it("shows a truthful empty state when there are no pending suggestions", async () => {
		seedAdminAI({ suggestions: [] });
		render(<AdminAI />);

		await openSideTab("Activity");
		await waitFor(() => {
			expect(screen.getByText("No pending suggestions")).toBeInTheDocument();
		});
	});

	it("approves an executable suggestion through the real API", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Activity");
		const approveBtn = await screen.findByRole("button", { name: /Approve/ });
		fireEvent.click(approveBtn);

		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith(
				"/api/agent",
				expect.objectContaining({ id: 1, action: "approve" }),
			);
		});
	});

	it("requires confirmation before approving a critical suggestion", async () => {
		seedAdminAI({ suggestions: [SUGGESTION_CRITICAL] });
		render(<AdminAI />);

		await openSideTab("Activity");
		const reviewBtn = await screen.findByRole("button", { name: /Review\.\.\./ });
		fireEvent.click(reviewBtn);

		await waitFor(() => {
			// Confirm dialog opens — approve is NOT sent yet
			expect(screen.getByText(/Critical suggestion — confirm/)).toBeInTheDocument();
			expect(
				screen.getByText(/will apply it immediately and record it in the audit log/),
			).toBeInTheDocument();
		});
		expect(mockedPut).not.toHaveBeenCalled();
	});

	it("confirms a critical suggestion from the confirm dialog", async () => {
		seedAdminAI({ suggestions: [SUGGESTION_CRITICAL] });
		render(<AdminAI />);

		await openSideTab("Activity");
		const reviewBtn = await screen.findByRole("button", { name: /Review\.\.\./ });
		fireEvent.click(reviewBtn);

		await waitFor(() => {
			expect(screen.getByText(/Critical suggestion — confirm/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Confirm & apply/ }));

		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith(
				"/api/agent",
				expect.objectContaining({ id: 2, action: "approve" }),
			);
		});
	});

	it("dismisses a suggestion through the API and refreshes the list", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Activity");
		const dismissBtn = await screen.findByRole("button", { name: /Dismiss/ });
		fireEvent.click(dismissBtn);

		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith(
				"/api/agent",
				expect.objectContaining({ id: 1, action: "dismiss" }),
			);
			expect(toastMock).toHaveBeenCalledWith("Dismissed", "ok");
		});
	});

	it("generate suggestions drafts new actions through the API", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Activity");
		// exact text — the quick-action chips “Generate CSV” must not match
		const genBtn = await screen.findByRole("button", { name: "Generate" });
		fireEvent.click(genBtn);

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/agent", {
				action: "generate",
			});
		});
	});

	it("toggles between pending and history suggestion lists", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Activity");
		await screen.findByText("Mark lift post as in progress");
		// the history toggle in the activity panel (not the header history button)
		fireEvent.click(screen.getByRole("button", { name: /history \(0\)/ }));

		await waitFor(() => {
			expect(screen.getByText("No history yet")).toBeInTheDocument();
		});
	});

	it("loads and shows system health in the Health tab", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Health");
		await waitFor(() => {
			expect(screen.getByText("System Health")).toBeInTheDocument();
			expect(screen.getByText("healthy")).toBeInTheDocument();
			// uptime 99.9s renders as 0h 1m; DB latency is real data
			expect(screen.getByText(/Uptime: 0h 1m/)).toBeInTheDocument();
			expect(screen.getByText("Latency: 12ms")).toBeInTheDocument();
			expect(screen.getByText("closed (0)")).toBeInTheDocument(); // circuit breaker
		});
	});

	it("loads and lists tools in the Tools tab", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Tools");
		await waitFor(() => {
			expect(screen.getByText("hide_post")).toBeInTheDocument();
			expect(screen.getByText(/Hide a reported post from the feed/)).toBeInTheDocument();
		});
	});

	it("loads and lists audit entries in the Audit tab", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Audit");
		await waitFor(() => {
			expect(screen.getByText("post.hidden")).toBeInTheDocument();
			expect(screen.getByText(/hid post-123/)).toBeInTheDocument();
		});
	});

	it("loads and lists memories in the Memory tab", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await openSideTab("Memory");
		await waitFor(() => {
			expect(screen.getByText("facilities:lift")).toBeInTheDocument();
			expect(
				screen.getByText("Block C lift has recurring issues"),
			).toBeInTheDocument();
			expect(screen.getByText("1 memories")).toBeInTheDocument();
		});
	});

	it("shows the Agents tab routing panel by default", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await waitFor(() => {
			expect(screen.getByText("Agent Routing")).toBeInTheDocument();
			expect(screen.getByText("NVIDIA Nemotron 70B")).toBeInTheDocument();
		});
	});

	it("opens the conversation history dialog and renders saved sessions", async () => {
		seedAdminAI({ history: [HISTORY_MSG] });
		mockedPostLong.mockImplementation(async (path: string) => {
			if (path === "/api/ai-chat") return [HISTORY_MSG];
			return [];
		});
		render(<AdminAI />);

		fireEvent.click(screen.getByTitle("Conversation history"));
		await waitFor(() => {
			expect(screen.getByText(/Conversation history/i)).toBeInTheDocument();
		});
	});

	it("collapses and expands the side panel", async () => {
		seedAdminAI();
		render(<AdminAI />);

		await waitFor(() => {
			expect(screen.getByText("Agent Routing")).toBeInTheDocument();
		});
		const collapse = screen.getByTitle("Collapse panel");
		fireEvent.click(collapse);

		await waitFor(() => {
			expect(screen.getByTitle("Expand panel")).toBeInTheDocument();
			expect(screen.queryByText("Agent Routing")).not.toBeInTheDocument();
		});
		fireEvent.click(screen.getByTitle("Expand panel"));
		await waitFor(() => {
			expect(screen.getByText("Agent Routing")).toBeInTheDocument();
		});
	});
});
