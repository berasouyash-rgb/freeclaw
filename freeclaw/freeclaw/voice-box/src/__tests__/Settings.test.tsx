import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	INFRASTRUCTURE_COPY,
	LOCAL_PROFILE_COPY,
	NOTIFY_PRIVACY_COPY,
	RETENTION_COPY,
} from "../lib/privacyCopy";

const settingsSource = readFileSync("src/pages/Settings.tsx", "utf8");

describe("Settings privacy disclosures", () => {
	it("defines the shared privacy constants", () => {
		expect(NOTIFY_PRIVACY_COPY).toContain("stores the phone number or email address");
		expect(LOCAL_PROFILE_COPY).toContain("stored in this browser");
		expect(RETENTION_COPY).toContain("purged after 30 days");
		expect(INFRASTRUCTURE_COPY).toContain("Infrastructure providers");
	});

	it("uses the shared privacy constants in the Settings page", () => {
		for (const name of [
			"NOTIFY_PRIVACY_COPY",
			"LOCAL_PROFILE_COPY",
			"RETENTION_COPY",
			"INFRASTRUCTURE_COPY",
		]) {
			expect(settingsSource).toContain(name);
		}
	});

	it("does not claim that all ownership data remains local", () => {
		expect(settingsSource).not.toMatch(
			/no personal data.*ever|never asks for or stores.*email|ownership data.*stays only in your browser/i,
		);
	});
});
