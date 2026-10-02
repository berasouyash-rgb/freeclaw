// ═══════════════════════════════════════════════════════════════════
// primitives1 — small display primitives contract
// ═══════════════════════════════════════════════════════════════════
// Locks: AILoader (size/className/label), Confetti (fireConfetti canvas
// burst + auto-clean, component fires once), CountUp (ease-out count to
// value with suffix, animates from previous, cancels on unmount), FadeIn
// (vb-rise delay-class mapping), PurgeCountdown (days/hours label, urgent
// state, null when expired, 60s tick), Trend (pct/aria/title, invert,
// prev<=0), Sparkline (empty guard, computed path, color/size),
// TypingIndicator (default/preview/minimal), ThinkingBubble (sizes,
// sublabel, staggered dots).
// ═══════════════════════════════════════════════════════════════════

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AILoader from "../components/AILoader";
import Confetti, { fireConfetti } from "../components/Confetti";
import CountUp from "../components/CountUp";
import {
	LoadingSpinner,
	VB_MOTIVE_MS,
	VB_MOTIVES,
} from "../components/ErrorBoundary";
import FadeIn from "../components/FadeIn";
import PurgeCountdown from "../components/PurgeCountdown";
import ThinkingBubble from "../components/ThinkingBubble";
import Trend, { Sparkline } from "../components/Trend";
import TypingIndicator from "../components/TypingIndicator";

const HOUR = 3600000;
const DAY = 86400000;

// ─── shared rAF / canvas harness ─────────────────────────────────────
// The global setup mocks rAF with an async setTimeout; for frame-driven
// components we install a synchronous, queue-based rAF so ticks can be
// flushed deterministically. The jsdom canvas 2d context is not
// implemented, so fireConfetti needs a stub context.
let frames: FrameRequestCallback[];
let ctxMock: Record<string, ReturnType<typeof vi.fn>>;
const origGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
	frames = [];
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		}),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	ctxMock = {
		clearRect: vi.fn(),
		save: vi.fn(),
		translate: vi.fn(),
		rotate: vi.fn(),
		fillRect: vi.fn(),
		beginPath: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		restore: vi.fn(),
	};
	HTMLCanvasElement.prototype.getContext = vi.fn(
		() => ctxMock,
	) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	HTMLCanvasElement.prototype.getContext = origGetContext;
	// flush any lingering frames and remove leftover canvases
	let guard = 0;
	while (frames.length && guard < 200) {
		const cb = frames.shift();
		cb?.(Date.now());
		guard++;
	}
	document.querySelectorAll("canvas").forEach((c) => c.remove());
});

// ─── AILoader ────────────────────────────────────────────────────────

describe("AILoader", () => {
	it("renders the ring, four blur spans, and core", () => {
		render(<AILoader />);
		expect(document.querySelector(".ai-loader-container")).toBeInTheDocument();
		expect(document.querySelectorAll(".ai-loader-ring span")).toHaveLength(4);
		expect(document.querySelector(".ai-loader-core")).toBeInTheDocument();
	});

	it("applies the size to the container style", () => {
		render(<AILoader size={64} />);
		expect(document.querySelector(".ai-loader-container")).toHaveStyle({
			width: "64px",
			height: "64px",
		});
	});

	it("defaults to 48px when no size is given", () => {
		render(<AILoader />);
		expect(document.querySelector(".ai-loader-container")).toHaveStyle({
			width: "48px",
			height: "48px",
		});
	});

	it("renders the label and custom className when provided", () => {
		const { container } = render(
			<AILoader label="Analyzing…" className="my-loader" />,
		);
		expect(screen.getByText("Analyzing…")).toHaveClass("animate-pulse");
		expect(container.firstElementChild).toHaveClass("my-loader");
	});

	it("omits the label when not provided", () => {
		const { container } = render(<AILoader />);
		expect(
			container.querySelector("span.animate-pulse"),
		).not.toBeInTheDocument();
	});
});

// ─── LoadingSpinner (motive loader) ──────────────────────────────────

describe("LoadingSpinner", () => {
	it("renders brand lockup: ring, halo, wordmark, tagline, and status text", () => {
		render(<LoadingSpinner text="Loading conversation…" motiveOff />);
		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(document.querySelector(".vb-loading-ring")).toBeInTheDocument();
		expect(document.querySelector(".vb-loading-halo")).toBeInTheDocument();
		expect(screen.getByText("Voice Flow")).toBeInTheDocument();
		expect(screen.getByText("Your Voice Matters")).toBeInTheDocument();
		expect(screen.getByText("Loading conversation…")).toBeInTheDocument();
		// motive line is suppressed when opted out
		expect(
			document.querySelector(".vb-loading-motive"),
		).not.toBeInTheDocument();
	});

	it("shows the pinned motive when provided", () => {
		render(<LoadingSpinner motive="Your voice, fully anonymous." />);
		expect(
			screen.getByText("Your voice, fully anonymous."),
		).toBeInTheDocument();
	});

	it("defaults to the first motive and cycles the full story with timers", () => {
		vi.useFakeTimers();
		try {
			render(<LoadingSpinner />);
			expect(screen.getByText("Loading…")).toBeInTheDocument();
			expect(screen.getByText(VB_MOTIVES[0]!)).toBeInTheDocument();

			act(() => {
				vi.advanceTimersByTime(VB_MOTIVE_MS);
			});
			expect(screen.getByText(VB_MOTIVES[1]!)).toBeInTheDocument();

			act(() => {
				vi.advanceTimersByTime(VB_MOTIVE_MS * 4);
			});
			expect(screen.getByText(VB_MOTIVES[0]!)).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders a progress bar that fills exactly over durationMs when provided", () => {
		render(<LoadingSpinner durationMs={5000} />);
		const bar = document.querySelector(".vb-loading-progress") as HTMLElement;
		expect(bar).toBeInTheDocument();
		expect(bar.style.getPropertyValue("--vb-progress-duration")).toBe("5000ms");
	});

	it("omits the progress bar when no durationMs is given", () => {
		render(<LoadingSpinner />);
		expect(
			document.querySelector(".vb-loading-progress"),
		).not.toBeInTheDocument();
	});
});

// ─── Confetti ────────────────────────────────────────────────────────

describe("Confetti", () => {
	it("fireConfetti appends a fixed full-screen canvas and draws particles", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		fireConfetti();
		const canvas = document.querySelector("canvas");
		expect(canvas).toBeInTheDocument();
		expect(canvas!.style.position).toBe("fixed");
		expect(canvas!.style.zIndex).toBe("9998");
		expect(canvas!.width).toBe(window.innerWidth);
		expect(canvas!.height).toBe(window.innerHeight);

		// deterministic random (0.5) → all particles are circles
		let guard = 0;
		while (frames.length && guard < 120) {
			const cb = frames.shift();
			cb?.(Date.now());
			guard++;
		}
		expect(ctxMock.arc).toHaveBeenCalled();
		expect(ctxMock.fillRect).not.toHaveBeenCalled();
		expect(ctxMock.fill).toHaveBeenCalled();
	});

	it("fireConfetti auto-removes the canvas after the burst ends", () => {
		fireConfetti();
		expect(document.querySelector("canvas")).toBeInTheDocument();
		let guard = 0;
		while (frames.length && guard < 120) {
			const cb = frames.shift();
			cb?.(Date.now());
			guard++;
		}
		expect(document.querySelector("canvas")).not.toBeInTheDocument();
	});

	it("component wrapper renders nothing but fires once on mount", () => {
		const { container, rerender } = render(<Confetti />);
		expect(container).toBeEmptyDOMElement();
		expect(document.querySelectorAll("canvas")).toHaveLength(1);
		rerender(<Confetti />);
		expect(document.querySelectorAll("canvas")).toHaveLength(1);
		// drain frames so the canvas cleans up
		let guard = 0;
		while (frames.length && guard < 120) {
			const cb = frames.shift();
			cb?.(Date.now());
			guard++;
		}
	});
});

// ─── CountUp ─────────────────────────────────────────────────────────

describe("CountUp", () => {
	const tick = (nowDelta = 900) => {
		const cb = frames.shift();
		if (cb) act(() => cb(performance.now() + nowDelta));
	};

	it("renders 0 before animating, then reaches the value with suffix", () => {
		render(<CountUp value={1234} suffix="+" />);
		expect(screen.getByText("0+")).toBeInTheDocument();
		tick();
		expect(screen.getByText("1,234+")).toBeInTheDocument();
	});

	it("animates through an eased intermediate value", () => {
		render(<CountUp value={100} />);
		// t = 0.5 → eased = 1 - 0.125 = 0.875 → round(87.5) = 88
		tick(450);
		expect(screen.getByText("88")).toBeInTheDocument();
		tick();
		expect(screen.getByText("100")).toBeInTheDocument();
	});

	it("counts from the previous value when value changes", () => {
		const { rerender } = render(<CountUp value={100} />);
		tick();
		expect(screen.getByText("100")).toBeInTheDocument();
		rerender(<CountUp value={200} />);
		tick();
		expect(screen.getByText("200")).toBeInTheDocument();
	});

	it("cancels a pending frame on unmount", () => {
		const { unmount } = render(<CountUp value={50} />);
		unmount();
		expect(cancelAnimationFrame).toHaveBeenCalled();
	});
});

// ─── FadeIn ──────────────────────────────────────────────────────────

describe("FadeIn", () => {
	it("renders children in a vb-rise wrapper", () => {
		const { container } = render(<FadeIn>Hello</FadeIn>);
		expect(screen.getByText("Hello")).toBeInTheDocument();
		expect(container.querySelector(".vb-rise")).toBeInTheDocument();
	});

	it.each([
		[0, ""],
		[0.05, " vb-rise-delay-1"],
		[0.1, " vb-rise-delay-1"],
		[0.15, " vb-rise-delay-2"],
		[0.25, " vb-rise-delay-3"],
		[0.35, " vb-rise-delay-4"],
		[0.41, " vb-rise-delay-5"],
	])("maps delay %s to class %s", (delay, expected) => {
		const { container } = render(<FadeIn delay={delay as number}>x</FadeIn>);
		const el = container.querySelector(".vb-rise");
		expect(el!.className).toBe(`vb-rise${expected} `);
	});

	it("appends a custom className", () => {
		const { container } = render(<FadeIn className="my-fade">x</FadeIn>);
		expect(container.querySelector(".vb-rise")).toHaveClass("my-fade");
	});
});

// ─── PurgeCountdown ──────────────────────────────────────────────────

describe("PurgeCountdown", () => {
	it("renders days and hours for a far-future purge", () => {
		const purgeAt = new Date(
			Date.now() + 2 * DAY + 3 * HOUR + 5 * 60000,
		).toISOString();
		const { container } = render(<PurgeCountdown purgeAt={purgeAt} />);
		const chip = screen.getByText(/auto-deletes in/);
		expect(chip).toHaveTextContent("auto-deletes in 2d 3h");
		expect(chip).toHaveAttribute("title", expect.stringContaining("5 days"));
		expect(container.querySelector(".vb-trend-bounce")).not.toBeInTheDocument();
		expect(chip).not.toHaveStyle({ color: "#dc4b4b" });
	});

	it("renders hours-only label with urgent styling under 24h", () => {
		const purgeAt = new Date(Date.now() + 5 * HOUR + 2 * 60000).toISOString();
		const { container } = render(<PurgeCountdown purgeAt={purgeAt} />);
		const chip = screen.getByText(/auto-deletes in/);
		expect(chip).toHaveTextContent("auto-deletes in 5h");
		expect(chip).toHaveStyle({ color: "#dc4b4b" });
		expect(container.querySelector(".vb-trend-bounce")).toBeInTheDocument();
	});

	it("returns null once the purge time has passed", () => {
		const { container } = render(
			<PurgeCountdown purgeAt={new Date(Date.now() - 1000).toISOString()} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("ticks with the clock and clears its interval on unmount", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
		const { unmount } = render(
			<PurgeCountdown purgeAt="2025-01-01T01:30:00Z" />,
		);
		expect(screen.getByText(/auto-deletes in 1h/)).toBeInTheDocument();

		act(() => vi.advanceTimersByTime(40 * 60000));
		expect(screen.getByText(/auto-deletes in 0h/)).toBeInTheDocument();

		unmount();
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});
});

// ─── Trend ───────────────────────────────────────────────────────────

describe("Trend", () => {
	it("renders an up trend with pct, arrow, and aria label", () => {
		const { container } = render(<Trend current={120} previous={100} />);
		expect(screen.getByText("20%")).toBeInTheDocument();
		expect(screen.getByLabelText("Trend up 20 percent")).toBeInTheDocument();
		expect(container.querySelector("svg.lucide-arrow-up")).toBeInTheDocument();
		expect(screen.getByText("20%").closest("span")).toHaveAttribute(
			"title",
			"vs previous period: +20",
		);
	});

	it("renders a down trend", () => {
		const { container } = render(<Trend current={50} previous={100} />);
		expect(screen.getByText("50%")).toBeInTheDocument();
		expect(screen.getByLabelText("Trend down 50 percent")).toBeInTheDocument();
		expect(
			container.querySelector("svg.lucide-arrow-down"),
		).toBeInTheDocument();
	});

	it("renders a flat trend with the Minus icon", () => {
		const { container } = render(<Trend current={100} previous={100} />);
		expect(screen.getByText("0%")).toBeInTheDocument();
		expect(screen.getByLabelText("Trend flat 0 percent")).toBeInTheDocument();
		expect(container.querySelector("svg.lucide-minus")).toBeInTheDocument();
	});

	it("uses the label prop as the tooltip title", () => {
		render(<Trend current={10} previous={5} label="Cafeteria complaints" />);
		expect(screen.getByText("100%").closest("span")).toHaveAttribute(
			"title",
			"Cafeteria complaints",
		);
	});

	it("treats a down trend as good when inverted", () => {
		const { container } = render(<Trend current={50} previous={100} invert />);
		const chip = screen.getByLabelText("Trend down 50 percent");
		expect(chip).toHaveClass("bg-good/12", "text-good");
		expect(
			container.querySelector("svg.lucide-arrow-down"),
		).toBeInTheDocument();
	});

	it("handles previous <= 0 with the honest absolute delta, not a fake percent", () => {
		// A percent change from a zero base is undefined (infinite), so the
		// badge must NOT render "100%" — it shows the real absolute delta and
		// the accessible name omits the misleading percentage.
		render(<Trend current={42} previous={0} />);
		expect(screen.getByText("+42")).toBeInTheDocument();
		expect(screen.getByLabelText("Trend up")).toBeInTheDocument();
	});

	it("shows a flat badge when both values are zero", () => {
		render(<Trend current={0} previous={0} />);
		expect(screen.getByText("0%")).toBeInTheDocument();
		expect(screen.getByLabelText("Trend flat 0 percent")).toBeInTheDocument();
	});
});

// ─── Sparkline ───────────────────────────────────────────────────────

describe("Sparkline", () => {
	it("returns null for empty data", () => {
		const { container } = render(<Sparkline data={[]} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders a path matching the computed points", () => {
		const { container } = render(<Sparkline data={[1, 2, 3]} />);
		const svg = container.querySelector("svg");
		expect(svg).toBeInTheDocument();
		expect(svg).toHaveAttribute("aria-hidden", "true");
		expect(svg).toHaveAttribute("width", "96");
		expect(svg).toHaveAttribute("height", "28");
		const paths = container.querySelectorAll("svg path");
		expect(paths).toHaveLength(2);
		expect(paths[1]).toHaveAttribute("d", "M0.0,17.7 L48.0,10.3 L96.0,3.0");
		expect(paths[0]).toHaveAttribute(
			"d",
			"M0.0,17.7 L48.0,10.3 L96.0,3.0 L96,28 L0,28 Z",
		);
	});

	it("applies custom color, width, and height", () => {
		const { container } = render(
			<Sparkline data={[5, 1]} color="#ff0000" width={120} height={40} />,
		);
		const paths = container.querySelectorAll("svg path");
		expect(paths[1]).toHaveAttribute("stroke", "#ff0000");
		expect(paths[0]).toHaveAttribute("fill", "#ff0000");
		expect(container.querySelector("svg")).toHaveAttribute("width", "120");
	});

	it("renders a highlight circle on the last point", () => {
		const { container } = render(<Sparkline data={[1, 2, 3]} />);
		const circle = container.querySelector("circle");
		expect(circle).toBeInTheDocument();
		expect(circle).toHaveAttribute("r", "2.5");
		expect(circle).toHaveAttribute("cx", "96.0");
		expect(circle).toHaveAttribute("cy", "3.0");
	});
});

// ─── TypingIndicator ─────────────────────────────────────────────────

describe("TypingIndicator", () => {
	it("default variant shows the AI header, label, and three dots", () => {
		const { container } = render(<TypingIndicator />);
		expect(screen.getByText("AI Assistant")).toBeInTheDocument();
		expect(screen.getByText("AI is thinking...")).toBeInTheDocument();
		// three visual dots (the ping halo is an overlay on the first dot)
		expect(
			container.querySelectorAll(".typing-dot:not(.animate-ping)"),
		).toHaveLength(3);
		expect(container.querySelector("svg.lucide-bot")).toBeInTheDocument();
	});

	it("preview variant shows label and dots without the header", () => {
		const { container } = render(
			<TypingIndicator variant="preview" label="Drafting…" />,
		);
		expect(screen.getByText("Drafting…")).toBeInTheDocument();
		expect(screen.queryByText("AI Assistant")).not.toBeInTheDocument();
		expect(container.querySelector(".inline-flex")).toBeInTheDocument();
		expect(container.querySelectorAll(".typing-dot")).toHaveLength(3);
	});

	it("minimal variant renders only dots and no label", () => {
		const { container } = render(<TypingIndicator variant="minimal" />);
		expect(container.querySelectorAll(".typing-dot")).toHaveLength(3);
		expect(screen.queryByText("AI is thinking...")).not.toBeInTheDocument();
		expect(screen.queryByText("AI Assistant")).not.toBeInTheDocument();
	});

	it("passes through a custom className", () => {
		const { container } = render(<TypingIndicator className="my-typing" />);
		expect(container.firstElementChild).toHaveClass("my-typing");
	});

	it("announces itself as a live status region in every variant", () => {
		for (const variant of ["default", "preview", "minimal"] as const) {
			const { unmount } = render(
				<TypingIndicator variant={variant} label="Working…" />,
			);
			// role=status carries implicit aria-live=polite — screen readers
			// announce "AI is responding" state changes in every chat surface.
			expect(screen.getByRole("status")).toBeInTheDocument();
			unmount();
		}
	});
});

// ─── ThinkingBubble ──────────────────────────────────────────────────

describe("ThinkingBubble", () => {
	it("renders the default label and three staggered pulse dots", () => {
		const { container } = render(<ThinkingBubble />);
		expect(screen.getByText("Analyzing")).toBeInTheDocument();
		const dots = container.querySelectorAll(".thinking-pulse-dot");
		expect(dots).toHaveLength(3);
		expect(dots[0]).toHaveStyle({ animationDelay: "0s" });
		expect(dots[1]).toHaveStyle({ animationDelay: "0.3s" });
		expect(dots[2]).toHaveStyle({ animationDelay: "0.6s" });
		expect(container.querySelector("svg.lucide-sparkles")).toBeInTheDocument();
	});

	it("renders the sublabel when provided", () => {
		render(<ThinkingBubble sublabel="Reviewing 3 reports…" />);
		expect(screen.getByText("Reviewing 3 reports…")).toBeInTheDocument();
	});

	it("omits the sublabel when not provided", () => {
		render(<ThinkingBubble />);
		expect(screen.queryByText(/Reviewing/)).not.toBeInTheDocument();
	});

	it("applies size-based dot and label classes", () => {
		const { container } = render(
			<ThinkingBubble size="lg" label="Synthesizing" />,
		);
		const dots = container.querySelectorAll(".thinking-pulse-dot");
		expect(dots[0]).toHaveClass("w-2.5", "h-2.5");
		expect(screen.getByText("Synthesizing")).toHaveClass("text-xs");
	});
});
