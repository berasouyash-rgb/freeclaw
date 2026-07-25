import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client — used for Realtime subscriptions only.
 * All data writes go through API routes (server-side client with service role key).
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('CRITICAL: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder',
  {
    realtime: { params: { eventsPerSecond: 5 } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export default supabase;
