// ═══════════════════════════════════════════════════════════════════
// API test env isolation
// ═══════════════════════════════════════════════════════════════════
// Vitest loads the repo .env into process.env, so the real
// VITE_SUPABASE_* values leak into every API test. Any code path that
// builds a public Supabase client (e.g. publicClient() in
// api/_workforce-workers.js) would then fire REAL network requests —
// the suite silently depends on the network and a live project (this
// caused the anonymity-guard budget-cap test to exceed its 30s timeout).
//
// Blank the public config at setup time so such clients return null and
// fall back to their local/mocked paths. Server-side _db-client.js is
// mocked per test file; blanking the URL here makes any non-mocked use
// fail fast instead of hitting the network.
// ═══════════════════════════════════════════════════════════════════

import { vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
