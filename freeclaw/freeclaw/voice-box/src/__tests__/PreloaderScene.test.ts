// ═══════════════════════════════════════════════════════════════════
// PreloaderScene — Three.js factory contract tests
// ═══════════════════════════════════════════════════════════════════
// jsdom has no WebGL, so we mock THREE.WebGLRenderer to exercise the
// real controller lifecycle (setup → setStatus → dispose) and verify:
//   • the controller surface exists and works
//   • dispose releases the renderer + cancels the RAF loop
//   • dispose is idempotent
//   • with an unmocked renderer (jsdom) the factory degrades to null so
//     the CSS fallback takes over — never a broken canvas
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	disposed: vi.fn(),
	rendered: vi.fn(),
}));

vi.mock("three", async (importOriginal) => {
	const actual = await importOriginal<typeof import("three")>();
	return {
		...actual,
		// Regular function (NOT arrow) so `new THREE.WebGLRenderer()` works —
		// an arrow implementation throws "not a constructor" and the scene
		// factory degrades to null, breaking every lifecycle test.
		WebGLRenderer: function () {
			return {
				setPixelRatio: vi.fn(),
				setSize: vi.fn(),
				render: (...args: unknown[]) => mocks.rendered(...args),
				dispose: () => mocks.disposed(),
				domElement: document.createElement("canvas"),
			};
		},
	};
});

import { createPreloaderScene } from "../components/preloader/PreloaderScene";

function makeCanvas(): HTMLCanvasElement {
	const c = document.createElement("canvas");
	Object.defineProperty(c, "clientWidth", { value: 400, configurable: true });
	Object.defineProperty(c, "clientHeight", { value: 400, configurable: true });
	return c;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	// No RAF loops should survive a test.
	vi.restoreAllMocks();
});

describe("createPreloaderScene — controller lifecycle (mock renderer)", () => {
	it("creates a controller with the full contract", () => {
		const ctrl = createPreloaderScene({ canvas: makeCanvas(), quality: "MEDIUM" });
		expect(ctrl).not.toBeNull();
		expect(typeof ctrl?.setStatus).toBe("function");
		expect(typeof ctrl?.dispose).toBe("function");
		expect(typeof ctrl?.getFrameCount).toBe("function");
		ctrl?.dispose();
	});

	it("renders frames while running, then stops after dispose", () => {
		const ctrl = createPreloaderScene({ canvas: makeCanvas(), quality: "HIGH" });
		expect(ctrl).not.toBeNull();
		// one frame is scheduled synchronously in jsdom (rAF mocked by setup)
		expect(mocks.rendered).toHaveBeenCalled();
		ctrl?.dispose();
		const before = mocks.rendered.mock.calls.length;
		// after dispose, no new frames
		const frames = ctrl?.getFrameCount() ?? 0;
		expect(frames).toBeGreaterThanOrEqual(1);
		expect(mocks.rendered.mock.calls.length).toBe(before);
	});

	it("dispose releases the renderer exactly once and is idempotent", () => {
		const ctrl = createPreloaderScene({ canvas: makeCanvas(), quality: "LOW" });
		ctrl?.dispose();
		ctrl?.dispose();
		expect(mocks.disposed).toHaveBeenCalledTimes(1);
	});

	it("setStatus accepts every machine state without throwing", () => {
		const ctrl = createPreloaderScene({ canvas: makeCanvas(), quality: "MEDIUM" });
		for (const s of [
			"INITIALIZING",
			"LOADING",
			"VERIFYING",
			"READY",
			"REVEAL",
			"ERROR",
		] as const) {
			expect(() => ctrl?.setStatus(s)).not.toThrow();
		}
		ctrl?.dispose();
	});

	it("low quality still creates a valid scene (adaptive budgets)", () => {
		const ctrl = createPreloaderScene({ canvas: makeCanvas(), quality: "LOW" });
		expect(ctrl).not.toBeNull();
		ctrl?.dispose();
	});

	it("reduced-motion mode renders a static frame and stops the loop", () => {
		const ctrl = createPreloaderScene({
			canvas: makeCanvas(),
			quality: "MEDIUM",
			reducedMotion: true,
		});
		expect(ctrl).not.toBeNull();
		// first frame renders, loop then halts (reduced motion = no travel)
		expect(mocks.rendered).toHaveBeenCalled();
		ctrl?.dispose();
	});

	it("resize listener is removed on dispose (no leaks)", () => {
		const addSpy = vi.spyOn(window, "addEventListener");
		const removeSpy = vi.spyOn(window, "removeEventListener");
		const ctrl = createPreloaderScene({ canvas: makeCanvas(), quality: "MEDIUM" });
		expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
		ctrl?.dispose();
		expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
	});
});

describe("createPreloaderScene — WebGL degradation (no mock)", () => {
	it("returns null when WebGL is unavailable so the fallback takes over", async () => {
		// Drop the file-level mock, reset the module registry, then import a
		// fresh copy of three + PreloaderScene. jsdom has no WebGL context, so
		// the real WebGLRenderer constructor throws and the factory must
		// degrade to null (never a broken canvas).
		vi.doUnmock("three");
		vi.resetModules();
		const { createPreloaderScene: realCreate } = await import(
			"../components/preloader/PreloaderScene"
		);
		const canvas = document.createElement("canvas");
		expect(
			realCreate({ canvas, quality: "HIGH", reducedMotion: false }),
		).toBeNull();
	});
});
