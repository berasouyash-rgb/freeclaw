import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFeedKeyboardNav } from "../hooks/useFeedKeyboardNav";

// Mock react-router
const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
}));

// Mock haptics
vi.mock("../lib/haptics", () => ({
	triggerHaptic: vi.fn(),
}));

describe("useFeedKeyboardNav", () => {
	const mockItems = [
		{ id: "post-1", title: "First Post" },
		{ id: "post-2", title: "Second Post" },
		{ id: "post-3", title: "Third Post" },
	];

	it("initializes with activeIndex -1", () => {
		const { result } = renderHook(() =>
			useFeedKeyboardNav({ items: mockItems })
		);
		expect(result.current.activeIndex).toBe(-1);
		expect(result.current.activeId).toBeNull();
	});

	it("navigates forward with 'j' key", () => {
		const { result } = renderHook(() =>
			useFeedKeyboardNav({ items: mockItems })
		);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
		});

		expect(result.current.activeIndex).toBe(0);
		expect(result.current.activeId).toBe("post-1");

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
		});

		expect(result.current.activeIndex).toBe(1);
		expect(result.current.activeId).toBe("post-2");
	});

	it("navigates backward with 'k' key and clamps at 0", () => {
		const { result } = renderHook(() =>
			useFeedKeyboardNav({ items: mockItems })
		);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
		});
		expect(result.current.activeIndex).toBe(1);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
		});
		expect(result.current.activeIndex).toBe(0);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
		});
		expect(result.current.activeIndex).toBe(0);
	});

	it("handles Enter key to open focused post", () => {
		const onOpen = vi.fn();
		const { result } = renderHook(() =>
			useFeedKeyboardNav({ items: mockItems, onOpen })
		);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
		});

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		});

		expect(onOpen).toHaveBeenCalledWith(mockItems[0]);
	});

	it("navigates to /submit on 'n' key", () => {
		renderHook(() => useFeedKeyboardNav({ items: mockItems }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
		});

		expect(mockNavigate).toHaveBeenCalledWith("/submit");
	});

	it("ignores key events when typing inside an input element", () => {
		const { result } = renderHook(() =>
			useFeedKeyboardNav({ items: mockItems })
		);

		const input = document.createElement("input");
		document.body.appendChild(input);

		act(() => {
			const event = new KeyboardEvent("keydown", { key: "j" });
			Object.defineProperty(event, "target", { value: input });
			window.dispatchEvent(event);
		});

		expect(result.current.activeIndex).toBe(-1);
		document.body.removeChild(input);
	});
});
