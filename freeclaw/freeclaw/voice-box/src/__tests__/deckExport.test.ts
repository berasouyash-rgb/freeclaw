// ═══════════════════════════════════════════════════════════════════
// deckExport — PPT builder honours the section pick
// ═══════════════════════════════════════════════════════════════════
// "Full PPT features" means: title slide, section slides with real tables
// and real charts (bar / pie / line from live numbers), footer with the
// generation stamp. What it must NEVER do: inject an unticked section,
// fabricate a number, or ship a slide with a blank title. The pptxgenjs
// class is injected so tests run without the heavy lib.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";
import { buildPptx } from "../lib/deckExport";
import { cannedSpec, emptySpec } from "./deckSpecFixture";

function stubPres() {
	const slides: { texts: string[][]; tables: unknown[]; charts: unknown[] }[] =
		[];
	const pres = {
		slides,
		defineLayout: vi.fn(),
		layout: "",
		addSlide: vi.fn(() => {
			const s = {
				texts: [] as string[][],
				tables: [] as unknown[],
				charts: [] as unknown[],
				addText: vi.fn((t: string | { text: string }[]) => {
					s.texts.push(
						typeof t === "string" ? [t] : t.map((r) => r.text),
					);
				}),
				addTable: vi.fn((rows: unknown[]) => {
					s.tables.push(rows);
				}),
				addShape: vi.fn(),
				addChart: vi.fn((_type: unknown, _data: unknown) => {
					s.charts.push([_type, _data]);
				}),
			};
			slides.push(s);
			return s;
		}),
		writeFile: vi.fn(),
	};
	return pres;
}

describe("buildPptx section selection", () => {
	it("builds cover + every section when all are picked", async () => {
		const pres = stubPres();
		await buildPptx(cannedSpec(), ["complaints", "feed", "reports", "polls", "trends", "actions"], () => pres as never);
		// Cover + 6 sections.
		expect(pres.addSlide).toHaveBeenCalledTimes(7);
	});

	it("builds ONLY the picked sections (plus cover)", async () => {
		const pres = stubPres();
		await buildPptx(cannedSpec(), ["polls"], () => pres as never);
		expect(pres.addSlide).toHaveBeenCalledTimes(2);
		const allText = pres.slides.flatMap((s) => s.texts.flat());
		expect(allText.join("\n")).toMatch(/Sports day/);
		expect(allText.join("\n")).not.toMatch(/lab taps/i);
	});

	it("renders real charts on data sections, never text-only dumps", async () => {
		const pres = stubPres();
		await buildPptx(
			cannedSpec(),
			["complaints", "feed", "polls", "trends"],
			() => pres as never,
		);
		const chartCount = pres.slides.reduce((n, s) => n + s.charts.length, 0);
		expect(chartCount).toBeGreaterThanOrEqual(4);
	});

	it("renders the top-complaints table from live rows", async () => {
		const pres = stubPres();
		await buildPptx(cannedSpec(), ["complaints"], () => pres as never);
		const tables = pres.slides[1]!.tables;
		expect(tables.length).toBeGreaterThan(0);
		expect(JSON.stringify(tables)).toMatch(/Fix the lab taps/);
	});

	it("stamps every deck with the generation time (honest provenance)", async () => {
		const pres = stubPres();
		await buildPptx(cannedSpec(), ["polls"], () => pres as never);
		const allText = pres.slides.flatMap((s) => s.texts.flat()).join("\n");
		expect(allText).toMatch(/2026-10-10/);
	});

	it("exports an honest empty deck without fabricating numbers", async () => {
		const pres = stubPres();
		await buildPptx(
			emptySpec(),
			["complaints", "feed", "reports", "polls", "trends", "actions"],
			() => pres as never,
		);
		expect(pres.addSlide).toHaveBeenCalledTimes(7);
		const allText = pres.slides.flatMap((s) => s.texts.flat()).join("\n");
		expect(allText).not.toMatch(/NaN|undefined/);
	});
});
