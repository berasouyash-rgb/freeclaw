const PROJECT_REF = process.env.FULLSTACK_PROJECT_REF || '';
const RESTORE_URL = process.env.FULLSTACK_RESTORE_API_URL || '';
const RESTORE_KEY = process.env.FULLSTACK_RESTORE_KEY || '';

let _restoreTriggered = false;

export function triggerRestore() {
  if (_restoreTriggered || !PROJECT_REF || !RESTORE_URL) return;
  _restoreTriggered = true;

  const headers = { 'Content-Type': 'application/json' };
  // Include auth token if configured (prevents unauthorized restore triggers)
  if (RESTORE_KEY) headers['Authorization'] = `Bearer ${RESTORE_KEY}`;

  fetch(RESTORE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ project_ref: PROJECT_REF }),
  }).catch((err) => console.error('[db-wake] Restore request failed:', err.message));

  // Rate limit: max one restore per minute
  setTimeout(() => { _restoreTriggered = false; }, 60000);
}
