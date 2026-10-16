// Seo — per-route document title, self-referential canonical, and 404 noindex.
// Locks in the audit fixes: duplicate titles across the SPA, missing canonical
// tags, and crawlable soft-404s.
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import Seo from "../components/Seo";

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Seo />
			<Routes>
				<Route path="/" element={<div>home</div>} />
				<Route path="/about" element={<div>about</div>} />
				<Route path="/faq" element={<div>faq</div>} />
				<Route path="/communities/:slug" element={<div>community</div>} />
				<Route path="*" element={<div>not-found</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

const canonical = () => document.querySelector('link[rel="canonical"]');
const robots = () => document.querySelector('meta[name="robots"]');

describe("Seo", () => {
	beforeEach(() => {
		canonical()?.remove();
		robots()?.remove();
		document.title = "";
	});

	it("sets the default title and a self-referential canonical on /", () => {
		renderAt("/");
		expect(document.title).toBe(
			"Voice Flow — Anonymous School Feedback Platform",
		);
		expect(canonical()?.getAttribute("href")).toBe(
			`${window.location.origin}/`,
		);
		expect(robots()).toBeNull();
	});

	it("gives each public route its own title and canonical", () => {
		renderAt("/about");
		expect(document.title).toBe("About Voice Flow — Anonymous School Feedback");
		expect(canonical()?.getAttribute("href")).toBe(
			`${window.location.origin}/about`,
		);
	});

	it("titles the FAQ page for search results", () => {
		renderAt("/faq");
		expect(document.title).toBe(
			"Frequently Asked Questions — Voice Flow",
		);
	});

	it("normalizes a trailing slash out of the canonical URL", () => {
		renderAt("/about/");
		expect(canonical()?.getAttribute("href")).toBe(
			`${window.location.origin}/about`,
		);
	});

	it("uses a generic title for parameterized routes", () => {
		renderAt("/communities/general");
		expect(document.title).toBe("Community — Voice Flow");
		expect(canonical()?.getAttribute("href")).toBe(
			`${window.location.origin}/communities/general`,
		);
	});

	it("noindexes unrouted paths and drops their canonical", () => {
		// Seed a canonical from a previous (indexed) route.
		renderAt("/about");
		expect(canonical()).not.toBeNull();

		renderAt("/definitely-not-a-page");
		expect(document.title).toBe("Page not found — Voice Flow");
		expect(robots()?.getAttribute("content")).toBe("noindex, follow");
		expect(canonical()).toBeNull();
	});

	it("restores indexability when navigating back from a 404", () => {
		const view = renderAt("/definitely-not-a-page");
		expect(robots()).not.toBeNull();

		view.unmount();
		renderAt("/about");
		expect(robots()).toBeNull();
		expect(canonical()?.getAttribute("href")).toBe(
			`${window.location.origin}/about`,
		);
	});
});
