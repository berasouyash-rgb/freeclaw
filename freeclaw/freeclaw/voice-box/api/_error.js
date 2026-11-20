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
/**
 * Describe any thrown value for the logs.
 *
 * PostgREST rejections are PLAIN OBJECTS (`{message, details, hint, code}`),
 * not Errors. The old `String(err)` on those produced "[object Object]" in
 * every log line, so a failing 500 (e.g. an undefined column on a post
 * update) arrived with no cause at all and could not be diagnosed from the
 * server log. This keeps client responses generic while the log stays useful.
 */
function describeThrown(err) {
	if (err instanceof Error) {
		return { msg: err.message, stack: err.stack || "" };
	}
	if (err && typeof err === "object") {
		const e = err;
		const parts = [e.message, e.details, e.hint, e.code ? `code=${String(e.code)}` : ""]
			.filter((p) => typeof p === "string" && p.trim().length > 0);
		if (parts.length) return { msg: parts.join(" | "), stack: "" };
		try {
			return { msg: JSON.stringify(err).slice(0, 800), stack: "" };
		} catch {
			return { msg: "[unserializable thrown value]", stack: "" };
		}
	}
	return { msg: String(err), stack: "" };
}

export function sanitizeError(res, err, context = "api") {
	const { msg, stack } = describeThrown(err);

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
