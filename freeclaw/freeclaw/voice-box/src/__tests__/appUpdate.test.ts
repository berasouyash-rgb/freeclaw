// App update check — native shells only (APK + EXE). Polls /api/version at
// most once a day, compares against the baked build version, and surfaces
// an "Update detected" dialog with Update now / Later. Web browsers update
// on reload by themselves and never enter this path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CURRENT = "2.0.0";

function setShell(kind: "web" | "mobile" | "desktop") {
	const w = window as unknown as Record<string, unknown>;
	try {
		delete w.Capacitor;
	} catch {
		/* ignore */
	}
	try {
		delete w.vbDesktop;
	} catch {
		/* ignore */
	}
	if (kind === "mobile")
		w.Capacitor = { isNativePlatform: () => true };
	if (kind === "desktop") w.vbDesktop = true;
}

async function freshModule(fetchImpl: (url: string) => Promise<unknown>) {
	vi.resetModules();
	vi.stubGlobal(
		"fetch",
		vi.fn((url: string) => fetchImpl(url)) as unknown as typeof fetch,
	);
	return import("../lib/appUpdate");
}

beforeEach(() => {
	localStorage.clear();
	setShell("web");
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

const UPDATE = {
	platform: "android",
	version: "2.1.0",
	url: "https://example.com/app.apk",
	notes: "Live feed fixes",
} as const;

function stubGrantedNotify() {
	const shown: Array<{ title: string }> = [];
	const Ctor = vi.fn(function (this: unknown, title: string) {
		shown.push({ title });
		return this;
	}) as unknown as typeof Notification;
	Object.defineProperty(Ctor, "permission", { value: "granted", configurable: true });
	vi.stubGlobal("Notification", Ctor);
	return shown;
}

function setHidden(hidden: boolean) {
	Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
}

describe("maybeNotifyAppUpdate", () => {
	it("pings the device when the app is hidden and the channel is on", async () => {
		const mod = await freshModule(async () => ({}));
		stubGrantedNotify();
		setHidden(true);
		expect(mod.maybeNotifyAppUpdate({ ...UPDATE })).toBe(true);
	});

	it("stays silent in the foreground (the dialog covers it)", async () => {
		const mod = await freshModule(async () => ({}));
		const shown = stubGrantedNotify();
		setHidden(false);
		expect(mod.maybeNotifyAppUpdate({ ...UPDATE })).toBe(false);
		expect(shown).toHaveLength(0);
	});

	it("honors the browser-channel opt-out", async () => {
		const mod = await freshModule(async () => ({}));
		stubGrantedNotify();
		setHidden(true);
		localStorage.setItem("vb:browser-notify", JSON.stringify({ enabled: false }));
		expect(mod.maybeNotifyAppUpdate({ ...UPDATE })).toBe(false);
	});

	it("does nothing without an update", async () => {
		const mod = await freshModule(async () => ({}));
		stubGrantedNotify();
		setHidden(true);
		expect(mod.maybeNotifyAppUpdate(null)).toBe(false);
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	setShell("web");
});

describe("compareVersions", () => {
	it("orders dotted versions numerically, not lexicographically", async () => {
		const mod = await freshModule(async () => ({}));
		expect(mod.compareVersions("2.1.0", "2.0.0")).toBeGreaterThan(0);
		expect(mod.compareVersions("2.0.0", "2.1.0")).toBeLessThan(0);
		expect(mod.compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
		expect(mod.compareVersions("2.0.0", "2.0.0")).toBe(0);
		expect(mod.compareVersions("10.0.0", "9.99.99")).toBeGreaterThan(0);
	});

	it("treats garbage as 0.0.0 so junk can never trigger an update", async () => {
		const mod = await freshModule(async () => ({}));
		expect(mod.compareVersions("abc", CURRENT)).toBeLessThan(0);
		expect(mod.compareVersions("", CURRENT)).toBeLessThan(0);
	});
});

describe("checkForAppUpdate", () => {
	function versionFeed(version: string, url = "https://example.com/app.apk") {
		return async () => ({
			ok: true,
			json: async () => ({
				app: "voice-flow",
				platforms: {
					android: { version, url, notes: "Fixes" },
					windows: { version, url, notes: "Fixes" },
				},
			}),
		});
	}

	it("returns null on web — browsers update on reload", async () => {
		const mod = await freshModule(versionFeed("9.9.9"));
		expect(await mod.checkForAppUpdate()).toBeNull();
	});

	it("offers the update when the server is newer (mobile + desktop)", async () => {
		for (const shell of ["mobile", "desktop"] as const) {
			setShell(shell);
			const mod = await freshModule(versionFeed("2.1.0"));
			const found = await mod.checkForAppUpdate();
			expect(found, shell).not.toBeNull();
			expect(found!.url).toBe("https://example.com/app.apk");
			localStorage.clear();
		}
	});

	it("stays quiet when already current or the feed is empty", async () => {
		setShell("mobile");
		const mod = await freshModule(versionFeed(CURRENT));
		expect(await mod.checkForAppUpdate()).toBeNull();

		const mod2 = await freshModule(async () => ({
			ok: true,
			json: async () => ({ app: "voice-flow", platforms: {} }),
		}));
		expect(await mod2.checkForAppUpdate()).toBeNull();
	});

	it("checks at most once a day and honors Later-snooze", async () => {
		setShell("mobile");
		const fetchMock = vi.fn(versionFeed("2.1.0"));
		const mod = await freshModule(fetchMock);
		expect(await mod.checkForAppUpdate()).not.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// Second call rides the daily cache — no second request.
		expect(await mod.checkForAppUpdate()).not.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		mod.snoozeUpdate();
		const mod2 = await freshModule(fetchMock);
		expect(await mod2.checkForAppUpdate()).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("never throws on network failure — stays silent", async () => {
		setShell("mobile");
		const mod = await freshModule(async () => {
			throw new TypeError("Failed to fetch");
		});
		expect(await mod.checkForAppUpdate()).toBeNull();
	});
});
