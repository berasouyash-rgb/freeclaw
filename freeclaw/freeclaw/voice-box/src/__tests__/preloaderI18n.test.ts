// ═══════════════════════════════════════════════════════════════════
// preloaderI18n — locale detection + translation unit tests
// ═══════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import {
	detectLocale,
	PRELOADER_STRINGS,
	resolveLocale,
	t,
} from "../components/preloader/preloaderI18n";

describe("resolveLocale", () => {
	it("returns en for empty / undefined / unknown input", () => {
		expect(resolveLocale()).toBe("en");
		expect(resolveLocale(null)).toBe("en");
		expect(resolveLocale("")).toBe("en");
		expect(resolveLocale("xx-YY")).toBe("en");
	});

	it("normalizes base language codes", () => {
		expect(resolveLocale("es")).toBe("es");
		expect(resolveLocale("fr-FR")).toBe("fr");
		expect(resolveLocale("de-DE")).toBe("de");
		expect(resolveLocale("pt-BR")).toBe("pt");
		expect(resolveLocale("pt-PT")).toBe("pt");
	});

	it("handles Chinese variants (Simplified vs Traditional)", () => {
		expect(resolveLocale("zh")).toBe("zh-CN");
		expect(resolveLocale("zh-CN")).toBe("zh-CN");
		expect(resolveLocale("zh-SG")).toBe("zh-CN");
		expect(resolveLocale("zh-TW")).toBe("zh-TW");
		expect(resolveLocale("zh-HK")).toBe("zh-TW");
		expect(resolveLocale("zh-Hant")).toBe("zh-TW");
	});

	it("maps Norwegian and Filipino variants", () => {
		expect(resolveLocale("no")).toBe("nb");
		expect(resolveLocale("nb-NO")).toBe("nb");
		expect(resolveLocale("tl")).toBe("fil");
		expect(resolveLocale("fil-PH")).toBe("fil");
	});

	it("is case-insensitive", () => {
		expect(resolveLocale("ES")).toBe("es");
		expect(resolveLocale("PT-BR")).toBe("pt");
		expect(resolveLocale("ZH-TW")).toBe("zh-TW");
	});
});

describe("detectLocale", () => {
	it("falls back to English when navigator is missing", () => {
		const nav = globalThis.navigator;
		Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
		expect(detectLocale()).toBe("en");
		Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
	});
});

describe("t", () => {
	it("translates every key for a known locale", () => {
		expect(t("loading", "es")).toBe("Preparando tu espacio de trabajo");
		expect(t("ready", "fr")).toBe("Prêt");
		expect(t("retry", "de")).toBe("Erneut versuchen");
		expect(t("continue", "hi")).toBe("जारी रखें");
		expect(t("error", "ja")).toBe("対応が必要な項目があります");
	});

	it("falls back to English for unknown locales and keys", () => {
		expect(t("ready", "zz")).toBe("Ready");
		expect(t("starting", "en")).toBe("Starting");
	});

	it("exposes the same key set for every catalog entry", () => {
		const keys = Object.keys(PRELOADER_STRINGS.en ?? {}).sort();
		for (const [locale, strings] of Object.entries(PRELOADER_STRINGS)) {
			expect(Object.keys(strings).sort(), `locale ${locale}`).toEqual(keys);
			// Every string must be non-empty and real text
			for (const [k, v] of Object.entries(strings)) {
				expect(v.length, `${locale}.${k}`).toBeGreaterThan(0);
			}
		}
	});

	it("covers a broad set of languages", () => {
		// The boot layer speaks the world's major languages; English stays the
		// ultimate fallback for anything uncatalogued.
		expect(Object.keys(PRELOADER_STRINGS).length).toBeGreaterThanOrEqual(30);
		expect(PRELOADER_STRINGS.es).toBeDefined();
		expect(PRELOADER_STRINGS["zh-CN"]).toBeDefined();
		expect(PRELOADER_STRINGS["zh-TW"]).toBeDefined();
		expect(PRELOADER_STRINGS.ar).toBeDefined();
		expect(PRELOADER_STRINGS.hi).toBeDefined();
	});
});
