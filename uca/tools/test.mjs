// Headless checks for the UCA build (dist/local): renders, console errors, §5 pixel diff vs the
// original's reference shots, phone layout (no horizontal scroll), keyboard path, shell handshake.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { FIXED_TIME, HEIGHT, PHONE_UA, UCA_DIR, WIDTHS } from "./shared.mjs";

const ROOT = join(UCA_DIR, "dist/local");
const OUT = join(UCA_DIR, "dist/test");
mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".js": "text/javascript" };

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path === "/" || path === "/index.html") path = "/index.html";
  if (path === "/shell-host.html") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(SHELL_HOST);
  }
  const file = join(ROOT, path);
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// Minimal stand-in for Record 50: answers app:ready and chart:get the way the shell does.
const SHELL_HOST = `<!doctype html><body style="margin:0"><iframe id="f" src="/index.html#/notes" style="border:0;width:1100px;height:700px"></iframe>
<script>
window.received = [];
addEventListener("message", (e) => {
  const m = e.data; if (!m || !m.gin) return;
  window.received.push(m);
  if (m.gin === "app:ready") e.source.postMessage({ gin: "app:context", user: null, theme: "dark" }, "*");
  if (m.gin === "chart:get") e.source.postMessage({ gin: "chart:state", chart: null, viewing: null, viewingName: null }, "*");
});
</script></body>`;

const results = { errors: [], diffs: [], checks: [] };
const browser = await chromium.launch();

function diff(name, width) {
  const refPath = join(UCA_DIR, "reference", `${name}-${width}.png`);
  const gotPath = join(OUT, `${name}-${width}.png`);
  if (!existsSync(refPath)) return null;
  const a = PNG.sync.read(readFileSync(refPath));
  const b = PNG.sync.read(readFileSync(gotPath));
  if (a.width !== b.width || a.height !== b.height) return { name, width, percent: 100, note: "size mismatch" };
  const out = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  writeFileSync(join(OUT, `${name}-${width}.diff.png`), PNG.sync.write(out));
  return { name, width, percent: +((n / (a.width * a.height)) * 100).toFixed(2) };
}

async function page(width, opts = {}) {
  const phone = width === 360 ? { isMobile: true, hasTouch: true, userAgent: PHONE_UA, deviceScaleFactor: 1 } : {};
  const context = await browser.newContext({ viewport: { width, height: HEIGHT }, ...phone, ...opts });
  const p = await context.newPage();
  await p.clock.setFixedTime(new Date(FIXED_TIME));
  p.on("pageerror", (e) => results.errors.push(`${width}: ${e.message}`));
  p.on("console", (m) => ["error", "warning"].includes(m.type()) && results.errors.push(`${width}: console ${m.type()}: ${m.text()}`));
  return { context, p };
}

const SCENES = {
  "notes-only": async (p, width) => {
    await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
    if (width !== 360) {
      await p.evaluate(() => document.querySelector('[data-window-id="messages"] [data-wc="close"]')?.click());
    }
  },
  desktop: async (p) => {
    await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  },
};

for (const width of WIDTHS) {
  for (const [name, run] of Object.entries(SCENES)) {
    const { context, p } = await page(width);
    await run(p, width);
    await p.waitForTimeout(800);
    await p.mouse.move(width / 2, 300);
    await p.screenshot({ path: join(OUT, `${name}-${width}.png`) });
    const d = diff(name, width);
    if (d) results.diffs.push(d);
    if (width === 360 || width === 320) {
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      results.checks.push([`no horizontal scroll at ${width}px (${name})`, !overflow]);
    }
    await context.close();
  }
}

// 320 px phone layout
{
  const { context, p } = await page(320, { isMobile: true, hasTouch: true, userAgent: PHONE_UA });
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  results.checks.push(["no horizontal scroll at 320px", !overflow]);
  await p.screenshot({ path: join(OUT, `phone-320.png`) });
  await context.close();
}

// Keyboard path: Tab reaches the Apple menu; j/k move between notes; Escape closes a menu.
{
  const { context, p } = await page(1440);
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  await p.keyboard.press("Tab");
  const firstFocus = await p.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  results.checks.push(["Tab reaches the menu bar first", firstFocus === "Apple menu"]);
  await p.keyboard.press("Enter");
  const menuOpen = await p.locator('[data-panel="apple"]').count();
  await p.keyboard.press("Escape");
  const menuClosed = await p.locator('[data-panel="apple"]').count();
  results.checks.push(["Enter opens / Escape closes the Apple menu", menuOpen === 1 && menuClosed === 0]);
  await p.mouse.click(300, 400);
  await p.keyboard.press("j");
  const hash = await p.evaluate(() => location.hash);
  results.checks.push(["j selects the next note", hash === "#/notes/quick-links"]);
  await context.close();
}

// Shell handshake inside an iframe.
{
  const { context, p } = await page(1200);
  await p.goto(`${base}/shell-host.html`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const received = await p.evaluate(() => window.received);
  results.checks.push(["iframe posts {gin:'app:ready', weight}", received.some((m) => m.gin === "app:ready" && m.weight)]);
  const embed = await p.frameLocator("#f").locator("body").evaluate(() => typeof window.qcEmbed?.mount === "function" && !("QC_EMBED" in window));
  results.checks.push(["qcEmbed exposed, no QC_EMBED global", embed]);
  await context.close();
}

// Inert without props (placeholder build) shows a specific error, not a broken page.
{
  const { context, p } = await page(1024);
  const html = readFileSync(join(UCA_DIR, "dist/phonemac.html"), "utf8");
  await p.setContent(html);
  const text = await p.locator("[role=alert]").textContent();
  results.checks.push(["empty props → visible specific error", /componentProps/.test(text ?? "")]);
  await context.close();
}

await browser.close();
server.close();

console.log("\nPixel diff vs original (target ≤ 0.5%):");
for (const d of results.diffs) console.log(`  ${d.name.padEnd(11)} ${String(d.width).padStart(4)}px  ${String(d.percent).padStart(6)}%${d.note ? `  (${d.note})` : ""}`);
console.log("\nChecks:");
for (const [label, ok] of results.checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
console.log(`\nConsole errors: ${results.errors.length ? "\n  " + [...new Set(results.errors)].join("\n  ") : "none"}`);
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
