import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Download from "../pages/Download";

function feed(body: unknown, ok = true) {
	return vi.fn(async () => ({
		ok,
		json: async () => body,
	})) as unknown as typeof fetch;
}

beforeEach(() => {
	vi.unstubAllGlobals();
});

describe("Download page", () => {
	it("shows the recommended device build with a tap-to-download link", async () => {
		vi.stubGlobal(
			"fetch",
			feed({
				app: "voice-flow",
				platforms: {
					android: { version: "2.1.0", url: "https://example.com/a.apk" },
					windows: { version: "2.1.0", url: "https://example.com/a.exe" },
				},
			}),
		);
		render(
			<MemoryRouter>
				<Download />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText("Recommended for this device")).toBeInTheDocument();
		});
		const links = screen.getAllByRole("link", { name: /download/i });
		expect(links.length).toBeGreaterThan(0);
		for (const a of links) {
			expect(a.getAttribute("href") || "").toMatch(/^https:\/\//);
		}
	});

	it("is honest when no releases are published yet", async () => {
		vi.stubGlobal("fetch", feed({ app: "voice-flow", platforms: {} }));
		render(
			<MemoryRouter>
				<Download />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(
				screen.getByText(/no packaged releases published yet/i),
			).toBeInTheDocument();
		});
	});

	it("stays usable when the feed is unreachable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}) as unknown as typeof fetch,
		);
		render(
			<MemoryRouter>
				<Download />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole("alert")).toBeInTheDocument();
		});
	});
});
