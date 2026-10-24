import { describe, expect, it } from "vitest";
import { detectDevicePlatform, pickDownload } from "../lib/download";
import { statusLabel } from "../pages/PostDetail";

describe("detectDevicePlatform", () => {
	it("detects android, windows, macos", () => {
		expect(detectDevicePlatform("Android 14", "")).toBe("android");
		expect(detectDevicePlatform("Windows NT 10.0", "")).toBe("windows");
		expect(detectDevicePlatform("Macintosh", "")).toBe("macos");
		expect(detectDevicePlatform("X11", "Linux")).toBe("windows");
		expect(detectDevicePlatform("", "")).toBe("unknown");
	});
});

describe("pickDownload", () => {
	const feed = {
		android: { version: "2.1.0", url: "https://example.com/a.apk" },
		windows: { version: "2.1.0", url: "https://example.com/a.exe" },
		macos: { version: "2.1.0", url: "https://example.com/a.dmg" },
	};
	it("picks the device build first", () => {
		expect(pickDownload(feed, "android")?.key).toBe("android");
		expect(pickDownload(feed, "windows")?.key).toBe("windows");
		expect(pickDownload(feed, "macos")?.key).toBe("macos");
	});
	it("returns null when nothing published", () => {
		expect(pickDownload({}, "android")).toBeNull();
	});
});

describe("statusLabel", () => {
	it("maps waiting to Working on", () => {
		expect(statusLabel("waiting")).toBe("Working on");
		expect(statusLabel("in_progress")).toBe("In progress");
		expect(statusLabel("solved")).toBe("Solved");
	});
});
