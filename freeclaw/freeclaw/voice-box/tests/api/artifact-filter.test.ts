// Regression: the test-artifact filter must not hide legitimate school posts
// merely because their title uses the ordinary English word "test".
import { describe, expect, it } from "vitest";
import { isTestArtifact } from "../../api/_artifact-filter.js";

describe("isTestArtifact", () => {
	it("keeps a legitimate student post that mentions a test", () => {
		expect(
			isTestArtifact("Can we test the emergency alarm before Friday?"),
		).toBe(false);
	});

	it("still removes the known seeded QA artifacts", () => {
		for (const title of [
			"QA test post 2026-07-14",
			"Test post in Other category",
			"Content Type Test",
			"Full CRUD Test 210145",
			"Final Workflow Test",
			"Fzqbn otsm8vjg lh2d3kil",
		]) {
			expect(isTestArtifact(title), title).toBe(true);
		}
	});
});
