// AppealPanel — files recourse for safety-blocked writes without publishing.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppealPanel from "../components/AppealPanel";

const postMock = vi.fn();
const toastMock = vi.fn();

vi.mock("../lib/api", () => ({
	api: { post: (...args: unknown[]) => postMock(...args) },
}));
vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: toastMock, anonId: "anon-1" }),
}));

function renderPanel() {
	return render(
		<MemoryRouter>
			<AppealPanel surface="post" title="Canteen sucks" body="food sucks daily" />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	postMock.mockReset();
	toastMock.mockClear();
});

describe("AppealPanel", () => {
	it("files the blocked text + reason and confirms with a tracking link", async () => {
		const user = userEvent.setup();
		postMock.mockResolvedValue({ id: "apl_1", status: "open" });
		renderPanel();
		await user.type(screen.getByLabelText(/appeal reason/i), "honest food complaint");
		await user.click(screen.getByRole("button", { name: /appeal this decision/i }));
		await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/appeals", expect.objectContaining({
			surface: "post",
			title: "Canteen sucks",
			body: "food sucks daily",
			reason: "honest food complaint",
			author_id: "anon-1",
		})));
		expect(await screen.findByTestId("appeal-confirmation")).toBeTruthy();
		expect(screen.getByText(/my activity/i).closest("a")?.getAttribute("href")).toBe("/activity");
	});

	it("treats a deduped refile as filed, not an error", async () => {
		const user = userEvent.setup();
		postMock.mockResolvedValue({ id: "apl_9", status: "open", deduped: true });
		renderPanel();
		await user.click(screen.getByRole("button", { name: /appeal this decision/i }));
		expect(await screen.findByTestId("appeal-confirmation")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("surfaces filing failures inline (e.g. appeals exhausted)", async () => {
		const user = userEvent.setup();
		postMock.mockRejectedValue(new Error("Too many open appeals (3). Wait for review before filing more."));
		renderPanel();
		await user.click(screen.getByRole("button", { name: /appeal this decision/i }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByTestId("appeal-confirmation")).toBeNull();
	});

	it("previews what will be sent with contacts masked (moderators see full text)", async () => {
		render(
			<MemoryRouter>
				<AppealPanel
					surface="post"
					title="Call me on 123-456-7890"
					body="my mail is me@example.com please help"
				/>
			</MemoryRouter>,
		);
		const preview = await screen.findByTestId("appeal-preview");
		expect(preview.textContent).not.toContain("123-456-7890");
		expect(screen.getByText("Moderators see the full text.")).toBeInTheDocument();
	});
});
