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
		// OOM guard: jsdom + heavy dynamic imports exhaust fork-worker memory.
		//
		// Do NOT collapse every file into one long-lived process. `singleFork`
		// reuses a single child for all 165 files, so V8's heap only grows:
		// the run died with "FATAL ERROR: Zone Allocation failed - process out
		// of memory" and the crash was reported as 9 failed files / 30 failed
		// tests that do not fail in isolation. Per-file isolation (the forks
		// pool default) lets each worker exit and give its memory back, which
		// is what actually keeps the suite deterministic.
		//
		// Width is pinned to ONE worker on purpose. The suite is 165 jsdom
		// files; on a machine already holding ~11 GB of unrelated apps, two
		// or three concurrent 3 GB workers trip the OS out-of-memory killer
		// and the crash surfaces as fake "failed files". A single worker that
		// is recycled per file (the forks-pool default isolation) caps peak
		// memory at one file's worth instead of the whole suite's.
		pool: "forks",
		fileParallelism: false,
		forks: {
			singleFork: false,
			execArgv: ["--max-old-space-size=2048"],
		},
		maxWorkers: 1,
		minWorkers: 1,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/", "tests/"],
		},
	},
});
