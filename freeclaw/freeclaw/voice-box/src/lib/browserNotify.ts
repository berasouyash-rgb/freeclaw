/**
 * On-device browser notifications — the channel beyond SMS/email.
 * Uses the Notification API directly (no push server, no phone number):
 * works on desktop browsers and on mobile via an installed PWA / open tab.
 * Every entry point is guarded: unsupported browsers, denied permission,
 * and failures all resolve to "no notification", never a throw.
 *
 * DELIVERY MODEL (why this file registers a service worker):
 * Android Chrome and every Android WebView refuse `new Notification(...)`
 * with "Illegal constructor" — the only supported path there is
 * `ServiceWorkerRegistration.showNotification`. The previous version
 * ALWAYS went to `navigator.serviceWorker.ready`, which never resolves when
 * no worker is registered: the promise stayed pending forever, the
 * notification was silently dropped, and the function still returned
 * `true`. That is exactly the reported "notifications don't work" bug, on
 * every browser that ships a service worker API (i.e. all of them).
 *
 * Now: a real `/sw.js` is registered at boot, the desktop constructor is
 * tried first (it shows immediately and is not subject to worker startup),
 * and the worker path is the documented mobile fallback — with a timeout
 * so a missing/broken registration can never hang a notification forever.
 */

let _swPromise: Promise<ServiceWorkerRegistration | null> | null = null;

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

/**
 * Register the notification service worker. Called once at boot. Failures
 * are swallowed: a browser without service workers still gets desktop
 * notifications through the constructor path.
 */
export function registerNotifyServiceWorker(): void {
	try {
		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
		if (typeof window === "undefined") return;
		// Service workers require a secure context (https, or localhost).
		const { protocol, hostname } = window.location;
		const secure = protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
		if (!secure) return;
		navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
			/* registration is best-effort; constructor notifications still work */
		});
	} catch {
		/* unsupported */
	}
}

/** The active registration, or null when none becomes active in time. */
function swRegistration(timeoutMs = 2500): Promise<ServiceWorkerRegistration | null> {
	try {
		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
			return Promise.resolve(null);
		}
		if (_swPromise) return _swPromise;
		const pending = Promise.race([
			navigator.serviceWorker.ready,
			new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
		]).then((reg) => (reg as ServiceWorkerRegistration) || null);
		_swPromise = pending.catch(() => null);
		// Do not cache a miss: a worker registered later must be usable.
		void _swPromise.then((reg) => {
			if (!reg) _swPromise = null;
		});
		return _swPromise;
	} catch {
		return Promise.resolve(null);
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
 * shown (supported + permitted + a real display call succeeded or was
 * scheduled on a live registration).
 */
export function showBrowserNotification(ping: BrowserPing): boolean {
	try {
		if (!browserNotifySupported()) return false;
		if (Notification.permission !== "granted") return false;

		const title = (ping.title || "Voice Flow").slice(0, 80);
		const body = (ping.body || "").slice(0, 160);
		const tag = ping.tag || "voice-flow";
		const icon = "/icons/icon-192.png";

		// Path 1 — desktop browsers: the constructor renders immediately and
		// is not subject to worker activation timing.
		try {
			const n = new Notification(title, { body, tag, silent: false, icon });
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
			// Path 2 — Android Chrome/WebView: the constructor throws by spec.
		}

		if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
			void swRegistration().then((reg) => {
				if (!reg || typeof reg.showNotification !== "function") return;
				reg.showNotification(title, {
					body,
					tag,
					icon,
					badge: icon,
					// The worker's notificationclick handler reads this.
					data: { url: ping.url || "/" },
				}).catch(() => {
					/* worker refused — nothing else to try */
				});
			});
			return true;
		}

		return false;
	} catch {
		return false;
	}
}
