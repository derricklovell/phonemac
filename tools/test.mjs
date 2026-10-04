// Headless checks for the UCA build (dist/local): renders, console errors, §5 pixel diff vs the
// original's reference shots, phone layout (no horizontal scroll), keyboard path, shell handshake.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
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
    return res.end(url.searchParams.has("session") ? SESSION_HOST : SHELL_HOST);
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
  if (m.scheme) {
    document.body.dataset.scheme = m.scheme;
    document.body.dataset.appearance = m.appearance;
    document.body.dataset.mq = String(matchMedia("(prefers-color-scheme: dark)").matches);
  }
  if (m.gin === "app:restore") {
    var opened = ((m.state && m.state.opened) || 0) + 1;
    document.getElementById("s").textContent = "record ${view} restored, opened " + opened;
    parent.postMessage({ gin: "app:state", state: { opened: opened } }, "*");
    parent.postMessage({ gin: "messages:unread", n: 3 }, "*");
  }
});
parent.postMessage({ gin: "app:ready", weight: "dom" }, "*");
</script></body></html>`;

// ---------------------------------------------------------------- 1ovr1 API mock
// Every test context answers https://api.1ovr1.com itself, the way the live API behaves for record 74:
// viewer_iframe is blank without the merchant's cookie (so the shell falls back to get_pages s01),
// get_pages/74 is the snapshot of the real record, and messages/* need the session's Bearer token.
const TEST_TOKEN = "test-session-token"; // what the stand-in appshell restores; not a real credential
const RECORD_74 = readFileSync(join(UCA_DIR, "props/fixtures/records/74.s01.html"), "utf8");
const INBOX = readFileSync(join(UCA_DIR, "props/fixtures/inbox.json"), "utf8");
const api = { inboxAuth: [], sends: [] };
async function mockApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const origin = req.headers()["origin"] || "*";
  const cors = {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (url.pathname === "/api:9yDRTI1I/viewer_iframe") return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/html" }, body: "" });
  if (url.pathname === "/api:o-B1LTj7/get_pages/74") return json(200, [{ id: 74, name: "Messages", s01: RECORD_74 }]);
  if (url.pathname.startsWith("/api:9yDRTI1I/messages/")) {
    const auth = req.headers()["authorization"] || null;
    if (url.pathname === "/api:9yDRTI1I/messages/inbox") api.inboxAuth.push(auth);
    if (auth !== `Bearer ${TEST_TOKEN}`) return json(401, { message: "Unauthorized" });
    if (url.pathname === "/api:9yDRTI1I/messages/inbox") return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: INBOX });
    if (url.pathname === "/api:9yDRTI1I/messages/send") {
      api.sends.push(JSON.parse(req.postData() || "{}"));
      return json(200, { message: { id: 9000 + api.sends.length, ts: Date.now(), via: null } });
    }
    return json(200, {});
  }
  return route.fulfill({ status: 404, headers: cors, body: "" });
}

// The appshell with a signed-in merchant: app:ready → app:restore with the user and session token.
const SESSION_HOST = `<!doctype html><body style="margin:0"><iframe id="f" src="/index.html#/notes" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>
<script>
window.received = [];
addEventListener("message", (e) => {
  const m = e.data; if (!m || !m.gin) return;
  window.received.push(m);
  if (m.gin === "app:ready") e.source.postMessage({ gin: "app:restore", view_id: "desktop", state: null, ts: 0, authed: true,
    user: { username: "sample-merchant", user_id: "u-1", display_name: "Sample Studio", auth_token: "${TEST_TOKEN}" } }, "*");
});
</script></body>`;

const results = { errors: [], diffs: [], checks: [] };
// Chrome flags every frame sandboxed with allow-scripts + allow-same-origin. That is the appshell's
// own sandbox for view frames, kept as-is, so the warning is expected wherever a record is hosted.
const KNOWN = [/both allow-scripts and allow-same-origin/];
// Sandboxed CI/cloud machines reach the internet only through HTTPS_PROXY, which the test browser
// can't use without breaking its localhost pages. There, remote assets the tests need (the boot
// logo) are fetched with curl (proxy-aware) and handed to the page unchanged.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch();
async function viaProxy(p, url) {
  if (!PROXY) return;
  await p.route(url, (r) => {
    try {
      r.fulfill({ status: 200, contentType: "image/jpeg", body: execFileSync("curl", ["-sSf", url], { maxBuffer: 1 << 24 }) });
    } catch {
      r.abort();
    }
  });
}

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
  await context.route("https://api.1ovr1.com/**", mockApi);
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
    // Icons use decoding="async"; wait until every image can paint so shots aren't timing-dependent.
    await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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
  // Lifecycle only (the record also hears shell:active as the front app changes).
  const lifecycle = got.split(",").filter((g) => ["app:restore", "shell:sleep", "shell:wake"].includes(g)).join(",");
  results.checks.push(["record app is slept when hidden and woken when shown (no reload)", lifecycle === "app:restore,shell:sleep,shell:wake"]);
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

// Apple menu theme switch: existing items untouched, menu stays open, every surface follows.
{
  const { context, p } = await page(1440, { colorScheme: "light" });
  await p.goto(`${base}/records.html#/notes`, { waitUntil: "networkidle" });
  await p.frameLocator('[data-window-id="messages"] iframe').locator("text=restored").waitFor({ timeout: 3000 });
  await p.locator('[data-menu="apple"]').click();
  const ids = await p.$$eval('[data-panel="apple"] [data-item]', (b) => b.map((x) => x.dataset.item));
  results.checks.push([
    "Apple menu keeps its items, in order, plus the Theme switch",
    JSON.stringify(ids) === JSON.stringify(["about-mac", "settings", "sleep", "restart", "shutdown", "lock", "logout"]) &&
      (await p.locator('[data-panel="apple"] [data-theme-switch]').count()) === 1,
  ]);
  await p.screenshot({ path: join(OUT, "apple-menu-theme-light.png"), clip: { x: 0, y: 0, width: 420, height: 380 } });
  const notesBg = () => p.evaluate(() => getComputedStyle(document.querySelector('[data-window-id="notes"] .notes-app')).backgroundColor);
  const lightBg = await notesBg();

  await p.locator('[data-theme-option="dark"]').click();
  await p.waitForTimeout(300);
  const dark = await p.evaluate(() => ({
    cls: document.documentElement.classList.contains("dark"),
    scheme: document.documentElement.style.colorScheme,
    open: !!document.querySelector('[data-panel="apple"]'),
    checked: document.querySelector('[data-theme-option][aria-checked="true"]')?.dataset.themeOption,
    saved: JSON.parse(localStorage.getItem("pc-system-settings") || "{}").appearance,
  }));
  const darkBg = await notesBg();
  const frame = p.frameLocator('[data-window-id="messages"] iframe').locator("body");
  const fr = { scheme: await frame.getAttribute("data-scheme"), mq: await frame.getAttribute("data-mq") };
  await p.screenshot({ path: join(OUT, "apple-menu-theme-dark.png"), clip: { x: 0, y: 0, width: 420, height: 380 } });
  await p.screenshot({ path: join(OUT, "desktop-1440-dark.png") });
  results.checks.push([
    "Dark: page goes dark, menu stays open, choice saved",
    dark.cls && dark.scheme === "dark" && dark.open && dark.checked === "dark" && dark.saved === "dark" && darkBg !== lightBg,
  ]);
  results.checks.push([`Dark reaches record apps (message scheme=${fr.scheme}, prefers-color-scheme dark in frame=${fr.mq})`, fr.scheme === "dark"]);

  // Keyboard: Left/Right choose within the switch.
  await p.locator('[data-theme-option="dark"]').focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(50);
  const kb = await p.evaluate(() => ({
    checked: document.querySelector('[data-theme-option][aria-checked="true"]')?.dataset.themeOption,
    focused: document.activeElement?.dataset.themeOption,
  }));
  results.checks.push(["ArrowRight moves to System and keeps focus on the switch", kb.checked === "system" && kb.focused === "system"]);

  // System follows the OS live; Light / Dark override it.
  await p.emulateMedia({ colorScheme: "dark" });
  await p.waitForTimeout(100);
  const sysDark = await p.evaluate(() => document.documentElement.classList.contains("dark"));
  await p.emulateMedia({ colorScheme: "light" });
  await p.waitForTimeout(100);
  const sysLight = await p.evaluate(() => !document.documentElement.classList.contains("dark"));
  await p.locator('[data-theme-option="light"]').click();
  await p.emulateMedia({ colorScheme: "dark" });
  await p.waitForTimeout(100);
  const forcedLight = await p.evaluate(() => !document.documentElement.classList.contains("dark"));
  results.checks.push(["System follows the OS live; Light overrides a dark OS", sysDark && sysLight && forcedLight]);
  await p.keyboard.press("Escape");

  // The choice survives a reload (and applies before first paint of the shell).
  await p.locator('[data-menu="apple"]').click();
  await p.locator('[data-theme-option="dark"]').click();
  await p.reload({ waitUntil: "networkidle" });
  const persisted = await p.evaluate(() => document.documentElement.classList.contains("dark"));
  results.checks.push(["theme choice persists across reloads", persisted]);
  await context.close();
}

// Phone follows the same setting (no Apple menu there).
{
  const { context, p } = await page(360, { ...PHONE, colorScheme: "light" });
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  await p.evaluate(() => localStorage.setItem("pc-system-settings", JSON.stringify({ appearance: "dark" })));
  await p.reload({ waitUntil: "networkidle" });
  await p.screenshot({ path: join(OUT, "phone-360-dark.png") });
  results.checks.push(["phone uses the saved theme", await p.evaluate(() => document.documentElement.classList.contains("dark"))]);
  await context.close();
}

// Apple menu avatar (appshell logic): picture → initials fallback → signed-in ring/dot → live picture.
{
  const avatar = (frameOrPage) =>
    frameOrPage.locator('[data-menu="apple"]').evaluate((b) => ({
      img: b.querySelector("[data-avatar-img]")?.getAttribute("src") ?? null,
      text: b.querySelector("[data-avatar]")?.textContent.trim() ?? null,
      dot: !!b.querySelector("[data-avatar-dot]"),
      label: b.getAttribute("aria-label"),
    }));

  const { context, p } = await page(1440);
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  const a = await avatar(p);
  results.checks.push(["Apple menu shows the user's picture (componentProps.user.avatarUrl), no signed-in dot", a.img === "assets/headshot.jpg" && !a.dot && a.label === "Apple menu"]);
  await p.screenshot({ path: join(OUT, "menubar-avatar.png"), clip: { x: 0, y: 0, width: 260, height: 28 } });
  await context.close();

  // Picture that fails to load → first two letters of the username.
  const c2 = await page(1440);
  const errorsBefore = results.errors.length;
  await c2.p.route("**/headshot.jpg", (r) => r.fulfill({ status: 404, body: "" }));
  await c2.p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  await c2.p.waitForTimeout(100);
  const b = await avatar(c2.p);
  results.checks.push([`picture fails → initials ("${b.text}")`, b.img === null && b.text === "AL"]);
  await c2.p.screenshot({ path: join(OUT, "menubar-avatar-initials.png"), clip: { x: 0, y: 0, width: 260, height: 28 } });
  await c2.context.close();
  // The 404 above is the point of this case, not a page error.
  results.errors.splice(errorsBefore, results.errors.length - errorsBefore, ...results.errors.slice(errorsBefore).filter((e) => !/status of 404/.test(e)));

  // Inside the appshell: auth:user signs someone in, profile:avatar swaps the picture, sign-out reverts.
  const c3 = await page(1200);
  await c3.p.goto(`${base}/shell-host.html`, { waitUntil: "networkidle" });
  await c3.p.waitForTimeout(300);
  const f = c3.p.frameLocator("#f");
  const send = (m) => c3.p.evaluate((msg) => document.getElementById("f").contentWindow.postMessage(msg, "*"), m);
  await send({ gin: "auth:user", authed: true, user: { username: "derrick", user_id: 7 } });
  await c3.p.waitForTimeout(100);
  const signedIn = await avatar(f);
  await send({ gin: "profile:avatar", url: "/assets/notes.png" });
  await c3.p.waitForTimeout(100);
  const pictured = await avatar(f);
  await send({ gin: "profile:avatar", url: "javascript:alert(1)" });
  await c3.p.waitForTimeout(50);
  const rejected = await avatar(f);
  await send({ gin: "auth:user", authed: false, user: null });
  await c3.p.waitForTimeout(100);
  const signedOut = await avatar(f);
  results.checks.push([
    "shell auth:user → initials + ring/dot; profile:avatar → picture; bad URL ignored; sign-out → props user",
    signedIn.text === "DE" && signedIn.dot && !signedIn.img &&
      pictured.img === "/assets/notes.png" && pictured.dot &&
      rejected.img === "/assets/notes.png" &&
      signedOut.img === "assets/headshot.jpg" && !signedOut.dot,
  ]);
  await c3.context.close();
}

// Loading screen: the real 1ovr1 logo (from storage) on #262626.
{
  const { context, p } = await page(1440);
  const LOGO = "https://storage.googleapis.com/xsxx-a39r-0vrj.n7e.xano.io/vault/Mnkcxzwv/einxV-Okg8ydi0B5SQ69dA3RKHc/WR46_A../1ovr1%20logo.JPG";
  await viaProxy(p, LOGO);
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  await p.locator('[data-menu="apple"]').click();
  await p.locator('[data-item="restart"]').click();
  await p.waitForFunction(() => document.querySelector("[data-boot-logo]")?.complete, null, { timeout: 10000 });
  await p.waitForTimeout(200);
  const boot = await p.evaluate(() => {
    const img = document.querySelector("[data-boot-logo]");
    return {
      bg: getComputedStyle(img.closest(".fixed")).backgroundColor,
      src: img.getAttribute("src"),
      loaded: img.complete && img.naturalWidth > 0,
      height: img.getBoundingClientRect().height,
      apple: !!document.querySelector(".fixed svg[data-icon='apple']"),
    };
  });
  await p.screenshot({ path: join(OUT, "boot-screen.png") });
  results.checks.push([
    `loading screen: 1ovr1 logo (${boot.height}px tall) on #262626, no Apple icon`,
    boot.bg === "rgb(38, 38, 38)" && boot.src === LOGO && boot.loaded && boot.height === 200 && !boot.apple,
  ]);
  await context.close();
}

// Record 74 (the real Messages code) inside the desktop inside a signed-in appshell: the session
// reaches the record, its inbox loads with the token, and it is moved/resized after loading.
{
  const { context, p } = await page(1440);
  await p.goto(`${base}/shell-host.html?session`, { waitUntil: "networkidle" });
  const d = p.frameLocator("#f");
  const win = d.locator('[data-window-id="messages"]');
  const rec = d.frameLocator('[data-window-id="messages"] iframe');
  await rec.locator('.conv[data-id="101"]').waitFor({ timeout: 8000 });
  await p.waitForTimeout(200);
  const rect = () => win.evaluate((w) => { const r = w.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), z: +getComputedStyle(w).zIndex }; });
  const frameSize = () => rec.locator("body").evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const badge = await d.locator('[data-dock-item="messages"] [data-badge]').textContent();
  const threads = await rec.locator(".conv").count();
  const avatar = await d.locator('[data-menu="apple"] [data-avatar]').textContent();
  const r0 = await rect();
  const f0 = await frameSize();

  // Click the part of Messages that Notes doesn't cover: its window comes to the front.
  await d.locator('[data-window-id="notes"]').click({ position: { x: 400, y: 300 } });
  const zBack = (await rect()).z;
  await p.mouse.click(r0.x + r0.w - 60, r0.y + 300);
  await p.waitForTimeout(150);
  const zFront = (await rect()).z;
  // Open a conversation through the app's own function (at this width an open thread covers the list).
  await rec.locator("body").evaluate(() => window.openById(101));
  await p.waitForTimeout(150);

  const t = await d.locator('[data-window-id="messages"] [data-window-drag-handle]').boundingBox();
  await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await p.mouse.down();
  await p.mouse.move(t.x + t.width / 2 - 60, t.y + 200, { steps: 8 });
  await p.mouse.move(t.x + t.width / 2 - 200, t.y + t.height / 2 + 90, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(100);
  const r1 = await rect();

  const seBox = await d.locator('[data-window-id="messages"] [data-window-resize-handle="se"]').boundingBox();
  const se = { x: seBox.x + seBox.width / 2, y: seBox.y + seBox.height / 2 };
  await p.mouse.move(se.x, se.y);
  await p.mouse.down();
  await p.mouse.move(se.x - 100, se.y - 80, { steps: 6 });
  await p.mouse.move(se.x + 140, se.y + 60, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(150);
  const r2 = await rect();
  const f2 = await frameSize();

  const wBox = await d.locator('[data-window-id="messages"] [data-window-resize-handle="w"]').boundingBox();
  const we = { x: wBox.x + wBox.width / 2, y: wBox.y + wBox.height / 2 };
  await p.mouse.move(we.x, we.y);
  await p.mouse.down();
  await p.mouse.move(we.x + 120, we.y, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(150);
  const r3 = await rect();
  await p.screenshot({ path: join(OUT, "messages-record74-moved-resized.png") });

  const t2 = await d.locator('[data-window-id="messages"] [data-window-drag-handle]').boundingBox();
  await p.mouse.dblclick(t2.x + t2.width / 2, t2.y + t2.height / 2);
  await p.waitForTimeout(250);
  const rFill = await rect();
  const fFill = await frameSize();
  await p.mouse.dblclick(rFill.x + rFill.w / 2, rFill.y + 19);
  await p.waitForTimeout(250);
  const rBack = await rect();
  const kept = await rec.locator("body").evaluate(() => window.state && window.state.activeId);

  // Reply from the app: goes to messages/send with the session token.
  await rec.locator("#input").fill("10:30 works, see you then!");
  await rec.locator("#send").click();
  await p.waitForTimeout(300);

  // "Open invoice" in a payment message: not hosted here, so it goes up to the appshell.
  await rec.locator("body").evaluate(() => window.openById(103));
  await p.waitForTimeout(150);
  await rec.locator('[data-mact="open-invoice"]').click();
  await p.waitForTimeout(150);
  const opened = (await p.evaluate(() => window.received)).filter((m) => m.gin === "apps:open");

  results.checks.push([
    `inside the appshell: Messages (record 74) gets the session — inbox loaded with its token (${threads} threads), Dock badge ${badge}, avatar ${avatar.trim()}`,
    threads === 4 && badge === "4" && api.inboxAuth.includes(`Bearer ${TEST_TOKEN}`) && avatar.trim() === "SA",
  ]);
  results.checks.push([`clicking inside the app's iframe brings its window to the front (z ${zBack} → ${zFront})`, zFront > zBack]);
  results.checks.push([`drag by title bar moves it (${r0.x},${r0.y} → ${r1.x},${r1.y}), size unchanged`, r1.x === r0.x - 200 && r1.y === r0.y + 90 && r1.w === r0.w && r1.h === r0.h]);
  results.checks.push([
    `corner resize (${r1.w}×${r1.h} → ${r2.w}×${r2.h}) reaches the app (${f0.w}×${f0.h} → ${f2.w}×${f2.h})`,
    r2.w === r1.w + 140 && r2.h === r1.h + 60 && r2.x === r1.x && f2.w - f0.w === 140 && f2.h - f0.h === 60,
  ]);
  results.checks.push([`left-edge resize keeps the right edge (${r2.x}+${r2.w} → ${r3.x}+${r3.w})`, r3.x === r2.x + 120 && r3.w === r2.w - 120 && r3.x + r3.w === r2.x + r2.w]);
  results.checks.push([`title double-click fills (${rFill.w}×${rFill.h}, app ${fFill.w}×${fFill.h}) and restores`, rFill.w === 1440 && fFill.w === rFill.w - 2 && rBack.x === r3.x && rBack.w === r3.w && rBack.h === r3.h]);
  results.checks.push([`the app keeps its open conversation through move/resize (activeId ${kept})`, kept === 101]);
  results.checks.push([`a reply goes to messages/send with the session (${JSON.stringify(api.sends[0]?.args ?? null)})`, api.sends.length === 1 && api.sends[0].args.thread_id === 101]);
  results.checks.push([`"Open invoice" (record 100, not hosted here) is passed up to the appshell`, opened.length === 1 && opened[0].view_id === 100 && opened[0].context?.invoice === "INV-1042"]);
  await context.close();
}

// Standalone (no appshell): record 74 loads via viewer_iframe → get_pages fallback and shows its
// signed-out state; no token, so no inbox request is made.
{
  const { context, p } = await page(1440);
  const before = api.inboxAuth.length;
  await p.goto(`${base}/index.html#/notes`, { waitUntil: "networkidle" });
  const rec = p.frameLocator('[data-window-id="messages"] iframe');
  await rec.locator("#listState").waitFor({ timeout: 8000 });
  await p.waitForTimeout(2200); // record 74 tries the cookie after 1.8 s when no shell answers
  const text = (await rec.locator("#listState").textContent()).trim();
  results.checks.push([`standalone: record 74 loads (viewer_iframe blank → get_pages s01) and says "${text}"`, /sign in/i.test(text) && api.inboxAuth.length === before]);
  await context.close();
}

// The claude.ai preview as built: appshell stand-in → desktop → record 74 on the bundled sample inbox.
{
  const { context, p } = await page(1440);
  await p.goto(`${base}/preview-host.html`, { waitUntil: "networkidle" });
  const rec = p.frameLocator("#desktop").frameLocator('[data-window-id="messages"] iframe');
  await rec.locator('.conv[data-id="101"]').waitFor({ timeout: 8000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(OUT, "preview-host.png") });
  results.checks.push(["preview build: appshell stand-in → desktop → record 74 shows the sample inbox", (await rec.locator(".conv").count()) === 4]);
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
