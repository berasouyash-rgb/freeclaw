// ActionPreviews extra coverage — visual preview cards for agent tools
// Covers option lists, toggle states (hidden/locked/pinned/featured),
// moderation cards, announcement/comment flows, mutation previews,
// presentation periods, CSV gating, generic fallback, and router coverage.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	AdminReplyPreview,
	AnalyticsPreview,
	AnnouncementPreview,
	AssignPreview,
	BanPreview,
	ClearAnnouncePreview,
	CommentPreview,
	CSVPreview,
	DeletePostPreview,
	ETAPreview,
	FeaturePreview,
	GenericPreview,
	getToolPreview,
	HidePreview,
	LockPreview,
	MetaAgentPreview,
	PinPreview,
	PollPreview,
	PresentationPreview,
	PriorityPreview,
	ReportsPreview,
	TrendAnalysisPreview,
	UnbanPreview,
	UpdatePostPreview,
	UserSearchPreview,
	WarnPreview,
} from "../pages/admin/agent-chat/ActionPreviews";

describe("ActionPreviews extra", () => {
	it("should render poll title with every option when options are provided", () => {
		const { rerender } = render(
			<PollPreview args={{ title: "Lunch poll", options: ["A", "B", "C"] }} />,
		);
		expect(screen.getByText("Lunch poll")).toBeInTheDocument();
		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("B")).toBeInTheDocument();
		expect(screen.getByText("C")).toBeInTheDocument();
		expect(screen.getByText("LIVE")).toBeInTheDocument();
		rerender(<PollPreview args={{}} />);
		expect(screen.getByText("Untitled Poll")).toBeInTheDocument();
		expect(screen.getByText("Yes")).toBeInTheDocument();
		expect(screen.getByText("No")).toBeInTheDocument();
	});

	it("should render HIDDEN and VISIBLE states for hide preview", () => {
		const { rerender } = render(
			<HidePreview args={{ title: "Spam post", hidden: true }} />,
		);
		expect(screen.getByText("HIDDEN")).toBeInTheDocument();
		expect(screen.getByText(/requires admin approval/i)).toBeInTheDocument();
		rerender(<HidePreview args={{ title: "Good post", hidden: false }} />);
		expect(screen.getByText("VISIBLE")).toBeInTheDocument();
		expect(screen.getByText(/restored to public view/i)).toBeInTheDocument();
	});

	it("should render HIGH badge and fall back to MEDIUM for unknown priority", () => {
		const { rerender } = render(
			<PriorityPreview args={{ title: "Urgent", priority: "high" }} />,
		);
		expect(screen.getByText("HIGH")).toBeInTheDocument();
		rerender(<PriorityPreview args={{ title: "Normal", priority: "bogus" }} />);
		expect(screen.getByText("MEDIUM")).toBeInTheDocument();
		rerender(<PriorityPreview args={{ title: "Calm", priority: "low" }} />);
		expect(screen.getByText("LOW")).toBeInTheDocument();
	});

	it("should render admin reply text with ADMIN and REPLY badges", () => {
		render(<AdminReplyPreview args={{ post_id: "p9", reply: "We are on it" }} />);
		expect(screen.getByText("We are on it")).toBeInTheDocument();
		expect(screen.getByText("ADMIN")).toBeInTheDocument();
		expect(screen.getByText("REPLY")).toBeInTheDocument();
	});

	it("should render LOCKED and UNLOCKED states for lock preview", () => {
		const { rerender } = render(<LockPreview args={{ title: "T", locked: true }} />);
		expect(screen.getByText("LOCKED")).toBeInTheDocument();
		expect(screen.getByText(/disabled/i)).toBeInTheDocument();
		rerender(<LockPreview args={{ title: "T", locked: false }} />);
		expect(screen.getByText("UNLOCKED")).toBeInTheDocument();
		expect(screen.getByText(/re-enabled/i)).toBeInTheDocument();
	});

	it("should render PINNED and FEATURED toggle states", () => {
		const { rerender } = render(<PinPreview args={{ title: "T", pinned: true }} />);
		expect(screen.getByText("PINNED")).toBeInTheDocument();
		expect(screen.getByText(/top of the feed/i)).toBeInTheDocument();
		rerender(<PinPreview args={{ title: "T", pinned: false }} />);
		expect(screen.getByText("UNPINNED")).toBeInTheDocument();
		rerender(<FeaturePreview args={{ title: "T", featured: true }} />);
		expect(screen.getByText("FEATURED")).toBeInTheDocument();
		rerender(<FeaturePreview args={{ title: "T", featured: false }} />);
		expect(screen.getByText("NOT FEATURED")).toBeInTheDocument();
	});

	it("should render ban card with user id, reason, and Unknown fallback", () => {
		const { rerender } = render(
			<BanPreview args={{ user_id: "u123", reason: "spam" }} />,
		);
		expect(screen.getByText("u123")).toBeInTheDocument();
		expect(screen.getByText("BANNED")).toBeInTheDocument();
		expect(screen.getByText(/spam/)).toBeInTheDocument();
		rerender(<BanPreview args={{}} />);
		expect(screen.getByText("Unknown")).toBeInTheDocument();
	});

	it("should render unban restore and warn warning cards", () => {
		const { rerender } = render(<UnbanPreview args={{ user_id: "u7" }} />);
		expect(screen.getByText("u7")).toBeInTheDocument();
		expect(screen.getByText("RESTORED")).toBeInTheDocument();
		rerender(<WarnPreview args={{ anon_id: "a9", reason: "rude" }} />);
		expect(screen.getByText("a9")).toBeInTheDocument();
		expect(screen.getByText("WARNING")).toBeInTheDocument();
		expect(screen.getByText(/rude/)).toBeInTheDocument();
	});

	it("should render delete post card with id and reason", () => {
		const { rerender } = render(
			<DeletePostPreview args={{ post_id: "p5", reason: "duplicate" }} />,
		);
		expect(screen.getByText(/Post will be deleted/)).toBeInTheDocument();
		expect(screen.getByText(/p5/)).toBeInTheDocument();
		expect(screen.getByText(/duplicate/)).toBeInTheDocument();
		rerender(<DeletePostPreview args={{}} />);
		expect(screen.getByText(/Post will be deleted/)).toBeInTheDocument();
	});

	it("should render announcement banner and clear-announcement empty state", () => {
		const { unmount } = render(
			<AnnouncementPreview args={{ message: "Hello all" }} />,
		);
		expect(screen.getByText("Hello all")).toBeInTheDocument();
		expect(screen.getByText(/top of the site/i)).toBeInTheDocument();
		unmount();
		render(<ClearAnnouncePreview />);
		expect(screen.getByText("Clear Announcement")).toBeInTheDocument();
		expect(screen.getByText(/no longer appear/i)).toBeInTheDocument();
	});

	it("should render comment preview with body and OFFICIAL badge", () => {
		render(<CommentPreview args={{ post_id: "p1", body: "Nice post" }} />);
		expect(screen.getByText("Nice post")).toBeInTheDocument();
		expect(screen.getByText("OFFICIAL")).toBeInTheDocument();
		expect(screen.getByText(/publicly/i)).toBeInTheDocument();
	});

	it("should render update, ETA, and assign mutation previews", () => {
		const { unmount } = render(
			<UpdatePostPreview args={{ post_id: "p1", status: "solved" }} />,
		);
		expect(screen.getByText("solved")).toBeInTheDocument();
		expect(screen.getByText("status")).toBeInTheDocument();
		unmount();
		render(<ETAPreview args={{ title: "Fix road", eta: "Friday" }} />);
		expect(screen.getByText("Friday")).toBeInTheDocument();
		expect(screen.getByText("Set ETA")).toBeInTheDocument();
		const { unmount: unmount2 } = render(
			<AssignPreview args={{ title: "Fix road", assigned_to: "team-a" }} />,
		);
		expect(screen.getByText("team-a")).toBeInTheDocument();
		expect(screen.getByText("Assign Post")).toBeInTheDocument();
		unmount2();
	});

	it("should render presentation period labels and slide counts", () => {
		const { unmount } = render(
			<PresentationPreview args={{ topic: "Weekly", period: "week" }} />,
		);
		expect(screen.getByText("Weekly")).toBeInTheDocument();
		expect(screen.getByText(/This Week/)).toBeInTheDocument();
		unmount();
		render(
			<PresentationPreview args={{ topic: "Monthly", period: "month" }} />,
		);
		expect(screen.getByText("Monthly")).toBeInTheDocument();
		expect(screen.getByText(/This Month/)).toBeInTheDocument();
	});

	it("should gate CSV download link on success result", () => {
		const { unmount } = render(
			<CSVPreview
				args={{ filename: "out.csv", row_count: 10, columns: ["a", "b"] }}
				result={{ success: true, data: { csv: "a,b", row_count: 10 } }}
			/>,
		);
		expect(screen.getByText("out.csv")).toBeInTheDocument();
		expect(screen.getByText(/10 rows/)).toBeInTheDocument();
		expect(screen.getByText("Download")).toBeInTheDocument();
		unmount();
		render(<CSVPreview args={{ filename: "pending.csv" }} />);
		expect(screen.getByText("pending.csv")).toBeInTheDocument();
		expect(screen.queryByText("Download")).not.toBeInTheDocument();
	});

	it("should render generic parameters and No parameters empty state", () => {
		const { rerender } = render(<GenericPreview args={{}} />);
		expect(screen.getByText("No parameters")).toBeInTheDocument();
		rerender(<GenericPreview args={{ status: "hidden" }} />);
		expect(screen.getByText("Status")).toBeInTheDocument();
		expect(screen.getByText("hidden")).toBeInTheDocument();
	});

	it("should route tools to dedicated previews and fall back to generic", () => {
		const cases: Array<[string, Record<string, unknown>, string]> = [
			["ban_user", { user_id: "u1" }, "BANNED"],
			["search_users", { query: "anon" }, "anon"],
			["generate_summary", {}, "Trend Analysis"],
			["trend_analysis", {}, "Trend Analysis"],
			["get_analytics", {}, "Fetching Analytics"],
			["get_reports", {}, "Pending Reports"],
			["bulk_update", { status: "hidden" }, "Meta-Agent"],
			["search_content", { query: "roads" }, "roads"],
			["definitely_not_a_tool", { anything: "value" }, "Parameters"],
		];
		for (const [tool, args, text] of cases) {
			const { unmount } = render(getToolPreview(tool, args));
			expect(screen.getAllByText(new RegExp(text, "i")).length).toBeGreaterThan(0);
			unmount();
		}
		const { unmount } = render(
			<MetaAgentPreview args={{ query: "do research" }} />,
		);
		expect(screen.getByText("do research")).toBeInTheDocument();
		expect(screen.getByText("Researcher")).toBeInTheDocument();
		unmount();
		render(<UserSearchPreview args={{ query: "anon_1" }} />);
		expect(screen.getByText("anon_1")).toBeInTheDocument();
		const { unmount: u2 } = render(<TrendAnalysisPreview args={{}} />);
		expect(screen.getByText("Engagement")).toBeInTheDocument();
		u2();
		const { unmount: u3 } = render(<AnalyticsPreview />);
		expect(screen.getByText("Fetching Analytics")).toBeInTheDocument();
		u3();
		render(<ReportsPreview />);
		expect(screen.getByText("Pending Reports")).toBeInTheDocument();
	});
});
