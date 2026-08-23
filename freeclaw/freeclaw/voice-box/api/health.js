// Health check — proves DB reachability for uptime monitors.
// Public endpoint, no auth. Keep it cheap (1 row, no count).
import supabase from "./_db-client.js";

export default async function handler(req, res) {
  // CORS: allow uptime monitors from any origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const t0 = Date.now();
  try {
    const { error } = await supabase.from("settings").select("key").limit(1);
    if (error) {
      return res.status(503).json({ ok: false, db: false, latency_ms: Date.now() - t0, error: error.message });
    }
    return res.status(200).json({ ok: true, db: true, latency_ms: Date.now() - t0, timestamp: new Date().toISOString() });
  } catch (err) {
    return res.status(503).json({ ok: false, db: false, latency_ms: Date.now() - t0, error: err.message });
  }
}
