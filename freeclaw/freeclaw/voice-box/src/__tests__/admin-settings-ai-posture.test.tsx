import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real /api/providers?action=list contract (api/_providers.js:1490-1525):
// rows carry { name, model, is_default, has_env_key }.
const PROVIDERS = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		model: "claude-sonnet-4-6",
		enabled: true,
		priority: 0,
		is_default: true,
		status: "ok",
		last_tested: null,
		key_masked: "sk-…abc",
		has_env_key: true,
	},
	nvidia: {
		id: "nvidia",
		name: "NVIDIA NIM",
		model: "nvidia/nemotron-3-ultra-550b-a55b",
		enabled: true,
		priority: 1,
		is_default: false,
		status: "untested",
		last_tested: null,
		key_masked: "",
		has_env_key: false,
	},
};

vi.mock("lucide-react", () => ({
	Bot: () => null,
	KeyRound: () => null,
	List: () => null,
	LogOut: () => null,
	ShieldCheck: () => null,
	SlidersHorizontal: () => null,
}));

const get = vi.fn();
const post = vi.fn();

vi.mock("../lib/api", () => ({
	api: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
	},
	clearAdminSession: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: vi.fn() }),
}));

vi.mock("../lib/utils", () => ({
	sha256: vi.fn(async () => "hashed"),
}));

vi.mock("../pages/admin/ProviderSettings", () => ({
	default: () => <div data-testid="provider-settings" />,
}));

async function renderSettings() {
	const { default: AdminSettings } = await import("../pages/admin/AdminSettings");
	render(<AdminSettings />);
}

describe("AdminSettings AI-provider posture (live, not hardcoded)", () => {
	beforeEach(() => {
		get.mockReset();
		post.mockReset();
		// Default: every other admin read succeeds with a benign value; the
		// providers list is overridden per-test.
		get.mockImplementation((url: string) => {
			if (url.includes("action=auth_mode")) return Promise.resolve({ env_secret: false });
			if (url.includes("action=get_agent_actions")) return Promise.resolve({ enabled: true });
			if (url.includes("action=get_spam_config"))
				return Promise.resolve({ flag: 40, review: 70, quarantine: 90 });
			if (url.includes("action=get_retention_config"))
				return Promise.resolve({ user_delete_hours: 72, auto_delete_enabled: true, classes: {} });
			if (url.includes("action=get_feed_config")) return Promise.resolve({ page_size: 30 });
			if (url.includes("action=get_cleanup_stats"))
				return Promise.resolve({ cleanup: null, purge: null });
			if (url.includes("/api/providers"))
				return Promise.resolve({ anthropic: PROVIDERS.anthropic, nvidia: PROVIDERS.nvidia });
			return Promise.resolve({});
		});
	});

	it("states the LIVE default provider + model instead of hardcoding Claude/ANTHROPIC_API_KEY", async () => {
		await renderSettings();

		await waitFor(() => {
			// The claim reads the actual default row from /api/providers.
			expect(
				screen.getByText(/AI moderation runs on Anthropic \(claude-sonnet-4-6\)/),
			).toBeTruthy();
		});

		// The stale hardcoded claim must be gone: no bare "Claude Sonnet 4.6 …
		// when an ANTHROPIC_API_KEY secret is configured" sentence.
		expect(screen.queryByText(/Claude Sonnet 4\.6\) runs when/)).toBeNull();
	});

	it("falls back to an honest 'no provider configured' claim when the list has no default", async () => {
		get.mockImplementation((url: string) => {
			if (url.includes("/api/providers")) return Promise.resolve({});
			return Promise.resolve({});
		});
		await renderSettings();

		await waitFor(() => {
			expect(
				screen.getByText(/AI moderation runs on a built-in heuristic engine \(no AI provider configured\)/),
			).toBeTruthy();
		});
	});

	it("keeps the heuristic-fallback statement when the providers read fails", async () => {
		get.mockImplementation((url: string) => {
			if (url.includes("/api/providers"))
				return Promise.reject(new Error("forbidden"));
			return Promise.resolve({});
		});
		await renderSettings();

		await waitFor(() => {
			expect(
				screen.getByText(/AI moderation runs on a built-in heuristic engine \(no AI provider configured\)/),
			).toBeTruthy();
		});
	});
});
