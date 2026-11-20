import fs from 'fs';
import path from 'path';

function searchFiles(dir, exts) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== '__tests__') {
        results = results.concat(searchFiles(fullPath, exts));
      }
    } else {
      if (exts.some(ext => fullPath.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const files = searchFiles('./src', ['.tsx', '.jsx']);
const buttonIssues = [];
const linkIssues = [];
const formIssues = [];
const unhandledAsync = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');

  // Check <a> tags with empty or # href
  const aRegex = /<a\s+[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = aRegex.exec(content)) !== null) {
    const href = match[2];
    if (href === '#' || href === '' || href.startsWith('javascript:')) {
      const lineNo = content.substring(0, match.index).split('\n').length;
      linkIssues.push({ file, line: lineNo, tag: match[0].trim() });
    }
  }

  // Check buttons without onClick or type="submit"
  // Look for <button ...> (can span multiple lines)
  const buttonRegex = /<button\b([^>]*?)(\/?>)/gis;
  while ((match = buttonRegex.exec(content)) !== null) {
    const attrs = match[1];
    const isSelfClosing = match[2] === '/>';
    const lineNo = content.substring(0, match.index).split('\n').length;

    const hasOnClick = /onClick\b/i.test(attrs);
    const hasTypeSubmit = /type\s*=\s*["']submit["']/i.test(attrs);
    const hasPropsSpread = /\{\.\.\.\w+\}/.test(attrs);

    // If it's not a submit button, has no onClick, and doesn't spread props:
    if (!hasOnClick && !hasTypeSubmit && !hasPropsSpread) {
      // Check if it has type="button" or no type
      buttonIssues.push({
        file,
        line: lineNo,
        snippet: ('<button ' + attrs.replace(/\s+/g, ' ').trim() + '>').slice(0, 120),
        reason: 'No onClick handler, not type="submit", no props spread'
      });
    }
  }

  // Check for forms without onSubmit
  const formRegex = /<form\b([^>]*?)(\/?>)/gis;
  while ((match = formRegex.exec(content)) !== null) {
    const attrs = match[1];
    const lineNo = content.substring(0, match.index).split('\n').length;
    const hasOnSubmit = /onSubmit\b/i.test(attrs);
    const hasPropsSpread = /\{\.\.\.\w+\}/.test(attrs);
    if (!hasOnSubmit && !hasPropsSpread) {
      formIssues.push({
        file,
        line: lineNo,
        snippet: ('<form ' + attrs.replace(/\s+/g, ' ').trim() + '>').slice(0, 100)
      });
    }
  }
}

console.log('=== DEAD / INERT LINKS (href="#" or empty) ===');
console.log(JSON.stringify(linkIssues, null, 2));

console.log('\n=== BUTTONS WITHOUT ONCLICK / SUBMIT / PROPS SPREAD ===');
console.log(JSON.stringify(buttonIssues, null, 2));

console.log('\n=== FORMS WITHOUT ONSUBMIT ===');
console.log(JSON.stringify(formIssues, null, 2));
