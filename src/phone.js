// Phone shell, modelled on the 1ovr1 appshell's bottom bar: one full-screen stage holding a warm
// stack of app panes (hidden panes sleep, shown panes wake, nothing re-boots on a switch), and an
// icon rail that scrolls sideways when it is wider than the screen. A grab handle above the rail
// shows/hides it the same way the appshell's drag bar does (tap, or swipe up/down).
import { need, t, on, emit, el, html, raw, cn, asset, store, storageKey } from "./core.js";
import * as wm from "./wm.js";

const P = () => need("phone");

const panes = new Map(); // appId -> { root, instance }
const badges = {};
let factories;
let stage, footer, bar, handle;
let active = null;
let recent = []; // most recent first
const routes = {}; // appId -> last route the app reported, restored when it comes back to the front
let barVisible = true;

function saveState() {
  store.set("sessionStorage", storageKey("phoneState"), JSON.stringify({ active, barVisible }));
}

export function mount(root, { factoryFor, route, fallbackAppId }) {
  factories = factoryFor;
  const saved = store.json("sessionStorage", storageKey("phoneState")) ?? {};
  barVisible = saved.barVisible !== false;
  const c = P();

  root.dataset.shell = "mobile";
  const shell = el(html`<div class="fixed inset-0 flex flex-col bg-background pt-[env(safe-area-inset-top)]" data-phone>
    <div class="relative flex-1 min-h-0 overflow-hidden" data-phone-stage></div>
    <div class="shrink-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-t border-black/10 dark:border-white/10" data-phone-footer>
      <button type="button" data-phone-handle aria-controls="pc-phone-bar" aria-label="${t("phone.toggleBar")}"
        class="group flex w-full items-center justify-center select-none touch-none cursor-row-resize outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/70"
        style="height:${c.handleHeight}px">
        <span aria-hidden="true" class="h-1 w-12 rounded-full bg-black/20 dark:bg-white/25 transition-all duration-200 can-hover:group-hover:w-14 can-hover:group-hover:bg-black/30 dark:can-hover:group-hover:bg-white/40"></span>
      </button>
      <nav id="pc-phone-bar" aria-label="${t("phone.bar")}" data-phone-bar
        class="pc-scroll-hidden flex items-center overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-proximity"
        style="height:${c.barHeight}px;padding:0 ${c.paddingX}px;scroll-padding-inline:${c.paddingX}px">
        <div class="mx-auto flex w-max items-center" style="gap:${c.gap}px" data-phone-row></div>
      </nav>
    </div>
  </div>`);
  root.appendChild(shell);
  stage = shell.querySelector("[data-phone-stage]");
  footer = shell.querySelector("[data-phone-footer]");
  bar = shell.querySelector("[data-phone-bar]");
  handle = shell.querySelector("[data-phone-handle]");

  // Centred while the icons fit; once they don't, the row is wider than the bar and scrolls.
  const row = bar.querySelector("[data-phone-row]");
  for (const appId of c.barAppIds) row.appendChild(makeIcon(wm.getApp(appId)));
  wireBar();
  wireHandle();
  applyBarVisibility();
  refreshCalendarIcon();
  setInterval(refreshCalendarIcon, 60000);
  window.addEventListener("resize", updateFades);

  on("app:badge", ({ appId, count }) => {
    badges[appId] = count;
    renderBar();
  });
  on("route:changed", (path) => {
    const appId = path.split("/")[0];
    if (panes.has(appId)) routes[appId] = path;
  });

  const start = route.appId && c.barAppIds.includes(route.appId) ? route.appId : saved.active && c.barAppIds.includes(saved.active) ? saved.active : fallbackAppId;
  activate(start, { initialSlug: route.appId === start ? route.rest || null : null });
}

// ---------------------------------------------------------------- bar
function makeIcon(app) {
  const c = P();
  return el(html`<button type="button" data-phone-app="${app.id}" aria-label="${app.name}"
    class="relative flex shrink-0 snap-start flex-col items-center justify-center rounded-xl outline-none transition-transform duration-150 active:scale-90 can-hover:hover:bg-black/5 dark:can-hover:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/70"
    style="width:${c.itemSize}px;height:${c.itemSize}px">
    <span class="relative flex items-center justify-center" style="width:${c.iconSize}px;height:${c.iconSize}px" data-phone-frame>
      ${
        app.id === "calendar"
          ? raw('<span data-calendar-icon class="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-white shadow-sm"><span class="text-calendar-red font-medium leading-none"></span><span class="text-calendar-ink font-normal leading-none"></span></span>')
          : html`<img alt="" draggable="false" decoding="async" src="${asset(app.icon)}" width="${c.iconSize}" height="${c.iconSize}"
              class="pointer-events-none h-full w-full object-contain [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.3))]" style="transform: scale(${app.dockIconScale})">`
      }
    </span>
    <span aria-hidden="true" data-phone-dot class="absolute left-1/2 -translate-x-1/2 rounded-full bg-black/60 dark:bg-white/70 opacity-0 transition-opacity duration-200"
      style="bottom:1px;width:${c.dotSize}px;height:${c.dotSize}px"></span>
  </button>`);
}

function refreshCalendarIcon() {
  const node = bar?.querySelector("[data-calendar-icon]");
  if (!node) return;
  const size = Math.round(P().iconSize * need("dock.calendarIconRatio"));
  const now = new Date();
  const [day, date] = node.children;
  day.textContent = now.toLocaleDateString(need("formats.locale"), { weekday: "short" });
  date.textContent = String(now.getDate());
  Object.assign(node.style, { width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.21)}px` });
  day.style.fontSize = `${size * 0.22}px`;
  date.style.fontSize = `${size * 0.56}px`;
  date.style.marginTop = `${-size * 0.04}px`;
}

function renderBar() {
  for (const btn of bar.querySelectorAll("[data-phone-app]")) {
    const id = btn.dataset.phoneApp;
    const app = wm.getApp(id);
    const isActive = id === active;
    if (isActive) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
    btn.classList.toggle("bg-black/[0.07]", isActive);
    btn.classList.toggle("dark:bg-white/[0.12]", isActive);
    btn.querySelector("[data-phone-dot]").classList.toggle("opacity-0", !panes.has(id));
    const count = badges[id] ?? 0;
    let badge = btn.querySelector("[data-badge]");
    if (count > 0) {
      if (!badge) {
        badge = el(
          `<span data-badge aria-hidden="true" class="pointer-events-none absolute right-0.5 top-0.5 h-4 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white shadow-[0_1px_2px_rgba(0,0,0,0.35)]"></span>`,
        );
        btn.appendChild(badge);
      }
      badge.textContent = count > 99 ? "99+" : String(count);
      btn.setAttribute("aria-label", t("phone.badgeLabel", { app: app.name, count }));
    } else {
      badge?.remove();
      btn.setAttribute("aria-label", app.name);
    }
  }
  updateFades();
}

// Edge fades tell the user there is more rail to scroll to, only on the side(s) that have it.
function updateFades() {
  if (!bar) return;
  const max = bar.scrollWidth - bar.clientWidth;
  const left = bar.scrollLeft > 1;
  const right = max - bar.scrollLeft > 1;
  bar.dataset.fade = left && right ? "both" : left ? "left" : right ? "right" : "none";
}

function revealActiveIcon() {
  const btn = bar.querySelector(`[data-phone-app="${active}"]`);
  if (!btn || bar.scrollWidth <= bar.clientWidth) return;
  const pad = P().paddingX;
  const b = bar.getBoundingClientRect();
  const i = btn.getBoundingClientRect();
  if (i.left < b.left + pad) bar.scrollLeft -= b.left + pad - i.left;
  else if (i.right > b.right - pad) bar.scrollLeft += i.right - (b.right - pad);
}

function wireBar() {
  bar.addEventListener("scroll", updateFades, { passive: true });
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-phone-app]");
    if (!btn) return;
    const id = btn.dataset.phoneApp;
    if (id === active) emit("phone:reselect", id);
    else activate(id);
  });
  // A mouse wheel scrolls the rail sideways (touch and trackpads already do).
  bar.addEventListener(
    "wheel",
    (e) => {
      if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
  bar.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const buttons = [...bar.querySelectorAll("[data-phone-app]")];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: buttons.length - 1 }[e.key];
    buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus();
  });
}

// ---------------------------------------------------------------- handle (tap or swipe)
function applyBarVisibility() {
  bar.hidden = !barVisible;
  handle.setAttribute("aria-expanded", String(barVisible));
  footer.style.paddingBottom = "env(safe-area-inset-bottom)";
  footer.dataset.barVisible = String(barVisible);
}

export function setBarVisible(v) {
  if (barVisible === v) return;
  barVisible = v;
  applyBarVisibility();
  saveState();
  emit("phone:bar", { visible: v });
  if (v) requestAnimationFrame(() => (revealActiveIcon(), updateFades()));
}

function wireHandle() {
  const c = P();
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, y: e.clientY, flipped: false };
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId || drag.flipped) return;
    const d = drag.y - e.clientY;
    if (barVisible && d < -c.swipeThreshold) (drag.flipped = true), setBarVisible(false);
    else if (!barVisible && d > c.swipeThreshold) (drag.flipped = true), setBarVisible(true);
  });
  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const tap = !drag.flipped && Math.abs(drag.y - e.clientY) < c.tapSlop;
    drag = null;
    if (tap && e.type === "pointerup") setBarVisible(!barVisible);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  // Keyboard users get the same toggle (pointer taps are handled above).
  handle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setBarVisible(!barVisible);
    }
  });
}

// ---------------------------------------------------------------- panes (warm stack)
function setPaneShown(pane, shown) {
  pane.root.classList.toggle("invisible", !shown);
  pane.root.classList.toggle("pointer-events-none", !shown);
  pane.root.inert = !shown;
  if (shown) pane.root.removeAttribute("aria-hidden");
  else pane.root.setAttribute("aria-hidden", "true");
}

function createPane(appId, initialSlug) {
  const app = wm.getApp(appId);
  const ctx = {
    windowId: appId,
    window: null,
    isFocused: () => active === appId,
    focus: () => activate(appId),
    close: () => closeApp(appId),
    minimize: () => back(appId),
    toggleMaximize: () => setBarVisible(!barVisible),
    startDrag() {},
    controls: (cls) => wm.windowControls(appId, cls),
    setMetadata() {},
  };
  const instance = factories(app)(ctx, { mobile: true, initialSlug, app });
  const root = el(html`<section data-phone-pane="${appId}" aria-label="${app.name}" class="absolute inset-0 overflow-hidden bg-background"></section>`);
  root.appendChild(instance.el);
  // Window controls rendered by an app (Notes keeps the original's traffic lights) act on the pane.
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-wc]");
    if (!b || !root.contains(b)) return;
    e.stopPropagation();
    ({ close: ctx.close, minimize: ctx.minimize, maximize: ctx.toggleMaximize })[b.dataset.wc]?.();
  });
  stage.appendChild(root);
  const pane = { root, instance };
  panes.set(appId, pane);
  return pane;
}

export function activate(appId, { initialSlug = null } = {}) {
  const previous = active;
  let pane = panes.get(appId);
  if (!pane) pane = createPane(appId, initialSlug);
  active = appId;
  recent = [appId, ...recent.filter((id) => id !== appId)];

  for (const [id, p] of panes) {
    const shown = id === appId;
    setPaneShown(p, shown);
    if (!shown && id === previous) p.instance.sleep?.();
  }
  if (previous && previous !== appId) pane.instance.wake?.();
  enforceWarmLimit();
  renderBar();
  revealActiveIcon();
  saveState();
  emit("route:set", routes[appId] ?? (initialSlug ? `${appId}/${initialSlug}` : appId));
  emit("phone:active", appId);
}

// The appshell keeps a budget of warm frames; past it the least recently used pane is torn down
// (its state lives in storage, so reopening it restores where it was).
function enforceWarmLimit() {
  const limit = P().warmLimit;
  for (const id of recent.slice(limit)) {
    const p = panes.get(id);
    if (!p || id === active) continue;
    p.instance.destroy?.();
    p.root.remove();
    panes.delete(id);
    delete routes[id];
  }
  recent = recent.filter((id) => panes.has(id));
}

function back(appId) {
  const next = recent.find((id) => id !== appId && panes.has(id));
  if (next) activate(next);
}

export function closeApp(appId) {
  const p = panes.get(appId);
  if (!p) return;
  const next = recent.find((id) => id !== appId && panes.has(id)) ?? need("responsive.mobileFallbackAppId");
  p.instance.destroy?.();
  p.root.remove();
  panes.delete(appId);
  delete routes[appId];
  recent = recent.filter((id) => id !== appId);
  // Closing the front app shows the one used before it; with nothing left, the fallback app
  // starts fresh (the stage is never empty).
  if (active === appId) {
    active = null;
    activate(next);
  } else renderBar();
}

export const activeAppId = () => active;
