import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CurvedMobileNav } from "../components/CurvedMobileNav";

describe("CurvedMobileNav — Fluid Curved Floating Bottom Nav", () => {
	it("renders all five primary navigation tabs plus the More button", () => {
		const onOpenMore = vi.fn();
		render(
			<MemoryRouter initialEntries={["/"]}>
				<CurvedMobileNav
					chatUnread={0}
					unreadAlerts={0}
					moreOpen={false}
					onOpenMore={onOpenMore}
				/>
			</MemoryRouter>,
		);

		const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
		expect(nav).toBeInTheDocument();

		expect(screen.getByRole("link", { name: "Feed" })).toHaveAttribute("href", "/");
		expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
		expect(screen.getByRole("link", { name: "Submit" })).toHaveAttribute("href", "/submit");
		expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/chat");
		expect(screen.getByRole("link", { name: "Me" })).toHaveAttribute("href", "/activity");
		expect(screen.getByRole("button", { name: "More pages" })).toBeInTheDocument();
	});

	it("shows chat unread badge on the Inbox link", () => {
		render(
			<MemoryRouter initialEntries={["/"]}>
				<CurvedMobileNav
					chatUnread={4}
					unreadAlerts={0}
					moreOpen={false}
					onOpenMore={vi.fn()}
				/>
			</MemoryRouter>,
		);

		expect(
			screen.getByRole("link", { name: "Inbox, 4 unread" }),
		).toBeInTheDocument();
		expect(screen.getByText("4")).toBeInTheDocument();
	});

	it("shows unread alerts on the More button", () => {
		render(
			<MemoryRouter initialEntries={["/"]}>
				<CurvedMobileNav
					chatUnread={0}
					unreadAlerts={2}
					moreOpen={false}
					onOpenMore={vi.fn()}
				/>
			</MemoryRouter>,
		);

		expect(
			screen.getByRole("button", { name: "More pages, 2 unread alerts" }),
		).toBeInTheDocument();
	});

	it("triggers onOpenMore when clicking the More button", () => {
		const onOpenMore = vi.fn();
		render(
			<MemoryRouter initialEntries={["/"]}>
				<CurvedMobileNav
					chatUnread={0}
					unreadAlerts={0}
					moreOpen={false}
					onOpenMore={onOpenMore}
				/>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole("button", { name: "More pages" }));
		expect(onOpenMore).toHaveBeenCalledTimes(1);
	});

	it("correctly identifies active route when on /search", () => {
		render(
			<MemoryRouter initialEntries={["/search"]}>
				<CurvedMobileNav
					chatUnread={0}
					unreadAlerts={0}
					moreOpen={false}
					onOpenMore={vi.fn()}
				/>
			</MemoryRouter>,
		);

		const searchLink = screen.getByRole("link", { name: "Search" });
		expect(searchLink.className).toContain("text-accent");
	});
});
