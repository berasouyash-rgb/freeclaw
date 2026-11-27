import fs from 'fs';

const content = fs.readFileSync('src/pages/Admin.tsx', 'utf8');
const cases = content.match(/case\s+["'][^"']+["']:/g);
console.log('Admin tab cases in Admin.tsx:');
console.log(cases);

import { ADMIN_TAB_KEYS } from '../src/lib/adminTabs.ts';
const caseKeys = cases.map(c => c.replace(/case\s+["']|["']:/g, ''));
for (const key of ADMIN_TAB_KEYS) {
  if (!caseKeys.includes(key)) {
    console.warn(`WARNING: Admin tab key '${key}' has NO case in Admin.tsx!`);
  }
}
console.log('Admin tab keys check complete.');
