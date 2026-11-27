import fs from 'fs';
import { ROUTE_MATRIX, ROUTE_CLASS } from '../api/_auth-matrix.js';

// Extract routes from api/index.js
const indexCode = fs.readFileSync('api/index.js', 'utf-8');
const routesMatch = indexCode.match(/const routes = \{([\s\S]*?)\n\};/);
if (!routesMatch) {
  console.error('Could not find const routes = { ... } in api/index.js');
  process.exit(1);
}

const routesBlock = routesMatch[1];
const routeNames = [];
const rRegex = /["']?([a-zA-Z0-9_\-\/]+)["']?\s*:\s*protect\(/g;
let m;
while ((m = rRegex.exec(routesBlock)) !== null) {
  routeNames.push(m[1]);
}

console.log(`Found ${routeNames.length} routes in api/index.js\n`);

const missingInMatrix = [];
const matrixEntries = Object.keys(ROUTE_MATRIX);

for (const r of routeNames) {
  if (!ROUTE_MATRIX[r]) {
    missingInMatrix.push(r);
  }
}

console.log('Routes in api/index.js NOT explicitly classified in ROUTE_MATRIX:');
console.log(missingInMatrix);
