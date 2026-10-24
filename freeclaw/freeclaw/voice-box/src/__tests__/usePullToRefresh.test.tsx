// ─── usePullToRefresh tests ──────────────────────────────────────
// Locks the mobile pull-to-refresh gesture:
//   1. a full pull from the top commits a refresh
//   2. a short pull does not
//   3. the gesture only arms at the top of the page — scrolling back up
//      through a feed must never fire a refresh (regression: only the
//      handler element's own scrollTop was checked, and it is not the
//      scroller, so the gesture armed anywhere on the page)
//   4. a start that bails must not leave its origin behind for the next
//      gesture to measure against

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePullToRefresh } from "../hooks/usePullToRefresh";

/** Minimal host: the hook only needs an element to attach handlers to. */
function Harness({ onRefresh }: { onRefresh: () => void }) {
	const pull = usePullToRefresh(onRefresh);
	return (
		<div
			data-testid="zone"
			onTouchStart={pull.onTouchStart}
			onTouchMove={pull.onTouchMove}
			onTouchEnd={pull.onTouchEnd}
		>
			<span data-testid="state">
				{pull.refreshing ? "refreshing" : pull.pulling ? "pulling" : "idle"}
			</span>
		</div>
	);
}

const touch = (clientY: number) => ({ touches: [{ clientY }] });

/** jsdom's window.scrollY is a fixed getter — drive it for scroll position. */
function setScrollY(value: number) {
	Object.defineProperty(window, "scrollY", {
		value,
		configurable: true,
		writable: true,
	});
}

describe("usePullToRefresh", () => {
	afterEach(() => {
		setScrollY(0);
		vi.restoreAllMocks();
	});

	it("commits a refresh on a full pull from the top", async () => {
		const onRefresh = vi.fn();
		render(<Harness onRefresh={onRefresh} />);
		const zone = screen.getByTestId("zone");

		fireEvent.touchStart(zone, touch(0));
		fireEvent.touchMove(zone, touch(90));
		expect(screen.getByTestId("state")).toHaveTextContent("pulling");
		fireEvent.touchEnd(zone);

		await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
	});

	it("does not commit on a short pull", () => {
		const onRefresh = vi.fn();
		render(<Harness onRefresh={onRefresh} />);
		const zone = screen.getByTestId("zone");

		fireEvent.touchStart(zone, touch(0));
		fireEvent.touchMove(zone, touch(40)); // resisted travel under threshold
		fireEvent.touchEnd(zone);

		expect(onRefresh).not.toHaveBeenCalled();
		expect(screen.getByTestId("state")).toHaveTextContent("idle");
	});

	// The wrapper the handlers sit on is not the scrolling element — the
	// document scrolls. Measuring only the wrapper's own scrollTop armed the
	// gesture mid-page, so scrolling back up through the feed replaced the
	// list instead of moving the page.
	it("stays disarmed while the page is scrolled, however far the finger drags", () => {
		const onRefresh = vi.fn();
		render(<Harness onRefresh={onRefresh} />);
		const zone = screen.getByTestId("zone");

		// A first gesture at the top, released without committing.
		fireEvent.touchStart(zone, touch(0));
		fireEvent.touchMove(zone, touch(30));
		fireEvent.touchEnd(zone);
		expect(onRefresh).not.toHaveBeenCalled();

		// Now the user is reading the feed and drags downward.
		setScrollY(800);
		fireEvent.touchStart(zone, touch(600));
		fireEvent.touchMove(zone, touch(900));
		expect(screen.getByTestId("state")).toHaveTextContent("idle");
		fireEvent.touchEnd(zone);
		expect(onRefresh).not.toHaveBeenCalled();
	});

	it("stays disarmed when a nested scroller is scrolled", () => {
		const onRefresh = vi.fn();
		render(<Harness onRefresh={onRefresh} />);
		const zone = screen.getByTestId("zone");
		Object.defineProperty(zone, "scrollTop", {
			value: 400,
			configurable: true,
			writable: true,
		});

		fireEvent.touchStart(zone, touch(0));
		fireEvent.touchMove(zone, touch(200));
		fireEvent.touchEnd(zone);

		expect(onRefresh).not.toHaveBeenCalled();
	});

	// A bailed start used to leave startYRef from the previous gesture, so the
	// first move of the next gesture measured a large bogus delta and fired.
	it("does not measure a move whose start was rejected", () => {
		const onRefresh = vi.fn();
		render(<Harness onRefresh={onRefresh} />);
		const zone = screen.getByTestId("zone");

		// Gesture 1: armed at y=300 (page at top), then abandoned.
		fireEvent.touchStart(zone, touch(300));
		fireEvent.touchEnd(zone);

		// Gesture 2 starts while scrolled, so it is rejected — its move must
		// not be measured against gesture 1's origin.
		setScrollY(1200);
		fireEvent.touchStart(zone, touch(300));
		fireEvent.touchMove(zone, touch(380));
		fireEvent.touchEnd(zone);

		expect(onRefresh).not.toHaveBeenCalled();
	});
});
