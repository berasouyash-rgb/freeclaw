import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
	UserProfileDialog,
	getAnonymousProfile,
	type UserProfileMeta,
} from "../components/UserProfileDialog";

describe("getAnonymousProfile", () => {
	it("returns deterministic avatar emoji and handle for anon id", () => {
		const p1 = getAnonymousProfile("anon_1a2b3c4d5e");
		const p2 = getAnonymousProfile("anon_1a2b3c4d5e");
		expect(p1.emoji).toBe(p2.emoji);
		expect(p1.className).toBe(p2.className);
		expect(p1.handle).toBe("anon_1a2b3");
	});

	it("returns Admin shield and style for ADMIN", () => {
		const admin = getAnonymousProfile("ADMIN");
		expect(admin.emoji).toBe("🛡️");
		expect(admin.handle).toBe("Admin");
	});
});

describe("UserProfileDialog", () => {
	it("renders anonymous student profile with OP badge and mention action", () => {
		const onMention = vi.fn();
		const onClose = vi.fn();
		const meta: UserProfileMeta = {
			authorId: "anon_9876543210",
			isAdmin: false,
			isMine: false,
			isOp: true,
		};

		render(
			<BrowserRouter>
				<UserProfileDialog
					profileMeta={meta}
					onClose={onClose}
					onMention={onMention}
				/>
			</BrowserRouter>,
		);

		expect(screen.getByText(/Author Profile/i)).toBeInTheDocument();
		expect(screen.getByText("OP")).toBeInTheDocument();
		expect(screen.getByText(/Post Author \(OP\)/i)).toBeInTheDocument();
		expect(screen.getByText(/100% Anonymous & Private/i)).toBeInTheDocument();

		const mentionBtn = screen.getByRole("button", { name: /Mention in reply/i });
		fireEvent.click(mentionBtn);
		expect(onMention).toHaveBeenCalledWith("anon_98765");
		expect(onClose).toHaveBeenCalled();
	});

	it("renders own profile with custom bio and settings link", () => {
		const onClose = vi.fn();
		const meta: UserProfileMeta = {
			authorId: "anon_mine",
			isMine: true,
		};

		render(
			<BrowserRouter>
				<UserProfileDialog
					profileMeta={meta}
					displayName="Alex"
					localProfile={{ avatar: "🦊", bio: "Coding late at night", photo: "" }}
					onClose={onClose}
				/>
			</BrowserRouter>,
		);

		expect(screen.getByText("Your Anonymous Profile")).toBeInTheDocument();
		expect(screen.getByText("Alex (You)")).toBeInTheDocument();
		expect(screen.getByText("Coding late at night")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /Edit Profile & Bio/i })).toHaveAttribute("href", "/settings");
	});

	it("renders official administrator profile", () => {
		const onClose = vi.fn();
		const meta: UserProfileMeta = {
			authorId: "ADMIN",
			isAdmin: true,
		};

		render(
			<BrowserRouter>
				<UserProfileDialog
					profileMeta={meta}
					onClose={onClose}
				/>
			</BrowserRouter>,
		);

		expect(screen.getByText("Administrator Profile")).toBeInTheDocument();
		expect(screen.getByText("Official Administrator")).toBeInTheDocument();
		expect(screen.getByText("School Staff")).toBeInTheDocument();
	});
});
