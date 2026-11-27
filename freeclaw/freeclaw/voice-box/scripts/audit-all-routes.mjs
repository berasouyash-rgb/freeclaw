import fs from 'fs';
import path from 'path';

const indexCode = fs.readFileSync('api/index.js', 'utf-8');
const routesMatch = indexCode.match(/const routes = \{([\s\S]*?)\n\};/);
const routesBlock = routesMatch[1];
const routeMap = {};
const rRegex = /["']?([a-zA-Z0-9_\-\/]+)["']?\s*:\s*protect\(([a-zA-Z0-9_]+)/g;
let m;
while ((m = rRegex.exec(routesBlock)) !== null) {
  routeMap[m[1]] = m[2];
}

console.log('Total routes parsed:', Object.keys(routeMap).length);

// Also find imports
const importRegex = /import\s+([a-zA-Z0-9_]+)\s+from\s+["']([^"']+)["']/g;
const imports = {};
let imp;
while ((imp = importRegex.exec(indexCode)) !== null) {
  imports[imp[1]] = imp[2];
}

for (const [route, handlerVar] of Object.entries(routeMap)) {
  const file = imports[handlerVar];
  console.log(`${route.padEnd(25)} -> ${handlerVar.padEnd(20)} (${file})`);
}
