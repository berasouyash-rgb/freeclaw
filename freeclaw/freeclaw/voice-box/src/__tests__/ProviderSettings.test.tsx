// ═══════════════════════════════════════════════════════════════════
// ProviderSettings — AI provider config contract
// ═══════════════════════════════════════════════════════════════════
// Locks: provider list render (default star, model, key status), search,
// test single provider, test all, set default, model save, key save,
// enable/disable toggle, category grouping + expand/collapse, error toasts.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProviderSettings from "../pages/admin/ProviderSettings";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: mocks.post },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

const PROVIDERS = {
	openai: {
		id: "openai",
		name: "OpenAI",
		model: "gpt-4o",
		enabled: true,
		priority: 1,
		is_default: true,
		status: "ok",
		last_tested: "2026-07-01T10:00:00.000Z",
		key_masked: "sk-…abc",
		has_env_key: true,
	},
	nvidia: {
		id: "nvidia",
		name: "NVIDIA",
		model: "meta/llama-3.1-70b-instruct",
		enabled: false,
		priority: 2,
		is_default: false,
		status: "failed",
		last_tested: "2026-07-01T09:00:00.000Z",
		key_masked: "",
		has_env_key: false,
	},
	deepseek: {
		id: "deepseek",
		name: "DeepSeek",
		model: "deepseek-chat",
		enabled: true,
		priority: 3,
		is_default: false,
		status: "untested",
		last_tested: null,
		key_masked: "",
		has_env_key: true,
	},
};

const CATEGORY_INFO = {
	categories: {
		major: ["openai"],
		inference: ["nvidia"],
		other: ["deepseek"],
	},
	names: { major: "Major providers", inference: "Inference", other: "Other" },
	total: 3,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockImplementation(async (path: string) => {
		if (path.includes("action=categories")) return CATEGORY_INFO;
		return PROVIDERS;
	});
	mocks.post.mockResolvedValue({ ok: true, success: true, latency_ms: 120 });
});

function renderPage() {
	return render(<ProviderSettings />);
}

describe("ProviderSettings — list rendering", () => {
	it("loads and lists providers grouped by category (only major pre-expanded)", async () => {
		renderPage();
		expect(await screen.findByText("OpenAI")).toBeInTheDocument();
		expect(screen.getByText("Major providers")).toBeInTheDocument();
		// Collapsed categories show their headers but not their providers
		expect(screen.getByText("Inference")).toBeInTheDocument();
		expect(screen.getByText("Other")).toBeInTheDocument();
		expect(screen.queryByText("NVIDIA")).not.toBeInTheDocument();
		expect(screen.queryByText("DeepSeek")).not.toBeInTheDocument();
	});

	it("marks the default provider with a star and badge", async () => {
		renderPage();
		await screen.findByText("OpenAI");
		expect(screen.getByText("Default")).toBeInTheDocument();
	});

	it("shows masked key, env-var and no-key states", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");
		expect(screen.getByText("Key: sk-…abc")).toBeInTheDocument();

		// Expand the other two categories to see the env-var and no-key states
		await user.click(screen.getByRole("button", { name: /Inference/ }));
		await user.click(screen.getByRole("button", { name: /Other/ }));
		expect(screen.getAllByText("Env var").length).toBeGreaterThan(0);
		expect(screen.getByText("No key")).toBeInTheDocument();
	});

	it("shows provider test status", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");
		expect(screen.getAllByText("● OK").length).toBeGreaterThan(0);

		await user.click(screen.getByRole("button", { name: /Inference/ }));
		await user.click(screen.getByRole("button", { name: /Other/ }));
		expect(screen.getAllByText("● Failed").length).toBeGreaterThan(0);
		expect(screen.getAllByText("● Untested").length).toBeGreaterThan(0);
	});

	it("toasts an error when the load fails", async () => {
		mocks.get.mockRejectedValue(new Error("providers down"));
		renderPage();
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("providers down", "err");
		});
	});
});

describe("ProviderSettings — search", () => {
	it("filters providers by name", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		await user.type(
			screen.getByPlaceholderText(/Search 3 providers/),
			"nvidia",
		);
		expect(screen.getByText("NVIDIA")).toBeInTheDocument();
		expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
	});

	it("filters providers by model name", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		await user.type(
			screen.getByPlaceholderText(/Search 3 providers/),
			"deepseek-chat",
		);
		expect(screen.getByText("DeepSeek")).toBeInTheDocument();
		expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
	});
});

describe("ProviderSettings — provider actions", () => {
	it("tests a single provider and toasts the latency", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		await user.click(screen.getByTitle("Test"));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/providers", {
				action: "test_provider",
				provider: "openai",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("OpenAI: OK (120ms)", "ok");
	});

	it("toasts a failure result from test single", async () => {
		mocks.post.mockResolvedValue({ success: false, error: "bad key" });
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		await user.click(screen.getByTitle("Test"));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"OpenAI: Failed — bad key",
				"err",
			);
		});
	});

	it("tests all providers and toasts the aggregate", async () => {
		// test_all returns a per-provider result map
		mocks.post.mockResolvedValue({
			openai: { success: true },
			nvidia: { success: true },
			deepseek: { success: false },
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		await user.click(screen.getByRole("button", { name: /Test all/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/providers", {
				action: "test_all",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Tested 3 providers: 2 OK, 1 failed",
			"ok",
		);
	});

	it("sets a non-default provider as default via the star", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		// DeepSeek is in the collapsed Other group — expand it and click its star
		await user.click(screen.getByRole("button", { name: /Other/ }));
		await screen.findByText("DeepSeek");
		const row = screen.getByText("DeepSeek").closest(".rounded-xl") as HTMLElement;
		await user.click(within(row).getByTitle("Set as default"));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/providers", {
				action: "set_default",
				provider: "deepseek",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("DeepSeek set as default", "ok");
	});

	it("saves a model change via the model select", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		// OpenAI row has the model select with gpt-4o variants
		const row = screen.getByText("OpenAI").closest(".rounded-xl") as HTMLElement;
		const combo = within(row).getAllByRole("combobox")[0] as HTMLElement;
		await user.selectOptions(combo, "gpt-4o-mini");
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/providers", {
				action: "update_provider",
				provider: "openai",
				config: { model: "gpt-4o-mini" },
			});
		});
	});

	it("toggles a provider on via the Off button", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");
		await user.click(screen.getByRole("button", { name: /Inference/ }));
		await screen.findByText("NVIDIA");

		// NVIDIA is disabled → shows "Off"; clicking enables it
		const row = screen.getByText("NVIDIA").closest(".rounded-xl") as HTMLElement;
		await user.click(within(row).getByRole("button", { name: "Off" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/providers", {
				action: "update_provider",
				provider: "nvidia",
				config: { enabled: true },
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("NVIDIA enabled", "ok");
	});

	it("expands a provider to edit its API key", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		// OpenAI has a masked key → the settings input is a password field
		const row = screen.getByText("OpenAI").closest(".rounded-xl") as HTMLElement;
		await user.click(within(row).getByTitle("Settings"));
		const keyInput = within(row).getByPlaceholderText("sk-…abc");
		await user.type(keyInput, "sk-new-key");
		await user.click(within(row).getByRole("button", { name: /Save/ }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/providers", {
				action: "update_provider",
				provider: "openai",
				config: { key: "sk-new-key", enabled: true },
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("OpenAI key updated", "ok");
	});

	it("toasts a generic error when an action fails without an Error", async () => {
		mocks.post.mockRejectedValue("boom");
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		await user.click(screen.getByRole("button", { name: /Test all/ }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Provider action failed - check console for details",
				"err",
			);
		});
	});
});

describe("ProviderSettings — categories", () => {
	it("collapses and expands a category group", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("OpenAI");

		// collapse the major group (only one expanded initially)
		await user.click(screen.getByRole("button", { name: /Major providers/ }));
		expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Major providers/ }));
		expect(screen.getByText("OpenAI")).toBeInTheDocument();
	});

	it("shows enabled counts per category header", async () => {
		renderPage();
		await screen.findByText("OpenAI");
		// Two categories have 1/1 active (major + other) and inference has 0/1
		expect(screen.getAllByText("1/1 active")).toHaveLength(2);
		expect(screen.getByText("0/1 active")).toBeInTheDocument();
	});
});
