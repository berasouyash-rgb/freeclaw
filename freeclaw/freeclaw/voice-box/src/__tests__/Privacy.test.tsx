import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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

function LocationProbe() {
	const loc = useLocation();
	return <span data-testid="path">{loc.pathname}</span>;
}

describe("Privacy disclosures", () => {
	it("has a working Back button that returns to the previous screen", () => {
		render(
			<MemoryRouter initialEntries={["/", "/privacy"]} initialIndex={1}>
				<Routes>
					<Route path="/" element={<LocationProbe />} />
					<Route
						path="/privacy"
						element={
							<>
								<Privacy />
								<LocationProbe />
							</>
						}
					/>
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByTestId("path")).toHaveTextContent("/privacy");
		fireEvent.click(screen.getByRole("button", { name: "Go back" }));
		expect(screen.getByTestId("path")).toHaveTextContent("/");
	});
	it("renders the shared truthful disclosure set", () => {
		render(
			<MemoryRouter>
				<Privacy />
			</MemoryRouter>,
		);

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
		render(
			<MemoryRouter>
				<Privacy />
			</MemoryRouter>,
		);

		expect(screen.queryByText(/no personal data.*ever/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/never asks for or stores.*email/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/ownership data.*stays only in your browser/i)).not.toBeInTheDocument();
	});
});
