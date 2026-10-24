import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * Route-driven document head — titles, canonical, and crawlability.
 *
 * The app is a single-page app served from one index.html, so crawlers see
 * the same <title> and no canonical on every URL. This effect rewrites both
 * per route:
 *
 *  - every routable page gets its own <title> (kills duplicate-title groups)
 *  - every routable page gets a self-referential absolute canonical
 *    (consolidates trailing-slash / old-domain duplicates onto one URL)
 *  - unrouted paths (the 404 route) get `noindex, follow` and NO canonical,
 *    so soft-404s stop diluting the index
 *
 * Skips canonical writes on non-http(s) origins (Electron file:// and the
 * Capacitor shell) where there is no meaningful origin to declare.
 */

const DEFAULT_TITLE = "Voice Flow — Anonymous School Feedback Platform";

// First match wins — most specific patterns (parameterized routes) first.
const TITLES: Array<[RegExp, string]> = [
	[/^\/$/, DEFAULT_TITLE],
	[/^\/about$/, "About Voice Flow — Anonymous School Feedback"],
	[/^\/contact$/, "Contact — Voice Flow"],
	[/^\/terms$/, "Terms of Service — Voice Flow"],
	[/^\/privacy$/, "Privacy Policy — Voice Flow"],
	[/^\/accessibility$/, "Accessibility — Voice Flow"],
	[/^\/status$/, "System Status — Voice Flow"],
	[/^\/changelog$/, "Changelog — Voice Flow"],
	[/^\/faq$/, "Frequently Asked Questions — Voice Flow"],
	[/^\/download$/, "Download the App — Voice Flow"],
	[/^\/board$/, "Solving Board — Voice Flow"],
	[/^\/polls$/, "School Polls — Voice Flow"],
	[/^\/suggestions$/, "Suggestions — Voice Flow"],
	[/^\/leaderboard$/, "Leaderboard — Voice Flow"],
	[/^\/communities\/[^/]+$/, "Community — Voice Flow"],
	[/^\/communities$/, "Communities — Voice Flow"],
	[/^\/submit$/, "Submit Feedback — Voice Flow"],
	[/^\/post\/[^/]+$/, "Post — Voice Flow"],
	[/^\/search$/, "Search — Voice Flow"],
	[/^\/insights$/, "Insights — Voice Flow"],
	[/^\/activity$/, "My Activity — Voice Flow"],
	[/^\/saved$/, "Saved Posts — Voice Flow"],
	[/^\/chat$/, "Chat — Voice Flow"],
	[/^\/settings$/, "Settings — Voice Flow"],
	[/^\/notifications$/, "Notifications — Voice Flow"],
	[/^\/admin(\/|$)/, "Admin Console — Voice Flow"],
];

function titleFor(pathname: string): string | null {
	for (const [pattern, title] of TITLES) {
		if (pattern.test(pathname)) return title;
	}
	return null;
}

export default function Seo() {
	const { pathname } = useLocation();

	useEffect(() => {
		// Normalize: "/about/" and "/about" are the same page.
		const path =
			pathname.length > 1 && pathname.endsWith("/")
				? pathname.slice(0, -1)
				: pathname;

		const title = titleFor(path);
		document.title = title ?? "Page not found — Voice Flow";

		// Robots meta — noindex unrouted (404) paths, clear it elsewhere.
		let robots = document.querySelector<HTMLMetaElement>(
			'meta[name="robots"]',
		);
		if (title === null) {
			if (!robots) {
				robots = document.createElement("meta");
				robots.name = "robots";
				document.head.appendChild(robots);
			}
			robots.content = "noindex, follow";
		} else {
			robots?.remove();
		}

		const origin = window.location.origin;
		if (!/^https?:\/\//.test(origin)) return; // native shell — no origin

		if (title === null) {
			document
				.querySelector<HTMLLinkElement>('link[rel="canonical"]')
				?.remove();
			return;
		}

		const href = `${origin}${path}`;

		let link = document.querySelector<HTMLLinkElement>(
			'link[rel="canonical"]',
		);
		if (!link) {
			link = document.createElement("link");
			link.rel = "canonical";
			document.head.appendChild(link);
		}
		link.href = href;
	}, [pathname]);

	return null;
}
