import fs from 'fs';
import path from 'path';

console.log('=== VOICEFLOW PRINCIPAL STATIC AUDIT ===\n');

// 1. Audit api/index.js routes & handlers
const apiIndex = fs.readFileSync('api/index.js', 'utf-8');
const lines = apiIndex.split('\n');
console.log(`[API Gateway] api/index.js: ${lines.length} lines`);

// Check router dispatch table
const cases = [];
const routeRegex = /case\s+["']([^"']+)["']\s*:/g;
let match;
while ((match = routeRegex.exec(apiIndex)) !== null) {
  cases.push(match[1]);
}
console.log(`[API Gateway] Total registered route endpoints: ${cases.length}`);

// 2. Check for missing handlers in api/
const apiFiles = fs.readdirSync('api').filter(f => f.endsWith('.js') && f.startsWith('_'));
console.log(`[API Backend] Internal modules in api/: ${apiFiles.length}`);

// 3. Scan for TODOs, FIXMEs, and potential unhandled catches in api/
let todos = [];
for (const file of apiFiles) {
  const content = fs.readFileSync(path.join('api', file), 'utf-8');
  const fileLines = content.split('\n');
  fileLines.forEach((l, idx) => {
    if (/TODO|FIXME|HACK|XXX/i.test(l) && !l.includes('TODOs and FIXMEs')) {
      todos.push({ file, line: idx + 1, text: l.trim().slice(0, 100) });
    }
  });
}
console.log(`[Code Health] Found ${todos.length} TODO/FIXME markers in api/ modules`);
if (todos.length > 0) {
  console.log('Sample markers:', todos.slice(0, 5));
}

// 4. Check AppContext.tsx and frontend services
const appContext = fs.readFileSync('src/contexts/AppContext.tsx', 'utf-8');
console.log(`[Frontend Core] AppContext.tsx: ${appContext.split('\n').length} lines`);

// 5. Check desktop & mobile configs
const electronMain = fs.readFileSync('electron/main.cjs', 'utf-8');
console.log(`[Native Desktop] electron/main.cjs: ${electronMain.split('\n').length} lines`);
const capConfig = fs.readFileSync('capacitor.config.ts', 'utf-8');
console.log(`[Native Mobile] capacitor.config.ts: present`);

console.log('\n=== AUDIT INITIALIZATION COMPLETE ===');
