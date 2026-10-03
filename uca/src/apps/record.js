// Apps that live in their own records (built separately) are hosted the way the 1ovr1 appshell
// hosts a tab: fetch the record from the viewer endpoint, mount it in a sandboxed srcdoc iframe,
// answer its gin: handshake, keep its state, and sleep/wake it when it is hidden/shown.
import { need, t, emit, el, html, raw, cn, store, storageKey } from "../core.js";

const frames = new Map(); // contentWindow -> { viewId, appId, iframe }
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

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || typeof d.gin !== "string") return;
    const frame = frames.get(e.source);
    if (!frame) return;
    const { viewId, appId } = frame;
    if (d.gin === "app:ready") {
      const saved = store.json("localStorage", stateKey(viewId));
      post(e.source, {
        gin: "app:restore",
        view_id: viewId,
        state: saved ? saved.state : null,
        ts: saved ? saved.ts : 0,
        authed: false,
        user: null,
      });
      const route = store.get("sessionStorage", routeKey(viewId));
      if (route && route !== "/") post(e.source, { gin: "route:set", route });
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
    // Same message the appshell turns into a bar badge.
    if (d.gin === "messages:unread") emit("app:badge", { appId, count: Math.max(0, parseInt(d.n, 10) || 0) });
  });
}

// Same URL shape as the appshell: `${viewEndpoint}_iframe?view=<id>` serves the record with its
// props injected. A blank body is a failure, never cached and never mounted (it would be a blank frame).
function loadRecord(viewId) {
  if (!htmlCache.has(viewId)) {
    const url = `${need("config.viewEndpoint")}_iframe?view=${encodeURIComponent(viewId)}`;
    htmlCache.set(
      viewId,
      fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (!text.trim()) throw new Error(t("record.empty"));
        return text;
      }),
    );
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
