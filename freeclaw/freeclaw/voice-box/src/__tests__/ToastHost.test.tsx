/**
 * ToastHost — regression tests for the app-wide toast host.
 *
 * REGRESSION: the toast host used to live inside <Layout>, but /admin/*
 * mounts outside Layout. Every toast() in the admin console (login
 * success/failure, session expiry, moderation actions) updated state that
 * nothing rendered — admins got zero feedback. The host now mounts once at
 * the AppProvider level; these tests pin the rendering contract:
 *   - toasts render with their text
 *   - error kinds carry the error styling
 *   - action toasts render their action button
 *   - the container is aria-live + never intercepts clicks
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProvider, useApp } from "../contexts/AppContext";
import ToastHost from "../components/ToastHost";

function Fire() {
	const { toast } = useApp();
	return (
		<div>
			<button onClick={() => toast("Saved successfully", "ok")}>fire-ok</button>
			<button onClick={() => toast("Incorrect password.", "err")}>fire-err</button>
			<button
				onClick={() =>
					toast("Undo?", "info", { label: "Undo", fn: () => {} })
				}
			>
				fire-action
			</button>
			<ToastHost />
		</div>
	);
}

function renderHost() {
	return render(
		<AppProvider>
			<Fire />
		</AppProvider>,
	);
}

describe("ToastHost", () => {
	it("renders a fired toast's text", () => {
		renderHost();
		fireEvent.click(screen.getByText("fire-ok"));
		expect(screen.getByText("Saved successfully")).toBeInTheDocument();
	});

	it("marks error toasts with the error styling", () => {
		renderHost();
		fireEvent.click(screen.getByText("fire-err"));
		const card = screen.getByText("Incorrect password.").closest("div");
		expect(card?.className).toContain("text-bad");
	});

	it("renders the action button on an action toast", () => {
		renderHost();
		fireEvent.click(screen.getByText("fire-action"));
		expect(
			screen.getByRole("button", { name: "Undo" }),
		).toBeInTheDocument();
	});

	it("host container is a polite live region that never intercepts clicks", () => {
		renderHost();
		fireEvent.click(screen.getByText("fire-ok"));
		const host = screen
			.getByText("Saved successfully")
			.closest('[role="status"]');
		expect(host).not.toBeNull();
		expect(host?.className).toContain("pointer-events-none");
	});
});
