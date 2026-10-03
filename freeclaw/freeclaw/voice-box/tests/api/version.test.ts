// App update feed — /api/version tells native shells (APK + EXE + DMG)
// where the newest build lives. Sourced purely from release env vars so an
// unset release simply advertises nothing (the client treats that as
// up-to-date). Public info only: no auth, no user data, short shared cache.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
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

const REQ = { method: "GET", headers: {}, query: {} };

beforeEach(() => {
	vi.resetModules();
	vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
	it("advertises nothing when no release env is set", async () => {
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ app: "voice-flow", platforms: {} });
	});

	it("publishes per-platform releases from env", async () => {
		vi.stubEnv("LATEST_APK_VERSION", "2.1.0");
		vi.stubEnv("LATEST_APK_URL", "https://example.com/app.apk");
		vi.stubEnv("LATEST_APK_NOTES", "Live feed fixes");
		vi.stubEnv("LATEST_EXE_VERSION", "2.1.0");
		vi.stubEnv("LATEST_EXE_URL", "https://example.com/app.exe");
		vi.stubEnv("LATEST_MAC_VERSION", "2.1.0");
		vi.stubEnv("LATEST_MAC_URL", "https://example.com/app.dmg");
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			app: "voice-flow",
			platforms: {
				android: {
					version: "2.1.0",
					url: "https://example.com/app.apk",
					notes: "Live feed fixes",
				},
				windows: {
					version: "2.1.0",
					url: "https://example.com/app.exe",
				},
				macos: {
					version: "2.1.0",
					url: "https://example.com/app.dmg",
				},
			},
		});
	});

	it("skips a platform missing either version or URL", async () => {
		vi.stubEnv("LATEST_APK_VERSION", "2.1.0");
		vi.stubEnv("LATEST_APK_URL", "");
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		expect(
			(res.body as { platforms: Record<string, unknown> }).platforms,
		).toEqual({});
	});

	it("405s non-GET methods", async () => {
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler({ ...REQ, method: "POST" } as never, res as never);
		expect(res.statusCode).toBe(405);
	});
});
