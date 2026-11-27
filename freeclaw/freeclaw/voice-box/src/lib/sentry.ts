// ─── Sentry Error Tracking — Frontend ──────────────────────────
// Initialize Sentry for the React SPA. DSN is configured here as
// a hardcoded default and can be overridden via VITE_SENTRY_DSN env var.
// Source maps are uploaded during build via vite.config.ts.
//
// Perf note: @sentry/react is loaded via a destructured dynamic import
// inside loadInit — never statically, and never as a whole namespace.
// `const Sentry = await import(...)` followed by member access defeats
// Rollup tree-shaking and balloons the async chunk to 400KB+ (measured).
// Destructuring `init` keeps only the used exports (~90KB, post-paint).
// Nothing in prod code needs the rest of the SDK surface.

// Your Sentry DSN — captured here and also settable via VITE_SENTRY_DSN env var
const HARDCODED_DSN =
	"https://2edb1451dd3eaf08c56dc4c2c8839cf4@o4511824665968640.ingest.us.sentry.io/4511824685760512";
const dsn =
	(import.meta.env.VITE_SENTRY_DSN as string | undefined) || HARDCODED_DSN;

type SentryInit = typeof import("@sentry/react").init;

let cachedInit: SentryInit | null = null;

/** Lazily load Sentry's init (cached singleton). Exported for tests. */
export async function loadInit(): Promise<SentryInit> {
	if (!cachedInit) {
		const { init } = await import("@sentry/react");
		cachedInit = init;
	}
	return cachedInit;
}

/** For tests: drop the cached init so re-imports start fresh. */
export function __resetSentryForTests() {
	cachedInit = null;
}

export async function initSentry(): Promise<boolean> {
	/* v8 ignore start -- @preserve: dsn always falls back to the hardcoded DSN above, so this block is unreachable */
	if (!dsn) {
		if (import.meta.env.DEV) {
			console.log("[Sentry] Skipped (no DSN in dev mode)");
		} else {
			console.warn("[Sentry] DSN not set — errors will not be tracked");
		}
		return false;
	}
	/* v8 ignore stop -- @preserve */

	const init = await loadInit();
	init({
		dsn,
		environment: import.meta.env.MODE || "production",
		// Only track ~20% of transactions in production to stay within free tier
		tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.2,
		// Don't send errors from local dev
		enabled: !import.meta.env.DEV,
		// Data collection opt-out — no user info or HTTP bodies sent
		dataCollection: {
			// userInfo: false,
			// httpBodies: [],
		},
		// Ignore common non-actionable errors
		ignoreErrors: [
			"ResizeObserver loop limit exceeded",
			"NetworkError when attempting to fetch resource",
			"AbortError",
			"timeout",
		],
		// Attach additional context to help debugging
		beforeSend(event) {
			// Add viewport/user-agent info
			event.tags = {
				...event.tags,
				url: window.location.href,
				viewport: `${window.innerWidth}x${window.innerHeight}`,
			};
			return event;
		},
	});

	console.log("[Sentry] Initialized ✓");
	return true;
}
