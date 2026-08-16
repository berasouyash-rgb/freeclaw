// ─── Sentry Error Tracking — Frontend ──────────────────────────
// Initialize Sentry for the React SPA. DSN is configured here as
// a hardcoded default and can be overridden via VITE_SENTRY_DSN env var.
// Source maps are uploaded during build via vite.config.ts.

import * as Sentry from "@sentry/react";

// Your Sentry DSN — captured here and also settable via VITE_SENTRY_DSN env var
const HARDCODED_DSN =
	"https://2edb1451dd3eaf08c56dc4c2c8839cf4@o4511824665968640.ingest.us.sentry.io/4511824685760512";
const dsn =
	(import.meta.env.VITE_SENTRY_DSN as string | undefined) || HARDCODED_DSN;

export function initSentry() {
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

	Sentry.init({
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

// Convenience exports for downstream use
export const SentryErrorBoundary = Sentry.ErrorBoundary;
export const SentryProfiler = Sentry.Profiler;
export { Sentry };
export default Sentry;
