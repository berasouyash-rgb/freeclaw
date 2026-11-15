import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluatePostForQuarantine, quarantinePostByAgent } from "../../api/_auto-quarantine.js";

// Mock supabase client
vi.mock("../../api/_db-client.js", () => {
	const chain = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue({ data: [], error: null }),
		update: vi.fn().mockReturnThis(),
	};
	return {
		default: {
			from: vi.fn(() => chain),
		},
	};
});

// Mock audit log & notify
vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn().mockResolvedValue(true),
	notifyUser: vi.fn().mockResolvedValue(true),
}));

describe("24/7 AI Safety Sentinel Auto-Quarantine Engine", () => {
	it("flags and evaluates faculty name leaks (kauli mam) as critical violation", async () => {
		const post = {
			id: "post_test_01",
			title: "we habve told our tecaher kauli mam but still she di ...",
			description: "Complaint about teacher response",
			category: "Academics",
			author_id: "anon_student_1",
		};

		const decision = await evaluatePostForQuarantine(post);
		expect(decision.shouldQuarantine).toBe(true);
		expect(decision.rule).toBe("privacy_faculty_name");
		expect(decision.severity).toBe("critical");
		expect(decision.reason).toContain("kauli mam");
	});

	it("flags faculty title + name combinations (sharma sir)", async () => {
		const post = {
			id: "post_test_02",
			title: "sharma sir did not check my test paper",
			description: "Marks are not updated",
			category: "Academics",
			author_id: "anon_student_2",
		};

		const decision = await evaluatePostForQuarantine(post);
		expect(decision.shouldQuarantine).toBe(true);
		expect(decision.rule).toBe("privacy_faculty_name");
		expect(decision.reason).toContain("sharma sir");
	});

	it("flags low-quality keyboard mash and gibberish (we shou;d asddm ac)", async () => {
		const post = {
			id: "post_test_03",
			title: "we shou;d asddm ac",
			description: "broken letters in title",
			category: "Academics",
			author_id: "anon_student_3",
		};

		const decision = await evaluatePostForQuarantine(post);
		expect(decision.shouldQuarantine).toBe(true);
		expect(decision.rule).toBe("quality_gibberish");
	});

	it("flags direct intimidation or threat patterns", async () => {
		const post = {
			id: "post_test_04",
			title: "watch your back outside school",
			description: "I will find you and make you pay",
			category: "Bullying",
			author_id: "anon_student_4",
		};

		const decision = await evaluatePostForQuarantine(post);
		expect(decision.shouldQuarantine).toBe(true);
		expect(decision.severity).toBe("critical");
	});

	it("approves clean, policy-compliant campus feedback", async () => {
		const post = {
			id: "post_test_05",
			title: "Water filter on 2nd floor library is leaking",
			description: "Pressure is low and clean drinking water is unavailable during afternoon classes.",
			category: "Facilities",
			author_id: "anon_student_5",
		};

		const decision = await evaluatePostForQuarantine(post);
		expect(decision.shouldQuarantine).toBe(false);
	});

	it("successfully marks quarantined post hidden_by agent in database patch", async () => {
		const post = {
			id: "post_test_06",
			title: "we habve told our tecaher kauli mam",
			description: "teacher ignoring complaint",
			category: "Academics",
			author_id: "anon_student_6",
			status_history: [],
		};

		const evalResult = {
			shouldQuarantine: true,
			reason: "Faculty name identified: kauli mam",
			rule: "privacy_faculty_name",
			severity: "critical",
		};

		const res = await quarantinePostByAgent(post, evalResult, {
			agentName: "24/7 AI Safety Sentinel",
		});

		expect(res.success).toBe(true);
		expect(res.hidden).toBe(true);
		expect(res.hidden_by).toBe("agent");
		expect(res.reason).toBe("Faculty name identified: kauli mam");
	});
});
