// Faq — structured data + heading structure for search/AI answer engines.
// Locks in the audit fixes: FAQPage JSON-LD that mirrors the visible Q&A
// verbatim, and questions wrapped as h3 headings.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Faq from "../pages/Faq";

function schema() {
	const script = document.querySelector('script[data-testid="faq-schema"]');
	expect(script).not.toBeNull();
	return JSON.parse(script!.innerHTML);
}

describe("Faq", () => {
	it("emits a FAQPage JSON-LD block mirroring the visible questions", () => {
		render(<Faq />);
		const data = schema();
		expect(data["@context"]).toBe("https://schema.org");
		expect(data["@type"]).toBe("FAQPage");
		expect(data.mainEntity.length).toBeGreaterThanOrEqual(8);

		for (const item of data.mainEntity) {
			expect(item["@type"]).toBe("Question");
			expect(item.name.length).toBeGreaterThan(0);
			expect(item.acceptedAnswer["@type"]).toBe("Answer");
			expect(item.acceptedAnswer.text.length).toBeGreaterThan(0);
			// schema.org rule: JSON-LD must match visible content verbatim.
			expect(screen.getByText(item.name)).toBeTruthy();
		}
	});

	it("renders one h3 heading per question, each wrapping its button", () => {
		render(<Faq />);
		const headings = screen.getAllByRole("heading", { level: 3 });
		expect(headings.length).toBe(schema().mainEntity.length);

		for (const heading of headings) {
			const button = heading.querySelector("button");
			expect(button).not.toBeNull();
			expect(button?.hasAttribute("aria-expanded")).toBe(true);
		}
		// First question ships expanded; every other one starts collapsed.
		const states = headings.map(
			(h) => h.querySelector("button")?.getAttribute("aria-expanded"),
		);
		expect(states[0]).toBe("true");
		expect(states.slice(1).every((s) => s === "false")).toBe(true);
	});

	it("collapses and re-expands a question on click", () => {
		render(<Faq />);
		const first = screen.getByRole("button", {
			name: /is voice flow really anonymous/i,
		});
		// Default: first answer visible.
		expect(first.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText(/no registration, and we never ask/i)).toBeTruthy();

		fireEvent.click(first);
		expect(first.getAttribute("aria-expanded")).toBe("false");
		expect(
			screen.queryByText(/no registration, and we never ask/i),
		).toBeNull();

		fireEvent.click(first);
		expect(first.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText(/no registration, and we never ask/i)).toBeTruthy();
	});
});
