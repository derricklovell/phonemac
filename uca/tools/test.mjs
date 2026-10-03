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
  // Mock of the appshell's viewer endpoint (`${viewEndpoint}_iframe?view=<id>`).
  if (path === "/viewer_iframe") {
    const view = url.searchParams.get("view");
    if (!["9001", "9002"].includes(view)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(MOCK_RECORD(view));
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

// A record as the shell would serve it: says app:ready, applies app:restore, reports state and an
// unread count, and records every gin: message it is sent (body[data-got]).
const MOCK_RECORD = (view) => `<!doctype html><html><body style="margin:0;font:14px sans-serif">
<p id="s" style="padding:16px">record ${view} booting</p>
<script>
var got = [];
addEventListener("message", function (e) {
  var m = e.data; if (!m || !m.gin) return;
  got.push(m.gin); document.body.dataset.got = got.join(",");
  if (m.gin === "app:restore") {
    var opened = ((m.state && m.state.opened) || 0) + 1;
    document.getElementById("s").textContent = "record ${view} restored, opened " + opened;
    parent.postMessage({ gin: "app:state", state: { opened: opened } }, "*");
    parent.postMessage({ gin: "messages:unread", n: 3 }, "*");
  }
});
parent.postMessage({ gin: "app:ready", weight: "dom" }, "*");
</script></body></html>`;

const results = { errors: [], diffs: [], checks: [] };
// Chrome flags every frame sandboxed with allow-scripts + allow-same-origin. That is the appshell's
// own sandbox for view frames, kept as-is, so the warning is expected wherever a record is hosted.
const KNOWN = [/both allow-scripts and allow-same-origin/];
const browser = await chromium.launch();

function crop(png, height) {
  const out = new PNG({ width: png.width, height });
  png.data.copy(out.data, 0, 0, png.width * height * 4);
  return out;
}

// cropHeight: compare only the top rows (the phone layout adds a bottom bar the original lacks,
// so only the app area above it is held to the original).
function diff(name, width, { cropHeight, note } = {}) {
  const refPath = join(UCA_DIR, "reference", `${name}-${width}.png`);
  const gotPath = join(OUT, `${name}-${width}.png`);
  if (!existsSync(refPath)) return null;
  let a = PNG.sync.read(readFileSync(refPath));
  let b = PNG.sync.read(readFileSync(gotPath));
  if (a.width !== b.width || a.height !== b.height) return { name, width, percent: 100, note: "size mismatch" };
  if (cropHeight) {
    a = crop(a, cropHeight);
    b = crop(b, cropHeight);
  }
  const out = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  writeFileSync(join(OUT, `${name}-${width}.diff.png`), PNG.sync.write(out));
  return { name, width, percent: +((n / (a.width * a.height)) * 100).toFixed(2), note };
}

const PHONE = { isMobile: true, hasTouch: true, userAgent: PHONE_UA, deviceScaleFactor: 1 };

async function page(width, opts = {}) {
  const phone = width === 360 ? { isMobile: true, hasTouch: true, userAgent: PHONE_UA, deviceScaleFactor: 1 } : {};
  const context = await browser.newContext({ viewport: { width, height: HEIGHT }, ...phone, ...opts });
  const p = await context.newPage();
  await p.clock.setFixedTime(new Date(FIXED_TIME));
  p.on("pageerror", (e) => results.errors.push(`${width}: ${e.message}`));
  p.on(
    "console",
    (m) =>
      ["error", "warning"].includes(m.type()) &&
      !KNOWN.some((k) => k.test(m.text())) &&
      results.errors.push(`${width}: console ${m.type()}: ${m.text()}`),
  );
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
    let opts = {};
    if (width === 360) {
      // The original's phone view is Notes alone. Even if the original had the bar's space at the
      // bottom, Notes would be laid out the same way down to that point, so only the app area above
      // the bar is compared.
      const top = await p.evaluate(() => document.querySelector("[data-phone-footer]")?.getBoundingClientRect().top);
      opts = { cropHeight: Math.floor(top), note: `app area above the bar (${Math.floor(top)}px)` };
    }
    const d = diff(name, width, opts);
    if (d) results.diffs.push(d);
    if (width === 360 || width === 320) {
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      results.checks.push([`no horizontal scroll at ${width}px (${name})`, !overflow]);
    }
    await context.close();
  }
}

// ---------------------------------------------------------------- phone shell
const bar = (p) =>
  p.evaluate(() => {
    const b = document.querySelector("[data-phone-bar]");
    return {
      hidden: b.hidden,
      icons: [...b.querySelectorAll("[data-phone-app]")].map((x) => x.dataset.phoneApp),
      active: b.querySelector('[aria-current="page"]')?.dataset.phoneApp ?? null,
      scrollable: b.scrollWidth > b.clientWidth,
      fade: b.dataset.fade,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

for (const width of [320, 360, 414]) {
  const { context, p } = await page(width, PHONE);
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  const b = await bar(p);
  results.checks.push([`phone ${width}px: bar shows ${b.icons.length} apps, Notes active, no page h-scroll`, !b.hidden && b.icons.length === 5 && b.active === "notes" && !b.pageOverflow]);
  await p.screenshot({ path: join(OUT, `phone-${width}.png`) });
  await context.close();
}

// Many apps: the bar scrolls sideways (fades on the side with more), the page never does.
{
  const { context, p } = await page(320, PHONE);
  await p.goto(`${base}/records.html#/notes`, { waitUntil: "networkidle" });
  const before = await bar(p);
  await p.screenshot({ path: join(OUT, `phone-320-full-bar.png`) });
  await p.evaluate(() => {
    const b = document.querySelector("[data-phone-bar]");
    b.scrollLeft = b.scrollWidth;
  });
  await p.waitForTimeout(100);
  const after = await bar(p);
  results.checks.push([
    `phone 320px, ${before.icons.length} apps: bar scrolls sideways (fade right → left), page doesn't`,
    before.scrollable && before.fade === "right" && after.fade === "left" && !before.pageOverflow && !after.pageOverflow,
  ]);
  // Tapping an off-screen app scrolls it into view and makes it active.
  await p.evaluate(() => (document.querySelector("[data-phone-bar]").scrollLeft = 0));
  await p.locator('[data-phone-app="preview"]').click();
  const inView = await p.evaluate(() => {
    const b = document.querySelector("[data-phone-bar]").getBoundingClientRect();
    const i = document.querySelector('[data-phone-app="preview"]').getBoundingClientRect();
    return i.left >= b.left && i.right <= b.right;
  });
  const a = await bar(p);
  results.checks.push(["tapping an app makes it active and keeps its icon in view", a.active === "preview" && inView]);
  await context.close();
}

// Switching apps keeps each one warm: Notes stays on the open note, same DOM node.
{
  const { context, p } = await page(360, PHONE);
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  await p.locator('[data-phone-pane="notes"] [data-note-slug="reading-list"]').first().click();
  await p.evaluate(() => (window.__notesPane = document.querySelector('[data-phone-pane="notes"]')));
  await p.locator('[data-phone-app="messages"]').click();
  const hiddenNotes = await p.evaluate(() => getComputedStyle(document.querySelector('[data-phone-pane="notes"]')).visibility);
  await p.locator('[data-phone-app="notes"]').click();
  const kept = await p.evaluate(
    () => window.__notesPane === document.querySelector('[data-phone-pane="notes"]') && location.hash,
  );
  const b = await bar(p);
  results.checks.push([
    "switching apps hides (not destroys) the last one; coming back restores it as left",
    hiddenNotes === "hidden" && kept === "#/notes/reading-list" && b.active === "notes",
  ]);
  // Handle: tap hides the bar, tap again shows it.
  await p.locator("[data-phone-handle]").click();
  const hid = (await bar(p)).hidden;
  await p.screenshot({ path: join(OUT, `phone-360-bar-hidden.png`) });
  await p.locator("[data-phone-handle]").click();
  const shown = !(await bar(p)).hidden;
  results.checks.push(["handle tap hides, then shows, the bar", hid && shown]);
  // Swipe down on the handle hides it too.
  const h = await p.locator("[data-phone-handle]").boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + 2);
  await p.mouse.down();
  await p.mouse.move(h.x + h.width / 2, h.y + 80, { steps: 5 });
  await p.mouse.up();
  results.checks.push(["swipe down on the handle hides the bar", (await bar(p)).hidden]);
  await context.close();
}

// Record-hosted apps: fetched from the viewer endpoint, gin: handshake answered, state kept,
// unread count badged, sleep/wake on switch.
{
  const { context, p } = await page(360, PHONE);
  await p.goto(`${base}/records.html#/notes`, { waitUntil: "networkidle" });
  await p.locator('[data-phone-app="messages"]').click();
  const frame = p.frameLocator('[data-phone-pane="messages"] iframe');
  await frame.locator("text=restored, opened 1").waitFor({ timeout: 3000 });
  await p.waitForTimeout(100);
  const badge = await p.locator('[data-phone-app="messages"] [data-badge]').textContent();
  const stored = await p.evaluate(() => localStorage.getItem("pc-app-state:9001"));
  results.checks.push(["record app: app:ready → app:restore; app:state stored; unread → badge", badge === "3" && /"opened":1/.test(stored ?? "")]);
  await p.screenshot({ path: join(OUT, `phone-360-record.png`) });
  await p.locator('[data-phone-app="notes"]').click();
  await p.locator('[data-phone-app="messages"]').click();
  await p.waitForTimeout(100);
  const got = await frame.locator("body").getAttribute("data-got");
  results.checks.push(["record app is slept when hidden and woken when shown (no reload)", got === "app:restore,shell:sleep,shell:wake"]);
  await context.close();
}

// Same record on the desktop: hosted in its window, badge on the Dock icon.
{
  const { context, p } = await page(1440);
  await p.goto(`${base}/records.html#/notes`, { waitUntil: "networkidle" });
  const frame = p.frameLocator('[data-window-id="messages"] iframe');
  await frame.locator("text=restored").waitFor({ timeout: 3000 });
  await p.waitForTimeout(100);
  const badge = await p.locator('[data-dock-item="messages"] [data-badge]').textContent();
  results.checks.push(["desktop: record app hosted in its window, unread → Dock badge", badge === "3"]);
  await p.screenshot({ path: join(OUT, `desktop-1440-record.png`) });
  await context.close();
}

// Desktop Dock wider than the window: it scrolls sideways instead of running off-screen.
{
  const { context, p } = await page(600);
  await p.goto(`${base}/records.html#/notes`, { waitUntil: "networkidle" });
  await p.evaluate(() => {
    // Keep every app in the Dock so the rail is wider than the window.
    const keep = Object.fromEntries(componentProps.apps.map((a) => [a.id, true]));
    localStorage.setItem("pc-dock-keep-overrides", JSON.stringify(keep));
  });
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  const dockState = await p.evaluate(() => {
    const dock = document.querySelector("[data-dock]").getBoundingClientRect();
    const rail = document.querySelector("[data-dock] > div");
    return {
      inside: dock.left >= 0 && dock.right <= window.innerWidth,
      scrolls: rail.scrollWidth > rail.clientWidth,
      fade: rail.dataset.fade,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  await p.screenshot({ path: join(OUT, `desktop-600-dock-overflow.png`) });
  results.checks.push(["desktop Dock wider than the window scrolls inside it", dockState.inside && dockState.scrolls && dockState.fade === "right" && !dockState.pageOverflow]);
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
