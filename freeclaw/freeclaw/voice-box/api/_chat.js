// Anonymous direct messaging between admin and anonymous users
import supabase from './_db-client.js';
import { cors, isAdmin, checkUser, clean, maskProfanity } from './_auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const { thread_id, threads } = req.query;
      if (threads === '1') {
        if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
        const [{ data: t }, { data: msgs }] = await Promise.all([
          supabase.from('chat_threads').select('*').order('updated_at', { ascending: false }),
          supabase.from('chat_messages').select('thread_id,sender,read,body,created_at').order('created_at', { ascending: false }).limit(1000),
        ]);
        const enriched = (t || []).map((th) => {
          const mine = (msgs || []).filter((m) => m.thread_id === th.thread_id);
          return {
            ...th,
            last_message: mine[0]?.body || '',
            last_at: mine[0]?.created_at || th.updated_at,
            unread: mine.filter((m) => m.sender === 'user' && !m.read).length,
          };
        });
        return res.status(200).json(enriched);
      }
      if (!thread_id) return res.status(400).json({ error: 'Missing thread_id' });
      const [{ data: msgs, error }, { data: thread }] = await Promise.all([
        supabase.from('chat_messages').select('*').eq('thread_id', thread_id).order('created_at', { ascending: true }).limit(500),
        supabase.from('chat_threads').select('*').eq('thread_id', thread_id).maybeSingle(),
      ]);
      if (error) throw error;
      return res.status(200).json({ messages: msgs || [], thread: thread || null });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const thread_id = clean(b.thread_id, 40);
      if (!thread_id) return res.status(400).json({ error: 'Missing thread_id' });
      const fromAdmin = b.sender === 'admin' && (await isAdmin(req));
      if (!fromAdmin) {
        const gate = await checkUser(thread_id);
        if (!gate.ok) return res.status(403).json({ error: gate.error });
      }
      const body = maskProfanity(clean(b.body, 1000));
      if (!body && !b.attachment_url) return res.status(400).json({ error: 'Empty message' });
      // Ensure thread exists / bump
      const { data: existing } = await supabase.from('chat_threads').select('thread_id').eq('thread_id', thread_id).maybeSingle();
      const now = new Date().toISOString();
      if (existing) await supabase.from('chat_threads').update({ updated_at: now, status: 'open' }).eq('thread_id', thread_id);
      else await supabase.from('chat_threads').insert({ thread_id, status: 'open', updated_at: now });
      const { data, error } = await supabase.from('chat_messages').insert({
        thread_id, sender: fromAdmin ? 'admin' : 'user', body,
        attachment_url: clean(b.attachment_url, 500) || null,
      }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const b = req.body || {};
      const admin = await isAdmin(req);
      if (b.action === 'mark_read') {
        // admin marks user messages read; user marks admin messages read
        const senderToMark = admin && b.as === 'admin' ? 'user' : 'admin';
        await supabase.from('chat_messages').update({ read: true }).eq('thread_id', b.thread_id).eq('sender', senderToMark);
        return res.status(200).json({ ok: true });
      }
      if (b.action === 'set_status') {
        if (!admin) return res.status(403).json({ error: 'Admin only' });
        await supabase.from('chat_threads').update({ status: b.status === 'closed' ? 'closed' : 'open', updated_at: new Date().toISOString() }).eq('thread_id', b.thread_id);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('chat API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
