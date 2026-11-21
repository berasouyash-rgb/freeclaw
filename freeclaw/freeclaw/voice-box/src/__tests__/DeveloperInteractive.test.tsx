import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Developer from "../pages/Developer";

// Mock clipboard
Object.assign(navigator, {
	clipboard: {
		writeText: vi.fn().mockImplementation(() => Promise.resolve()),
	},
});

describe("Developer — Full Interactive Experience Showcase", () => {
	it("renders creator headline, portrait, and dynamic credentials", () => {
		render(
			<MemoryRouter>
				<Developer />
			</MemoryRouter>,
		);

		expect(screen.getAllByText("Souyash Bera").length).toBeGreaterThan(0);
		expect(screen.getByText("Class 7B Creator", { exact: false })).toBeInTheDocument();
		expect(screen.getByText("2,639+")).toBeInTheDocument();
		expect(screen.getByText("Automated Tests")).toBeInTheDocument();
	});

	it("switches sandbox tabs and interacts with the Anonymity Engine", () => {
		render(
			<MemoryRouter>
				<Developer />
			</MemoryRouter>,
		);

		// Crypto simulator is active by default
		expect(screen.getByText("1. Anonymity Engine")).toBeInTheDocument();
		const input = screen.getByPlaceholderText("Type student concern...");
		fireEvent.change(input, { target: { value: "Test anonymous feedback" } });
		expect(input).toHaveValue("Test anonymous feedback");

		// Click copy anonymous token
		const copyTokenBtn = screen.getByRole("button", { name: /Copy Anonymous Token/i });
		fireEvent.click(copyTokenBtn);
		expect(navigator.clipboard.writeText).toHaveBeenCalled();
	});

	it("simulates AI moderation analysis in the AI sandbox tab", async () => {
		render(
			<MemoryRouter>
				<Developer />
			</MemoryRouter>,
		);

		// Switch to AI Moderation tab
		const aiTab = screen.getByRole("tab", { name: /2. AI Moderation Tester/i });
		fireEvent.click(aiTab);

		expect(screen.getByText("Real-Time School AI Moderation & Categorization")).toBeInTheDocument();

		// Click preset
		const presetBtn = screen.getByRole("button", { name: "Infra Issue" });
		fireEvent.click(presetBtn);

		const analyzeBtn = screen.getByRole("button", { name: /Analyze Post/i });
		fireEvent.click(analyzeBtn);

		await waitFor(() => {
			expect(screen.getByText("Toxicity Score")).toBeInTheDocument();
		});
	});

	it("executes CLI commands in the SouyashOS terminal", async () => {
		render(
			<MemoryRouter>
				<Developer />
			</MemoryRouter>,
		);

		expect(screen.getByText("SouyashOS Shell")).toBeInTheDocument();

		// Click a quick chip like 'whoami'
		const whoamiChip = screen.getByRole("button", { name: "whoami" });
		fireEvent.click(whoamiChip);

		expect(screen.getAllByText(/Class 7B/i).length).toBeGreaterThan(0);

		// Click clear
		const clearChip = screen.getByRole("button", { name: "clear" });
		fireEvent.click(clearChip);
	});

	it("allows switching milestone chapters in the journey story", async () => {
		render(
			<MemoryRouter>
				<Developer />
			</MemoryRouter>,
		);

		// Chapter 2: The Motivation
		const chapter2Btn = screen.getByRole("button", { name: /The Motivation/i });
		fireEvent.click(chapter2Btn);

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "Why I Built VoiceFlow", level: 3 }),
			).toBeInTheDocument();
		});

		expect(
			screen.getByText(/Schools are where young minds spend formative years/i),
		).toBeInTheDocument();
	});

	it("allows filtering technical stack items", () => {
		render(
			<MemoryRouter>
				<Developer />
			</MemoryRouter>,
		);

		const frontendFilter = screen.getByRole("button", { name: "frontend" });
		fireEvent.click(frontendFilter);

		expect(screen.getByText("React 19 & TypeScript")).toBeInTheDocument();
	});

	it("copies email to clipboard from the connect card", () => {
		render(
			<MemoryRouter>
				<Developer />
			</MemoryRouter>,
		);

		const copyEmailBtns = screen.getAllByRole("button", { name: /Connect|Copy Email/i });
		fireEvent.click(copyEmailBtns[0]!);

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("souyash@voiceflow.org");
	});
});
