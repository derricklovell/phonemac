// Menu bar: Apple menu, focused-app menus, status items and clock.
import { need, t, emit, on, el, html, raw, cn, icon } from "./core.js";
import * as wm from "./wm.js";
import { settings } from "./settings-store.js";

let bar;
let openMenu = null;
let clockTimer = null;
const menuProviders = new Map(); // appId -> () => [{ id, label, items: () => [...] }]

// Apps contribute extra menu-bar menus (e.g. Notes "File").
export function registerAppMenus(appId, provider) {
  menuProviders.set(appId, provider);
}

const BTN_ACTIVE = "bg-blue-500 text-white";
const BTN_IDLE = "text-black dark:text-white can-hover:hover:bg-white/10";
const STATUS_ACTIVE = "bg-white/30 dark:bg-white/20";
const STATUS_IDLE = "can-hover:hover:bg-white/10";
const PANEL =
  "absolute top-7 rounded-lg bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl shadow-2xl border border-black/10 dark:border-white/10 py-1 z-[70] overflow-hidden";

export function mount(container) {
  bar = el(`<div class="fixed top-0 left-0 right-0 h-7 flex items-center justify-between px-4 z-[70] select-none" data-menubar></div>`);
  container.appendChild(bar);
  render();
  on("wm:change", render);
  on("settings:change", render);
  on("menu:dismiss", () => setOpen(null));
  document.addEventListener("mousedown", (e) => {
    if (openMenu && !bar.contains(e.target)) setOpen(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openMenu) setOpen(null);
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
    const appId = wm.focusedAppId();
    if (e.key.toLowerCase() === "q" && !e.metaKey && !e.ctrlKey && appId && getApp(appId).canQuit) {
      e.preventDefault();
      wm.closeApp(appId);
    }
  });
  bar.addEventListener("click", onClick);
  scheduleClock();
}

const getApp = (id) => wm.getApp(id);

function setOpen(menu) {
  openMenu = menu;
  wm.setMenuOpen(Boolean(menu));
  render();
}

function focusedApp() {
  const id = wm.focusedAppId() ?? need("desktop.defaultMenuAppId");
  return getApp(id);
}

function appMenus(app) {
  const provider = menuProviders.get(app.id);
  return provider ? provider() : [];
}

function menuButton(id, label, bold) {
  return html`<button type="button" data-menu="${id}" aria-haspopup="menu" aria-expanded="${openMenu === id}"
    class="${cn("text-sm px-2 py-0.5 rounded transition-colors", bold && "font-semibold", openMenu === id ? BTN_ACTIVE : BTN_IDLE)}">${label}</button>`;
}

function statusButton(id, label, glyph, glyphCls) {
  return html`<button type="button" data-menu="${id}" aria-label="${label}" aria-haspopup="menu" aria-expanded="${openMenu === id}"
    class="${cn("flex items-center justify-center w-7 h-5 rounded transition-colors", openMenu === id ? STATUS_ACTIVE : STATUS_IDLE)}">${icon(glyph, glyphCls)}</button>`;
}

function item({ id, label, glyph, shortcut, disabled }) {
  return html`<button type="button" role="menuitem" data-item="${id}" ${raw(disabled ? "disabled" : "")}
    class="w-full flex items-center gap-3 px-3 py-1.5 text-xs text-left hover:bg-blue-500 hover:text-white transition-colors group">
    ${glyph ? html`<span class="text-muted-foreground group-hover:text-white">${icon(glyph, "w-4 h-4")}</span>` : ""}
    <span>${label}</span>
    ${shortcut ? html`<span class="ml-auto text-xs text-muted-foreground group-hover:text-white/70">${shortcut}</span>` : ""}
  </button>`;
}

const divider = () => html`<div class="my-1 border-t border-black/10 dark:border-white/10"></div>`;

function panel(id, cls, items) {
  return html`<div role="menu" data-panel="${id}" class="${cn(PANEL, cls)}">${items.map((i) =>
    i === "-" ? divider() : item(i),
  )}</div>`;
}

const actions = new Map();

function appleItems() {
  return [
    { id: "about-mac", label: t("apple.about"), glyph: "monitor", run: () => emit("system:about") },
    "-",
    { id: "settings", label: t("apple.settings"), glyph: "settings", run: () => wm.openWindow("settings") },
    "-",
    { id: "sleep", label: t("apple.sleep"), glyph: "moon", run: () => emit("system:overlay", "sleep") },
    { id: "restart", label: t("apple.restart"), glyph: "rotateCcw", run: () => emit("system:overlay", "restart") },
    { id: "shutdown", label: t("apple.shutdown"), glyph: "power", run: () => emit("system:overlay", "shutdown") },
    "-",
    { id: "lock", label: t("apple.lock"), glyph: "lock", run: () => emit("system:overlay", "lock") },
    {
      id: "logout",
      label: t("apple.logout", { user: need("user.displayName") }),
      glyph: "logOut",
      run: () => emit("system:overlay", "logout"),
    },
  ];
}

function appItems(app) {
  const list = [{ id: "about-app", label: t("app.about", { app: app.menuBarTitle }), glyph: "info", run: () => emit("system:about-app", app.id) }];
  if (app.canQuit) {
    list.push("-", { id: "quit", label: t("app.quit", { app: app.menuBarTitle }), glyph: "x", shortcut: "Q", run: () => wm.closeApp(app.id) });
  }
  return list;
}

function clockText() {
  const s = settings();
  const now = new Date();
  const locale = need("formats.locale");
  const parts = [
    s.clockShowDayOfWeek ? now.toLocaleDateString(locale, { weekday: "short" }) : null,
    s.clockShowDate ? now.toLocaleDateString(locale, { month: "short", day: "numeric" }) : null,
  ].filter(Boolean);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    second: s.clockShowSeconds ? "2-digit" : undefined,
    hour12: true,
  })
    .formatToParts(now)
    .filter((p) => s.clockShowAmPm || p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
  return { label: now.toLocaleString(locale), text: parts.length ? `${parts.join(" ")} ${time}` : time };
}

function scheduleClock() {
  clearTimeout(clockTimer);
  const ms = settings().clockShowSeconds ? 1000 : 60000;
  clockTimer = setTimeout(() => {
    const c = bar.querySelector("[data-clock]");
    if (c) {
      const { label, text } = clockText();
      c.textContent = text;
      c.setAttribute("aria-label", label);
    }
    scheduleClock();
  }, ms - (Date.now() % ms));
}

function render() {
  const app = focusedApp();
  const extra = appMenus(app);
  actions.clear();
  const reg = (items) => items.forEach((i) => i !== "-" && actions.set(i.id, i.run));

  let panels = "";
  if (openMenu === "apple") {
    const items = appleItems();
    reg(items);
    panels = panel("apple", "left-2 w-64", items);
  } else if (openMenu === "appMenu") {
    const items = appItems(app);
    reg(items);
    panels = panel("appMenu", "left-[68px] w-56", items);
  } else {
    const menu = extra.find((m) => m.id === openMenu);
    if (menu) {
      const items = menu.items();
      reg(items);
      panels = panel(menu.id, cn(menu.panelClass, "w-56"), items);
    }
  }

  const clock = clockText();
  bar.innerHTML = html`
    <div class="flex items-center gap-4">
      <button type="button" data-menu="apple" aria-label="${t("apple.label")}" aria-haspopup="menu" aria-expanded="${openMenu === "apple"}"
        class="${cn("flex items-center justify-center w-6 h-5 -ml-1 rounded transition-colors", openMenu === "apple" ? "bg-blue-500" : "can-hover:hover:bg-white/10")}">
        ${icon("apple", cn("w-4 h-4", openMenu === "apple" ? "text-white" : "text-black dark:text-white"))}
      </button>
      <div data-testid="menu-bar-app-commands" class="flex items-center gap-1">
        ${menuButton("appMenu", app.menuBarTitle, true)}
        ${extra.map((m) => menuButton(m.id, m.label, false))}
      </div>
    </div>
    <div class="flex items-center gap-1">
      ${statusButton("battery", t("status.battery"), "battery", "h-3.5 w-5 transition-colors text-black dark:text-white")}
      ${statusButton("wifi", t("status.wifi"), "wifi", "w-4 h-4 text-black dark:text-white")}
      ${statusButton("controlCenter", t("status.controlCenter"), "sliders", "w-4 h-4 text-black dark:text-white")}
      <button type="button" data-menu="notificationCenter" data-clock aria-label="${clock.label}" data-testid="menu-bar-clock"
        class="${cn("flex items-center gap-1.5 text-sm px-2 py-0.5 rounded transition-colors ml-1", openMenu === "notificationCenter" ? STATUS_ACTIVE : STATUS_IDLE, "text-black dark:text-white")}">${clock.text}</button>
    </div>
    ${raw(panels)}`;
}

function onClick(e) {
  const itemBtn = e.target.closest("[data-item]");
  if (itemBtn) {
    const run = actions.get(itemBtn.dataset.item);
    setOpen(null);
    run?.();
    return;
  }
  const menuBtn = e.target.closest("[data-menu]");
  if (!menuBtn) return;
  const id = menuBtn.dataset.menu;
  // Status menus are ported in a later phase; until then they only toggle their highlight.
  setOpen(openMenu === id ? null : id);
}
