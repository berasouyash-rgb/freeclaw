import { readFileSync, readdirSync } from "fs";
const dir = "dist-analyze/assets";
const maps = readdirSync(dir).filter(f => f.endsWith(".js.map"));
for (const f of maps) {
  const map = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const byPkg = new Map();
  const sources = map.sources || [];
  const contents = map.sourcesContent || [];
  sources.forEach((s, i) => {
    const len = contents[i] ? contents[i].length : 0;
    const m = s.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
    let key = m ? m[1] : (s.match(/^\.\.\//) ? "../" + s.split("/").slice(1,3).join("/") : "src/" + (s.split("/")[1] || ""));
    if (s.startsWith("../") === false && !m) key = "(app)";
    byPkg.set(key, (byPkg.get(key) || 0) + len);
  });
  const total = [...byPkg.values()].reduce((a,b)=>a+b,0);
  if (total < 60000) continue;
  console.log(`\n### ${f}  (map sources total ${(total/1024).toFixed(0)} KB)`);
  [...byPkg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10)
    .forEach(([k,v]) => console.log(`  ${(v/1024).toFixed(0).padStart(6)} KB  ${k}`));
}
