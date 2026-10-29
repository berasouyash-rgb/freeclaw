import { useEffect } from "react";
import { api, hasAdminSession } from "../lib/api";
import { apiBase } from "../lib/platform";
import { showBrowserNotification } from "../lib/browserNotify";

const RECONNECT_MS = 5_000;
const MAX_FAILURES = 5;
/** At most one popup per window — a burst of writes is one admin alert. */
const POPUP_THROTTLE_MS = 10_000;
/**
 * Slang escalations are written to the `settings` KV, which the SSE stream
 * does not publish (see BINDINGS in api/_admin-events.js), so the console
 * polls for a new pending scope decision on this cadence instead.
 */
const ESCALATION_POLL_MS = 60_000;

/** Admin event kind → the tab it belongs to, for the popup deep link. */
const KIND_TAB: Record<string, string> = {
	reports: "reports",
	posts: "posts",
	polls: "polls",
	chat: "inbox",
	votes: "polls",
	comments: "posts",
	// Slang escalations are decided from the users tab (scope selector).
	escalations: "users",
};

function popupForKinds(kinds: string[]) {
	const first = kinds.find((k) => KIND_TAB[k]) || "reports";
	const label = first.charAt(0).toUpperCase() + first.slice(1);
	const title = kinds.length > 1 ? `New admin activity (${kinds.length} areas)` : `New activity in ${label}`;
	const url = `/admin?tab=${encodeURIComponent(KIND_TAB[first] || "reports")}`;
	return { title, url, kinds };
}

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
		let lastPopupAt = 0;
		// Escalation poll state (-1 = not yet known, so the first poll only
		// seeds the baseline and never raises a popup for a backlog).
		let lastPending = -1;
		let polling = false;
		let pollTimer: ReturnType<typeof setInterval> | null = null;

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

		/** Shared popup path: one throttle for BOTH the SSE wake-ups and the
		 *  escalation poll, so a burst across the two is still one alert. */
		const raisePopup = (popup: { title: string; url: string; kinds: string[] }) => {
			if (cancelled) return false;
			const now = Date.now();
			if (now - lastPopupAt < POPUP_THROTTLE_MS) return false;
			lastPopupAt = now;
			// In-app: Layout listens and raises a toast (it owns the toast API).
			try {
				window.dispatchEvent(new CustomEvent("vb:admin-activity", { detail: popup }));
			} catch {
				/* non-browser context */
			}
			showBrowserNotification({
				title: popup.title,
				body: "Tap to open the admin console.",
				tag: "vb-admin-activity",
				url: popup.url,
			});
			return true;
		};

		/** Detect a NEW pending escalation (not yet decided). */
		const pollEscalations = async () => {
			if (cancelled || polling || !hasAdminSession()) return;
			polling = true;
			try {
				const r = await api.post<{ pending_escalations?: unknown }>("/api/admin", {
					action: "escalated_users",
				});
				if (cancelled) return;
				const pending = Array.isArray(r?.pending_escalations) ? r.pending_escalations : [];
				const grew = lastPending >= 0 && pending.length > lastPending;
				if (grew) {
					const label =
						pending.length > 1
							? `${pending.length} slang escalations awaiting decision`
							: "Slang escalation awaiting decision";
					// If we are inside the throttle window, leave the old
					// baseline alone so the next tick still sees the growth
					// and the alert goes out as soon as the window opens.
					const sent = raisePopup({
						title: label,
						url: "/admin?tab=users",
						kinds: ["escalations"],
					});
					if (sent) lastPending = pending.length;
				} else {
					// Unchanged or resolved — track the current backlog.
					lastPending = pending.length;
				}
			} catch {
				/* the poll is best-effort — the users tab refresh button remains */
			} finally {
				polling = false;
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
			es.addEventListener("update", (ev: MessageEvent) => {
				if (cancelled) return;
				onUpdate();

				// Admin popup — the same on-screen toast + device notification
				// pattern the student inbox uses, so an open admin console on a
				// phone actually tells its operator that something arrived.
				let kinds: string[] = [];
				try {
					const parsed = JSON.parse(String(ev.data || "{}")) as {
						kinds?: unknown;
					};
					kinds = Array.isArray(parsed.kinds)
						? parsed.kinds.filter((k): k is string => typeof k === "string")
						: [];
				} catch {
					kinds = [];
				}
				if (kinds.length === 0) return;
				raisePopup(popupForKinds(kinds));
			});
			es.onerror = () => {
				closeStream();
				if (cancelled) return;
				failures += 1;
				schedule();
			};
		};

		void connect();
		// Slang escalations never reach the SSE stream (settings KV is not
		// published), so poll for a new pending decision. First tick seeds
		// the baseline; it does not alert on an existing backlog.
		void pollEscalations();
		pollTimer = setInterval(() => void pollEscalations(), ESCALATION_POLL_MS);
		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
			if (pollTimer) clearInterval(pollTimer);
			closeStream();
		};
	}, [onUpdate]);
}
