import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The user reported that reported posts vanish from the admin Reports page.
// Root cause: the action named "hide" called DELETE /api/posts, which is a
// HARD delete (it cascades comments + reactions). Hiding must be a PUT that
// sets `hidden: true`, preserving the post and its moderation evidence.
const source = readFileSync(
	resolve(process.cwd(), "src/pages/admin/Reports.tsx"),
	"utf8",
);
const start = source.indexOf("const hideTargetAndResolve");
const end = source.indexOf("const applyAiRecommendation");
if (start === -1 || end === -1) throw new Error("hide helper not found");
const hideHelper = source.slice(start, end);

describe("Reports — hide a reported post", () => {
	it("never hard-deletes the post", () => {
		expect(hideHelper).not.toMatch(/api\.del\s*\(/);
	});

	it("uses the hide endpoint for post targets", () => {
		expect(hideHelper).toMatch(
			/api\.put\(\s*["']\/api\/posts["']\s*,\s*\{[^}]*hidden:\s*true/,
		);
	});

	it("keeps the comment hide path non-destructive", () => {
		const comment = hideHelper.slice(hideHelper.indexOf("comment"));
		expect(comment).not.toMatch(/api\.del\s*\(/);
	});
});
