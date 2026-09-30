import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores(["dist", "coverage"]),
	{
		files: ["**/*.{ts,tsx}"],
		extends: [
			js.configs.recommended,
			tseslint.configs.recommended,
			reactHooks.configs.flat.recommended,
			reactRefresh.configs.vite,
		],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		rules: {
			// React 19 compiler rules — too strict for existing admin panel patterns
			// These flag valid useEffect+setState patterns used for initial data fetching
			"react-hooks/set-state-in-effect": "off",
			"react-hooks/purity": "off",
			"react-hooks/immutability": "off",
			"react-hooks/refs": "off",
			"react-hooks/preserve-manual-memoization": "off",
			// Keep real bug rules enabled
			"react-hooks/rules-of-hooks": "error",
			"react-hooks/exhaustive-deps": "warn",
			// Downgrade any to warn — fix incrementally
			"@typescript-eslint/no-explicit-any": "warn",
			// Allow unused vars prefixed with _ (common convention)
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			// Control chars in sanitize() are intentional
			"no-control-regex": "off",
			// Files export both components and constants/types — standard pattern
			"react-refresh/only-export-components": "off",
		},
	},
	{
		// Ambient declarations describe untyped JS modules (api/*.js). `any` is
		// the correct type at that boundary — it is a declaration, not app code,
		// so the "no any" rule does not apply and must not fail the lint gate.
		files: ["**/*.d.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		// Test files: vi.mock factories and Web-platform mocks (speech, IO,
		// sentry events) are inherently dynamic. `any` is the sanctioned
		// exception for test doubles — never ship `any` in app code.
		files: [
			"**/*.test.{ts,tsx}",
			"**/__tests__/**/*.{ts,tsx}",
			"**/tests/**/*.{ts,tsx}",
		],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
]);
