// ═══════════════════════════════════════════════════════════════════
// AdminSettings — password change + security posture + setup guide
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • password validation (min length, mismatch)
//   • SHA-256 hashing before transmission
//   • success / error paths through the real admin API
//   • busy state disables the button
//   • security posture claims render
//   • setup & deployment guide renders
//   • ProviderSettings is embedded
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminSettings from "../pages/admin/AdminSettings";
import {
	INFRASTRUCTURE_COPY,
	SERVER_PII_COPY,
} from "../lib/privacyCopy";

vi.mock("../lib/api", () => ({
	api: {
		post: vi.fn(),
		get: vi.fn(),
		getSlow: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: toastMock }),
}));

// jsdom has no crypto.subtle, so the real sha256() never settles. Mock it with a
// deterministic FNV-1a-based 64-char hex digest — still proves plaintext never
// leaves the browser (asserted via /^[0-9a-f]{64}$/ and not.toContain).
vi.mock("../lib/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../lib/utils")>();
	return {
		...mod,
		sha256: vi.fn(async (text: string) => {
			let h = 2166136261;
			for (let i = 0; i < text.length; i++) {
				h ^= text.charCodeAt(i);
				h = Math.imul(h, 16777619);
			}
			return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
		}),
	};
});

// ProviderSettings has its own dedicated suite — stub it here.
vi.mock("../pages/admin/ProviderSettings", () => ({
	default: () => <div data-testid="provider-settings-stub" />,
}));

const toastMock = vi.fn();

import { api } from "../lib/api";
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedGet = api.get as ReturnType<typeof vi.fn>;

const PASSWORD_INPUTS = () =>
	screen.getAllByPlaceholderText(/password/i) as [HTMLInputElement, HTMLInputElement];

beforeEach(() => {
	vi.clearAllMocks();
	toastMock.mockReset();
	// The page probes the auth mode on mount; default = password mode so the
	// change-password form renders (env mode has its own tests below).
	mockedGet.mockResolvedValue({ env_secret: false });
});

describe("AdminSettings", () => {
	it("renders the settings title and the two password fields", () => {
		render(<AdminSettings />);
		expect(screen.getByText("Settings")).toBeInTheDocument();
		expect(
			screen.getByPlaceholderText("New password — your choice"),
		).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Confirm new password")).toBeInTheDocument();
	});

	it("enables submit only when both fields match", () => {
		// Owner's policy: the admin may choose ANY password — the form's only
		// job is non-empty + match. Locks the regression where strength gates
		// (min length / blocklist) locked the admin out of their own choice.
		render(<AdminSettings />);
		const [pw1] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "abc" } });

		expect(
			screen.getByRole("button", { name: "Update password" }),
		).toBeDisabled();
		expect(mockedPost).not.toHaveBeenCalled();
	});

	it("accepts any password the admin chooses, short or simple", () => {
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "abc" } });
		fireEvent.change(pw2, { target: { value: "abc" } });

		expect(
			screen.getByRole("button", { name: "Update password" }),
		).toBeEnabled();
	});

	it("accepts a well-known breached password too — the admin decides", () => {
		// Deliberate: no blocklist. If this ever regresses into a gate, the
		// admin is again being told what they may not choose.
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "qwerty123" } });
		fireEvent.change(pw2, { target: { value: "qwerty123" } });

		expect(
			screen.getByRole("button", { name: "Update password" }),
		).toBeEnabled();
	});

	it("shows a mismatch hint and keeps the button disabled", () => {
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "MySecret123!" } });
		fireEvent.change(pw2, { target: { value: "Different99!" } });

		expect(
			screen.getByText("Passwords do not match yet."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Update password" }),
		).toBeDisabled();
		expect(mockedPost).not.toHaveBeenCalled();
	});

	it("sends a SHA-256 hashed password to the admin API on success", async () => {
		mockedPost.mockResolvedValue({ ok: true });
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "MySecret123!" } });
		fireEvent.change(pw2, { target: { value: "MySecret123!" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith(
				"/api/admin",
				expect.objectContaining({
					action: "change_password",
					new_hash: expect.any(String),
				}),
			);
		});
		const hash = mockedPost.mock.calls[0]![1]!.new_hash as string;
		// SHA-256 hex digest is 64 characters — plain text never leaves the browser
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toContain("MySecret123!");
	});

	it("clears inputs and shows a success toast after a successful change", async () => {
		mockedPost.mockResolvedValue({ ok: true });
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "MySecret123!" } });
		fireEvent.change(pw2, { target: { value: "MySecret123!" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith(
				"Password updated — use it on your next login",
				"ok",
			);
		});
		expect(pw1.value).toBe("");
		expect(pw2.value).toBe("");
	});

	it("shows the error message when the API rejects the change", async () => {
		mockedPost.mockRejectedValue(new Error("Session expired"));
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "MySecret123!" } });
		fireEvent.change(pw2, { target: { value: "MySecret123!" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Session expired", "err");
		});
	});

	it("shows the generic error message for non-Error failures", async () => {
		mockedPost.mockRejectedValue("boom");
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "MySecret123!" } });
		fireEvent.change(pw2, { target: { value: "MySecret123!" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith(
				"Failed to change password",
				"err",
			);
		});
	});

	it("disables the button and shows Saving… while the request is in flight", async () => {
		let resolve!: (v: unknown) => void;
		mockedPost.mockImplementation(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		);
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "MySecret123!" } });
		fireEvent.change(pw2, { target: { value: "MySecret123!" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
		});
		resolve({ ok: true });
		// After success the fields clear, so the button reverts to “Update password”
		// (still disabled because pw1 is empty again) — busy state is released.
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Update password" }),
			).toBeInTheDocument();
		});
		expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument();
	});

	it("keeps the button disabled while the fields are empty", () => {
		render(<AdminSettings />);
		expect(screen.getByRole("button", { name: "Update password" })).toBeDisabled();
	});

	it("documents that passwords are hashed before transmission", () => {
		render(<AdminSettings />);
		expect(
			screen.getByText(
				/passwords are hashed with sha-256 in your browser before transmission/i,
			),
		).toBeInTheDocument();
	});

	it("renders the security posture list with sessions, PII boundaries, sanitization and rate limits", () => {
		render(<AdminSettings />);
		expect(screen.getByText("Security posture")).toBeInTheDocument();
		expect(
			screen.getByText(/Sessions expire automatically after 60 minutes\./),
		).toBeInTheDocument();
		expect(screen.getByText(SERVER_PII_COPY)).toBeInTheDocument();
		expect(screen.getByText(INFRASTRUCTURE_COPY)).toBeInTheDocument();
		expect(
			screen.queryByText(/no personal data exists in the database\./i),
		).not.toBeInTheDocument();
		expect(
			screen.getByText(/Rate limits: 3 posts\/min, 5 comments\/30s/),
		).toBeInTheDocument();
	});

	it("renders the setup & deployment guide with backend and AI integration steps", () => {
		render(<AdminSettings />);
		expect(screen.getByText(/Setup & deployment guide/)).toBeInTheDocument();
		expect(screen.getByText(/1 · Backend \(Supabase\)/)).toBeInTheDocument();
		expect(screen.getByText(/2 · AI integration/)).toBeInTheDocument();
		expect(screen.getByText(/3 · Admin access/)).toBeInTheDocument();
		expect(screen.getByText(/4 · Privacy guarantees/)).toBeInTheDocument();
	});

	it("loads and saves the user-deleted retention hours", async () => {
		mockedGet.mockImplementation(async (path) => {
			if (String(path).includes("get_retention_config")) return { user_delete_hours: 5 };
			if (String(path).includes("get_spam_config")) return { flag: 40, review: 60, quarantine: 80 };
			if (String(path).includes("get_agent_actions")) return { enabled: true };
			return { env_secret: false };
		});
		mockedPost.mockResolvedValue({ user_delete_hours: 12 });
		render(<AdminSettings />);
		const input = await screen.findByLabelText("User-deleted auto-remove hours");
		// The input renders on first paint with value ""; the mocked
		// get_retention_config GET lands a tick later. findByLabelText only
		// guarantees existence — wait for the loaded value (CI proved the
		// race: jest-dom reports "" on a number input as null).
		await waitFor(() => expect(input).toHaveValue(5));
		fireEvent.change(input, { target: { value: "12" } });
		fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/admin", {
				action: "set_retention_config",
				user_delete_hours: 12,
				auto_delete_enabled: true,
				classes: {},
			});
		});
		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Deleted posts auto-remove after 12h", "ok");
		});
	});

	it("toggles auto-delete off and saves it", async () => {
		mockedGet.mockImplementation(async (path) => {
			if (String(path).includes("get_retention_config")) return { user_delete_hours: 5, auto_delete_enabled: true };
			if (String(path).includes("get_spam_config")) return { flag: 40, review: 60, quarantine: 80 };
			if (String(path).includes("get_agent_actions")) return { enabled: true };
			if (String(path).includes("get_cleanup_stats")) return { cleanup: null, purge: null };
			return { env_secret: false };
		});
		mockedPost.mockResolvedValue({ user_delete_hours: 5, auto_delete_enabled: false });
		render(<AdminSettings />);
		const toggle = await screen.findByLabelText("Auto-delete user-deleted posts");
		fireEvent.click(toggle);
		fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/admin", {
				action: "set_retention_config",
				user_delete_hours: 5,
				auto_delete_enabled: false,
				classes: {},
			});
		});
	});

	it("warns when auto-delete is off and restores the 5h default", async () => {
		mockedGet.mockImplementation(async (path) => {
			if (String(path).includes("get_retention_config")) return { user_delete_hours: 24, auto_delete_enabled: false };
			if (String(path).includes("get_spam_config")) return { flag: 40, review: 60, quarantine: 80 };
			if (String(path).includes("get_agent_actions")) return { enabled: true };
			if (String(path).includes("get_cleanup_stats")) return { cleanup: null, purge: null };
			return { env_secret: false };
		});
		mockedPost.mockResolvedValue({ user_delete_hours: 5, auto_delete_enabled: true });
		render(<AdminSettings />);
		expect(await screen.findByText(/deleted posts are kept for admins indefinitely/)).toBeInTheDocument();
		expect(screen.getByText(/auto-delete is off: deleted rows accumulate/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Restore 5h default" }));
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/admin", {
				action: "set_retention_config",
				user_delete_hours: 5,
				auto_delete_enabled: true,
				classes: {
					comments: true,
					reactions: true,
					chat_messages: true,
					activity_logs: true,
					agent_conversations: true,
					archived_polls: true,
					agent_history: true,
				},
			});
		});
		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Retention restored to the 5h default", "ok");
		});
	});

	it("sends per-class janitor toggles with the retention save", async () => {
		mockedGet.mockImplementation(async (path) => {
			if (String(path).includes("get_retention_config")) return { user_delete_hours: 5, auto_delete_enabled: true, classes: {} };
			if (String(path).includes("get_spam_config")) return { flag: 40, review: 60, quarantine: 80 };
			if (String(path).includes("get_agent_actions")) return { enabled: true };
			if (String(path).includes("get_cleanup_stats")) return { cleanup: null, purge: null };
			return { env_secret: false };
		});
		mockedPost.mockResolvedValue({ user_delete_hours: 5, auto_delete_enabled: true, classes: { comments: false } });
		render(<AdminSettings />);
		// All seven class toggles render, defaulting to on.
		const commentsBox = await screen.findByLabelText("Old comments");
		expect(commentsBox).toBeChecked();
		fireEvent.click(commentsBox);
		fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/admin", {
				action: "set_retention_config",
				user_delete_hours: 5,
				auto_delete_enabled: true,
				classes: { comments: false },
			});
		});
	});

	it("embeds the ProviderSettings module inside a card", () => {
		render(<AdminSettings />);
		expect(screen.getByTestId("provider-settings-stub")).toBeInTheDocument();
	});

	it("switches to the environment-secret view when the deployment uses one", async () => {
		mockedGet.mockResolvedValue({ env_secret: true });
		render(<AdminSettings />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /Sign out all admin sessions/i }),
			).toBeInTheDocument(),
		);
		// The password form must not render in env mode — it would be a lie.
		expect(screen.queryByPlaceholderText(/password/i)).not.toBeInTheDocument();
	});

	it("revokes all admin sessions from the env-secret view", async () => {
		mockedGet.mockResolvedValue({ env_secret: true });
		mockedPost.mockResolvedValue({ ok: true });
		render(<AdminSettings />);
		fireEvent.click(
			await screen.findByRole("button", {
				name: /Sign out all admin sessions/i,
			}),
		);
		await waitFor(() =>
			expect(mockedPost).toHaveBeenCalledWith("/api/admin", {
				action: "revoke_all_sessions",
			}),
		);
	});
});

describe("AdminSettings — feed page size", () => {
	function mockFeedGet(pageSize: number) {
		mockedGet.mockImplementation((url) => {
			if (String(url).includes("get_feed_config"))
				return Promise.resolve({ page_size: pageSize });
			return Promise.resolve({ env_secret: false });
		});
	}

	it("renders the server value in the control", async () => {
		mockFeedGet(50);
		render(<AdminSettings />);
		const input = await screen.findByLabelText("Posts loaded per feed fetch");
		// Same async-load race as the retention control: the GET value commits
		// after the input already exists — wait for it instead of racing.
		await waitFor(() => expect(input).toHaveValue(50));
	});

	it("saves through set_feed_config and adopts the normalized value", async () => {
		mockFeedGet(30);
		mockedPost.mockResolvedValue({ page_size: 20 });
		render(<AdminSettings />);
		const input = await screen.findByLabelText("Posts loaded per feed fetch");
		fireEvent.change(input, { target: { value: 20 } });
		fireEvent.click(screen.getByRole("button", { name: "Save feed page size" }));
		await waitFor(() =>
			expect(mockedPost).toHaveBeenCalledWith(`/api/admin`, {
				action: `set_feed_config`,
				page_size: 20,
			}),
		);
		// The save round-trip adopts the normalized value from the POST
		// response — wait for the committed render, not just the call.
		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Feed loads 20 posts at once", "ok");
			expect(input).toHaveValue(20);
		});
	});

	it("disables save until the value loads", () => {
		mockedGet.mockReturnValue(new Promise(() => {}));
		render(<AdminSettings />);
		expect(screen.getByRole("button", { name: "Save feed page size" })).toBeDisabled();
	});
});
