/**
 * On-device browser notifications — the channel beyond SMS/email.
 * Uses the Notification API directly (no push server, no phone number):
 * works on desktop browsers and on mobile via an installed PWA / open tab.
 * Every entry point is guarded: unsupported browsers, denied permission,
 * and failures all resolve to "no notification", never a throw.
 */

export function browserNotifySupported(): boolean {
	try {
		if (typeof window === "undefined") return false;
		// typeof-check (not `in`): a stubbed-out global still answers `in`.
		return typeof (window as unknown as Record<string, unknown>).Notification === "function";
	} catch {
		return false;
	}
}

export function browserNotifyPermission(): NotificationPermission | "unsupported" {
	try {
		if (!browserNotifySupported()) return "unsupported";
		return Notification.permission;
	} catch {
		return "unsupported";
	}
}

/**
 * Permission-first request: call this from an explicit user gesture AFTER
 * showing the primer UI (what notifications are for + how to undo), never
 * on page load. Resolves to the resulting state, never throws.
 */
export async function requestBrowserNotifyPermission(): Promise<
	NotificationPermission | "unsupported"
> {
	try {
		if (!browserNotifySupported()) return "unsupported";
		if (Notification.permission === "granted" || Notification.permission === "denied") {
			return Notification.permission;
		}
		return await Notification.requestPermission();
	} catch {
		return "unsupported";
	}
}

export interface BrowserPing {
	title: string;
	body?: string;
	tag?: string;
	url?: string;
}

/**
 * Show one on-device notification. Returns true only when it was actually
 * shown (supported + permitted + constructed without error).
 */
export function showBrowserNotification(ping: BrowserPing): boolean {
	try {
		if (!browserNotifySupported()) return false;
		if (Notification.permission !== "granted") return false;
		const n = new Notification(ping.title.slice(0, 80), {
			body: (ping.body || "").slice(0, 160),
			tag: ping.tag || "voice-flow",
			silent: false,
		});
		if (ping.url) {
			n.onclick = () => {
				try {
					window.focus();
					if (ping.url!.startsWith("/")) window.location.assign(ping.url!);
				} catch {
					/* navigation is best-effort */
				}
			};
		}
		return true;
	} catch {
		return false;
	}
}
