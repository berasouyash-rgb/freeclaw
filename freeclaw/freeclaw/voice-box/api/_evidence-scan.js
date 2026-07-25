// Evidence Upload Scanner — scans uploaded files for PII, explicit content, malware patterns.
//
// POST /api/evidence/scan
//   { file_url, file_type, file_name, author_id }
//
// Returns:
//   { safe: boolean, risk_level: 'low'|'medium'|'high', findings: string[], recommendation: string }

import supabase from './_db-client.js';
import { cors, auditLog } from './_auth.js';

// ─── File Type Risk Assessment ──────────────────────────────────
const HIGH_RISK_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MEDIUM_RISK_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const LOW_RISK_TYPES = ['text/plain', 'text/csv'];

const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.com', '.scr', '.pif', '.vbs', '.js', '.ws', '.wsh'];

// ─── Content Analysis Patterns ──────────────────────────────────
const PII_PATTERNS = [
  { name: 'Phone number', regex: /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g },
  { name: 'Email address', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'SSN pattern', regex: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g },
  { name: 'Credit card', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
  { name: 'Date of birth', regex: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g },
  { name: 'Address', regex: /\b\d{1,5}\s+[a-zA-Z\s]+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl)\b/gi },
];

const EXPLICIT_PATTERNS = [
  { name: 'Explicit content keywords', regex: /\b(nude|naked|sex tape|porn|xxx|explicit|onlyfans)\b/gi },
  { name: 'Threatening language', regex: /\b(kill|murder|shoot|stab|bomb|burn down|destroy)\b/gi },
  { name: 'Blackmail indicators', regex: /\b(if you don't|or else|pay me|i'll tell|i'll post|i'll share)\b/gi },
];

const MALWARE_INDICATORS = [
  'eval(',
  'exec(',
  'system(',
  'subprocess',
  'child_process',
  'require(',
  'import os',
  'shell_exec',
  'passthru',
  'base64_decode',
  'unescape(',
  'fromcharcode',
];

// ─── Main Handler ───────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { file_url, file_type, file_name, author_id } = req.body || {};

  if (!file_url && !file_name) {
    return res.status(400).json({ error: 'file_url or file_name required' });
  }

  const startTime = Date.now();
  const findings = [];
  let riskLevel = 'low';
  const SCAN_TIMEOUT_MS = 25000; // FIX-M8: 25s overall timeout for entire scan

  try {
    // Wrap entire scan in 25s timeout to prevent cold-start hangs
    await Promise.race([
      (async () => {
    // 1. Check file extension
    const ext = (file_name || '').toLowerCase().split('.').pop();
    const dangerousExt = DANGEROUS_EXTENSIONS.some(d => d.endsWith(`.${ext}`));
    if (dangerousExt) {
      findings.push(`Dangerous file extension detected: .${ext}`);
      riskLevel = 'high';
    }

    // 2. Check MIME type risk
    if (HIGH_RISK_TYPES.includes(file_type)) {
      findings.push(`High-risk file type: ${file_type} — may contain embedded content`);
      if (riskLevel !== 'high') riskLevel = 'medium';
    } else if (MEDIUM_RISK_TYPES.includes(file_type)) {
      findings.push(`Medium-risk file type: ${file_type} — image files may contain embedded PII`);
      if (riskLevel === 'low') riskLevel = 'medium';
    }

    // 3. If it's a text-based file, try to scan content
    if (file_url && (file_type?.includes('text') || file_type?.includes('pdf') || ext === 'txt' || ext === 'csv' || ext === 'md')) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(file_url, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.ok) {
          const text = await response.text().catch(() => '');

          // Scan for PII
          for (const pattern of PII_PATTERNS) {
            const matches = text.match(pattern.regex);
            if (matches?.length) {
              findings.push(`${pattern.name} detected (${matches.length} instance${matches.length > 1 ? 's' : ''})`);
              riskLevel = 'high';
            }
          }

          // Scan for explicit content
          for (const pattern of EXPLICIT_PATTERNS) {
            const matches = text.match(pattern.regex);
            if (matches?.length) {
              findings.push(`${pattern.name} detected (${matches.length} instance${matches.length > 1 ? 's' : ''})`);
              riskLevel = 'high';
            }
          }

          // Scan for malware indicators
          const lowerText = text.toLowerCase();
          const malwareHits = MALWARE_INDICATORS.filter(m => lowerText.includes(m));
          if (malwareHits.length) {
            findings.push(`Potential code injection patterns: ${malwareHits.join(', ')}`);
            riskLevel = 'high';
          }
        }
      } catch {
        // File not downloadable or timeout — not an error, just skip content scan
        findings.push('Content scan skipped — file not directly accessible');
      }
    }

    // 4. Check file size via Content-Length if available
    if (file_url) {
      try {
        const headRes = await fetch(file_url, { method: 'HEAD' }).catch(() => null);
        const contentLength = headRes?.headers?.get('content-length');
        if (contentLength) {
          const sizeMB = parseInt(contentLength) / (1024 * 1024);
          if (sizeMB > 10) {
            findings.push(`Unusually large file: ${sizeMB.toFixed(1)}MB`);
            if (riskLevel === 'low') riskLevel = 'medium';
          }
        }
      } catch { /* ignore */ }
    }

    // 5. Determine recommendation
    let recommendation;
    if (riskLevel === 'high') {
      recommendation = 'File should be reviewed by an administrator before publication';
    } else if (riskLevel === 'medium') {
      recommendation = 'File appears potentially risky — review recommended';
    } else {
      recommendation = 'File appears safe for publication';
    }

    const elapsed = Date.now() - startTime;

    // Audit log
    await auditLog(author_id || 'anonymous', `evidence_scan_${riskLevel}`, `Scanned ${file_name || 'unknown'} — ${findings.length} finding${findings.length !== 1 ? 's' : ''} in ${Date.now() - startTime}ms`);
      })(), // end scan work
      new Promise((_, reject) => setTimeout(() => reject(new Error('Scan timeout')), SCAN_TIMEOUT_MS)),
    ]); // FIX-M8: 25s overall timeout

    const elapsed = Date.now() - startTime;

    return res.status(200).json({
      safe: riskLevel !== 'high',
      risk_level: riskLevel,
      findings,
      recommendation: riskLevel === 'high' ? 'File should be reviewed by an administrator before publication' : riskLevel === 'medium' ? 'File appears potentially risky — review recommended' : 'File appears safe for publication',
      file_name: file_name || null,
      file_type: file_type || null,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    console.error('evidence scan error:', err);
    // FAIL-CLOSED: scan failure or timeout = file held for review, never auto-approve.
    return res.status(200).json({
      safe: false,
      risk_level: 'high',
      findings: [err.message === 'Scan timeout' ? 'Scan timed out after 25s — file held for review' : 'Scan system failure — file held for admin review', `Error: ${err.message || 'unknown'}`],
      recommendation: 'File must be reviewed by an administrator — scan system was unavailable',
      file_name: file_name || null,
      file_type: file_type || null,
      elapsed_ms: Date.now() - startTime,
    });
  }
}
