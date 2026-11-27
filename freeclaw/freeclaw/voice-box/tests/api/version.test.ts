// App update feed — /api/version tells native shells (APK + EXE + DMG)
// where the newest build lives. Sourced from release env vars, falling back
// to the manifest `scripts/release-native.mjs` writes when it publishes a
// build. A platform with neither source advertises nothing (the client treats
// that as up-to-date). Public info only: no auth, no user data, short cache.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareVersions } from "../../api/version.js";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

// Pin the generated manifest so these assertions describe the CONTRACT rather
// than whatever the last local release happened to publish.
vi.mock("../../api/_release-manifest.js", () => ({
	generated: "2026-01-01T00:00:00.000Z",
	version: "9.9.9",
	platforms: {
		android: {
			version: "9.9.9",
			url: "https://example.com/published.apk",
			notes: "Published by the release pipeline",
		},
	},
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
	it("advertises the published build when no release env is set", async () => {
		// The release pipeline is the normal source of truth. With no env vars
		// configured the feed must still advertise what it published — an empty
		// feed is indistinguishable from a broken download page.
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			app: "voice-flow",
			commit: "unknown",
			published: "2026-01-01T00:00:00.000Z",
			platforms: {
				android: {
					version: "9.9.9",
					url: "https://example.com/published.apk",
					notes: "Published by the release pipeline",
				},
			},
		});
	});

	it("publishes per-platform releases from env", async () => {
		// Newer than the pinned 9.9.9 manifest: a current env still wins.
		vi.stubEnv("LATEST_APK_VERSION", "10.0.0");
		vi.stubEnv("LATEST_APK_URL", "https://example.com/app.apk");
		vi.stubEnv("LATEST_APK_NOTES", "Live feed fixes");
		vi.stubEnv("LATEST_EXE_VERSION", "10.0.0");
		vi.stubEnv("LATEST_EXE_URL", "https://example.com/app.exe");
		vi.stubEnv("LATEST_MAC_VERSION", "10.0.0");
		vi.stubEnv("LATEST_MAC_URL", "https://example.com/app.dmg");
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			app: "voice-flow",
			commit: "unknown",
			published: "2026-01-01T00:00:00.000Z",
			platforms: {
				android: {
					// Env wins over the published manifest when it is not older.
					version: "10.0.0",
					url: "https://example.com/app.apk",
					notes: "Live feed fixes",
				},
				windows: {
					version: "10.0.0",
					url: "https://example.com/app.exe",
				},
				macos: {
					version: "10.0.0",
					url: "https://example.com/app.dmg",
				},
			},
		});
	});

	it("ignores a release env that is OLDER than the published build", async () => {
		// The incident this guards: a forgotten LATEST_APK_VERSION=2.0.1 sat in
		// production env for 31 days and overrode the published 2.0.3, so
		// /api/version advertised an old GitHub build to every installed app and
		// the Download page sent people to it. A stale pin must lose to the
		// newer artifact the release pipeline actually shipped.
		vi.stubEnv("LATEST_APK_VERSION", "2.0.1");
		vi.stubEnv("LATEST_APK_URL", "https://example.com/old.apk");
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		const platforms = (
			res.body as { platforms: Record<string, { version: string; url: string }> }
		).platforms;
		expect(platforms.android.version).toBe("9.9.9");
		expect(platforms.android.url).toBe("https://example.com/published.apk");
	});

	it("compares versions numerically, not as strings", () => {
		// "2.0.10" is newer than "2.0.9"; a string compare would invert it and
		// re-introduce the stale pin this feed just stopped honouring.
		expect(compareVersions("2.0.10", "2.0.9")).toBe(1);
		expect(compareVersions("2.0.9", "2.0.10")).toBe(-1);
		expect(compareVersions("2.0.3", "2.0.3")).toBe(0);
		expect(compareVersions("v2.1", "2.1.0")).toBe(0);
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

	it("always reports the deployed commit so staleness is checkable", async () => {
		vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123def456abc123def456abc123def456abcd");
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		expect(res.statusCode).toBe(200);
		expect((res.body as { commit: unknown }).commit).toBe(
			"abc123def456abc123def456abc123def456abcd",
		);
	});

	it("reports unknown commit when no SHA env is set", async () => {
		const { default: handler } = await import("../../api/version.js");
		const res = response();
		await handler(REQ as never, res as never);
		expect(res.statusCode).toBe(200);
		expect((res.body as { commit: unknown }).commit).toBe("unknown");
	});
});
