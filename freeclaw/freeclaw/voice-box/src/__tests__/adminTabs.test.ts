import { describe, expect, it } from "vitest";
import {
	ADMIN_TAB_GROUPS,
	ADMIN_TAB_KEYS,
	ADMIN_TABS,
	adminTabHref,
	normalizeAdminTab,
	parseAdminTab,
} from "../lib/adminTabs";

describe("admin tab registry", () => {
	it("keeps the complete 15-tab product surface in canonical order", () => {
		expect(ADMIN_TAB_KEYS).toEqual([
			"dashboard",
			"presentation",
			"reports",
			"posts",
			"users",
			"categories",
			"polls",
			"slang",
			"communities",
			"inbox",
			"errors",
			"logs",
			"email-templates",
			"ai-systems",
			"settings",
		]);
		expect(ADMIN_TABS).toHaveLength(15);
		expect(ADMIN_TAB_GROUPS.map((group) => group.title)).toEqual([
			"Overview",
			"Content",
			"Operations",
			"Configuration",
		]);
	});

	it("redirects the removed autonomous UI controls without deleting their capabilities", () => {
		for (const tab of [
			"agent-chat",
			"ops-center",
			"activity-stream",
			"system-health",
			"performance",
			"security",
			"work",
		]) {
			expect(normalizeAdminTab(tab)).toEqual({ tab: "dashboard", retired: true });
		}
	});

	it("normalizes query values and rejects unknown tabs safely", () => {
		expect(parseAdminTab("?tab=REPORTS")).toBe("reports");
		expect(parseAdminTab("email-templates")).toBe("email-templates");
		expect(parseAdminTab("builder")).toBe("dashboard");
		expect(parseAdminTab(null)).toBe("dashboard");
	});

	it("builds stable admin hrefs", () => {
		expect(adminTabHref("email-templates")).toBe(
			"/admin?tab=email-templates",
		);
	});
});
