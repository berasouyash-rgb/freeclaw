// Shared error sanitization for API routes.
// Never expose raw err.message in 500 responses — it leaks SQL table names,
// file paths, and internal service URLs to unauthenticated users.
import { trackError, logger } from './_observability.js';

/**
 * Sanitize an error for client-facing JSON responses.
 * Logs the full error server-side with structured logging, returns generic message to client.
 */
export function sanitizeError(res, err, context = 'api') {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : '';

  // Structured error logging
  logger.error(context, 'request_error', {
    error_message: msg,
    stack: stack?.slice(0, 1000),
    status_code: 500,
  });

  // Track error for aggregation
  trackError(err instanceof Error ? err : new Error(msg), { context });

  return res.status(500).json({ error: 'Internal server error' });
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
export function notFound(res, resource = 'Resource') {
  return res.status(404).json({ error: `${resource} not found` });
}

/**
 * Handle validation errors.
 */
export function validationError(res, errors) {
  return res.status(400).json({ error: 'Validation failed', details: errors });
}
