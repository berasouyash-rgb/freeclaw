import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./tests/setup.ts"],
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		// A single test takes <2s alone, but under full-suite parallel load
		// (many files, heavy dynamic imports) CPU contention regularly pushes
		// past the 5s default. 15s catches genuine deadlocks while absorbing
		// load spikes — this killed the whole class of stress-run flakes.
		testTimeout: 15_000,
		hookTimeout: 15_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/", "tests/"],
		},
	},
});
