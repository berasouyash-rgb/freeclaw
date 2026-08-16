// ═══════════════════════════════════════════════════════════════════
// primitives2 — interactive display primitives contract
// ═══════════════════════════════════════════════════════════════════
// Locks: PremiumCard (variants glass/bordered/default, hoverable glow,
// click, glowColor), GradientButton (variants/sizes, disabled & busy
// states, shimmer overlay, icon vs spinner), WordCloud (stop-word
// filtering, freq>=2, top-28, empty state, click-to-filter toggling),
// RecapCard (7-day window, solved-via-status_history, top category,
// most-supported, pluralization, null when empty).
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GradientButton from "../components/GradientButton";
import PremiumCard from "../components/PremiumCard";
import RecapCard from "../components/RecapCard";
import WordCloud from "../components/WordCloud";
import type { PostData, StatusHistoryEntry } from "../types";

const DAY = 86400000;

function mkPost(over: Partial<PostData> = {}): PostData {
	return {
		id: `p${Math.random().toString(36).slice(2)}`,
		type: "suggestion",
		title: "",
		description: "",
		category: "Facilities",
		status: "reported",
		priority: "medium",
		author_id: "anon_test",
		created_at: new Date().toISOString(),
		...over,
	};
}

// ─── PremiumCard ─────────────────────────────────────────────────────

describe("PremiumCard", () => {
	it("renders children inside the z-10 content layer", () => {
		const { container } = render(<PremiumCard>Card body</PremiumCard>);
		expect(screen.getByText("Card body")).toBeInTheDocument();
		expect(container.querySelector(".relative.z-10")).toContainElement(
			screen.getByText("Card body"),
		);
	});

	it("uses the default variant styles", () => {
		const { container } = render(<PremiumCard>body</PremiumCard>);
		const card = container.firstElementChild;
		expect(card).toHaveClass("bg-surface", "border-border", "premium-card");
	});

	it("uses glass variant styles", () => {
		const { container } = render(
			<PremiumCard variant="glass">body</PremiumCard>,
		);
		expect(container.firstElementChild).toHaveClass(
			"backdrop-blur-xl",
			"bg-surface/80",
		);
	});

	it("uses bordered variant styles", () => {
		const { container } = render(
			<PremiumCard variant="bordered">body</PremiumCard>,
		);
		expect(container.firstElementChild).toHaveClass(
			"bg-transparent",
			"border-2",
			"border-accent/20",
		);
	});

	it("renders the glow layer when hoverable (default)", () => {
		const { container } = render(<PremiumCard>body</PremiumCard>);
		expect(container.querySelector(".premium-card-glow")).toBeInTheDocument();
		expect(container.firstElementChild).toHaveClass(
			"hover:shadow-lg",
			"cursor-pointer",
		);
	});

	it("skips the glow layer and hover lift when hoverable is false", () => {
		const { container } = render(
			<PremiumCard hoverable={false}>body</PremiumCard>,
		);
		expect(
			container.querySelector(".premium-card-glow"),
		).not.toBeInTheDocument();
		expect(container.firstElementChild).not.toHaveClass("hover:shadow-lg");
	});

	it("fires onClick when the card is clicked", async () => {
		const onClick = vi.fn();
		const user = userEvent.setup();
		render(<PremiumCard onClick={onClick}>body</PremiumCard>);
		await user.click(screen.getByText("body"));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("sets the --glow-color custom property when glowColor is provided", () => {
		const { container } = render(
			<PremiumCard glowColor="#ff0000">body</PremiumCard>,
		);
		expect(container.firstElementChild).toHaveStyle({
			"--glow-color": "#ff0000",
		});
	});

	it("appends a custom className", () => {
		const { container } = render(
			<PremiumCard className="my-card">body</PremiumCard>,
		);
		expect(container.firstElementChild).toHaveClass("my-card");
	});
});

// ─── GradientButton ──────────────────────────────────────────────────

describe("GradientButton", () => {
	it("renders children and defaults to type button", () => {
		const { container } = render(<GradientButton>Save</GradientButton>);
		const btn = container.querySelector("button");
		expect(btn).toHaveAttribute("type", "button");
		expect(screen.getByText("Save")).toBeInTheDocument();
	});

	it("honors an explicit type", () => {
		const { container } = render(
			<GradientButton type="submit">Go</GradientButton>,
		);
		expect(container.querySelector("button")).toHaveAttribute("type", "submit");
	});

	it("fires onClick", async () => {
		const onClick = vi.fn();
		const user = userEvent.setup();
		render(<GradientButton onClick={onClick}>Go</GradientButton>);
		await user.click(screen.getByText("Go"));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("disables and styles the button when disabled", () => {
		const { container } = render(<GradientButton disabled>Go</GradientButton>);
		const btn = container.querySelector("button");
		expect(btn).toBeDisabled();
		expect(btn).toHaveClass("opacity-50", "cursor-not-allowed");
		expect(btn).not.toHaveClass("active:scale-[0.97]");
		expect(
			container.querySelector(".gradient-btn-shimmer"),
		).not.toBeInTheDocument();
	});

	it("treats busy as disabled and swaps the icon for a spinner", () => {
		const { container } = render(
			<GradientButton busy icon={<span>my-icon</span>}>
				Saving…
			</GradientButton>,
		);
		const btn = container.querySelector("button");
		expect(btn).toBeDisabled();
		expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
		expect(screen.queryByText("my-icon")).not.toBeInTheDocument();
	});

	it("renders the icon when present and not busy", () => {
		render(<GradientButton icon={<span>my-icon</span>}>Go</GradientButton>);
		expect(screen.getByText("my-icon")).toBeInTheDocument();
		expect(document.querySelector("svg.animate-spin")).not.toBeInTheDocument();
	});

	it("renders the shimmer overlay only for an enabled primary button", () => {
		const { container, rerender } = render(
			<GradientButton variant="primary">Go</GradientButton>,
		);
		expect(
			container.querySelector(".gradient-btn-shimmer"),
		).toBeInTheDocument();
		rerender(
			<GradientButton variant="primary" disabled>
				Go
			</GradientButton>,
		);
		expect(
			container.querySelector(".gradient-btn-shimmer"),
		).not.toBeInTheDocument();
	});

	it("applies variant classes", () => {
		const { container, rerender } = render(
			<GradientButton variant="secondary">Go</GradientButton>,
		);
		expect(container.querySelector("button")).toHaveClass("border-border");
		rerender(<GradientButton variant="danger">Go</GradientButton>);
		expect(container.querySelector("button")).toHaveClass(
			"bg-bad/10",
			"text-bad",
		);
		rerender(<GradientButton variant="ghost">Go</GradientButton>);
		expect(container.querySelector("button")).toHaveClass("bg-transparent");
	});

	it("applies size classes", () => {
		const { container, rerender } = render(
			<GradientButton size="sm">Go</GradientButton>,
		);
		expect(container.querySelector("button")).toHaveClass("px-4", "py-2");
		rerender(<GradientButton size="lg">Go</GradientButton>);
		expect(container.querySelector("button")).toHaveClass("px-8", "py-4");
	});

	it("appends a custom className", () => {
		const { container } = render(
			<GradientButton className="my-btn">Go</GradientButton>,
		);
		expect(container.querySelector("button")).toHaveClass("my-btn");
	});
});

// ─── WordCloud ───────────────────────────────────────────────────────

describe("WordCloud", () => {
	const twoPosts = () => [
		mkPost({
			title: "Bathroom door broken",
			description: "the door handle keeps breaking",
			tags: ["bathroom"],
		}),
		mkPost({
			title: "Bathroom lights flicker",
			description: "the lights need fixing",
			tags: ["bathroom"],
		}),
	];

	it("shows the empty state when there are no qualifying words", () => {
		render(<WordCloud posts={[]} />);
		expect(
			screen.getByText("Not enough posts yet to detect themes."),
		).toBeInTheDocument();
	});

	it("ignores stop words and single-occurrence words", () => {
		render(
			<WordCloud
				posts={[
					mkPost({ title: "the and for", description: "this that with has" }),
				]}
			/>,
		);
		expect(
			screen.getByText("Not enough posts yet to detect themes."),
		).toBeInTheDocument();
	});

	it("lists words by frequency and renders them as listitems", () => {
		render(<WordCloud posts={twoPosts()} />);
		const list = screen.getByRole("list", { name: "Common themes" });
		expect(list).toBeInTheDocument();
		const items = screen.getAllByRole("listitem");
		// bathroom (4), door (2), lights (2) — singles filtered out
		expect(items).toHaveLength(3);
		expect(screen.getByText("bathroom")).toBeInTheDocument();
		expect(screen.getByText("door")).toBeInTheDocument();
		expect(screen.getByText("lights")).toBeInTheDocument();
		// scale: 0.72 + (n/max) * 1.1 — bathroom is the most frequent
		expect(screen.getByText("bathroom")).toHaveStyle({ fontSize: "1.82rem" });
		expect(screen.getByText("door")).toHaveStyle({ fontSize: "1.27rem" });
		expect(screen.getByText("door")).toHaveAttribute(
			"title",
			expect.stringContaining("appears in 2 posts"),
		);
	});

	it("toggles the active word and reports clicks", async () => {
		const onWordClick = vi.fn();
		const user = userEvent.setup();
		render(<WordCloud posts={twoPosts()} onWordClick={onWordClick} />);

		await user.click(screen.getByText("door"));
		expect(onWordClick).toHaveBeenLastCalledWith("door");
		expect(screen.getByText("door")).toHaveClass("underline");
		expect(screen.getByText("door")).toHaveStyle({ color: "var(--vb-accent)" });

		await user.click(screen.getByText("door"));
		expect(onWordClick).toHaveBeenLastCalledWith("");
		expect(screen.getByText("door")).not.toHaveClass("underline");
	});

	it("limits the cloud to the top 28 words", () => {
		// 40 posts × "theme theme <unique4>" — theme (80) + 40 unique words (2 each)
		// = 41 candidates → slice(0,28) keeps only the top 28
		const letters = "abcdefghijklmnopqrstuvwxyz";
		const many = Array.from({ length: 40 }, (_, i) => {
			// collision-free 4-letter encoding: (i%26)² + (floor(i/26))²
			const w =
				letters.charAt(i % 26) +
				letters.charAt(i % 26) +
				letters.charAt(Math.floor(i / 26)) +
				letters.charAt(Math.floor(i / 26));
			return mkPost({
				title: `theme theme ${w} ${w}`,
				description: "",
				tags: [],
			});
		});
		render(<WordCloud posts={many} />);
		expect(screen.getAllByRole("listitem")).toHaveLength(28);
		expect(screen.getByText("theme")).toBeInTheDocument();
	});
});

// ─── RecapCard ───────────────────────────────────────────────────────

describe("RecapCard", () => {
	it("renders nothing when there is no recent activity", () => {
		const { container } = render(<RecapCard posts={[]} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("ignores posts created more than a week ago", () => {
		const old = mkPost({
			created_at: new Date(Date.now() - 8 * DAY).toISOString(),
		});
		const { container } = render(<RecapCard posts={[old]} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows the weekly heading and counts with pluralization", () => {
		const fresh = mkPost({ title: "A fresh issue", category: "Facilities" });
		render(<RecapCard posts={[fresh]} />);
		const section = screen.getByRole("region", { name: "Weekly recap" });
		expect(section).toBeInTheDocument();
		expect(screen.getByText("This week at your school")).toBeInTheDocument();
		expect(screen.getByText("1")).toBeInTheDocument();
		expect(screen.getByText(/new post$/)).toBeInTheDocument();
		expect(section.textContent).toMatch(/0\s+solved/);
	});

	it('pluralizes "posts" for multiple items', () => {
		const a = mkPost({
			created_at: new Date(Date.now() - 1 * DAY).toISOString(),
		});
		const b = mkPost({
			created_at: new Date(Date.now() - 2 * DAY).toISOString(),
		});
		render(<RecapCard posts={[a, b]} />);
		expect(screen.getByText(/new posts$/)).toBeInTheDocument();
	});

	it("counts posts solved within the week via status_history", () => {
		const solved = mkPost({
			created_at: new Date(Date.now() - 9 * DAY).toISOString(), // older than a week
			status: "solved",
			status_history: [
				{
					status: "solved" as const,
					at: new Date(Date.now() - 2 * DAY).toISOString(),
				},
			],
		});
		render(<RecapCard posts={[solved]} />);
		// no new posts this week, but one solved → card still renders
		const section = screen.getByRole("region", { name: "Weekly recap" });
		expect(section).toBeInTheDocument();
		expect(section.textContent).toMatch(/1\s+solved/);
	});

	it("ignores solves older than a week", () => {
		const stale = mkPost({
			created_at: new Date(Date.now() - 1 * DAY).toISOString(),
			status: "solved",
			status_history: [
				{
					status: "solved" as const,
					at: new Date(Date.now() - 9 * DAY).toISOString(),
				},
			],
		});
		render(<RecapCard posts={[stale]} />);
		expect(
			screen.getByRole("region", { name: "Weekly recap" }).textContent,
		).toMatch(/0\s+solved/);
	});

	it("shows the most active category with its emoji", () => {
		const foodA = mkPost({
			title: "Cafeteria lines",
			category: "Food",
			created_at: new Date(Date.now() - 1 * DAY).toISOString(),
		});
		const foodB = mkPost({
			title: "Cold trays",
			category: "Food",
			created_at: new Date(Date.now() - 2 * DAY).toISOString(),
		});
		const tech = mkPost({
			title: "Broken projector",
			category: "Technology",
			created_at: new Date(Date.now() - 3 * DAY).toISOString(),
		});
		render(<RecapCard posts={[foodA, foodB, tech]} />);
		expect(screen.getByText("Food")).toBeInTheDocument();
		expect(screen.getByText(/most active \(2\)/)).toBeInTheDocument();
	});

	it("highlights the most supported post", () => {
		const supported = mkPost({
			title: "Fix the gym roof",
			reactions: { support: 12, up: 5 },
			created_at: new Date(Date.now() - 1 * DAY).toISOString(),
		});
		render(<RecapCard posts={[supported]} />);
		expect(screen.getByText(/Fix the gym roof/)).toBeInTheDocument();
		expect(screen.getByText(/12 supports/)).toBeInTheDocument();
	});

	it("omits the most-supported line when no post has support", () => {
		const plain = mkPost({
			title: "Quiet hallways",
			reactions: { up: 3 },
			created_at: new Date(Date.now() - 1 * DAY).toISOString(),
		});
		render(<RecapCard posts={[plain]} />);
		expect(screen.queryByText(/Most supported/)).not.toBeInTheDocument();
	});

	it("does not crash when status_history entries are malformed", () => {
		const weird: StatusHistoryEntry[] = [
			{ status: "solved", at: "not-a-date" },
		];
		const post = mkPost({ status_history: weird });
		render(<RecapCard posts={[post]} />);
		// invalid date → +new Date('not-a-date') = NaN → comparison false → not counted as solved
		expect(
			screen.getByRole("region", { name: "Weekly recap" }).textContent,
		).toMatch(/0\s+solved/);
	});
});
