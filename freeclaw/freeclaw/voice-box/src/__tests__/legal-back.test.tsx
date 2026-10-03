// Legal pages always offer a way back — Terms and Accessibility previously
// had no back affordance, trapping mobile readers who land there directly.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import Accessibility from "../pages/Accessibility";
import Terms from "../pages/Terms";

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/" element={<div>Home feed</div>} />
				<Route path="/terms" element={<Terms />} />
				<Route path="/accessibility" element={<Accessibility />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("legal pages always offer a way back", () => {
	it("Terms renders a Back control", () => {
		renderAt("/terms");
		expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
	});

	it("Accessibility renders a Back control", () => {
		renderAt("/accessibility");
		expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
	});

	it("Back falls home on a direct landing with no history", async () => {
		// jsdom starts with a single history entry — the deep-link case.
		renderAt("/terms");
		fireEvent.click(screen.getByRole("button", { name: /back/i }));
		expect(await screen.findByText("Home feed")).toBeInTheDocument();
	});
});
