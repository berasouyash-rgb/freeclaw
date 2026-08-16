// ─── Retry wrapper for React.lazy() ─────────────────────────────
// Retries failed dynamic imports up to 3 times with exponential
// backoff (1s → 2s → 4s) before letting the error propagate.
// Prevents "Failed to fetch dynamically imported module" crashes
// when a chunk load fails due to network hiccups or stale cache.
//
// STALE-CHUNK SELF-HEALING:
// Vercel redeploys create new hashed chunk files and delete old ones.
// A tab that loaded the OLD index.html keeps requesting old chunk URLs
// that now 404 — every lazy page breaks, which the user experiences as
// "nothing / no buttons work." Retrying the same dead URL can't help,
// so after the retries are exhausted we reload the page ONCE (guarded by
// sessionStorage). A fresh load gets the NEW index.html → new chunk names.

import { lazy } from "react";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RELOAD_GUARD_KEY = "vb:chunkReloaded";

// Bound for the lazy-imported component. `any` is required here: React's own
// lazy() signature constrains T to ComponentType<any>, and any concrete
// component type (function OR class, with any props) must satisfy it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = import("react").ComponentType<any>;

/** Detect the 'Failed to fetch dynamically imported module' family of errors. */
export function isChunkLoadError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err ?? "");
	return (
		msg.includes("Failed to fetch dynamically imported module") ||
		msg.includes("Loading chunk") ||
		msg.includes("ChunkLoadError") ||
		msg.includes("Importing a module script failed") ||
		msg.includes("dynamically imported module")
	);
}

/**
 * Reload the page exactly once per session when a chunk 404s after a redeploy.
 * A normal reload fetches fresh index.html → fresh chunk URLs → app recovers.
 * The sessionStorage guard prevents an infinite reload loop if the new build
 * itself is broken (the app would just show the ErrorBoundary instead).
 * Returns true if a reload was actually scheduled (guard was free).
 */
export function reloadOnceForStaleChunk(): boolean {
	try {
		if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return false;
		sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
	} catch {
		/* storage unavailable — still attempt reload */
	}
	window.location.reload();
	return true;
}

export function retryLazy<T extends AnyComponent>(
	importFn: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
	return lazy(() => {
		let attempts = 0;

		const attempt = (): Promise<{ default: T }> => {
			attempts++;
			return importFn().catch((err: unknown) => {
				// Log the failure for debugging
				console.warn(
					`[retryLazy] Chunk load failed (attempt ${attempts}/${MAX_RETRIES}):`,
					err instanceof Error ? err.message : String(err),
				);

				if (attempts >= MAX_RETRIES) {
					// All retries exhausted. If it's a stale-chunk 404, self-heal by
					// reloading once — retrying the dead URL is guaranteed to fail.
					const willReload = isChunkLoadError(err) && reloadOnceForStaleChunk();
					if (willReload) {
						// Page is about to unload — stay in a pending state instead of
						// briefly flashing the ErrorBoundary before navigation completes.
						return new Promise<{ default: T }>(() => {});
					}
					// Rethrow the original error (ErrorBoundary will show fallback if
					// the reload didn't happen — e.g. reload already used this session).
					throw err;
				}

				// Wait with exponential backoff before retrying
				const delay = BASE_DELAY_MS * 2 ** (attempts - 1);
				return new Promise<{ default: T }>((resolve, reject) => {
					setTimeout(() => {
						attempt().then(resolve, reject);
					}, delay);
				});
			});
		};

		return attempt();
	});
}
