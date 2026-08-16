import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — used for Realtime subscriptions only.
 * All data writes go through API routes (server-side client with service role key).
 *
 * Hardening: this module must NEVER throw at import time. It is part of the
 * eagerly-evaluated module graph (App → Home → useRealtime → supabase), so an
 * uncaught error here used to prevent the entire app from booting and left the
 * splash screen on screen. Instead:
 *  - valid HTTP(S) URL + key → real client (realtime works)
 *  - missing or malformed config → export `null`; useRealtime degrades to its
 *    10s polling fallback, so the app keeps working with zero realtime.
 */

function isValidHttpUrl(value: string | undefined): value is string {
	if (!value) return false;
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
	isValidHttpUrl(url) && key
		? createClient(url, key, {
				realtime: { params: { eventsPerSecond: 5 } },
				auth: {
					persistSession: false,
					autoRefreshToken: false,
				},
			})
		: null;

if (!supabase) {
	console.error(
		"CRITICAL: Missing or invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — realtime disabled, polling fallback active.",
	);
}

export default supabase;
