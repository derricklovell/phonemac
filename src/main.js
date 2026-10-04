// UCA 3.0 entry: applyCSSProps() → buildLUT() → boot().
/* global componentProps */
import { need, has, t, on, emit, el, html, applyCSSProps, MissingProp } from "./core.js";
import * as wm from "./wm.js";
import * as menubar from "./menubar.js";
import * as dock from "./dock.js";
import * as overlays from "./overlays.js";
import * as shell from "./shell.js";
import * as phone from "./phone.js";
import { watchIdentity } from "./avatar.js";
import { settings, applyAppearance, watchSystemAppearance } from "./settings-store.js";
import { createNotesApp } from "./apps/notes.js";
import { createPendingApp } from "./apps/pending.js";
import { createRecordApp, setFrontApp } from "./apps/record.js";
import { detectMobileClientFromWindow } from "./lib/device-detection";

const LUT = {};

// The desktop's apps, built the way Record 50 builds its bar: the desktop's own apps (props.apps)
// plus every tab the appshell endpoints put in props.tabs (each the record's own dev json — view_id,
// name, icon path, colour). A tab whose view_id a desktop app already has joins that app (Messages
// keeps its macOS icon); any other tab becomes a record app of its own.
function buildApps() {
  const list = need("apps").map((a) => ({ ...a }));
  const byView = new Map(list.filter((a) => a.view_id != null).map((a) => [String(a.view_id), a]));
  if (has("tabs")) {
    const base = need("desktop.recordApp");
    for (const tab of need("tabs")) {
      if (tab.view_id == null || byView.has(String(tab.view_id))) continue;
      const name = tab.name || tab.label || t("record.untitled", { id: tab.view_id });
      const app = {
        ...structuredClone(base),
        id: `rec-${tab.view_id}`,
        name,
        menuBarTitle: name,
        description: tab.tagline || "",
        view_id: tab.view_id,
        glyph: tab.icon && tab.color ? { path: tab.icon, color: tab.color } : base.glyph,
      };
      list.push(app);
      byView.set(String(tab.view_id), app);
    }
  }
  return list;
}

function buildLUT() {
  const apps = buildApps();
  wm.setApps(apps);
  LUT.apps = new Map(apps.map((a) => [a.id, a]));
  LUT.ported = new Set(need("features.portedApps"));
}

const APP_FACTORIES = {
  notes: createNotesApp,
};

// An app with a view_id is its own record, loaded the way the appshell loads a tab; otherwise the
// in-page port if there is one; otherwise a labelled placeholder.
function factoryFor(app) {
  if (app.view_id != null) return createRecordApp;
  if (LUT.ported.has(app.id)) return APP_FACTORIES[app.id];
  return createPendingApp;
}

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

// Same rule as the original: phone layout only on phones/tablets (user agent, or several
// touch signals together), never because a desktop browser window is narrow.
function isPhone() {
  return detectMobileClientFromWindow();
}

// ---------------------------------------------------------------- boot
function boot() {
  applyAppearance();
  watchSystemAppearance();
  document.title = need("meta.title");
  watchIdentity();
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

  for (const app of wm.apps()) {
    const factory = factoryFor(app);
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
  // A hosted record asked to open another app hosted here.
  on("app:open", ({ appId }) => dock.activate(appId));
  on("dock:trash", () => wm.openWindow(need("desktop.trashAppId")));
  on("route:set", setRoute);
  on("app:badge", ({ appId, count }) => dock.setBadge(appId, count));
  on("wm:change", () => {
    const appId = wm.focusedAppId();
    setFrontApp(appId ? wm.getApp(appId) : null);
    if (appId && !location.hash.startsWith(`#/${appId}`)) setRoute(appId);
  });
  emit("wm:change");
}

function bootPhone(root, route) {
  on("route:set", setRoute);
  on("phone:active", (appId) => setFrontApp(wm.getApp(appId)));
  on("app:open", ({ appId }) => phone.onBar(appId) && phone.activate(appId));
  phone.mount(root, { factoryFor, route, fallbackAppId: need("responsive.mobileFallbackAppId") });
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
