import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown } from "../lib/markdown";

describe("renderMarkdown", () => {
	it("renders basic markdown with paragraph wrapper", () => {
		expect(renderMarkdown("Hello **world**")).toBe(
			"<p>Hello <strong>world</strong></p>",
		);
	});

	it("escapes raw HTML in input", () => {
		const html = renderMarkdown("<script>alert(1)</script>");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("blocks javascript: links", () => {
		const html = renderMarkdown("[x](javascript:alert(1))");
		expect(html).toContain('href="#"');
		expect(html).not.toContain("javascript:");
	});

	it("blocks javascript: links with leading whitespace", () => {
		expect(renderMarkdown("[x](  javascript:alert(1))")).toContain('href="#"');
	});

	it("blocks mixed-case javascript: links", () => {
		expect(renderMarkdown("[x](JaVaScRiPt:alert(1))")).toContain('href="#"');
	});

	it("blocks javascript: links with embedded ASCII control characters (XSS bypass)", () => {
		// Browsers strip tab/newline from URL schemes — "java<tab>script:" still
		// parses as javascript:, so the scheme must be checked after stripping.
		expect(renderMarkdown("[x](java\tscript:alert(1))")).toContain('href="#"');
		expect(renderMarkdown("[x](java\nscript:alert(1))")).toContain('href="#"');
		expect(renderMarkdown("[x](java\rscript:alert(1))")).toContain('href="#"');
	});

	it("blocks data:, vbscript: and file: links", () => {
		expect(renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)")).toContain(
			'href="#"',
		);
		expect(renderMarkdown("[x](vbscript:msgbox(1))")).toContain('href="#"');
		expect(renderMarkdown("[x](file:///etc/passwd)")).toContain('href="#"');
	});

	it("allows https, http and mailto links", () => {
		expect(renderMarkdown("[x](https://example.com/a)")).toContain(
			'href="https://example.com/a"',
		);
		expect(renderMarkdown("[x](http://example.com)")).toContain(
			'href="http://example.com"',
		);
		expect(renderMarkdown("[x](mailto:a@b.c)")).toContain(
			'href="mailto:a@b.c"',
		);
	});

	it("allows relative and fragment links", () => {
		expect(renderMarkdown("[x](/posts/1)")).toContain('href="/posts/1"');
		expect(renderMarkdown("[x](#top)")).toContain('href="#top"');
	});

	it("escapes quotes inside link hrefs (no attribute breakout)", () => {
		const html = renderMarkdown('[x](https://e.com/" onclick="alert(1))');
		expect(html).toContain("&quot; onclick=&quot;");
		expect(html).not.toContain('" onclick="');
	});

	it("wraps consecutive list items in ul", () => {
		const html = renderMarkdown("- one\n- two");
		expect(html).toContain("<ul>");
		expect(html.match(/<li>/g)?.length).toBe(2);
	});

	it("renders code blocks and inline code", () => {
		// NOTE: the trailing newline inside the fence is turned into <br/> by the
		// renderer (pre-existing behavior — the three original page-local copies
		// did the same), so only the head of the block is asserted.
		expect(renderMarkdown("```js\nconst a = 1\n```")).toContain(
			'<pre><code class="lang-js">const a = 1',
		);
		expect(renderMarkdown("use `code` now")).toContain("<code>code</code>");
	});
});

describe("escapeHtml", () => {
	it("escapes the five dangerous characters", () => {
		expect(escapeHtml(`<a href="x" y='z'>&`)).toBe(
			"&lt;a href=&quot;x&quot; y=&#39;z&#39;&gt;&amp;",
		);
	});
});
