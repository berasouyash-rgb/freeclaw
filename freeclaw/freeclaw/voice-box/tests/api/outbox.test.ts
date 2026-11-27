import { describe, expect, it } from "vitest";
import { OUTBOX_COLLECTION, outboxStats, outboxReport } from "../../api/_outbox.js";

describe("Durable write outbox (_outbox.js)", () => {
	it("exports the canonical outbox collection name", () => {
		expect(OUTBOX_COLLECTION).toBe("__outbox");
	});

	it("reports baseline outbox stats honestly", () => {
		const stats = outboxStats();
		expect(stats).toBeDefined();
		expect(typeof stats.recorded).toBe("number");
		expect(typeof stats.replayed).toBe("number");
		expect(typeof stats.failed).toBe("number");
		expect(typeof stats.conflicts).toBe("number");
	});

	it("generates an outbox report with pending count and stats", async () => {
		const report = await outboxReport();
		expect(report).toBeDefined();
		expect(report.stats).toBeDefined();
		expect(report.pending).toBeDefined();
	});
});
