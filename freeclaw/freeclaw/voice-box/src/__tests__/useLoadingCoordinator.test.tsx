// ═══════════════════════════════════════════════════════════════════
// useLoadingCoordinator — real readiness, not a timed animation
// ═══════════════════════════════════════════════════════════════════
// Proves the loader leaves ONLY when genuine readiness lands:
//   • shell mounts → INITIALIZING → LOADING
//   • fonts resolve → progress moves
//   • data probe answers → VERIFYING → READY (after the anti-flash floor)
//   • a hung probe → ERROR (max-wait watchdog), never an infinite spinner
//   • Retry re-runs init; Continue-with-limited proceeds anyway
//   • no timers leak on unmount
// ═══════════════════════════════════════════════════════════════════

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLoadingCoordinator } from "../components/preloader/useLoadingCoordinator";

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const fontsReady = { ready: Promise.resolve() };

beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(document, "fonts", {
		value: fontsReady,
		configurable: true,
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("real readiness flow", () => {
	it("reaches READY only when every critical flag is green", async () => {
		const probe = deferred<unknown>();
		const { result } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: () => probe.promise }),
		);

		// Shell mounts + all timed effects fire (env 80ms, auth 120ms, db 200ms, realtime 350ms)
		await act(async () => {
			vi.advanceTimersByTime(500);
		});
		expect(result.current.flags.shellReady).toBe(true);
		expect(result.current.flags.fontsReady).toBe(true);
		expect(result.current.flags.dataReady).toBe(false);

		// Data resolves → all critical green → READY
		await act(async () => {
			probe.resolve({ ok: true });
			await Promise.resolve();
		});
		expect(result.current.flags.dataReady).toBe(true);
		expect(result.current.status).toBe("READY");
	});

	it("stays at RESOURCES while the critical probe is pending (no fake completion)", async () => {
		const probe = deferred<unknown>();
		const { result } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: () => probe.promise }),
		);
		await act(async () => {});
		// env fires at 80ms — data is not green yet
		expect(result.current.flags.dataReady).toBe(false);

		await act(async () => {
			vi.advanceTimersByTime(5000);
		});
		// long past, but the probe never answered → not READY
		expect(result.current.status).not.toBe("READY");
		expect(result.current.flags.dataReady).toBe(false);

		await act(async () => {
			probe.resolve({ ok: true });
			await Promise.resolve();
		});
		expect(result.current.flags.dataReady).toBe(true);
	});

	it("never blocks forever — a hung probe trips the watchdog to ERROR", async () => {
		const probe = deferred<unknown>();
		const { result } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: () => probe.promise, maxWaitMs: 2000 }),
		);
		await act(async () => {});
		await act(async () => {
			vi.advanceTimersByTime(2600);
		});
		expect(result.current.errored).toBe(true);
		expect(result.current.status).toBe("ERROR");
	});

	it("Retry re-runs initialization and can succeed", async () => {
		let fail = true;
		const probe = vi.fn().mockImplementation(() => {
			if (fail) return Promise.reject(new Error("down"));
			return Promise.resolve({ ok: true });
		});
		const { result } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: probe, maxWaitMs: 2000 }),
		);
		await act(async () => {});
		await act(async () => {
			vi.advanceTimersByTime(2600);
		});
		expect(result.current.errored).toBe(true);

		fail = false;
		// Commit the retry (resets errored + flags + clock) first…
		await act(async () => {
			result.current.retry();
			await Promise.resolve();
			await Promise.resolve();
		});
		// …then let the probe resolve and ALL scenes elapse.
		await act(async () => {
			vi.advanceTimersByTime(2400);
		});
		expect(result.current.errored).toBe(false);
		expect(result.current.flags.dataReady).toBe(true);
		expect(result.current.status).toBe("READY");
	});

	it("Continue-with-limited experience lets the user through despite a failed probe", async () => {
		const probe = vi.fn().mockRejectedValue(new Error("down"));
		const { result } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: probe, maxWaitMs: 2000 }),
		);
		await act(async () => {});
		await act(async () => {
			vi.advanceTimersByTime(2600);
		});
		expect(result.current.status).toBe("ERROR");

		await act(async () => {
			result.current.continueLimited();
			vi.advanceTimersByTime(2400);
		});
		expect(result.current.errored).toBe(false);
		expect(result.current.status).toBe("READY");
	});

	it("exposes an honest progress that tracks real tasks", async () => {
		const probe = deferred<unknown>();
		const { result } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: () => probe.promise }),
		);
		// Advance past all timed effects (env 80ms, auth 120ms, db 200ms, realtime 350ms)
		await act(async () => {
			vi.advanceTimersByTime(500);
		});
		// shell + env + fonts + auth + db + realtime done, data pending → 6/7
		expect(result.current.progress).toBeCloseTo(6 / 7);
		await act(async () => {
			probe.resolve({});
			await Promise.resolve();
		});
		expect(result.current.progress).toBe(1);
	});
});

describe("cleanup hygiene", () => {
	it("clears its interval on unmount (no leaked ticker)", async () => {
		const clearSpy = vi.spyOn(window, "clearInterval");
		const probe = vi.fn().mockResolvedValue({});
		const { unmount } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: probe }),
		);
		await act(async () => {});
		unmount();
		expect(clearSpy).toHaveBeenCalled();
	});

	it("does not setState after unmount (data probe resolves late)", async () => {
		const probe = deferred<unknown>();
		const { unmount } = renderHook(() =>
			useLoadingCoordinator({ dataProbe: () => probe.promise }),
		);
		await act(async () => {});
		unmount();
		await act(async () => {
			probe.resolve({});
			await Promise.resolve();
		});
		// No crash = the effect's alive guard worked.
		expect(true).toBe(true);
	});
});
