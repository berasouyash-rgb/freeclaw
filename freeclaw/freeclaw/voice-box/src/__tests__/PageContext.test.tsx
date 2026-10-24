import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import {
	PageContextProvider,
	usePageContext,
} from "../components/admin/PageContext";

function Probe() {
	const context = usePageContext();
	return (
		<output data-testid="context">
			{context.page}|{context.pageTitle}|{JSON.stringify(context.filters)}
		</output>
	);
}

describe("PageContext admin tab contract", () => {
	it("uses the canonical query tab and excludes it from filters", () => {
		render(
			<MemoryRouter initialEntries={["/admin?tab=reports&status=open"]}>
				<PageContextProvider>
					<Probe />
				</PageContextProvider>
			</MemoryRouter>,
		);

		expect(screen.getByTestId("context")).toHaveTextContent(
			'reports|Reports|{"status":"open"}',
		);
	});

	it("falls back to Dashboard for an unknown tab", () => {
		render(
			<MemoryRouter initialEntries={["/admin?tab=builder"]}>
				<PageContextProvider>
					<Probe />
				</PageContextProvider>
			</MemoryRouter>,
		);

		expect(screen.getByTestId("context")).toHaveTextContent(
			"dashboard|Dashboard|{}",
		);
	});
});
