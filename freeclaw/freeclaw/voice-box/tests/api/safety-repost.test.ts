// Safety repost guard — normalization, record/check, attempt counting, fail-open.
import { describe, expect, it } from "vitest";
import {
	checkSafetyRepost,
	fingerprintSafetyText,
	recordSafetyRepost,
} from "../../api/_moderation.js";

function fakeClient(store: { items: unknown[] }) {
	return {
		from: (_t: string) => ({
			select: (_c: string) => ({
				eq: (_k: string, _v: string) => ({
					maybeSingle: async () => ({ data: { value: { items: store.items } }, error: null }),
				}),
			}),
			upsert: async (row: { value: { items: unknown[] } }) => {
				store.items = row.value.items;
				return { error: null };
			},
		}),
	};
}

describe("fingerprintSafetyText", () => {
	it("erases case, punctuation, and spacing", () => {
		expect(fingerprintSafetyText("UR   COOKED!!!")).toBe(fingerprintSafetyText("ur cooked"));
	});
	it("rejects short/generic text", () => {
		expect(fingerprintSafetyText("hi")).toBe("");
		expect(fingerprintSafetyText("")).toBe("");
		expect(fingerprintSafetyText(null as unknown as string)).toBe("");
	});
	it("keeps phone-like digit strings enforceable", () => {
		expect(fingerprintSafetyText("call 98765 43210 now").length).toBeGreaterThanOrEqual(8);
	});
});

describe("safety repost blocklist", () => {
	it("records then blocks, and counts repeat attempts", async () => {
		const store = { items: [] as unknown[] };
		const client = fakeClient(store);
		expect(await recordSafetyRepost(client, "You are an idiot, everyone hates you", "bullying")).toBe(true);
		const hit = await checkSafetyRepost(client, "YOU ARE AN IDIOT... everyone hates you!!!");
		expect(hit.blocked).toBe(true);
		expect(hit.rule).toBe("bullying");
		expect(hit.attempts).toBe(1);
		// Re-recording the same text bumps attempts instead of duplicating.
		await recordSafetyRepost(client, "you are an idiot everyone hates you", "bullying");
		expect(store.items).toHaveLength(1);
		const hit2 = await checkSafetyRepost(client, "You are an idiot, everyone hates you");
		expect(hit2.attempts).toBe(2);
	});
	it("leaves unrelated content alone", async () => {
		const store = { items: [] as unknown[] };
		const client = fakeClient(store);
		await recordSafetyRepost(client, "You are an idiot, everyone hates you", "bullying");
		expect((await checkSafetyRepost(client, "Thanks, I see the same issue near the library")).blocked).toBe(false);
	});
	it("fails open when storage throws", async () => {
		const broken = { from: () => { throw new Error("db down"); } };
		expect(await recordSafetyRepost(broken, "You are an idiot, everyone hates you", "bullying")).toBe(false);
		expect((await checkSafetyRepost(broken, "You are an idiot, everyone hates you")).blocked).toBe(false);
	});
});
