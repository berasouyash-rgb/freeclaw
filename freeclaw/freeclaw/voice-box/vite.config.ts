import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import {
	defineConfig,
	loadEnv,
	type PluginOption,
	type UserConfig,
} from "vite";
// @ts-expect-error — dev-only plugin (.mjs has no type declarations)
import { apiDev } from "./plugins/api-dev.mjs";

// https://vite.dev/config/
export default defineConfig(async ({ mode }): Promise<UserConfig> => {
	const plugins: PluginOption[] = [react(), tailwindcss()];
	// Local full-stack dev: mount the Vercel serverless API (api/index.js) inside
	// the dev server so /api/* works under `npm run dev` (build-only, never bundled).
	plugins.push(apiDev());
	try {
		// @ts-expect-error — generated .js plugin with no type declarations
		const m = await import("./.vite-source-tags.js");
		plugins.push(m.sourceTags());
	} catch {
		/* optional — skip when source-tags plugin is absent */
	}

	const env = loadEnv(mode, process.cwd(), [
		"VITE_",
		"NEXT_PUBLIC_",
		"SENTRY_",
	]);

	// Sentry source map upload (only when auth token is configured)
	const sentryAuthToken =
		env.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN;
	if (sentryAuthToken && mode === "production") {
		plugins.push(
			sentryVitePlugin({
				authToken: sentryAuthToken,
				org: env.SENTRY_ORG || process.env.SENTRY_ORG || "4511824665968640",
				project:
					env.SENTRY_PROJECT ||
					process.env.SENTRY_PROJECT ||
					"4511824685760512",
				telemetry: false,
			}),
		);
	}

	const processEnvDefines: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		// SENTRY_* are server-side config (SENTRY_AUTH_TOKEN is a secret) —
		// never inline them into the client bundle.
		if (key.startsWith("SENTRY_")) continue;
		processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
	}

	// Health manifest: write dist/health-chunks.json after each build.
	// closeBundle is a Rollup *plugin* hook — a top-level config property is
	// silently ignored by Vite, which is why the manifest never appeared.
	plugins.push({
		name: "health-chunks",
		closeBundle() {
			const assetsDir = join(__dirname, "dist", "assets");
			if (!existsSync(assetsDir)) return;
			const files = readdirSync(assetsDir).filter(
				(f) => f.endsWith(".js") && !f.endsWith(".js.map"),
			);
			const chunks = files.map((f) => {
				const fp = join(assetsDir, f);
				const size = statSync(fp).size;
				return { name: f, size, sizeKB: Math.round(size / 1024) };
			});
			writeFileSync(
				join(__dirname, "dist", "health-chunks.json"),
				JSON.stringify(
					{ generated: new Date().toISOString(), count: chunks.length, chunks },
					null,
					2,
				),
			);
			console.log(
				`[health] Generated health-chunks.json with ${chunks.length} chunks ✓`,
			);
		},
	});

	return {
		plugins,
		envPrefix: ["VITE_", "NEXT_PUBLIC_"],
		define: processEnvDefines,
		css: {
			// Lightning CSS transpiles modern color syntax (color-mix, oklab/oklch)
			// into plain rgba() fallbacks so older Android WebViews render correctly.
			transformer: "lightningcss" as const,
			lightningcss: {
				targets: { chrome: 87 << 16, safari: 14 << 16, firefox: 78 << 16 },
			},
		},
		build: {
			cssMinify: "lightningcss" as const,
			target: "es2018",
			cssTarget: "chrome87",
			// Source maps needed for Sentry (but only uploaded in production)
			sourcemap: mode === "production",
			rollupOptions: {
				output: {
					manualChunks: {
						react: ["react", "react-dom", "react-router"],
						supabase: ["@supabase/supabase-js"],
						icons: ["lucide-react"],
						// Animation libs are used by the cinematic preloader — isolated so
						// they load in parallel and can be cached independently from app code.
						animation: ["framer-motion"],
					},
					compact: true,
				},
			},
			minify: "esbuild",
			chunkSizeWarningLimit: 300,
			// In production, esbuild removes console.* and debugger statements
		},
	};
});
