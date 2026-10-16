import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Typewriter from "../components/Typewriter";

describe("Typewriter", () => {
	it("reveals the full server text progressively, then holds it", () => {
		vi.useFakeTimers();
		try {
			render(<Typewriter text="Hello world" cps={1000} label="AI reply" />);
			const region = screen.getByLabelText("AI reply");
			expect(region.textContent).not.toContain("Hello world");
			act(() => {
				vi.advanceTimersByTime(1000);
			});
			expect(region.textContent).toContain("Hello world");
			expect(region.querySelector(".vb-caret")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("never invents text beyond what the server sent", () => {
		vi.useFakeTimers();
		try {
			render(<Typewriter text="exact" cps={1000} label="AI reply" />);
			act(() => {
				vi.advanceTimersByTime(5000);
			});
			expect(screen.getByLabelText("AI reply").textContent).toContain("exact");
		} finally {
			vi.useRealTimers();
		}
	});
});
