import { createClient } from '@supabase/supabase-js';
import { triggerRestore } from './_db-wake.js';

// Connection pooling: reuse client across warm invocations (Vercel keeps instances alive)
let _client = null;

function getClient() {
  if (_client) return _client;

  _client = createClient(
    process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: {
        fetch: async (url, options) => {
          // Add request timeout to prevent hung connections
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
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
    }
  );

  return _client;
}

const supabase = getClient();
export default supabase;
