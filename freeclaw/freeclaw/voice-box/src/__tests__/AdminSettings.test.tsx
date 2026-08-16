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

const PASSWORD_INPUTS = () =>
	screen.getAllByPlaceholderText(/password/i) as [HTMLInputElement, HTMLInputElement];

beforeEach(() => {
	vi.clearAllMocks();
	toastMock.mockReset();
});

describe("AdminSettings", () => {
	it("renders the settings title and the two password fields", () => {
		render(<AdminSettings />);
		expect(screen.getByText("Settings")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("New password (min 6 chars)")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Confirm new password")).toBeInTheDocument();
	});

	it("rejects a password shorter than 6 characters with an error toast", async () => {
		render(<AdminSettings />);
		const [pw1] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "abc" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith(
				"Password must be at least 6 characters",
				"err",
			);
		});
		expect(mockedPost).not.toHaveBeenCalled();
	});

	it("rejects mismatched passwords with an error toast", async () => {
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "secret123" } });
		fireEvent.change(pw2, { target: { value: "different99" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Passwords do not match", "err");
		});
		expect(mockedPost).not.toHaveBeenCalled();
	});

	it("sends a SHA-256 hashed password to the admin API on success", async () => {
		mockedPost.mockResolvedValue({ ok: true });
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "mysecret123" } });
		fireEvent.change(pw2, { target: { value: "mysecret123" } });
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
		expect(hash).not.toContain("mysecret123");
	});

	it("clears inputs and shows a success toast after a successful change", async () => {
		mockedPost.mockResolvedValue({ ok: true });
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "mysecret123" } });
		fireEvent.change(pw2, { target: { value: "mysecret123" } });
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
		fireEvent.change(pw1, { target: { value: "mysecret123" } });
		fireEvent.change(pw2, { target: { value: "mysecret123" } });
		fireEvent.click(screen.getByRole("button", { name: "Update password" }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Session expired", "err");
		});
	});

	it("shows the generic error message for non-Error failures", async () => {
		mockedPost.mockRejectedValue("boom");
		render(<AdminSettings />);
		const [pw1, pw2] = PASSWORD_INPUTS();
		fireEvent.change(pw1, { target: { value: "mysecret123" } });
		fireEvent.change(pw2, { target: { value: "mysecret123" } });
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
		fireEvent.change(pw1, { target: { value: "mysecret123" } });
		fireEvent.change(pw2, { target: { value: "mysecret123" } });
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

	it("renders the security posture list with sessions, anonymity, sanitization and rate limits", () => {
		render(<AdminSettings />);
		expect(screen.getByText("Security posture")).toBeInTheDocument();
		expect(
			screen.getByText(/Sessions expire automatically after 60 minutes\./),
		).toBeInTheDocument();
		expect(
			screen.getByText(/no personal data exists in the database\./),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Rate limits: 3 posts\/min, 5 comments\/30s/),
		).toBeInTheDocument();
	});

	it("renders the setup & deployment guide with backend and AI integration steps", () => {
		render(<AdminSettings />);
		expect(screen.getByText(/Setup & deployment guide/)).toBeInTheDocument();
		expect(screen.getByText(/1 · Backend \(Supabase\)/)).toBeInTheDocument();
		expect(screen.getByText(/2 · AI integration \(Anthropic\)/)).toBeInTheDocument();
		expect(screen.getByText(/3 · Admin password/)).toBeInTheDocument();
		expect(screen.getByText(/4 · Privacy guarantees/)).toBeInTheDocument();
	});

	it("embeds the ProviderSettings module inside a card", () => {
		render(<AdminSettings />);
		expect(screen.getByTestId("provider-settings-stub")).toBeInTheDocument();
	});
});
