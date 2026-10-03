import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	CONTACT_PRIVACY_COPY,
	INFRASTRUCTURE_COPY,
	LOCAL_PROFILE_COPY,
	NOTIFY_PRIVACY_COPY,
	RETENTION_COPY,
} from "../lib/privacyCopy";
import Privacy from "../pages/Privacy";

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ anonId: "anon_test" }),
}));

describe("Privacy disclosures", () => {
	it("renders the shared truthful disclosure set", () => {
		render(<Privacy />);

		for (const copy of [
			NOTIFY_PRIVACY_COPY,
			CONTACT_PRIVACY_COPY,
			LOCAL_PROFILE_COPY,
			RETENTION_COPY,
			INFRASTRUCTURE_COPY,
		]) {
			expect(screen.getByText(copy)).toBeInTheDocument();
		}
	});

	it("does not claim that all personal data is never stored", () => {
		render(<Privacy />);

		expect(screen.queryByText(/no personal data.*ever/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/never asks for or stores.*email/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/ownership data.*stays only in your browser/i)).not.toBeInTheDocument();
	});
});
