// PWA installability contract — the web app must stay installable:
// manifest parses, carries the required installability fields, and every
// icon it references exists on disk.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

describe("PWA manifest", () => {
	it("parses and carries installability fields", () => {
		const raw = readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8");
		const manifest = JSON.parse(raw) as Record<string, unknown>;
		expect(typeof manifest.name).toBe("string");
		expect(typeof manifest.short_name).toBe("string");
		expect(manifest.start_url).toBeDefined();
		expect(manifest.display).toBe("standalone");
		expect(typeof manifest.theme_color).toBe("string");
		expect(typeof manifest.background_color).toBe("string");
		const icons = manifest.icons as Array<{ src: string; sizes: string }>;
		expect(Array.isArray(icons)).toBe(true);
		expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
		expect(icons.some((i) => i.sizes === "512x512")).toBe(true);
	});

	it("every referenced icon exists on disk", () => {
		const raw = readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8");
		const manifest = JSON.parse(raw) as {
			icons: Array<{ src: string }>;
		};
		for (const icon of manifest.icons) {
			const disk = join(ROOT, "public", icon.src.replace(/^\//, ""));
			expect(existsSync(disk), icon.src).toBe(true);
		}
		expect(
			existsSync(join(ROOT, "public", "icons", "apple-touch-icon.png")),
		).toBe(true);
	});

	it("index.html links the manifest and the iOS touch icon", () => {
		const html = readFileSync(join(ROOT, "index.html"), "utf8");
		expect(html).toContain('rel="manifest"');
		expect(html).toContain("manifest.webmanifest");
		expect(html).toContain("apple-touch-icon");
	});
});
