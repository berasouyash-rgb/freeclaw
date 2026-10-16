// Global jest-dom matcher types (toBeInTheDocument, toBeDisabled, …) for
// every test under src/. Runtime setup lives in tests/setup.ts (vitest
// setupFiles); this side-effect import only carries the TYPE augmentation
// into the tsc program, which otherwise sees no jest-dom import.
import "@testing-library/jest-dom/vitest";
