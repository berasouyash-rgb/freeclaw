// ═══════════════════════════════════════════════════════════════════
// Slice 14 contract — agent cards show EVIDENCE, never raw JSON:
//  • success result → sentence + label/value consequence rows + items
//  • no <pre> dump, no "{" anywhere in card text
//  • failure keeps the "Failed: …" line
//  • empty data → "Outcome recorded — verify in the … tab."
//  • completed cards start expanded; header always toggles evidence
//  • GenericPreview renders args as rows, never a JSON dump
// ═══════════════════════════════════════════════════════════════════
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActionCard from "../pages/admin/agent-chat/ActionCard";
import { GenericPreview } from "../pages/admin/agent-chat/ActionPreviews";
import type { Action } from "../pages/admin/agent-chat/tool-meta";

const base: Action = {
	id: "a1",
	tool: "get_posts",
	args: {},
	reason: "",
	destructive: false,
};

function renderCard(action: Action) {
	return render(
		<ActionCard
			action={action}
			onExecute={() => {}}
			onDismiss={() => {}}
			executing={false}
		/>
	);
}

describe("ActionCard evidence rendering", () => {
	it("shows sentence + consequence rows, never a JSON dump", () => {
		const { container } = renderCard({
			...base,
			result: {
				success: true,
				data: {
					message: "All stale reports cleared",
					open_reports_removed: 3,
					post_id: 42,
				},
			},
		});

		// Sentence line
		expect(screen.getByText("All stale reports cleared")).toBeTruthy();
		// Consequence rows
		expect(screen.getByText("Open Reports Removed")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
		expect(screen.getByText("Post ID")).toBeTruthy();
		expect(screen.getByText("42")).toBeTruthy();
		// Never a raw dump
		expect(container.querySelector("pre")).toBeNull();
		expect(container.textContent ?? "").not.toContain("{");
	});

	it("renders array outcomes as a count row + entity item lines", () => {
		renderCard({
			...base,
			result: {
				success: true,
				data: {
					message: "Removed 2 reports",
					removed_reports: [
						{ id: 7, status: "solved" },
						{ id: 9, status: "solved" },
					],
				},
			},
		});

		expect(screen.getByText("Removed Reports")).toBeTruthy();
		expect(screen.getByText("2 items")).toBeTruthy();
		expect(screen.getByText("#7 · solved")).toBeTruthy();
		expect(screen.getByText("#9 · solved")).toBeTruthy();
	});

	it("keeps the failed line verbatim on error", () => {
		renderCard({
			...base,
			tool: "delete_post",
			result: { success: false, error: "permission denied" },
		});

		expect(screen.getByText(/Failed: permission denied/)).toBeTruthy();
	});

	it("shows verify-in-tab hint when success data is empty", () => {
		renderCard({
			...base,
			tool: "delete_post",
			result: { success: true, data: {} },
		});

		expect(screen.getByText(/Outcome recorded/)).toBeTruthy();
		expect(screen.getByText(/verify in the posts tab/)).toBeTruthy();
	});

	it("starts expanded and the header toggles the evidence closed/open", () => {
		const message = "Hidden post 5";
		renderCard({
			...base,
			result: { success: true, data: { message } },
		});

		// Completed card starts expanded → evidence visible
		expect(screen.getByText(message)).toBeTruthy();

		// Header (label "View posts" for get_posts) collapses evidence
		const header = screen.getByRole("button", { name: /view posts/i });
		fireEvent.click(header);
		expect(screen.queryByText(message)).toBeNull();

		// …and expands it again
		fireEvent.click(header);
		expect(screen.getByText(message)).toBeTruthy();
	});
});

describe("GenericPreview args rendering", () => {
	it("flattens nested args into label/value rows, never JSON", () => {
		const { container } = render(
			<GenericPreview args={{ change: { status: "hidden" }, ids: [1, 2, 3] }} />
		);

		expect(screen.getByText("Change Status")).toBeTruthy();
		expect(screen.getByText("hidden")).toBeTruthy();
		expect(screen.getByText("Ids")).toBeTruthy();
		expect(screen.getByText("3 items")).toBeTruthy();
		expect(container.querySelector("pre")).toBeNull();
		expect(container.querySelector("code")).toBeNull();
	});
});
