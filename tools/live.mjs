// Live run of the desktop with a real merchant's values, READ-ONLY.
//   node tools/live.mjs                  token from $auth_token
//   node tools/live.mjs --env MY_TOKEN   token from $MY_TOKEN
//   --origin https://www.1ovr1.com       the host the page is served from (default https://app.1ovr1.com)
// It does what the devshell endpoint does: GET devshell with the token (Record 50's props for that
// account: tabs, config, merchant_*, app/seo), lay those over the desktop's own props, and replace
// `var componentProps = {};` in dist/phonemac.html with the result. The page is opened top-level with the
// authToken cookie (as the white-label gate leaves it), so it finds its session the way Record 50 does.
// All api.1ovr1.com traffic goes to the live API except writes: anything but GET is stopped locally.
// The token and the real props stay in this process's memory. Prints counts and statuses only.
// Output: dist/live/desktop-live.png (it shows real data: not committed, dist/ is ignored).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { UCA_DIR, HEIGHT } from "./shared.mjs";

// The page is served from a platform or merchant host, and the API answers by that Origin
// (get_ip_info: app.* → the dev builds, www.* → the live builds; viewer_iframe is blank for anything else).
// Requests are forwarded with the Origin the served page would have.
const originFlag = process.argv.indexOf("--origin");
const ORIGIN = originFlag > -1 ? process.argv[originFlag + 1] : "https://app.1ovr1.com";
const flag = process.argv.indexOf("--env");
const TOKEN_ENV = flag > -1 ? process.argv[flag + 1] : "auth_token";
const TOKEN = process.env[TOKEN_ENV];
if (!TOKEN) {
  console.error(`$${TOKEN_ENV} is not set in this session (environment variables reach sessions started after they're saved).`);
  process.exit(2);
}
const ROOT = join(UCA_DIR, "dist/local");
const OUT = join(UCA_DIR, "dist/live");
mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

function curlSync(args) {
  return new Promise((resolve, reject) =>
    execFile("curl", args, { maxBuffer: 1 << 26, encoding: "buffer" }, (err, stdout) => (err ? reject(err) : resolve(stdout.toString("utf8")))),
  );
}

// 1. devshell for this account → Record 50's props (the brace walk Record 50's own _parseProps uses).
const shellHtml = await curlSync(["-sSf", "-H", `Authorization: Bearer ${TOKEN}`, "-H", `Origin: ${ORIGIN}`, "https://api.1ovr1.com/api:9yDRTI1I/devshell"]);
const at = shellHtml.indexOf("var componentProps = {");
if (at < 0) throw new Error("devshell answered without injected props");
let depth = 0;
let endAt = -1;
for (let i = shellHtml.indexOf("{", at); i < shellHtml.length; i++) {
  if (shellHtml[i] === "{") depth++;
  else if (shellHtml[i] === "}" && --depth === 0) {
    endAt = i;
    break;
  }
}
const real = JSON.parse(shellHtml.slice(shellHtml.indexOf("{", at), endAt + 1));

// 2. The desktop's own props (theme from the built page's split props), with Record 50's on top.
const own = JSON.parse(readFileSync(join(UCA_DIR, "dist/split/props.json"), "utf8"));
const props = {
  ...own,
  ...Object.fromEntries(["tabs", "user", "merchant_id", "merchant_slug", "merchant_pk", "app", "seo", "route", "voice"].filter((k) => k in real).map((k) => [k, real[k]])),
  config: { ...own.config, ...real.config },
};

// 3. Inject exactly as devshell does.
const page = readFileSync(join(UCA_DIR, "dist/phonemac.html"), "utf8").replace(
  "var componentProps = {};",
  `var componentProps = ${JSON.stringify(props).replace(/</g, "\\u003c")};`,
);

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/live.html") {
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    return res.end(page);
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
  if (req.method() !== "GET") {
    calls.push({ path: url.pathname, status: "blocked (read-only)" });
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ message: { id: `local-${Date.now()}`, ts: Date.now() } }) });
  }
  const args = ["-sS", "-X", req.method(), "-w", "\n%{http_code}", "-H", `Origin: ${ORIGIN}`];
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
await context.addCookies([{ name: "authToken", value: TOKEN, url: base }]);
const p = await context.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`${base}/live.html`, { waitUntil: "load" });
await p.waitForTimeout(8000); // auth/me, records, first inbox read

const dock = await p.$$eval("[data-dock-item]", (b) => b.map((x) => x.dataset.dockItem));
const windows = await p.$$eval("[data-window-id]", (w) => w.map((x) => x.dataset.windowId));
const avatarSignedIn = (await p.locator('[data-menu="apple"] [data-avatar-dot]').count()) === 1;
await p.screenshot({ path: join(OUT, "desktop-live.png") });

await browser.close();
server.close();
const summarise = (c) => ({ path: c.path, status: c.status, bytes: c.bytes, auth: c.auth });
console.log(
  JSON.stringify(
    {
      realProps: { tabs: (real.tabs || []).map((t) => t.view_id), merchant_pk: real.merchant_pk ?? null },
      dock,
      windows,
      avatarSignedIn,
      calls: calls.map(summarise),
      pageErrors: errors,
    },
    null,
    2,
  ),
);
console.log(`screenshot (real data, not committed): ${join(OUT, "desktop-live.png")}`);
