// Live check against the real 1ovr1 API with a real session, READ-ONLY.
//   ONEOVR1_AUTH_TOKEN=… node tools/live.mjs
// A stand-in appshell restores the token to the desktop (dist/local/index.html), which passes it to
// Messages (record 74, loaded live via viewer_iframe → get_pages). messages/inbox goes to the real
// API; messages/send and messages/state are answered locally and never reach the merchant's data.
// The token stays in this process's memory: it is not written to disk, logged, or put in a page file.
// Output: dist/live/*.png and a summary of counts only (no message contents are printed).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { UCA_DIR, HEIGHT } from "./shared.mjs";

const TOKEN = process.env.ONEOVR1_AUTH_TOKEN;
if (!TOKEN) {
  console.error("ONEOVR1_AUTH_TOKEN is not set in this session (environment variables reach new sessions).");
  process.exit(2);
}
const ROOT = join(UCA_DIR, "dist/local");
const OUT = join(UCA_DIR, "dist/live");
mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

// The appshell stand-in; the token is put in the response, never in a file.
const host = () => `<!doctype html><body style="margin:0"><iframe id="f" src="/index.html#/notes" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>
<script>
var SESSION = ${JSON.stringify({ authed: true, user: { username: "live-check", auth_token: TOKEN } }).replace(/</g, "\\u003c")};
addEventListener("message", function (e) {
  var m = e.data; if (!m || m.gin !== "app:ready") return;
  e.source.postMessage({ gin: "app:restore", view_id: "desktop", state: null, ts: 0, authed: true, user: SESSION.user }, "*");
});
</script></body>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/live-host.html") {
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    return res.end(host());
  }
  const file = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// The test browser can't use the machine's HTTPS proxy, so API requests are made with curl (which
// does) and handed back unchanged. Writes are stopped here.
const calls = [];
function curl(args) {
  return new Promise((resolve, reject) =>
    execFile("curl", args, { maxBuffer: 1 << 26, encoding: "buffer" }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );
}
async function liveApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = {
    "access-control-allow-origin": req.headers()["origin"] || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (/\/messages\/(send|state)$/.test(url.pathname)) {
    calls.push({ path: url.pathname, status: "blocked (read-only)" });
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ message: { id: `local-${Date.now()}`, ts: Date.now() } }) });
  }
  const args = ["-sS", "-X", req.method(), "-w", "\n%{http_code}"];
  const auth = req.headers()["authorization"];
  if (auth) args.push("-H", `Authorization: ${auth}`);
  if (req.headers()["content-type"]) args.push("-H", `Content-Type: ${req.headers()["content-type"]}`);
  if (req.postData()) args.push("--data-binary", req.postData());
  args.push(url.href);
  try {
    const out = (await curl(args)).toString("utf8");
    const cut = out.lastIndexOf("\n");
    const status = Number(out.slice(cut + 1)) || 502;
    const body = out.slice(0, cut);
    calls.push({ path: url.pathname, status, bytes: body.length, auth: Boolean(auth) });
    const type = url.pathname.endsWith("viewer_iframe") ? "text/html" : "application/json";
    return route.fulfill({ status, headers: { ...cors, "content-type": type }, body });
  } catch (err) {
    calls.push({ path: url.pathname, status: "curl failed" });
    return route.abort();
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: HEIGHT } });
await context.route("https://api.1ovr1.com/**", liveApi);
const p = await context.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`${base}/live-host.html`, { waitUntil: "load" });

const d = p.frameLocator("#f");
const rec = d.frameLocator('[data-window-id="messages"] iframe');
let threads = 0;
let state = "";
try {
  await rec.locator(".conv, #listState").first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(4000); // first inbox read
  threads = await rec.locator(".conv").count();
  state = ((await rec.locator("#listState").textContent().catch(() => "")) || "").trim();
} catch (err) {
  state = `record did not render: ${err.message.split("\n")[0]}`;
}
// Bring Messages to the front and give it room, then screenshot.
const win = d.locator('[data-window-id="messages"]');
const r = await win.boundingBox();
if (r) {
  await p.mouse.click(r.x + r.width - 40, r.y + 300);
  const t = await d.locator('[data-window-id="messages"] [data-window-drag-handle]').boundingBox();
  await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await p.mouse.down();
  await p.mouse.move(t.x + t.width / 2 - 300, t.y + t.height / 2 + 20, { steps: 10 });
  await p.mouse.up();
}
await p.waitForTimeout(500);
await p.screenshot({ path: join(OUT, "messages-live.png") });
const badge = await d.locator('[data-dock-item="messages"] [data-badge]').textContent().catch(() => null);

await browser.close();
server.close();
console.log(JSON.stringify({ threads, listState: state || null, dockBadge: badge, calls, pageErrors: errors }, null, 2));
console.log(`screenshot: ${join(OUT, "messages-live.png")}`);
