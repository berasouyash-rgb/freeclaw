// ═══════════════════════════════════════════════════════════════════
// Device notifications on mobile — the reported "not working" bug
// ═══════════════════════════════════════════════════════════════════
// Android Chrome/WebView throw "Illegal constructor" for
// `new Notification(...)`; the only supported path is
// `ServiceWorkerRegistration.showNotification`. The old implementation
// waited on `navigator.serviceWorker.ready` with no worker registered —
// that promise never settled, the notification was silently dropped, and
// the function still returned true. This locks the fixed behaviour: the
// constructor is tried first, and the worker takes over when it throws.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	try {
		delete (navigator as unknown as Record<string, unknown>).serviceWorker;
	} catch {
		/* nothing to clean */
	}
});

function stubServiceWorker(showNotification: ReturnType<typeof vi.fn>) {
	Object.defineProperty(navigator, "serviceWorker", {
		configurable: true,
		value: {
			ready: Promise.resolve({ showNotification }),
			register: vi.fn(async () => ({})),
		},
	});
}

describe("showBrowserNotification — mobile service-worker path", () => {
	it("uses the registration when the constructor is illegal (Android)", async () => {
		const showNotification = vi.fn(async () => {});
		stubServiceWorker(showNotification);

		const Ctor = vi.fn(() => {
			throw new TypeError("Illegal constructor");
		}) as unknown as typeof Notification;
		Object.defineProperty(Ctor, "permission", { value: "granted", configurable: true });
		vi.stubGlobal("Notification", Ctor);

		vi.resetModules();
		const { showBrowserNotification } = await import("../lib/browserNotify");
		const shown = showBrowserNotification({
			title: "New reply in your inbox",
			body: "Open to read it",
			tag: "vb-test",
			url: "/chat",
		});

		expect(shown).toBe(true);
		await vi.waitFor(() => {
			expect(showNotification).toHaveBeenCalledTimes(1);
		});
		const [title, options] = showNotification.mock.calls[0] as unknown as [
			string,
			{ data: { url: string }; tag: string },
		];
		expect(title).toBe("New reply in your inbox");
		expect(options.tag).toBe("vb-test");
		// The tap target travels to the worker, which routes it back in-app.
		expect(options.data.url).toBe("/chat");
	});

	it("still reports false when neither path can display", async () => {
		const Ctor = vi.fn(() => {
			throw new TypeError("Illegal constructor");
		}) as unknown as typeof Notification;
		Object.defineProperty(Ctor, "permission", { value: "granted", configurable: true });
		vi.stubGlobal("Notification", Ctor);

		vi.resetModules();
		const { showBrowserNotification } = await import("../lib/browserNotify");
		// No serviceWorker on this navigator.
		expect(showBrowserNotification({ title: "hi" })).toBe(false);
	});
});
