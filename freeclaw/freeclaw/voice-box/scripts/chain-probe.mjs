import { chromium } from "@playwright/test";
const BASE = "http://localhost:5173";
const crypto = await import("node:crypto");
const hash = crypto.createHash("sha256").update(process.env.VB_ADMIN_PASSWORD).digest("hex");
const res = await fetch(BASE + "/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", password_hash: hash }) });
const { token } = await res.json();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(process.env.VB_WIDTH || 375), height: 800 } });
await page.addInitScript(([t]) => { sessionStorage.setItem("vb:adminAuth", JSON.stringify({ token: t, exp: Date.now()+3.6e6 })); }, [token]);
await page.goto(BASE + (process.env.VB_ROUTE || "/admin?tab=dashboard"), { waitUntil: "domcontentloaded" });
await page.waitForTimeout(Number(process.env.VB_WAIT || 6000));
const out = await page.evaluate(() => {
  const lines = [];
  const card = [...document.querySelectorAll(".card.p-4")].find(el => el.getBoundingClientRect().right > window.innerWidth);
  if (!card) return "no offending card";
  const report = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Intrinsic sizing: what does the browser think each grid item needs?
    const kids = [...el.children].map(k => {
      const kr = k.getBoundingClientRect();
      return `<${k.tagName.toLowerCase()} class="${(k.className||"").toString().slice(0,40)}" w=${Math.round(kr.width)} right=${Math.round(kr.right)} minW=${getComputedStyle(k).minWidth}`;
    });
    lines.push(`\n<${el.tagName.toLowerCase()}> w=${Math.round(r.width)} right=${Math.round(r.right)} display=${cs.display} cols=${cs.gridTemplateColumns.slice(0,50)} class="${(el.className||"").toString().slice(0,60)}"`);
    kids.forEach(k => lines.push("   child: " + k));
  };
  report(card);
  report(card.parentElement);
  return lines.join("\n");
});
console.log(out);
await browser.close();
