// ═══════════════════════════════════════════════════════════════════
// ErrorBoundary — crash reporting contract
// ═══════════════════════════════════════════════════════════════════
// A React error boundary consumes the error: window.onerror never fires
// for it, and the component tree stops rendering, so the only way a
// render crash reaches /api/client-error is if the boundary forwards it
// to reportBoundaryError. That helper existed but nothing ever called it
// — 17 ErrorBoundary instances were deployed with no onError prop — so
// production crashes only landed in the developer console.

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "../components/ErrorBoundary";

const mocks = vi.hoisted(() => ({
	reportBoundaryError: vi.fn(),
}));

vi.mock("../lib/errors", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/errors")>();
	return {
		...actual,
		reportBoundaryError: mocks.reportBoundaryError,
	};
});

// The return type must be stated: a body that only throws infers `never`,
// which tsc refuses as a JSX element type (TS2786).
function ThrowingChild(): ReactNode {
	throw new Error("render exploded");
}

function ThrowingValueChild(): ReactNode {
	// React lets any value be thrown; the buffer must still get a message.
	const boom: unknown = "bare string boom";
	throw boom;
}

describe("ErrorBoundary — crash reporting", () => {
	beforeEach(() => {
		mocks.reportBoundaryError.mockClear();
		// React logs every caught error; keep the suite output readable.
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forwards a caught render error to the error buffer", () => {
		render(
			<ErrorBoundary>
				<ThrowingChild />
			</ErrorBoundary>,
		);

		expect(mocks.reportBoundaryError).toHaveBeenCalledTimes(1);
		const [error, componentStack] = mocks.reportBoundaryError.mock.calls[0] ??
			[];
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe("render exploded");
		expect(typeof componentStack).toBe("string");
		expect(componentStack.length).toBeGreaterThan(0);
	});

	it("normalises a non-Error throw so the buffer still gets a message", () => {
		render(
			<ErrorBoundary>
				<ThrowingValueChild />
			</ErrorBoundary>,
		);

		expect(mocks.reportBoundaryError).toHaveBeenCalledTimes(1);
		const [error] = mocks.reportBoundaryError.mock.calls[0] ?? [];
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain("bare string boom");
	});

	it("reports alongside the optional onError callback, not instead of it", () => {
		const onError = vi.fn();
		render(
			<ErrorBoundary onError={onError}>
				<ThrowingChild />
			</ErrorBoundary>,
		);

		expect(onError).toHaveBeenCalledTimes(1);
		expect(mocks.reportBoundaryError).toHaveBeenCalledTimes(1);
	});
});
