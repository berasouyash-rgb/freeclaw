// Email templates endpoint — admin-only. Regression: the handler shipped
// with no auth, letting anyone relay email via test-send and rewrite all
// notification templates via PUT.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsAdmin, mockFrom } = vi.hoisted(() => ({
	mockIsAdmin: vi.fn(),
	mockFrom: vi.fn(),
}));

vi.mock("../../api/_auth.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../../api/_auth.js")>();
	return { ...mod, cors: vi.fn(), isAdmin: mockIsAdmin };
});

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));

vi.mock("../../api/_email.js", () => ({
	isEmailConfigured: vi.fn(() => false),
	sendPollClosedEmail: vi.fn(),
}));

import handler from "../../api/_email-templates.js";

function req(method: string, body?: unknown) {
	return { method, body: body ?? {}, headers: {}, query: {} };
}

function response() {
	const res: Record<string, unknown> = { statusCode: 200, body: undefined };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsAdmin.mockResolvedValue(false);
	mockFrom.mockImplementation(() => {
		const q: Record<string, unknown> = {};
		for (const m of ["select", "eq", "maybeSingle", "update", "insert", "upsert"]) {
			q[m] = vi.fn(() => q);
		}
		(q.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
		return q;
	});
});

describe("email-templates auth", () => {
	it("rejects anonymous test-send with 403", async () => {
		const res = response();
		await handler(
			req("POST", { action: "test-send", id: "post-solved", to_email: "a@b.com" }),
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("rejects anonymous template overwrite with 403", async () => {
		const res = response();
		await handler(
			req("PUT", { id: "post-solved", subject: "Hacked", body: "Hacked" }),
			res,
		);
		expect(res.statusCode).toBe(403);
	});

	it("lets admins preview and save", async () => {
		mockIsAdmin.mockResolvedValue(true);
		const preview = response();
		await handler(req("POST", { action: "preview", id: "post-solved" }), preview);
		expect(preview.statusCode).toBe(200);

		const save = response();
		await handler(
			req("PUT", { id: "post-solved", subject: "S", body: "B" }),
			save,
		);
		expect(save.statusCode).toBe(200);
	});
});
