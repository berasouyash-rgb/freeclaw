import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	browserNotifyPermission,
	browserNotifySupported,
	requestBrowserNotifyPermission,
	showBrowserNotification,
} from "../lib/browserNotify";

const realNotification = (globalThis as Record<string, unknown>).Notification;

function stubNotification(permission: NotificationPermission) {
	const instances: Array<Record<string, unknown>> = [];
	const Ctor = vi.fn(function (this: unknown, _title: string, _opts?: unknown) {
		instances.push({ title: _title, opts: _opts });
		return this;
	}) as unknown as typeof Notification;
	Object.defineProperty(Ctor, "permission", { value: permission, configurable: true });
	Object.defineProperty(Ctor, "requestPermission", {
		value: vi.fn(async () => permission),
		configurable: true,
	});
	vi.stubGlobal("Notification", Ctor);
	return { Ctor, instances };
}

beforeEach(() => {
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
	if (realNotification !== undefined) {
		(globalThis as Record<string, unknown>).Notification = realNotification;
	} else {
		delete (globalThis as Record<string, unknown>).Notification;
	}
});

describe("browserNotifySupported", () => {
	it("is false without the Notification API", () => {
		vi.stubGlobal("Notification", undefined);
		expect(browserNotifySupported()).toBe(false);
	});

	it("is true with the API present", () => {
		stubNotification("default");
		expect(browserNotifySupported()).toBe(true);
	});
});

describe("browserNotifyPermission", () => {
	it("reports unsupported without the API", () => {
		vi.stubGlobal("Notification", undefined);
		expect(browserNotifyPermission()).toBe("unsupported");
	});

	it("passes through the browser state", () => {
		stubNotification("denied");
		expect(browserNotifyPermission()).toBe("denied");
	});
});

describe("requestBrowserNotifyPermission", () => {
	it("returns unsupported without the API and never throws", async () => {
		vi.stubGlobal("Notification", undefined);
		await expect(requestBrowserNotifyPermission()).resolves.toBe("unsupported");
	});

	it("does not re-prompt an already-decided state", async () => {
		const { Ctor } = stubNotification("denied");
		await expect(requestBrowserNotifyPermission()).resolves.toBe("denied");
		expect(Ctor.requestPermission).not.toHaveBeenCalled();
	});

	it("asks once when undecided", async () => {
		const { Ctor } = stubNotification("default");
		(Ctor.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("granted");
		await expect(requestBrowserNotifyPermission()).resolves.toBe("granted");
		expect(Ctor.requestPermission).toHaveBeenCalledTimes(1);
	});
});

describe("showBrowserNotification", () => {
	it("returns false without support or permission", () => {
		vi.stubGlobal("Notification", undefined);
		expect(showBrowserNotification({ title: "hi" })).toBe(false);
		stubNotification("default");
		expect(showBrowserNotification({ title: "hi" })).toBe(false);
	});

	it("shows and truncates, wiring a same-origin click-through", () => {
		const { Ctor, instances } = stubNotification("granted");
		const ok = showBrowserNotification({
			title: "x".repeat(200),
			body: "y".repeat(500),
			tag: "t",
			url: "/activity",
		});
		expect(ok).toBe(true);
		expect(Ctor).toHaveBeenCalledTimes(1);
		const [title, opts] = (
			Ctor as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0] as [string, { body: string; tag: string }];
		expect(title.length).toBeLessThanOrEqual(80);
		expect(opts.body.length).toBeLessThanOrEqual(160);
		expect(opts.tag).toBe("t");
		expect(instances).toHaveLength(1);
	});

	it("returns false when construction throws", () => {
		const Ctor = vi.fn(() => {
			throw new Error("blocked");
		}) as unknown as typeof Notification;
		Object.defineProperty(Ctor, "permission", { value: "granted", configurable: true });
		vi.stubGlobal("Notification", Ctor);
		expect(showBrowserNotification({ title: "hi" })).toBe(false);
	});
});
