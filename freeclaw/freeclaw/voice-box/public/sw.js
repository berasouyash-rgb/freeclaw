/* Voice Flow — Enterprise Resilient Service Worker v2.
 * Provides:
 *   1. Sub-300ms App Shell caching & Stale-While-Revalidate asset delivery.
 *   2. Complete Offline Resiliency: loads UI and cached feeds when network is unavailable.
 *   3. OS-level and browser notification delivery (Android, Chrome, Web).
 *   4. Safe API read fallback for offline complaint/feed browsing.
 */

const CACHE_VERSION = "voiceflow-v2.1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;

const PRECACHE_ASSETS = [
	"/",
	"/index.html",
	"/favicon.svg",
	"/manifest.webmanifest",
	"/icons/apple-touch-icon.png",
];

// Install: precache app shell and activate immediately
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(SHELL_CACHE).then((cache) => {
			return cache.addAll(PRECACHE_ASSETS).catch(() => {
				/* precache is best-effort */
			});
		}).then(() => self.skipWaiting())
	);
});

// Activate: purge obsolete cache versions and claim clients
self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) => {
			return Promise.all(
				keys
					.filter((k) => k !== SHELL_CACHE && k !== API_CACHE)
					.map((k) => caches.delete(k))
			);
		}).then(() => self.clients.claim())
	);
});

// Fetch: intelligent offline fallback & high-speed caching
self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Ignore non-GET requests (mutations handled by client-side offline queue in src/lib/offline.ts)
	if (request.method !== "GET") return;

	// Ignore chrome extensions or unsupported schemes
	if (!url.protocol.startsWith("http")) return;

	// 1. Navigation (HTML pages) — Network-first with App Shell cache fallback
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.status === 200) {
						const clone = response.clone();
						caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
					}
					return response;
				})
				.catch(async () => {
					const cached = await caches.match(request);
					if (cached) return cached;
					const fallback = await caches.match("/index.html") || await caches.match("/");
					if (fallback) return fallback;
					return new Response(
						`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0e0e16;color:#fff;"><h2>Voice Flow (Offline)</h2><p>You are currently offline. Please reconnect to load fresh content.</p></body></html>`,
						{ headers: { "Content-Type": "text/html" } }
					);
				})
		);
		return;
	}

	// 2. Static Assets (JS chunks, CSS, fonts, SVG/PNG icons) — Stale-While-Revalidate
	if (
		url.pathname.startsWith("/assets/") ||
		url.pathname.endsWith(".js") ||
		url.pathname.endsWith(".css") ||
		url.pathname.endsWith(".svg") ||
		url.pathname.endsWith(".png") ||
		url.pathname.endsWith(".woff2") ||
		url.hostname.includes("fonts.gstatic.com")
	) {
		event.respondWith(
			caches.match(request).then((cached) => {
				const networkFetch = fetch(request).then((response) => {
					if (response.status === 200) {
						const clone = response.clone();
						caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
					}
					return response;
				}).catch(() => cached);

				return cached || networkFetch;
			})
		);
		return;
	}

	// 3. API Read Endpoints (Feeds, categories, public stats) — Network-first with API cache fallback
	if (
		url.pathname.startsWith("/api/posts") ||
		url.pathname.startsWith("/api/categories") ||
		url.pathname.startsWith("/api/stats") ||
		url.pathname.startsWith("/api/polls")
	) {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.status === 200) {
						const clone = response.clone();
						caches.open(API_CACHE).then((cache) => cache.put(request, clone));
					}
					return response;
				})
				.catch(async () => {
					const cached = await caches.match(request);
					if (cached) return cached;
					return new Response(
						JSON.stringify({ error: "Offline — serving cached data", offline: true, data: [] }),
						{ headers: { "Content-Type": "application/json" }, status: 200 }
					);
				})
		);
		return;
	}
});

// Notifications
self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const data = event.notification.data || {};
	const target = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";

	event.waitUntil(
		(async () => {
			try {
				const windows = await self.clients.matchAll({
					type: "window",
					includeUncontrolled: true,
				});
				for (const client of windows) {
					if ("focus" in client) {
						try {
							if ("navigate" in client && client.url) {
								await client.navigate(target);
							}
						} catch {
							/* best effort */
						}
						return await client.focus();
					}
				}
			} catch {
				/* fall through */
			}
			try {
				return await self.clients.openWindow(target);
			} catch {
				return undefined;
			}
		})(),
	);
});

self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = {};
	}
	const title = String(payload.title || "Voice Flow");
	const body = String(payload.body || "");
	const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";
	event.waitUntil(
		self.registration.showNotification(title.slice(0, 80), {
			body: body.slice(0, 160),
			icon: "/icons/icon-192.png",
			badge: "/icons/icon-192.png",
			tag: String(payload.tag || "voice-flow"),
			data: { url },
		}),
	);
});
