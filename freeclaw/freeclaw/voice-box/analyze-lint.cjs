const r = require('./lint.json');
let e = 0, w = 0;
const byRule = {};
const byFile = [];
for (const f of r) {
  e += f.errorCount; w += f.warningCount;
  if (f.messages.length) byFile.push([f.filePath.replace(process.cwd(), ''), f.errorCount, f.warningCount]);
  for (const m of f.messages) {
    const k = (m.ruleId || 'fatal') + '|' + m.severity;
    byRule[k] = (byRule[k] || 0) + 1;
  }
}
console.log('FILES', r.length, 'ERRORS', e, 'WARNINGS', w);
console.log('\n-- top rules (rule|severity: count) --');
Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(v, k));
console.log('\n-- worst files --');
byFile.sort((a, b) => (b[1] + b[2]) - (a[1] + a[2])).slice(0, 30).forEach(x => console.log(x[1], x[2], x[0]));
console.log('\n-- errors only (first 60) --');
let n = 0;
for (const f of r) for (const m of f.messages) if (m.severity === 1 && n++ < 60) {
  console.log(f.filePath.replace(process.cwd(), '') + ':' + m.line + ':' + m.column, '[' + (m.ruleId || 'fatal') + ']', m.message);
}
