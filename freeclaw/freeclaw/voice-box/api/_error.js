// Shared error sanitization for API routes.
// Never expose raw err.message in 500 responses — it leaks SQL table names,
// file paths, and internal service URLs to unauthenticated users.
import { logger, trackError } from "./_observability.js";

// Lazy-init Sentry for backend — env-only, no hardcoded fallback.
const BACKEND_DSN = process.env.SENTRY_DSN || "";

let sentryInit = false;
let sentryModule = null;
let sentryInitPromise = null;
function initBackendSentry() {
	if (sentryInitPromise) return sentryInitPromise;
	sentryInitPromise = (async () => {
		if (sentryInit) return;
		sentryInit = true;
		const dsn = process.env.SENTRY_DSN || BACKEND_DSN;
		if (!dsn) return;
		try {
			const Sentry = await import("@sentry/node");
			Sentry.init({
				dsn,
				environment: process.env.VERCEL_ENV || "production",
				tracesSampleRate: 0.2,
				enabled: process.env.VERCEL_ENV !== "development",
				ignoreErrors: [
					"ResizeObserver loop limit exceeded",
					"NetworkError when attempting to fetch resource",
					"AbortError",
				],
			});
			sentryModule = Sentry;
		} catch {
			/* @sentry/node not installed — skip silently */
		}
	})();
	return sentryInitPromise;
}

/**
 * Sanitize an error for client-facing JSON responses.
 *
 * The response is sent SYNCHRONOUSLY — callers do NOT need `await`.
 * Logging and Sentry happen in the background (fire-and-forget) so they
 * never delay or block the 500 response from reaching the client.
 */
export function sanitizeError(res, err, context = "api") {
	const msg = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : "";

	// Fire-and-forget: structured logging (async, non-blocking)
	try {
		logger.error(context, "request_error", {
			error_message: msg,
			stack: stack?.slice(0, 1000),
			status_code: 500,
		});
	} catch {
		/* logger failure must never block the response */
	}

	// Fire-and-forget: error tracking
	try {
		trackError(err instanceof Error ? err : new Error(msg), { context });
	} catch {
		/* tracking failure must never block the response */
	}

	// Fire-and-forget: Sentry (lazy-loads @sentry/node on first error)
	initBackendSentry()
		.then(() => {
			if (sentryModule) {
				try {
					sentryModule.captureException(err, {
						tags: { context },
						extra: { status_code: 500 },
					});
				} catch {
					/* skip */
				}
			}
		})
		.catch(() => {
			/* Sentry failure must never block the response */
		});

	// Send the response IMMEDIATELY — this is the critical path
	return res.status(500).json({ error: "Internal server error" });
}

/**
 * Create a typed error with status code.
 */
export function createError(status, message, code = null) {
	const err = new Error(message);
	err.status = status;
	err.code = code;
	return err;
}

/**
 * Handle not-found errors.
 */
export function notFound(res, resource = "Resource") {
	return res.status(404).json({ error: `${resource} not found` });
}

/**
 * Handle validation errors.
 */
export function validationError(res, errors) {
	return res.status(400).json({ error: "Validation failed", details: errors });
}
