// Server-side content moderation endpoint
import { cors, moderateContent } from './_auth.js';
import { sanitizeError } from './_error.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text field' });
    }

    const result = moderateContent(text);
    return res.status(200).json(result);
  } catch (err) {
    return sanitizeError(res, err, 'moderation');
  }
}
