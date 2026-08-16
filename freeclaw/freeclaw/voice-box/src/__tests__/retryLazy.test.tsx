// ─── retryLazy tests ──────────────────────────────────────────────
// Locks in the React.lazy() retry wrapper behavior:
//   1. isChunkLoadError recognizes the whole stale-chunk error family
//   2. reloadOnceForStaleChunk reloads once per session (guard in sessionStorage)
//   3. retryLazy resolves on the first attempt
//   4. retryLazy retries with exponential backoff and recovers
//   5. retryLazy rethrows the original error when retries are exhausted
//   6. Exhausted chunk-load errors trigger a one-time page reload and
//      leave the lazy component pending (no error flash before unload)

import { act, render, screen } from "@testing-library/react";
import { Component, createElement, type ReactNode, Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isChunkLoadError,
	reloadOnceForStaleChunk,
	retryLazy,
} from "../lib/retryLazy";

const RELOAD_GUARD_KEY = "vb:chunkReloaded";

/** Error boundary that renders the caught error instead of crashing the test. */
class ErrorBoundary extends Component<
	{ children: ReactNode },
	{ err: unknown }
> {
	state: { err: unknown } = { err: null };
	static getDerivedStateFromError(err: unknown) {
		return { err };
	}
	render() {
		return this.state.err ? (
			<div data-testid="boundary">boundary fallback</div>
		) : (
			this.props.children
		);
	}
}

function renderLazy(comp: ReturnType<typeof retryLazy>) {
	return render(
		<Suspense fallback={<div data-testid="loading">loading</div>}>
			<ErrorBoundary>{createElement(comp)}</ErrorBoundary>
		</Suspense>,
	);
}

describe("isChunkLoadError", () => {
	it.each([
		"Failed to fetch dynamically imported module: https://x/1.js",
		"Loading chunk 42 failed. (error: https://x/1.js)",
		"ChunkLoadError: Loading chunk 1 failed",
		"Importing a module script failed.",
		"dynamically imported module error",
	])("matches the stale-chunk family: %s", (msg) => {
		expect(isChunkLoadError(new Error(msg))).toBe(true);
	});

	it("does not match unrelated errors", () => {
		expect(isChunkLoadError(new Error("network down"))).toBe(false);
	});

	it("handles non-Error values", () => {
		expect(isChunkLoadError("Loading chunk 9 failed")).toBe(true);
		expect(isChunkLoadError(null)).toBe(false);
		expect(isChunkLoadError(undefined)).toBe(false);
		expect(isChunkLoadError(42)).toBe(false);
	});
});

describe("reloadOnceForStaleChunk", () => {
	let reloadMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		sessionStorage.clear();
		reloadMock = vi.fn();
		vi.stubGlobal("location", { ...window.location, reload: reloadMock });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("reloads and sets the guard the first time", () => {
		expect(reloadOnceForStaleChunk()).toBe(true);
		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe("1");
	});

	it("does not reload a second time in the same session", () => {
		sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
		expect(reloadOnceForStaleChunk()).toBe(false);
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it("still reloads when sessionStorage is unavailable", () => {
		vi.spyOn(sessionStorage, "getItem").mockImplementation(() => {
			throw new Error("storage denied");
		});
		vi.spyOn(sessionStorage, "setItem").mockImplementation(() => {
			throw new Error("storage denied");
		});

		expect(reloadOnceForStaleChunk()).toBe(true);
		expect(reloadMock).toHaveBeenCalledTimes(1);
	});
});

describe("retryLazy", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves immediately when the import succeeds", async () => {
		const Comp = retryLazy(() =>
			Promise.resolve({
				default: () => <div data-testid="loaded">loaded</div>,
			}),
		);

		renderLazy(Comp);
		expect(await screen.findByTestId("loaded")).toBeInTheDocument();
	});

	it("retries with exponential backoff (1s → 2s) and recovers", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const Comp = retryLazy(() => {
			calls++;
			return calls < 3
				? Promise.reject(new Error("transient chunk failure"))
				: Promise.resolve({
						default: () => <div data-testid="loaded">loaded</div>,
					});
		});

		renderLazy(Comp);
		expect(screen.getByTestId("loading")).toBeInTheDocument();
		expect(calls).toBe(1);

		// attempt 2 fires after 1000ms; attempt 3 fires after another 2000ms
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(calls).toBe(3);
		expect(screen.getByTestId("loaded")).toBeInTheDocument();
	});

	it("rethrows the original error when retries are exhausted (non-chunk error)", async () => {
		vi.useFakeTimers();
		const boom = new Error("network down");
		const Comp = retryLazy(() => Promise.reject(boom));

		renderLazy(Comp);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(screen.getByTestId("boundary")).toBeInTheDocument();
	});

	it("stringifies non-Error failures in the retry log and rethrows them", async () => {
		vi.useFakeTimers();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const Comp = retryLazy(() => Promise.reject("plain failure value"));

		renderLazy(Comp);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		// the rethrown value reaches the boundary; the log used String(err)
		expect(screen.getByTestId("boundary")).toBeInTheDocument();
		expect(warnSpy).toHaveBeenCalledTimes(3);
		expect(
			warnSpy.mock.calls.every((c) =>
				c.join(" ").includes("plain failure value"),
			),
		).toBe(true);
		warnSpy.mockRestore();
	});

	it("reloads once and stays pending when a chunk error exhausts retries", async () => {
		vi.useFakeTimers();
		const reloadMock = vi.fn();
		vi.stubGlobal("location", { ...window.location, reload: reloadMock });

		const Comp = retryLazy(() =>
			Promise.reject(new Error("Failed to fetch dynamically imported module")),
		);

		renderLazy(Comp);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe("1");
		// Page is about to unload — component stays pending, no boundary flash
		expect(screen.getByTestId("loading")).toBeInTheDocument();
		expect(screen.queryByTestId("boundary")).not.toBeInTheDocument();

		vi.unstubAllGlobals();
	});

	it("shows the boundary when the reload guard is already used", async () => {
		vi.useFakeTimers();
		const reloadMock = vi.fn();
		vi.stubGlobal("location", { ...window.location, reload: reloadMock });
		sessionStorage.setItem(RELOAD_GUARD_KEY, "1"); // reload already happened

		const Comp = retryLazy(() =>
			Promise.reject(new Error("Loading chunk 7 failed")),
		);

		renderLazy(Comp);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(reloadMock).not.toHaveBeenCalled();
		expect(screen.getByTestId("boundary")).toBeInTheDocument();

		vi.unstubAllGlobals();
	});
});
