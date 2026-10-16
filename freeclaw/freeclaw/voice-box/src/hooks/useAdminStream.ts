import { useEffect } from "react";
import { api, hasAdminSession } from "../lib/api";
import { apiBase } from "../lib/platform";

const RECONNECT_MS = 5_000;
const MAX_FAILURES = 5;

/**
 * Admin console live stream. Opens /api/admin-events (SSE) and calls
 * onUpdate on every `update` wake-up — the same freshness pill the pages
 * already raise for their realtime signal. Sits ALONGSIDE useRealtime:
 * contract tables stay on the anon channel, everything else (reports,
 * votes, chat, threads) arrives here.
 *
 * Auth: EventSource cannot send the admin header, so each (re)connect
 * first fetches a 5-minute bearer ticket over the normal authed path.
 * Five consecutive failures with no successful (re)connect stop the
 * loop — the console's explicit refresh buttons remain, and hammering a
 * dead endpoint helps nobody.
 */
export function useAdminStream(onUpdate: () => void) {
	useEffect(() => {
		// No EventSource (jsdom/tests, old browsers) or no admin session:
		// render nothing, open nothing. Server enforces auth regardless.
		if (typeof EventSource === "undefined" || !hasAdminSession()) return;
		let cancelled = false;
		let es: EventSource | null = null;
		let failures = 0;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		const closeStream = () => {
			if (es) {
				try {
					es.close();
				} catch {
					/* already closed */
				}
				es = null;
			}
		};

		const schedule = () => {
			if (cancelled || failures >= MAX_FAILURES) return;
			if (retryTimer) return;
			retryTimer = setTimeout(() => {
				retryTimer = null;
				void connect();
			}, RECONNECT_MS);
		};

		const connect = async () => {
			if (cancelled) return;
			let ticket = "";
			try {
				const r = await api.post<{ ticket?: string }>("/api/admin-events", {
					action: "ticket",
				});
				ticket = r?.ticket ?? "";
				if (!ticket || cancelled) throw new Error("no ticket");
			} catch {
				failures += 1;
				schedule();
				return;
			}
			try {
				es = new EventSource(
					`${apiBase()}/api/admin-events?ticket=${encodeURIComponent(ticket)}`,
					{ withCredentials: true },
				);
			} catch {
				failures += 1;
				schedule();
				return;
			}
			// Healthy steady state (45s hold → close → reconnect) resets the
			// counter on every open; only a truly dead endpoint accumulates.
			es.onopen = () => {
				failures = 0;
			};
			es.addEventListener("update", () => {
				if (!cancelled) onUpdate();
			});
			es.onerror = () => {
				closeStream();
				if (cancelled) return;
				failures += 1;
				schedule();
			};
		};

		void connect();
		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
			closeStream();
		};
	}, [onUpdate]);
}
