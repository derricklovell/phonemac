// Builds the TEST componentProps from the original repository's hard-coded data
// (app registry, OS wallpapers, strings, icons, theme tokens) plus the notes fixture.
// These are the values a record's `props` column carries; the page itself holds none of them.
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { UCA_DIR, NOTES } from "./shared.mjs";

const REPO = join(UCA_DIR, "..");
const require = createRequire(join(REPO, "package.json"));

async function importTs(entrySource) {
  const out = await build({
    stdin: { contents: entrySource, resolveDir: REPO, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    alias: { "@": REPO },
    logLevel: "silent",
  });
  const code = out.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

// ---------------------------------------------------------------- icons
function lucide(name, strokeWidth = 2) {
  const src = readFileSync(join(REPO, `node_modules/lucide-react/dist/esm/icons/${name}.js`), "utf8");
  const body = src.match(/createLucideIcon\("[^"]+",\s*(\[[\s\S]*\])\);/)[1];
  const nodes = Function(`return ${body}`)();
  const children = nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${a}></${tag}>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

function fontAwesome(pkg, name) {
  const def = require(pkg)[name].icon;
  const [w, h, , , path] = def;
  const d = Array.isArray(path) ? path.join(" ") : path;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"></path></svg>`;
}

const ICONS = {
  // lucide (stroke widths as the original passes them)
  monitor: lucide("monitor"),
  settings: lucide("settings"),
  moon: lucide("moon"),
  themeSun: lucide("sun", 1.75),
  themeMoon: lucide("moon", 1.75),
  themeMonitor: lucide("monitor", 1.75),
  themeSunMoon: lucide("sun-moon", 1.75),
  rotateCcw: lucide("rotate-ccw"),
  power: lucide("power"),
  lock: lucide("lock"),
  logOut: lucide("log-out"),
  info: lucide("info"),
  x: lucide("x"),
  ellipsis: lucide("ellipsis", 2.25),
  penSquare: lucide("square-pen"),
  search: lucide("search"),
  check: lucide("check", 2),
  chevronRight: lucide("chevron-right"),
  chevronLeft: lucide("chevron-left"),
  arrowUpDown: lucide("arrow-up-down", 1.8),
  calendarDays: lucide("calendar-days", 1.8),
  // Font Awesome
  apple: fontAwesome("@fortawesome/free-brands-svg-icons", "faApple"),
  wifi: fontAwesome("@fortawesome/free-solid-svg-icons", "faWifi"),
  battery: fontAwesome("@fortawesome/free-solid-svg-icons", "faBatteryFull"),
  sliders: fontAwesome("@fortawesome/free-solid-svg-icons", "faSliders"),
  // Window controls (components/window-controls.tsx)
  wcClose:
    '<svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M2.5 1.5L5 4L7.5 1.5L8.5 2.5L6 5L8.5 7.5L7.5 8.5L5 6L2.5 8.5L1.5 7.5L4 5L1.5 2.5Z"></path></svg>',
  wcMinimize:
    '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 5h6"></path></svg>',
  wcZoom:
    '<svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><polygon points="2,2 6,2 2,6"></polygon><polygon points="8,8 4,8 8,4"></polygon></svg>',
  wcRestore:
    '<svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><polygon points="4.5,0.5 0.5,4.5 4.5,4.5"></polygon><polygon points="5.5,5.5 9.5,5.5 5.5,9.5"></polygon></svg>',
};

// ---------------------------------------------------------------- strings
const STRINGS = {
  "window.close": "Close window",
  "window.minimize": "Minimize window",
  "window.maximize": "Maximize window",
  "window.restore": "Restore window",
  "apple.label": "Apple menu",
  "apple.about": "About This Mac",
  "apple.settings": "System Settings...",
  "apple.sleep": "Sleep",
  "apple.restart": "Restart...",
  "apple.shutdown": "Shut Down...",
  "apple.lock": "Lock Screen",
  "apple.logout": "Log Out {user}...",
  "app.about": "About {app}",
  "app.quit": "Quit {app}",
  "menu.file": "File",
  "status.battery": "Battery, 97%",
  "status.wifi": "Wi-Fi",
  "status.controlCenter": "Control Center",
  "dock.resize": "Resize Dock",
  "dock.trash": "Trash",
  "dock.open": "Open",
  "dock.keep": "Keep in Dock",
  "dock.quit": "Quit",
  "dock.check": "✓",
  "dock.appMenu": "{app} Dock menu",
  "dock.magnifyOn": "Turn Magnification On",
  "dock.magnifyOff": "Turn Magnification Off",
  "desktop.wallpaperAlt": "Desktop wallpaper",
  "overlay.wake": "Wake",
  "overlay.unlock": "Unlock",
  "overlay.powerOn": "Power on",
  "overlay.touchId": "Touch ID or Enter Password",
  "theme.label": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "phone.bar": "Apps",
  "phone.toggleBar": "Show or hide the app bar",
  "phone.badgeLabel": "{app}, {count} new",
  "record.loading": "Loading {app}…",
  "record.failed": "{app} couldn't load ({reason}).",
  "record.empty": "the record returned an empty page",
  "pending.body": "{app} is still being ported to the UCA build. It will appear here in a later phase.",
  "notes.displayOptions": "Notes display options",
  "notes.newNote": "New Note",
  "notes.search": "Search",
  "notes.searchLabel": "Search notes",
  "notes.clearSearch": "Clear search",
  "notes.listLabel": "Notes list",
  "notes.noResults": "No results found",
  "notes.dateAt": "{date} at {time}",
  "notes.private": "Private",
  "notes.titlePlaceholder": "Your title here...",
  "notes.bodyPlaceholder": "Start writing...",
  "notes.back": "Notes",
  "notes.sortBy": "Sort By",
  "notes.groupByDate": "Group By Date",
  "notes.sortMenu": "Sort notes",
  "notes.groupMenu": "Group notes by date",
  "notes.ascending": "Ascending",
  "notes.descending": "Descending",
  "notes.newestFirst": "Newest First",
  "notes.oldestFirst": "Oldest First",
  "notes.pin": "Pin Note",
  "notes.unpin": "Unpin Note",
  "notes.delete": "Delete Note",
};

// ---------------------------------------------------------------- props
export async function makeTestProps({ theme, assetBase }) {
  const { APPS } = await importTs('export { APPS } from "@/lib/app-config";');
  const { OS_VERSIONS } = await importTs('export { OS_VERSIONS } from "@/lib/os-versions";');

  const assets = {
    trash: `${assetBase}trash.png`,
    avatar: `${assetBase}headshot.jpg`,
  };
  const apps = APPS.map((a) => {
    const key = a.icon.replace(/^\//, "").replace(/\.png$/, "");
    assets[key] = `${assetBase}${a.icon.replace(/^\//, "")}`;
    return {
      id: a.id,
      name: a.name,
      icon: key,
      description: a.description,
      accentColor: a.accentColor,
      menuBarTitle: a.menuBarTitle,
      defaultPosition: a.defaultPosition,
      defaultSize: a.defaultSize,
      minSize: a.minSize,
      dockOrder: a.dockOrder ?? null,
      dockIconScale: a.dockIconScale ?? 1,
      showOnDockByDefault: a.showOnDockByDefault !== false,
      multiWindow: Boolean(a.multiWindow),
      cascadeOffset: a.cascadeOffset ?? 0,
      canQuit: a.id !== "finder",
      alwaysShowsOpenIndicator: a.id === "finder",
      mobile: { supported: a.mobile.supported },
      // Set when the app is built as its own record; the shell then loads it like an appshell tab.
      view_id: null,
    };
  });
  // Phone bar: the apps the original supports on phones, in Dock order.
  const byDock = [...apps].sort((l, r) => (l.dockOrder ?? Infinity) - (r.dockOrder ?? Infinity));
  const barAppIds = byDock.filter((a) => a.mobile.supported).map((a) => a.id);
  // Wallpapers: original file plus, where available, the resized copies the original site
  // served through next/image (uca/assets/wallpapers/<os>-<width>.webp).
  const WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
  const wallpapers = {};
  for (const os of OS_VERSIONS) {
    const sized = existsSync(join(UCA_DIR, `assets/wallpapers/${os.id}-640.webp`));
    wallpapers[os.id] = {
      name: os.name,
      src: sized
        ? `${assetBase}wallpapers/${os.id}-3840.webp`
        : `${assetBase}desktop/versions/${os.wallpaperFile}`,
      srcset: sized ? WIDTHS.map((w) => `${assetBase}wallpapers/${os.id}-${w}.webp ${w}w`).join(", ") : null,
    };
  }

  return {
    meta: { title: "alana goyal", previewTitle: "Phonemac Desktop", description: "Personal website of Alana Goyal", version: "uca-phase-1" },
    user: { displayName: "Alana Goyal", username: "alanagoyal", avatarUrl: assets.avatar },
    shell: { weight: "dom" },
    features: { portedApps: ["notes"] },
    apps,
    responsive: { mobileFallbackAppId: "notes" },
    config: { viewEndpoint: "https://api.1ovr1.com/api:9yDRTI1I/viewer" },
    phone: {
      barAppIds,
      barHeight: 52,
      handleHeight: 8,
      itemSize: 44,
      iconSize: 34,
      gap: 2,
      paddingX: 8,
      dotSize: 4,
      warmLimit: 4,
      swipeThreshold: 50,
      tapSlop: 10,
    },
    formats: { locale: "en-US" },
    storage: {
      windowLayout: "pc-desktop-window-layout",
      systemSettings: "pc-system-settings",
      dockKeep: "pc-dock-keep-overrides",
      dockScale: "pc-dock-scale",
      dockMagnification: "pc-dock-magnification",
      notesSession: "session_id",
      privateNotes: "pc-private-notes",
      pinnedNotes: "pinnedNotes",
      phoneState: "pc-phone-state",
      appStatePrefix: "pc-app-state:",
      appRoutePrefix: "pc-app-route:",
    },
    settings: {
      defaults: {
        appearance: "system",
        osVersion: "sierra",
        wallpaperUrl: null,
        focusMode: "off",
        menuBarBackground: false,
        clockShowDate: true,
        clockShowDayOfWeek: true,
        clockStyle: "digital",
        clockShowAmPm: true,
        clockFlashSeparators: false,
        clockShowSeconds: false,
      },
    },
    desktop: {
      menuBarHeight: 28,
      menuAvatarSize: 18,
      dockHeight: 80,
      windowDockGap: 12,
      windowZMax: 50,
      maximizedZIndex: 80,
      resizeCorner: 12,
      resizeEdge: 6,
      defaultMenuAppId: "finder",
      trashAppId: "finder",
      defaultLayout: {
        windows: [
          { appId: "messages", position: { x: 500, y: 60 }, size: null },
          { appId: "notes", position: { x: 150, y: 40 }, size: { width: 1000, height: 700 } },
        ],
        focusedAppId: "notes",
      },
      wallpapers,
      boot: { stepMs: 150, stepPercent: 5, finishDelayMs: 500 },
    },
    dock: {
      iconSize: 48,
      gap: 4,
      paddingX: 12,
      paddingY: 6,
      dividerHeight: 48,
      dividerMarginX: 4,
      dotSize: 4,
      badgeHeight: 20,
      badgeMinWidth: 20,
      badgePaddingX: 4,
      badgeFontSize: 11,
      handleHitboxWidth: 14,
      handleLineWidth: 1,
      minScale: 0.7,
      maxScale: 1.6,
      scaleStep: 0.05,
      dragPixelsPerScale: 220,
      magnificationScale: 1.4,
      magnificationRadius: 0.88,
      calendarIconRatio: 0.79,
      edgeMargin: 8,
      enterMs: 700,
      exitMs: 350,
    },
    notesApp: {
      defaultSlug: "about-me",
      defaultPinned: ["about-me", "quick-links"],
      newNoteEmoji: "👋🏼",
      saveDebounceMs: 500,
      defaultDisplay: { groupMode: "edited", sortField: "default", sortDirection: "newest" },
      displayStorageKeys: {
        groupMode: "notes-group-mode",
        sortField: "notes-sort-field",
        sortDirection: "notes-sort-direction",
      },
      categoryLabels: {
        pinned: "Pinned",
        notes: "Notes",
        today: "Today",
        yesterday: "Yesterday",
        7: "Previous 7 Days",
        30: "Previous 30 Days",
        older: "Older",
      },
      sortLabels: { default: "Default (Date Edited)", edited: "Date Edited", created: "Date Created", title: "Title" },
      groupLabels: { edited: "Date Edited", created: "Date Created", off: "Off" },
    },
    notes: NOTES,
    strings: STRINGS,
    icons: ICONS,
    assets,
    theme,
  };
}
