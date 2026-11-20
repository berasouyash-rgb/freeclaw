/**
 * On-device notifications for Voice Flow across all platforms:
 * 1. Desktop (Electron) — native OS toasts via Windows Action Center (IPC bridge to electron/main.cjs).
 * 2. Mobile (Android APK / Capacitor) — native heads-up alerts & tray notifications via @capacitor/local-notifications.
 * 3. Web (Desktop/Mobile browsers) — HTML5 Notification constructor + ServiceWorker showNotification fallback.
 *
 * Every entry point is guarded: unsupported environments, denied permission,
 * and failures all resolve safely to "no notification", never an unhandled rejection or throw.
 */

import { isMobileApp } from "./platform";
import { LocalNotifications } from "@capacitor/local-notifications";

export interface BrowserPing {
	title: string;
	body?: string;
	tag?: string;
	url?: string;
}

let _swPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let _channelCreated = false;
let _mobilePermission: NotificationPermission | null = null;
let _mobileListenerRegistered = false;

function isDesktopShell(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			Boolean((window as unknown as { vbDesktop?: unknown }).vbDesktop)
		);
	} catch {
		return false;
	}
}

async function ensureAndroidNotificationChannel(): Promise<void> {
	if (_channelCreated) return;
	try {
		await LocalNotifications.createChannel({
			id: "voiceflow_alerts",
			name: "Voice Flow Alerts",
			description: "Real-time school alerts, updates and announcements",
			importance: 5,
			visibility: 1,
			vibration: true,
		});
		_channelCreated = true;
	} catch {
		/* best-effort channel creation */
	}
}

function initMobileNotifications(): void {
	if (typeof window === "undefined" || !isMobileApp()) return;
	void ensureAndroidNotificationChannel();
	try {
		LocalNotifications.checkPermissions()
			.then((res) => {
				if (res.display === "granted") _mobilePermission = "granted";
				else if (res.display === "denied") _mobilePermission = "denied";
				else _mobilePermission = "default";
			})
			.catch(() => {});
	} catch {
		/* ignore */
	}

	if (!_mobileListenerRegistered) {
		try {
			void LocalNotifications.addListener(
				"localNotificationActionPerformed",
				(action) => {
					try {
						const extraUrl = action.notification?.extra?.url;
						if (extraUrl && typeof extraUrl === "string") {
							const target = extraUrl.startsWith("#")
								? extraUrl
								: `#${extraUrl.startsWith("/") ? extraUrl : "/" + extraUrl}`;
							window.location.hash = target;
						}
					} catch {
						/* navigation is best-effort */
					}
				},
			);
			_mobileListenerRegistered = true;
		} catch {
			/* ignore */
		}
	}
}

// Initialize on module load if in mobile shell
if (typeof window !== "undefined" && isMobileApp()) {
	initMobileNotifications();
}

export function browserNotifySupported(): boolean {
	try {
		if (typeof window === "undefined") return false;
		if (isDesktopShell()) return true;
		if (isMobileApp()) return true;
		// typeof-check (not `in`): a stubbed-out global still answers `in`.
		return typeof (window as unknown as Record<string, unknown>).Notification === "function";
	} catch {
		return false;
	}
}

export function browserNotifyPermission(): NotificationPermission | "unsupported" {
	try {
		if (!browserNotifySupported()) return "unsupported";
		if (isDesktopShell()) return "granted";
		if (isMobileApp()) return _mobilePermission || "default";
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

		if (isDesktopShell()) {
			return "granted";
		}

		if (isMobileApp()) {
			await ensureAndroidNotificationChannel();
			try {
				const res = await LocalNotifications.requestPermissions();
				const state: NotificationPermission = res.display === "granted" ? "granted" : "denied";
				_mobilePermission = state;
				return state;
			} catch {
				return "denied";
			}
		}

		if (Notification.permission === "granted" || Notification.permission === "denied") {
			return Notification.permission;
		}
		return await Notification.requestPermission();
	} catch {
		return "unsupported";
	}
}

/**
 * Register the notification service worker (web only) or set up native channels (mobile).
 * Called once at boot. Failures are swallowed.
 */
export function registerNotifyServiceWorker(): void {
	try {
		if (typeof window === "undefined") return;

		if (isMobileApp()) {
			initMobileNotifications();
			return;
		}

		if (isDesktopShell()) {
			return;
		}

		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
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

/**
 * Show one on-device notification across Desktop, Mobile, or Web.
 * Returns true only when it was actually shown or successfully scheduled.
 */
export function showBrowserNotification(ping: BrowserPing): boolean {
	try {
		if (!browserNotifySupported()) return false;

		const title = (ping.title || "Voice Flow").slice(0, 80);
		const body = (ping.body || "").slice(0, 160);
		const tag = ping.tag || "voice-flow";
		const icon = "/icons/icon-192.png";

		// 1. Desktop Shell (Electron native notifications via AUMID toast)
		if (isDesktopShell()) {
			const vbNotify = (
				window as unknown as {
					vbNotify?: { show: (p: BrowserPing) => Promise<boolean> };
				}
			).vbNotify;
			if (vbNotify && typeof vbNotify.show === "function") {
				void vbNotify.show({ title, body, tag, url: ping.url || "/" });
				return true;
			}
		}

		// 2. Mobile App (Android native heads-up/tray notification via Capacitor)
		if (isMobileApp()) {
			const notifId = (Date.now() + Math.floor(Math.random() * 1000)) % 2147483647;
			void ensureAndroidNotificationChannel()
				.then(() =>
					LocalNotifications.schedule({
						notifications: [
							{
								id: notifId,
								title,
								body,
								channelId: "voiceflow_alerts",
								smallIcon: "ic_launcher",
								extra: { url: ping.url || "/" },
							},
						],
					}),
				)
				.catch(() => {});
			return true;
		}

		// 3. Web browsers
		if (Notification.permission !== "granted") return false;

		// Path 3a — desktop web browsers: the constructor renders immediately
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
			// Path 3b — Android Chrome/WebView web: the constructor throws by spec.
		}

		if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
			void swRegistration().then((reg) => {
				if (!reg || typeof reg.showNotification !== "function") return;
				reg.showNotification(title, {
					body,
					tag,
					icon,
					badge: icon,
					data: { url: ping.url || "/" },
				}).catch(() => {
					/* worker refused */
				});
			});
			return true;
		}

		return false;
	} catch {
		return false;
	}
}
