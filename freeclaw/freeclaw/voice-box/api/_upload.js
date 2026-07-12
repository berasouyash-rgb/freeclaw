// Image upload to Supabase Storage (anonymous, size-capped)
import supabase from './_db-client.js';
import { cors, checkUser, clean } from './_auth.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fileBase64, contentType, author_id } = req.body || {};
    const gate = await checkUser(clean(author_id, 40));
    if (!gate.ok) return res.status(403).json({ error: gate.error });
    if (!fileBase64) return res.status(400).json({ error: 'No file' });
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(contentType || '')) {
      return res.status(400).json({ error: 'Only PNG, JPG, GIF or WebP images allowed.' });
    }
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 3 MB.' });
    const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
    const fileName = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('voicebox-media').upload(fileName, buffer, { contentType, upsert: true });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('voicebox-media').getPublicUrl(fileName);
    return res.status(200).json({ url: urlData.publicUrl });
  } catch (err) {
    console.error('upload API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
