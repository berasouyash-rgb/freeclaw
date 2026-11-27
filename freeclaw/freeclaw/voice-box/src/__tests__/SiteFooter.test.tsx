import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteFooter } from "../components/SiteFooter";

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		theme: "dark",
	}),
}));

describe("SiteFooter — Campus Artwork & Clean Production Footer", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("renders site-footer with brand, accreditation and links", () => {
		render(
			<MemoryRouter>
				<SiteFooter />
			</MemoryRouter>,
		);

		const footer = screen.getByTestId("site-footer");
		expect(footer).toBeInTheDocument();

		expect(screen.getByText("Vision International School")).toBeInTheDocument();
		expect(screen.getByText("Souyash Bera")).toBeInTheDocument();
		expect(screen.getByText("100% Anonymous")).toBeInTheDocument();

		expect(screen.getByRole("link", { name: "Feed" })).toHaveAttribute("href", "/");
		expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
		expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
	});

	it("toggles between Campus Backdrop and Clean mode", () => {
		render(
			<MemoryRouter>
				<SiteFooter />
			</MemoryRouter>,
		);

		const toggleBtn = screen.getByRole("button", {
			name: "Toggle footer background style",
		});
		expect(toggleBtn).toBeInTheDocument();

		// Default is art mode
		expect(screen.getByText("Campus Backdrop")).toBeInTheDocument();

		// Click to switch to clean
		fireEvent.click(toggleBtn);
		expect(screen.getByText("Clean Minimal")).toBeInTheDocument();
		expect(localStorage.getItem("vb:footer-style")).toBe("clean");

		// Click to switch back to art
		fireEvent.click(toggleBtn);
		expect(screen.getByText("Campus Backdrop")).toBeInTheDocument();
		expect(localStorage.getItem("vb:footer-style")).toBe("art");
	});

	it("scrolls to top on clicking back-to-top button", () => {
		const scrollToMock = vi.fn();
		window.scrollTo = scrollToMock;

		render(
			<MemoryRouter>
				<SiteFooter />
			</MemoryRouter>,
		);

		const topBtn = screen.getByRole("button", { name: "Scroll back to top" });
		fireEvent.click(topBtn);
		expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
	});
});
