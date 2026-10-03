import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DraftProposal from "../components/admin/DraftProposal";

const PROPOSAL = {
	title: "Broken lift in Block C",
	description: "The lift has been broken for two days.",
	category: "Facilities",
	private: true,
	status: "proposed",
	trigger: "student-request",
};

describe("DraftProposal", () => {
	it("shows title, category, description, and the student's words", () => {
		render(
			<DraftProposal
				proposal={PROPOSAL}
				excerpt={["The lift in Block C is broken"]}
				busy={false}
				onAccept={vi.fn()}
				onReject={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("draft-proposal")).toBeInTheDocument();
		expect(screen.getByText("Broken lift in Block C")).toBeInTheDocument();
		expect(screen.getByText("Facilities")).toBeInTheDocument();
		expect(screen.getByText(/broken for two days/)).toBeInTheDocument();
		expect(screen.getByText(/The lift in Block C is broken/)).toBeInTheDocument();
		expect(screen.getByText("Student request")).toBeInTheDocument();
	});

	it("defaults the visibility toggle from the draft and flips it", () => {
		render(
			<DraftProposal
				proposal={PROPOSAL}
				excerpt={[]}
				busy={false}
				onAccept={vi.fn()}
				onReject={vi.fn()}
			/>,
		);
		const toggle = screen.getByRole("switch", { name: "Private post" });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(screen.getByText(/goes through review/)).toBeInTheDocument();
	});

	it("accepts with the toggled visibility and rejects plainly", () => {
		const onAccept = vi.fn();
		const onReject = vi.fn();
		render(
			<DraftProposal
				proposal={PROPOSAL}
				excerpt={[]}
				busy={false}
				onAccept={onAccept}
				onReject={onReject}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Accept post" }));
		expect(onAccept).toHaveBeenCalledWith("private");
		fireEvent.click(screen.getByRole("button", { name: "Reject" }));
		expect(onReject).toHaveBeenCalledTimes(1);
	});

	it("disables both actions while busy", () => {
		render(
			<DraftProposal
				proposal={PROPOSAL}
				excerpt={[]}
				busy
				onAccept={vi.fn()}
				onReject={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Accept post" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
	});
});

describe("DraftProposal — proposed-time", () => {
  it("stamps when the draft was proposed", async () => {
    const { default: DraftProposal } = await import("../components/admin/DraftProposal");
    const { render, screen } = await import("@testing-library/react");
    render(
      <DraftProposal
        proposal={{
          title: "T", description: "D", category: "Other", private: true,
          status: "proposed", at: new Date(Date.now() - 3600_000).toISOString(),
        }}
        excerpt={[]}
        busy={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.getByText(/proposed /)).toBeInTheDocument();
  });
});
