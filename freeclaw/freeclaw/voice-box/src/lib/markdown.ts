/**
 * Shared minimal markdown renderer for admin chat surfaces.
 *
 * Renders user/AI text as HTML for `dangerouslySetInnerHTML`. All raw text is
 * HTML-escaped first; links are additionally scheme-allowlisted because a
 * naive `javascript:` strip can be bypassed with ASCII control characters
 * (`java\u0009script:` still parses as a javascript: URL in browsers) or with
 * mixed-case schemes (`JaVaScRiPt:`).
 */

const ALLOWED_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Escape HTML entities to prevent XSS via dangerouslySetInnerHTML */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function safeLinkHref(href: string): string {
	// Browsers strip leading/trailing whitespace and ASCII control characters
	// (tab, newline, …) before parsing a URL's scheme, so normalize the string
	// the same way BEFORE checking — otherwise "  javascript:" or
	// "java\u0009script:" bypasses a naive javascript: strip.
	const clean = href.replace(/[\u0000-\u001F\u007F]/g, "").trim();
	const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(clean)?.[1]?.toLowerCase();
	if (scheme && !ALLOWED_LINK_SCHEMES.has(scheme)) return "#";
	return href;
}

export function renderMarkdown(text: string): string {
	// Escape HTML first to prevent injection, then apply markdown transformations
	let html = escapeHtml(text)
		// Code blocks (``` ... ```)
		.replace(
			/```(\w*)\n([\s\S]*?)```/g,
			'<pre><code class="lang-$1">$2</code></pre>',
		)
		// Inline code
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		// Bold
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		// Italic
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		// Blockquotes
		.replace(/^>\s*(.+)$/gm, "<blockquote>$1</blockquote>")
		// Unordered lists
		.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
		// Ordered lists
		.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>")
		// Links — scheme-allowlist to prevent XSS
		.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			(_m: string, label: string, href: string) => {
				const safeHref = safeLinkHref(href);
				return `<a href="${safeHref}" target="_blank" rel="noopener" class="text-accent underline">${label}</a>`;
			},
		)
		// Line breaks (preserve double newlines as paragraphs)
		.replace(/\n\n/g, "</p><p>")
		.replace(/\n/g, "<br/>");

	// Wrap consecutive <li> in <ul>
	html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, "<ul>$1</ul>");
	// Wrap in paragraph if no block elements
	if (
		!html.startsWith("<pre>") &&
		!html.startsWith("<ul>") &&
		!html.startsWith("<blockquote>")
	) {
		html = `<p>${html}</p>`;
	}
	return html;
}
