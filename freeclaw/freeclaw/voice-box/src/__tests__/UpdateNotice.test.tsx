import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UpdateNotice from "../components/admin/UpdateNotice";

describe("UpdateNotice", () => {
  it("renders nothing when there are no updates", () => {
    const { container } = render(
      <UpdateNotice count={0} onViewUpdates={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("announces and exposes a keyboard-operable View updates action", () => {
    const onViewUpdates = vi.fn();
    render(
      <UpdateNotice
        count={3}
        onViewUpdates={onViewUpdates}
        lastUpdatedAt={Date.now() - 5_000}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("3 new updates");
    const button = screen.getByRole("button", { name: "View 3 new updates" });
    expect(button).toBeEnabled();
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onViewUpdates).toHaveBeenCalledTimes(1);
  });

  it("disables only the explicit action while refreshing", () => {
    render(
      <UpdateNotice
        count={1}
        onViewUpdates={vi.fn()}
        refreshing
      />,
    );

    expect(screen.getByRole("button", { name: "View 1 new update" })).toBeDisabled();
  });
});
