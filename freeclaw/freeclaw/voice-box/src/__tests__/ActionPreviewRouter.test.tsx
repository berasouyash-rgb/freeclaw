// ═══════════════════════════════════════════════════════════════════
// getToolPreview router — every tool with a purpose-built preview
// ═══════════════════════════════════════════════════════════════════
// `create_presentation` is a real agent tool (api/_agent-chat.js defines
// it, executes it, and tags the result with it) and TOOL_META styles it
// amber — but the preview router had no case for it, so every generated
// presentation card fell through to GenericPreview while the amber
// PresentationPreview component sat unreferenced.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getToolPreview } from "../pages/admin/agent-chat/ActionPreviews";

describe("getToolPreview router", () => {
	it("routes create_presentation to the dedicated presentation preview", () => {
		const { container } = render(
			getToolPreview("create_presentation", { topic: "Q1 outage review" }),
		);

		expect(container.textContent).toContain("Presentation Generator");
		expect(container.textContent).toContain("Q1 outage review");
	});

	it("keeps the generic preview for a tool with no dedicated case", () => {
		const { container } = render(
			getToolPreview("definitely_not_a_tool", { anything: "value" }),
		);

		// GenericPreview is the only preview headed "Parameters".
		expect(container.textContent).toContain("Parameters");
		expect(container.textContent).not.toContain("Presentation Generator");
	});
});
