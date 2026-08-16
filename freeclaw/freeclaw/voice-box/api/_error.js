// Shared error sanitization for API routes.
// Never expose raw err.message in 500 responses — it leaks SQL table names,
// file paths, and internal service URLs to unauthenticated users.
import { logger, trackError } from "./_observability.js";

// Lazy-init Sentry for backend — uses SENTRY_DSN env var, falls back to hardcoded DSN
const BACKEND_DSN =
	"https://2edb1451dd3eaf08c56dc4c2c8839cf4@o4511824665968640.ingest.us.sentry.io/4511824685760512";

let sentryInit = false;
let sentryModule = null;
// Cache the init promise so concurrent sanitizeError calls await the SAME
// import instead of each re-triggering it (and racing the sentryModule check).
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
			console.log("[Sentry] Backend initialized ✓");
		} catch {
			/* @sentry/node not installed — skip silently */
		}
	})();
	return sentryInitPromise;
}

/**
 * Sanitize an error for client-facing JSON responses.
 * Logs the full error server-side with structured logging, returns generic message to client.
 * Sends to Sentry if configured.
 */
export async function sanitizeError(res, err, context = "api") {
	const msg = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : "";

	// Lazy init Sentry on first error and AWAIT it — otherwise the first error
	// races the dynamic import and is never captured.
	try {
		await initBackendSentry();
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
	} catch {
		/* never let error reporting crash the response path */
	}

	// Structured error logging
	logger.error(context, "request_error", {
		error_message: msg,
		stack: stack?.slice(0, 1000),
		status_code: 500,
	});

	// Track error for aggregation
	trackError(err instanceof Error ? err : new Error(msg), { context });

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
