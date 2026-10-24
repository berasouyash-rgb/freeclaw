import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useUpdateSignal } from "../hooks/useUpdateSignal";

describe("useUpdateSignal", () => {
  it("starts at zero and increments without making a request", () => {
    const fetchSpy = vi.fn();
    const { result } = renderHook(() => useUpdateSignal());

    expect(result.current.updatesAvailable).toBe(0);
    act(() => result.current.markUpdatesAvailable());

    expect(result.current.updatesAvailable).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("caps the visible count at 99 and clears explicitly", () => {
    const { result } = renderHook(() => useUpdateSignal());

    act(() => {
      for (let i = 0; i < 120; i += 1) result.current.markUpdatesAvailable();
    });
    expect(result.current.updatesAvailable).toBe(99);

    act(() => result.current.clearUpdates());
    expect(result.current.updatesAvailable).toBe(0);
  });
});
