// Shared error sanitization for API routes.
// Never expose raw err.message in 500 responses — it leaks SQL table names,
// file paths, and internal service URLs to unauthenticated users.

/**
 * Sanitize an error for client-facing JSON responses.
 * Logs the full error server-side, returns a generic message to the client.
 */
export function sanitizeError(res, err, context) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : '';
  console.error(`[API] ${context}:`, msg);
  if (stack) console.error(`[API] ${context} STACK:`, stack);
  return res.status(500).json({ error: 'Internal server error' });
}
