// Image upload to Supabase Storage (anonymous, size-capped)
// FALLBACK: If Supabase Storage fails, returns a data-URL so images always work.
import supabase from './_db-client.js';
import { cors, checkUser, clean } from './_auth.js';
import { sanitizeError } from './_error.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Primary bucket — if it doesn't exist, try alternatives
const BUCKETS = ['chat-media', 'voicebox-media'];

export default async function handler(req, res) {
  cors(res, req);
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

    // Try each available bucket
    for (const bucket of BUCKETS) {
      try {
        const ext = (contentType.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const fileName = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(bucket).upload(fileName, buffer, { contentType, upsert: true });
        if (error) {
          console.warn(`Upload to bucket '${bucket}' failed:`, error.message);
          continue; // try next bucket
        }
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
        return res.status(200).json({ url: urlData.publicUrl, storage: bucket });
      } catch (e) {
        console.warn(`Bucket '${bucket}' error:`, e.message);
        continue;
      }
    }

    // FALLBACK: All storage buckets failed — return data URL so the image still works
    console.warn('All storage buckets failed — falling back to data URL');
    const dataUrl = `data:${contentType || 'image/png'};base64,${fileBase64}`;
    return res.status(200).json({ url: dataUrl, storage: 'fallback-data-url' });
  } catch (err) {
    console.error('upload API error:', err);
    // Last-resort fallback: return data URL
    try {
      const { fileBase64: fb64, contentType: ct } = req.body || {};
      if (fb64) {
        const dataUrl = `data:${ct || 'image/png'};base64,${fb64}`;
        return res.status(200).json({ url: dataUrl, storage: 'fallback-data-url' });
      }
    } catch { console.error('[upload] Last-resort data URL fallback also failed'); }
    return sanitizeError(res, err, 'upload');
  }
}
