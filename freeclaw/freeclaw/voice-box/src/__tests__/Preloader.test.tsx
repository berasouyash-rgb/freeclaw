// ═══════════════════════════════════════════════════════════════════
// Preloader — overlay component tests
// ═══════════════════════════════════════════════════════════════════
// In jsdom WebGL is unavailable, so the Three.js scene degrades to the
// CSS fallback — which is exactly the graceful-degradation contract.
// Locks:
//   • overlay renders with brand, status, progress track
//   • the fallback (not a broken canvas) appears without WebGL
//   • status label updates with machine state
//   • ERROR surfaces Retry / Continue actions that work
//   • READY → onFinish fires (reveal), overlay cleans up
//   • reduced-motion users get an instant, still reveal
//   • a single aria-live region narrates state
// ═══════════════════════════════════════════════════════════════════

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Preloader from "../components/preloader/Preloader";

// Deterministic scene contract: jsdom has no WebGL, and the real module is
// dynamically imported (code-split), so we mock it to return null — which is
// exactly the graceful-degradation path the overlay must handle. No timing
// dependence on jsdom's GL errors or chunk-resolution microtasks.
const sceneMocks = vi.hoisted(() => ({
	createPreloaderScene: vi.fn().mockReturnValue(null),
}));
vi.mock("../components/preloader/PreloaderScene", () => ({
	createPreloaderScene: sceneMocks.createPreloaderScene,
}));

const defaultMatchMedia = window.matchMedia;

function mockMatchMedia(overrides?: Partial<{ reduce: boolean; coarse: boolean }>) {
	const { reduce = false, coarse = false } = overrides || {};
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches:
			(query === "(prefers-reduced-motion: reduce)" && reduce) ||
			(query === "(pointer: coarse)" && coarse),
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})) as unknown as typeof window.matchMedia;
}

const fontsReady = { ready: Promise.resolve() };

/** Flush microtasks so the effect-driven flags (shell/fonts/data) settle. */
async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	mockMatchMedia({});
	Object.defineProperty(document, "fonts", { value: fontsReady, configurable: true });
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: async () => ({}),
	}) as unknown as typeof fetch;
});

afterEach(() => {
	window.matchMedia = defaultMatchMedia;
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("overlay render", () => {
	it("renders the brand mark and Voice Box name", () => {
		render(<Preloader />);
		expect(screen.getByText("Voice Box")).toBeInTheDocument();
		expect(screen.getByTestId("vpl-overlay")).toBeInTheDocument();
	});

	it("renders the CSS fallback (not a broken canvas) without WebGL", async () => {
		render(<Preloader />);
		await flush();
		// scene factory returns null → fallback path, never a broken canvas
		expect(screen.getByTestId("vpl-fallback")).toBeInTheDocument();
		expect(screen.queryByTestId("vpl-canvas")).not.toBeInTheDocument();
	});

	it("announces status via exactly one aria-live region", () => {
		render(<Preloader />);
		const live = screen.getAllByRole("status");
		expect(live.length).toBe(1);
	});

	it("shows a thin progress track with a bar", () => {
		render(<Preloader />);
		expect(document.querySelector(".vpl-track")).not.toBeNull();
		expect(document.querySelector(".vpl-bar")).not.toBeNull();
	});

	it("locks body scroll while mounted and releases on unmount", () => {
		const { unmount } = render(<Preloader />);
		expect(document.body.classList.contains("vpl-lock")).toBe(true);
		unmount();
		expect(document.body.classList.contains("vpl-lock")).toBe(false);
	});

	it("does not render debug diagnostics by default", () => {
		render(<Preloader />);
		expect(screen.queryByTestId("vpl-debug")).not.toBeInTheDocument();
	});

	it("renders debug diagnostics when debug is enabled", () => {
		render(<Preloader debug />);
		expect(screen.getByTestId("vpl-debug")).toBeInTheDocument();
	});
});

describe("readiness → reveal", () => {
	it("fires onFinish once the real readiness lands (READY)", async () => {
		const onFinish = vi.fn();
		render(<Preloader onFinish={onFinish} />);
		// shell + fonts + data all resolve
		await flush();
		// all three scenes play (3 × 700ms floor) → READY commits mid-advance
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		// the reveal effect schedules its timers on that commit — advance again
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		expect(onFinish).toHaveBeenCalled();
	});

	it("stays up (no onFinish) while critical data is pending", async () => {
		const onFinish = vi.fn();
		let resolveProbe!: (v: unknown) => void;
		global.fetch = vi.fn(
			() =>
				new Promise((res) => {
					resolveProbe = res;
				}) as unknown as Promise<Response>,
		) as unknown as typeof fetch;
		render(<Preloader onFinish={onFinish} />);
		await flush();
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});
		expect(onFinish).not.toHaveBeenCalled();

		await act(async () => {
			resolveProbe({ ok: true, json: async () => ({}) });
			await Promise.resolve();
			vi.advanceTimersByTime(1500);
		});
		// READY committed → reveal timers scheduled → advance again
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		expect(onFinish).toHaveBeenCalled();
	});

	it("status label tracks the machine state (reaches Ready)", async () => {
		render(<Preloader />);
		await flush();
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		expect(screen.getByTestId("vpl-status").textContent).toBe("Ready");
	});
});

describe("error state", () => {
	it("surfaces Retry and Continue when the watchdog trips", async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
		render(<Preloader />);
		await flush();
		await act(async () => {
			vi.advanceTimersByTime(9000);
		});
		expect(screen.getByTestId("vpl-error")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
	});

	it("Continue proceeds into READY and reveals the app", async () => {
		const onFinish = vi.fn();
		global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
		render(<Preloader onFinish={onFinish} />);
		await flush();
		await act(async () => {
			vi.advanceTimersByTime(9000);
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		expect(onFinish).toHaveBeenCalled();
	});

	it("Retry re-runs the data probe", async () => {
		let calls = 0;
		global.fetch = vi.fn().mockImplementation(() => {
			calls++;
			if (calls === 1) return Promise.reject(new Error("down"));
			return Promise.resolve({ ok: true, json: async () => ({}) });
		}) as unknown as typeof fetch;
		render(<Preloader />);
		await flush();
		await act(async () => {
			vi.advanceTimersByTime(9000);
		});
		expect(screen.getByTestId("vpl-error")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			vi.advanceTimersByTime(1500);
		});
		expect(calls).toBeGreaterThanOrEqual(2);
		expect(screen.queryByTestId("vpl-error")).not.toBeInTheDocument();
	});
});

describe("reduced motion", () => {
	it("marks the overlay and reveals instantly (no motion)", async () => {
		mockMatchMedia({ reduce: true });
		const onFinish = vi.fn();
		render(<Preloader onFinish={onFinish} />);
		await flush();
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		// reduced-motion reveal is a single short timeout on the READY commit
		await act(async () => {
			vi.advanceTimersByTime(300);
		});
		expect(screen.getByTestId("vpl-overlay").dataset.reducedMotion).toBe("true");
		expect(onFinish).toHaveBeenCalled();
	});
});
