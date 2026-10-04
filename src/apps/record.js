// Apps that live in their own records (built separately) are hosted the way the 1ovr1 appshell
// hosts a tab: fetch the record from the viewer endpoint, mount it in a sandboxed srcdoc iframe,
// answer its gin: handshake, keep its state, and sleep/wake it when it is hidden/shown.
//
// Inside the appshell this page is itself a tab, so a hosted record's messages reach this page, not
// the appshell. It stands in for the appshell towards them: the session the appshell restored to
// this page (user + auth_token) is restored to them, sign-in/out and app events are passed down,
// shell:active names the app in front here, and requests only the appshell can serve
// (apps:open for a record not hosted here) are passed up.
import { need, t, on, emit, el, html, raw, cn, store, storageKey } from "../core.js";
import { settings, appearanceScheme } from "../settings-store.js";
import { isPictureUrl, getSession, toHost } from "../shell.js";

const frames = new Map(); // contentWindow -> { viewId, appId, iframe }
let frontViewId = null; // view_id of the hosted app in front (null when the front app isn't a record)
const pendingContext = new Map(); // view_id -> context to deliver (view:context) once the record is up

export function setFrontApp(app) {
  const next = app && app.view_id != null ? app.view_id : null;
  if (next === frontViewId) return;
  frontViewId = next;
  broadcast({ gin: "shell:active", view_id: frontViewId });
}

function broadcast(msg, except) {
  for (const win of frames.keys()) if (win !== except) post(win, msg);
}
const htmlCache = new Map(); // view_id -> Promise<html>
let listening = false;

const SANDBOX =
  "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";

function stateKey(viewId) {
  return `${storageKey("appStatePrefix")}${viewId}`;
}

function routeKey(viewId) {
  return `${storageKey("appRoutePrefix")}${viewId}`;
}

function post(win, msg) {
  try {
    win.postMessage(msg, "*");
  } catch {
    /* frame gone */
  }
}

// Light / dark / system reaches a record two ways: `color-scheme` on its frame (so the frame's
// backdrop matches while it loads) and, as the source of truth, `appearance`/`scheme` in
// app:restore plus a `shell:appearance` message on every change. prefers-color-scheme inside the
// frame reports the OS, not this setting, so records should follow the message.
const appearanceMessage = () => ({ gin: "shell:appearance", appearance: settings().appearance, scheme: appearanceScheme() });

function listen() {
  if (listening) return;
  listening = true;
  on("appearance:change", ({ scheme }) => {
    const msg = appearanceMessage();
    for (const [win, frame] of frames) {
      frame.iframe.style.colorScheme = scheme;
      post(win, msg);
    }
  });
  // Sign-in/out from the appshell: told to every record the way the appshell tells its tabs
  // (auth:user carries no token; the records answer with app:ready and get a fresh app:restore).
  on("shell:session", (sess) =>
    broadcast(
      sess.authed
        ? { gin: "auth:user", authed: true, user: { username: sess.user.username ?? null, user_id: sess.user.user_id ?? null } }
        : { gin: "auth:user", authed: false, user: null },
    ),
  );
  on("shell:relay", (msg) => broadcast(msg));
  // apps:open with a context: the record gets view:context (now if it is up, else after app:ready).
  on("app:open", ({ appId, context }) => {
    const app = need("apps").find((a) => a.id === appId);
    if (!app || app.view_id == null || context == null) return;
    const up = [...frames].find(([, f]) => f.appId === appId);
    if (up) post(up[0], { gin: "view:context", view_id: app.view_id, context });
    else pendingContext.set(String(app.view_id), context);
  });
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || typeof d.gin !== "string") return;
    const frame = frames.get(e.source);
    if (!frame) return;
    const { viewId, appId } = frame;
    if (d.gin === "app:ready") {
      const saved = store.json("localStorage", stateKey(viewId));
      const sess = getSession();
      post(e.source, {
        gin: "app:restore",
        view_id: viewId,
        state: saved ? saved.state : null,
        ts: saved ? saved.ts : 0,
        authed: sess.authed,
        user: sess.user,
        appearance: settings().appearance,
        scheme: appearanceScheme(),
      });
      const route = store.get("sessionStorage", routeKey(viewId));
      if (route && route !== "/") post(e.source, { gin: "route:set", route });
      const ctx = pendingContext.get(String(viewId));
      if (ctx != null) {
        pendingContext.delete(String(viewId));
        post(e.source, { gin: "view:context", view_id: viewId, context: ctx });
      }
      return;
    }
    if (d.gin === "app:state") {
      store.set("localStorage", stateKey(viewId), JSON.stringify({ state: d.state, ts: Date.now() }));
      return;
    }
    if (d.gin === "route:changed" && typeof d.route === "string" && d.route.startsWith("/") && d.route.length <= 200) {
      store.set("sessionStorage", routeKey(viewId), d.route);
      return;
    }
    // A hosted profile screen changed the picture: the menu-bar avatar follows (as in the appshell).
    if (d.gin === "profile:avatar" && isPictureUrl(d.url)) {
      emit("profile:avatar", d.url);
      return;
    }
    if (d.gin === "shell:active:get") {
      post(e.source, { gin: "shell:active", view_id: frontViewId });
      return;
    }
    // An app event (e.g. messages:refresh) goes to the other hosted records and up to the appshell.
    if (d.gin === "app:event" && typeof d.name === "string") {
      broadcast(d, e.source);
      toHost(d);
      return;
    }
    // Open another app: one hosted here opens here; anything else is the appshell's to open.
    if (d.gin === "apps:open" && d.view_id != null) {
      const target = need("apps").find((a) => a.view_id != null && String(a.view_id) === String(d.view_id));
      if (target) emit("app:open", { appId: target.id, context: d.context ?? null });
      else toHost({ gin: "apps:open", view_id: d.view_id, context: d.context ?? null });
      return;
    }
    // Same message the appshell turns into a bar badge.
    if (d.gin === "messages:unread") emit("app:badge", { appId, count: Math.max(0, parseInt(d.n, 10) || 0) });
  });
}

// Same as the appshell: `${viewEndpoint}_iframe?view=<id>` (with the session cookie) serves the record
// with its props injected. A blank answer (no dev slot, or no session) falls back to the record's raw
// s01 from `${pagesEndpoint}/<id>`, as the appshell's own fallback does. Blank there too is a failure:
// never cached, never mounted (it would be a blank frame).
async function fetchText(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fetchRecord(viewId) {
  const id = encodeURIComponent(viewId);
  const viewed = await fetchText(`${need("config.viewEndpoint")}_iframe?view=${id}`, { credentials: "include" });
  if (viewed.trim()) return viewed;
  const pages = JSON.parse(await fetchText(`${need("config.pagesEndpoint")}/${id}`));
  const s01 = Array.isArray(pages) && pages[0] && typeof pages[0].s01 === "string" ? pages[0].s01 : "";
  if (!s01.trim()) throw new Error(t("record.empty"));
  return s01;
}

function loadRecord(viewId) {
  if (!htmlCache.has(viewId)) {
    htmlCache.set(viewId, fetchRecord(viewId));
    htmlCache.get(viewId).catch(() => htmlCache.delete(viewId));
  }
  return htmlCache.get(viewId);
}

export function createRecordApp(ctx, { app, mobile }) {
  listen();
  const root = el(html`<div class="h-full flex flex-col bg-background text-foreground" data-app="${app.id}" data-record="${app.view_id}">
    ${
      mobile
        ? ""
        : html`<div data-window-drag-handle="true" class="h-[38px] px-3 flex items-center shrink-0 select-none bg-muted border-b border-muted-foreground/20">
            <div class="shrink-0">${raw(ctx.controls("p-1"))}</div>
            <div class="flex-1 min-w-0 truncate text-center text-[13px] font-semibold">${app.name}</div>
            <div class="shrink-0 w-[60px]"></div>
          </div>`
    }
    <div class="relative flex-1 min-h-0" data-record-stage>
      <p class="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground" data-record-status role="status">${t("record.loading", { app: app.name })}</p>
    </div>
  </div>`);
  const stage = root.querySelector("[data-record-stage]");
  const status = root.querySelector("[data-record-status]");
  const iframe = document.createElement("iframe");
  iframe.title = app.name;
  iframe.setAttribute("sandbox", SANDBOX);
  iframe.setAttribute("allow", "clipboard-read; clipboard-write");
  iframe.className = cn("absolute inset-0 h-full w-full border-0 bg-background opacity-0 transition-opacity duration-200");
  iframe.dataset.viewId = String(app.view_id);
  iframe.style.colorScheme = appearanceScheme();
  stage.appendChild(iframe);

  if (!mobile) {
    root.firstElementChild.addEventListener("mousedown", (e) => ctx.startDrag(e));
    // Clicks inside the frame never reach this document; the frame taking focus is the signal
    // that its window was clicked and should come to the front.
    window.addEventListener("blur", onBlur);
  }
  function onBlur() {
    setTimeout(() => {
      if (document.activeElement === iframe && !ctx.isFocused()) ctx.focus();
    });
  }

  // The frame's window proxy survives navigation, so it is registered before the record loads:
  // a record can post app:ready before its load event fires.
  const register = () => {
    if (iframe.contentWindow) frames.set(iframe.contentWindow, { viewId: app.view_id, appId: app.id, iframe });
  };
  iframe.addEventListener("load", () => {
    if (!iframe.srcdoc) return;
    register();
    iframe.classList.replace("opacity-0", "opacity-100");
    status.hidden = true;
  });

  loadRecord(app.view_id)
    .then((markup) => {
      register();
      iframe.srcdoc = markup;
    })
    .catch((err) => {
      status.textContent = t("record.failed", { app: app.name, reason: err.message });
    });

  return {
    el: root,
    sleep() {
      if (iframe.contentWindow) post(iframe.contentWindow, { gin: "shell:sleep" });
    },
    wake() {
      if (iframe.contentWindow) post(iframe.contentWindow, { gin: "shell:wake" });
    },
    destroy() {
      window.removeEventListener("blur", onBlur);
      frames.delete(iframe.contentWindow);
    },
  };
}
