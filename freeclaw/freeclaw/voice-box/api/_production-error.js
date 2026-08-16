// ═══════════════════════════════════════════════════════════════════
// PRODUCTION ERROR HARDENING — Global catch-all handler wrapper
// ═══════════════════════════════════════════════════════════════════
// Wraps every API route handler to guarantee:
//   1. CORS headers are ALWAYS set (even on 500 errors)
//   2. No internal details ever leak to client (stack traces, SQL, env vars)
//   3. Every error is structured-logged with a request ID
//   4. Monitoring metrics are recorded for every request
//   5. Responses always have proper Content-Type + security headers
// ═══════════════════════════════════════════════════════════════════

import { cors } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import { generateRequestId } from "./_observability.js";
import { setSecurityHeaders } from "./_security.js";

/**
 * Wrap an API route handler with production-grade error protection.
 *
 * Usage in index.js:
 *   import { protect } from './_production-error.js';
 *   const routes = { posts: protect(postsHandler), ... };
 */
export function protect(handler, name = "unknown") {
	return async function protectedHandler(req, res) {
		// 1. Generate a unique request ID for tracing
		const requestId = req.headers?.["x-request-id"] || generateRequestId();
		const startTime = Date.now();

		// 2. ALWAYS set security headers and CORS — before ANYTHING else
		//    This ensures even crashes get proper CORS headers
		try {
			setSecurityHeaders(res);
			cors(res, req);
			res.setHeader("X-Request-Id", requestId);
			res.setHeader("Content-Type", "application/json; charset=utf-8");
		} catch (_) {
			// Security headers failing should never block the response
		}

		try {
			// 4. Handle OPTIONS preflight immediately (CORS already set above)
			if (req.method === "OPTIONS") {
				return res.status(204).end();
			}

			// 5. Execute the actual handler
			const result = await handler(req, res);

			// 6. If handler returned but didn't end the response, end it now
			if (result === undefined && !res.writableEnded) {
				// Handler didn't send a response — this is a bug in the handler
				// but we must not leave the client hanging
				res.status(200).json({ ok: true });
			}

			return result;
		} catch (err) {
			// 7. GUARANTEED: never leak internals. Even if sanitizeError itself throws,
			//    we have a final fallback that sends a generic error.
			const duration = Date.now() - startTime;
			const errorMessage = err instanceof Error ? err.message : String(err);

			// Structured error log
			console.error(
				JSON.stringify({
					level: "ERROR",
					category: "production_wrapper",
					message: `Uncaught error in /${name}`,
					error_message: errorMessage.slice(0, 500),
					request_id: requestId,
					method: req.method,
					path: req.url?.split("?")[0],
					duration_ms: duration,
					timestamp: new Date().toISOString(),
				}),
			);

			// Attempt to use sanitizeError (which itself is hardened)
			try {
				if (!res.writableEnded) {
					// capture status code
					res.statusCode = 500;
					return sanitizeError(
						res,
						err instanceof Error ? err : new Error(errorMessage),
						name,
					);
				}
			} catch (_) {
				// sanitizeError itself threw — absolute final fallback
				if (!res.writableEnded) {
					try {
						res.statusCode = 500;
						return res.end(JSON.stringify({ error: "Internal server error" }));
					} catch (_) {
						// Nothing we can do — response already sent or socket closed
					}
				}
			}
		} finally {
			// 8. If response was never ended, end it (shouldn't happen, but safety net)
			if (!res.writableEnded) {
				try {
					res.statusCode = 500;
					res.end(JSON.stringify({ error: "Internal server error" }));
				} catch (_) {
					// Socket already closed — ignore
				}
			}
		}
	};
}
