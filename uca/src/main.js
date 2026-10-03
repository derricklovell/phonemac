// UCA 3.0 entry: applyCSSProps() → buildLUT() → boot().
/* global componentProps */
import { need, t, on, emit, el, html, applyCSSProps, MissingProp } from "./core.js";
import * as wm from "./wm.js";
import * as menubar from "./menubar.js";
import * as dock from "./dock.js";
import * as overlays from "./overlays.js";
import * as shell from "./shell.js";
import { settings, applyAppearance, watchSystemAppearance } from "./settings-store.js";
import { createNotesApp } from "./apps/notes.js";
import { createPendingApp } from "./apps/pending.js";

const LUT = {};

function buildLUT() {
  LUT.apps = new Map(need("apps").map((a) => [a.id, a]));
  LUT.ported = new Set(need("features.portedApps"));
}

const APP_FACTORIES = {
  notes: createNotesApp,
};

// ---------------------------------------------------------------- routing (hash: #/app/rest)
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [appId, ...rest] = raw.split("/").filter(Boolean);
  return { appId: appId && LUT.apps.has(appId) ? appId : null, rest: rest.join("/") };
}

function setRoute(path) {
  const next = `#/${path}`;
  if (location.hash !== next) {
    try {
      history.replaceState(null, "", next);
    } catch {
      /* sandboxed frames may refuse history updates; the route still applies in-page */
    }
  }
  emit("route:changed", path);
}

function isPhone() {
  return window.matchMedia(`(max-width: ${need("responsive.mobileMaxWidth")}px)`).matches;
}

// ---------------------------------------------------------------- boot
function boot() {
  applyAppearance();
  watchSystemAppearance();
  document.title = need("meta.title");
  shell.boot();

  const root = document.getElementById("pc-root");
  const route = parseRoute();

  if (isPhone()) return bootPhone(root, route);

  root.dataset.shell = "desktop";
  const wallpaper = el(html`<img alt="${t("desktop.wallpaperAlt")}" decoding="async" sizes="100vw" class="object-cover -z-10 absolute inset-0 h-full w-full" data-wallpaper>`);
  const refreshWallpaper = () => {
    const s = settings();
    const set = need(`desktop.wallpapers.${s.osVersion}`);
    if (s.wallpaperUrl) wallpaper.removeAttribute("srcset");
    else if (set.srcset) wallpaper.srcset = set.srcset;
    else wallpaper.removeAttribute("srcset");
    wallpaper.src = s.wallpaperUrl ?? set.src;
  };
  refreshWallpaper();
  on("settings:change", refreshWallpaper);
  root.appendChild(wallpaper);

  menubar.mount(root);
  const layer = el(`<div data-windows></div>`);
  root.appendChild(layer);

  for (const app of need("apps")) {
    const factory = LUT.ported.has(app.id) ? APP_FACTORIES[app.id] : createPendingApp;
    wm.registerApp(app.id, (ctx) =>
      factory(ctx, { mobile: false, initialSlug: app.id === route.appId ? route.rest || null : null, app }),
    );
  }
  wm.boot(layer, route.appId);
  dock.mount(root);
  overlays.mount(root, {
    onReset: () => {
      sessionStorage.clear();
      location.reload();
    },
  });

  // Multi-window apps launched with nothing open get a fresh window.
  on("app:launch-empty", (appId) => wm.openWindow(appId));
  on("dock:trash", () => wm.openWindow(need("desktop.trashAppId")));
  on("route:set", setRoute);
  on("wm:change", () => {
    const appId = wm.focusedAppId();
    if (appId && !location.hash.startsWith(`#/${appId}`)) setRoute(appId);
  });
  emit("wm:change");
}

function bootPhone(root, route) {
  root.dataset.shell = "mobile";
  const app = route.appId ? LUT.apps.get(route.appId) : null;
  const appId = app && app.mobile.supported && LUT.ported.has(app.id) ? app.id : need("responsive.mobileFallbackAppId");
  const ctx = {
    windowId: appId,
    isFocused: () => true,
    close() {},
    minimize() {},
    toggleMaximize() {},
    startDrag() {},
    controls: (cls) => wm.windowControls(appId, cls),
    setMetadata() {},
  };
  const instance = APP_FACTORIES[appId](ctx, { mobile: true, initialSlug: route.appId === appId ? route.rest || null : null });
  root.appendChild(el(`<div class="fixed inset-0 bg-background"></div>`)).appendChild(instance.el);
  on("route:set", setRoute);
}

function showMissing(error) {
  const root = document.getElementById("pc-root");
  root.removeAttribute("data-shell");
  const box = document.createElement("pre");
  box.setAttribute("role", "alert");
  box.style.cssText = "white-space:pre-wrap;padding:16px;font:14px/1.5 monospace";
  box.textContent = `${error.message}.\nThis app renders only from its componentProps (record props injected by the server).`;
  root.replaceChildren(box);
}

export function init() {
  try {
    if (!componentProps || Object.keys(componentProps).length === 0) {
      throw new MissingProp("* (componentProps is empty — props were not injected)");
    }
    applyCSSProps(); // 1. CSS vars — style layer live
    buildLUT(); // 2. registry
    boot(); // 3. DOM, connections, events
  } catch (error) {
    if (error instanceof MissingProp) showMissing(error);
    else throw error;
  }
}
