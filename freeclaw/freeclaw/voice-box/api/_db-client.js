import { createClient } from '@supabase/supabase-js';
import { triggerRestore } from './_db-wake.js';

// Connection pooling: reuse client across warm invocations (Vercel keeps instances alive)
let _client = null;

/**
 * Server-side Supabase client.
 * Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS (API routes handle auth themselves).
 * Falls back to VITE_SUPABASE_ANON_KEY if service role key is not set (with RLS).
 */
function getClient() {
  if (_client) return _client;

  const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer service role key (bypasses RLS) — required for server-side operations
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('CRITICAL: Missing Supabase config. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  const isServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  _client = createClient(
    url || 'https://placeholder.supabase.co',
    key || 'placeholder',
    {
      global: {
        fetch: async (url, options) => {
          // Add request timeout to prevent hung connections
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok && res.status >= 500) triggerRestore();
            return res;
          } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') triggerRestore();
            throw err;
          }
        },
      },
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  if (!isServiceRole) {
    console.warn('⚠️ Using anon key for server-side client — RLS policies will be enforced. Set SUPABASE_SERVICE_ROLE_KEY for full access.');
  }

  return _client;
}

const supabase = getClient();
export default supabase;
