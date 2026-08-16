// ─── useSmartPoll tests ──────────────────────────────────────────
// Locks in the smart polling hook:
//   1. fires immediately on mount (or waits for the first interval)
//   2. toggles isPolling and clears lastError on success
//   3. exponential backoff on failure, capped at maxIntervalMs
//   4. wraps non-Error failures in Error
//   5. pauses while hidden and force-refreshes on return
//   6. no visibility listener when pauseOnHidden is false
//   7. cleans up timers on unmount and never schedules after unmount

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSmartPoll } from "../lib/useSmartPoll";

describe("useSmartPoll", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("fires immediately on mount and toggles isPolling", async () => {
		vi.useFakeTimers();
		let resolve!: (v: unknown) => void;
		const fetcher = vi.fn(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		);
		const { result } = renderHook(() => useSmartPoll(fetcher));

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(result.current.isPolling).toBe(true);

		await act(async () => {
			resolve("ok");
		});
		expect(result.current.isPolling).toBe(false);
		expect(result.current.lastError).toBeNull();
	});

	it("waits for the first interval when immediate is false", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.resolve("ok"));
		renderHook(() =>
			useSmartPoll(fetcher, { intervalMs: 1000, immediate: false }),
		);

		expect(fetcher).not.toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("backs off exponentially on failure and resets on success", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const fetcher = vi.fn(() => {
			calls++;
			return calls < 3
				? Promise.reject(new Error("boom"))
				: Promise.resolve("ok");
		});
		const onIntervalChange = vi.fn();
		const { result } = renderHook(() =>
			useSmartPoll(fetcher, { immediate: false, onIntervalChange }),
		);

		// attempt 1 fires at t=30000, fails → interval becomes 60000
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(result.current.lastError?.message).toBe("boom");
		expect(onIntervalChange).toHaveBeenLastCalledWith(60_000);

		// attempt 2 at t=90000, fails → interval becomes 120000
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(onIntervalChange).toHaveBeenLastCalledWith(120_000);

		// attempt 3 at t=210000, succeeds → backoff resets to 30000
		await act(async () => {
			await vi.advanceTimersByTimeAsync(120_000);
		});
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(result.current.lastError).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		expect(fetcher).toHaveBeenCalledTimes(4);
		// onIntervalChange only fires on failures
		expect(onIntervalChange).toHaveBeenCalledTimes(2);
	});

	it("caps the backoff interval at maxIntervalMs", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.reject(new Error("down")));
		const onIntervalChange = vi.fn();
		renderHook(() =>
			useSmartPoll(fetcher, {
				immediate: false,
				intervalMs: 100,
				maxIntervalMs: 250,
				backoffFactor: 2,
				onIntervalChange,
			}),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		}); // fail → 200
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		}); // fail → 400 → capped 250
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		}); // fail → 400 → capped 250

		expect(onIntervalChange.mock.calls.map((c) => c[0])).toEqual([
			200, 250, 250,
		]);
	});

	it("wraps non-Error failures into an Error for lastError", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.reject("nope"));
		const { result } = renderHook(() =>
			useSmartPoll(fetcher, { immediate: false, intervalMs: 100 }),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});

		expect(result.current.lastError).toBeInstanceOf(Error);
		expect(result.current.lastError?.message).toBe("nope");
	});

	it("wraps non-Error failures from forceRefresh into an Error", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.reject("oops"));
		const { result } = renderHook(() =>
			useSmartPoll(fetcher, { intervalMs: 1000, immediate: false }),
		);

		await act(async () => {
			await result.current.forceRefresh();
		});

		expect(result.current.lastError).toBeInstanceOf(Error);
		expect(result.current.lastError?.message).toBe("oops");
		expect(result.current.isPolling).toBe(false);
	});

	it("surfaces errors thrown by the mount refresh", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.reject(new Error("mount boom")));
		const { result } = renderHook(() =>
			useSmartPoll(fetcher, { intervalMs: 1000 }),
		);

		expect(fetcher).toHaveBeenCalledTimes(1);
		// flush the rejection microtask before asserting on state
		await act(async () => {
			await Promise.resolve();
		});
		expect(result.current.lastError?.message).toBe("mount boom");
		expect(result.current.isPolling).toBe(false);
	});

	it("pauses while hidden and force-refreshes on return", async () => {
		vi.useFakeTimers();
		let hidden = false;
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => hidden,
		});
		const fetcher = vi.fn(() => Promise.resolve("ok"));
		const { result } = renderHook(() =>
			useSmartPoll(fetcher, { intervalMs: 1000, immediate: false }),
		);

		hidden = true;
		document.dispatchEvent(new Event("visibilitychange"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(fetcher).not.toHaveBeenCalled();

		hidden = false;
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(fetcher).toHaveBeenCalledTimes(1); // immediate refresh on return

		// schedule resumes at the base interval
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(result.current.isPolling).toBe(false);
	});

	it("does not attach a visibility listener when pauseOnHidden is false", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.resolve("ok"));
		const addSpy = vi.spyOn(document, "addEventListener");
		renderHook(() =>
			useSmartPoll(fetcher, {
				intervalMs: 1000,
				immediate: false,
				pauseOnHidden: false,
			}),
		);

		expect(addSpy.mock.calls.map((c) => c[0])).not.toContain(
			"visibilitychange",
		);
	});

	it("does not fire immediately when the tab is hidden at mount", async () => {
		vi.useFakeTimers();
		const hidden = true;
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => hidden,
		});
		const fetcher = vi.fn(() => Promise.resolve("ok"));
		renderHook(() => useSmartPoll(fetcher, { intervalMs: 1000 })); // immediate defaults to true

		expect(fetcher).not.toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("cleans up timers on unmount", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.resolve("ok"));
		const { unmount } = renderHook(() =>
			useSmartPoll(fetcher, { intervalMs: 1000, immediate: false }),
		);

		unmount();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("never schedules after unmount", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(() => Promise.resolve("ok"));
		const { result, unmount } = renderHook(() =>
			useSmartPoll(fetcher, { intervalMs: 1000, immediate: false }),
		);

		unmount();
		await act(async () => {
			await result.current.forceRefresh();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});

		// the post-unmount refresh still runs, but no timer is scheduled after it
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
