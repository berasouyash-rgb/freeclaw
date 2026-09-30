import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["tests/api/**/*.test.ts"],
	setupFiles: ["tests/api/setup-env.ts"],
		testTimeout: 30000,
		hookTimeout: 30000,
		// PROCESS POOL (forks), not threads: the default threads pool races
		// console logs against per-worker RPC teardown on Windows, throwing a
		// spurious "EnvironmentTeardownError: Closing rpc while
		// 'onUserConsoleLog' was pending" and failing the suite even though all
		// 843 tests pass. Verified: full suite is green under --pool=forks.
		pool: "forks",
	},
});
