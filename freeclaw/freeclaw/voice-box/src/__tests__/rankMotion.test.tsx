// ═══════════════════════════════════════════════════════════════════
// Rank motion — FLIP reorder + the ↑/↓ chip
// ═══════════════════════════════════════════════════════════════════
// A sorted feed reorders on every vote. Locks the three rules that keep
// that from feeling like a glitch:
//   1. A card that changed position is played back from where it used to
//      be (transform translateY, decelerating) — never a teleport.
//   2. A card that did not move is never animated.
//   3. prefers-reduced-motion skips the motion but still reports the rank
//      move, so the chip still says what happened.
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RankDelta from "../components/RankDelta";
import { useFlipList } from "../hooks/useFlipList";

const animate = vi.fn();

// jsdom reports offsetTop 0 for everything and has no Web Animations API.
// Both are stubbed so the hook runs its real measurement/animation branch.
const tops = new Map<string, number>();

function stubLayout() {
	Object.defineProperty(HTMLElement.prototype, "offsetTop", {
		configurable: true,
		get(this: HTMLElement) {
			const id = this.dataset?.flipId;
			if (id) return tops.get(id) ?? 0;
			return 0;
		},
	});
	(
		HTMLElement.prototype as unknown as { animate: typeof animate }
	).animate = animate;
}

function restoreLayout() {
	// Reflect.deleteProperty restores jsdom's own accessors without the
	// optional-property dance that `delete` on a cast would need.
	Reflect.deleteProperty(HTMLElement.prototype, "offsetTop");
	Reflect.deleteProperty(HTMLElement.prototype, "animate");
	tops.clear();
}

function Harness({
	ids,
	onMoved,
}: {
	ids: string[];
	onMoved: (moves: Map<string, number>) => void;
}) {
	const ref = useFlipList({ order: ids, onMoved });
	return (
		<div ref={ref}>
			{ids.map((id) => (
				<div key={id} data-flip-id={id}>
					{id}
				</div>
			))}
		</div>
	);
}

function reducedMotion(matches: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches,
			media: "(prefers-reduced-motion: reduce)",
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
}

beforeEach(() => {
	animate.mockReset();
	stubLayout();
	reducedMotion(false);
});

afterEach(() => {
	restoreLayout();
	vi.unstubAllGlobals();
});

describe("useFlipList", () => {
	it("never animates the first paint", () => {
		tops.set("a", 0);
		tops.set("b", 100);
		const onMoved = vi.fn();
		render(<Harness ids={["a", "b"]} onMoved={onMoved} />);
		expect(animate).not.toHaveBeenCalled();
		expect(onMoved).not.toHaveBeenCalled();
	});

	it("glides a card from its old slot to its new one", () => {
		tops.set("a", 0);
		tops.set("b", 100);
		const onMoved = vi.fn();
		const { rerender } = render(<Harness ids={["a", "b"]} onMoved={onMoved} />);

		// "b" wins the vote: it takes the top slot, "a" drops one place.
		tops.set("b", 0);
		tops.set("a", 100);
		rerender(<Harness ids={["b", "a"]} onMoved={onMoved} />);

		expect(animate).toHaveBeenCalledTimes(2);
		const frames = animate.mock.calls.map(
			(call) =>
				(call[0] as { transform: string }[]).at(0)?.transform ?? "",
		);
		// "b" came from 100px below, "a" dropped 100px.
		expect(frames).toContain("translateY(100px)");
		expect(frames).toContain("translateY(-100px)");

		const moves = onMoved.mock.calls.at(-1)?.[0] as Map<string, number>;
		expect(moves.get("b")).toBe(1);
		expect(moves.get("a")).toBe(-1);
	});

	it("leaves cards that did not move alone", () => {
		tops.set("a", 0);
		tops.set("b", 100);
		tops.set("c", 200);
		const onMoved = vi.fn();
		const { rerender } = render(
			<Harness ids={["a", "b", "c"]} onMoved={onMoved} />,
		);

		// "b" and "c" swap places; "a" keeps the top slot untouched.
		tops.set("a", 0);
		tops.set("c", 100);
		tops.set("b", 200);
		rerender(<Harness ids={["a", "c", "b"]} onMoved={onMoved} />);

		expect(animate).toHaveBeenCalledTimes(2);
		const moves = onMoved.mock.calls.at(-1)?.[0] as Map<string, number>;
		expect(moves.has("a")).toBe(false);
	});

	it("stays quiet when a new card arrives instead of a reorder", () => {
		tops.set("a", 0);
		tops.set("b", 100);
		const onMoved = vi.fn();
		const { rerender } = render(<Harness ids={["a", "b"]} onMoved={onMoved} />);

		// A new post lands on top: every existing card shifts down one slot.
		tops.set("new", 0);
		tops.set("a", 100);
		tops.set("b", 200);
		rerender(<Harness ids={["new", "a", "b"]} onMoved={onMoved} />);

		expect(animate).not.toHaveBeenCalled();
		expect(onMoved).not.toHaveBeenCalled();
	});

	it("skips motion under prefers-reduced-motion but still reports the move", () => {
		reducedMotion(true);
		tops.set("a", 0);
		tops.set("b", 100);
		const onMoved = vi.fn();
		const { rerender } = render(<Harness ids={["a", "b"]} onMoved={onMoved} />);

		tops.set("b", 0);
		tops.set("a", 100);
		rerender(<Harness ids={["b", "a"]} onMoved={onMoved} />);

		expect(animate).not.toHaveBeenCalled();
		const moves = onMoved.mock.calls.at(-1)?.[0] as Map<string, number>;
		expect(moves.get("b")).toBe(1);
	});

	it("survives a browser with no Web Animations API", () => {
		// Simulate an older WebView with no Web Animations API.
		Reflect.deleteProperty(HTMLElement.prototype, "animate");
		tops.set("a", 0);
		tops.set("b", 100);
		const onMoved = vi.fn();
		const { rerender } = render(<Harness ids={["a", "b"]} onMoved={onMoved} />);
		tops.set("b", 0);
		tops.set("a", 100);
		expect(() =>
			rerender(<Harness ids={["b", "a"]} onMoved={onMoved} />),
		).not.toThrow();
	});
});

describe("RankDelta", () => {
	it("says up and down, and renders nothing for a non-move", () => {
		const { rerender } = render(<RankDelta move={2} />);
		expect(screen.getByTestId("rank-delta")).toHaveAttribute(
			"data-direction",
			"up",
		);
		expect(screen.getByTestId("rank-delta")).toHaveTextContent("2");

		rerender(<RankDelta move={-1} />);
		expect(screen.getByTestId("rank-delta")).toHaveAttribute(
			"data-direction",
			"down",
		);

		rerender(<RankDelta move={0} />);
		expect(screen.queryByTestId("rank-delta")).not.toBeInTheDocument();
	});

	it("is decorative — the vote count is the accessible result", () => {
		render(<RankDelta move={3} />);
		expect(screen.getByTestId("rank-delta")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
	});
});
