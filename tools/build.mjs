// Builds the single-file UCA app.
//   dist/phonemac.html        — the record file (devs01/s01): placeholder `var componentProps = {};`
//   dist/split/*              — the four UCA source fields + props.json
//   dist/local/index.html     — the same file with the TEST props injected, plus assets/ (local preview)
//   dist/local/preview-host.html + desktop.html — the artifact preview: an appshell stand-in hosting
//                               the desktop, which hosts record 74 (snapshot) on a sample inbox
//   dist/local/devshell.html  — test variant: the desktop with Record 50-style props (sample tabs, merchant)
//   dist/local/records.html   — test variant: every app on the phone bar, Messages/Photos hosted as
//                               records from the test server's mock viewer endpoint
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { UCA_DIR } from "./shared.mjs";
import { makeTestProps } from "./make-props.mjs";

const SRC = join(UCA_DIR, "src");
const DIST = join(UCA_DIR, "dist");
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(p, "utf8");

// ---------------------------------------------------------------- CSS
const ORIGINAL_CSS = [
  // The original app's stylesheets (Notes editor, markdown, globals + theme tokens).
  join(SRC, "styles/original/tiptap.css"),
  join(SRC, "styles/original/github-markdown.css"),
  join(SRC, "styles/original/globals.css"),
];

function cssSource() {
  const parts = ORIGINAL_CSS.map((p) => read(p).replace(/^@import .*;$/gm, ""));
  parts.push(read(join(SRC, "styles/port.css")));
  return parts.join("\n");
}

// var(--a, fallback) → var(--a), recursively, honouring nested parentheses.
// Each stripped fallback is recorded so it can be defined once on :root (custom properties
// inherit, so a :root default behaves exactly like the fallback did).
function stripVarFallbacks(value, fallbacks) {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    let depth = 0;
    let j = at + 3;
    let comma = -1;
    for (; j < value.length; j++) {
      const c = value[j];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      } else if (c === "," && depth === 1 && comma === -1) comma = j;
    }
    const name = value.slice(at + 4, comma === -1 ? j : comma).trim();
    if (comma !== -1 && fallbacks) {
      const fb = stripVarFallbacks(value.slice(comma + 1, j).trim(), fallbacks);
      if (!fallbacks.has(name)) fallbacks.set(name, new Set());
      fallbacks.get(name).add(fb);
    }
    out += `var(${name})`;
    i = j + 1;
  }
  return out;
}

const COLORISH = /color|background|border|fill|stroke|shadow|outline|caret|decoration|--tw-/;

function hexKey(r, g, b, a) {
  const h = (n) => Math.round(n).toString(16).padStart(2, "0");
  return a === undefined || a >= 1 ? `${h(r)}${h(g)}${h(b)}` : `${h(r)}${h(g)}${h(b)}${h(a * 255)}`;
}

function literalKey(lit) {
  const s = lit.toLowerCase();
  if (s === "white") return "ffffff";
  if (s === "black") return "000000";
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    return h.endsWith("ff") && h.length === 8 ? h.slice(0, 6) : h;
  }
  const m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const nums = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return hexKey(nums[0], nums[1], nums[2], nums[3]);
  }
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function replaceLiterals(prop, value, literals) {
  let v = value.replace(/#[0-9a-fA-F]{3,8}\b/g, (lit) => {
    const key = literalKey(lit);
    literals[key] = lit;
    return `var(--lit-${key})`;
  });
  v = v.replace(/\b(rgba?|hsla?)\(([^()]*)\)/g, (lit, fn, inner) => {
    if (inner.includes("var")) return lit;
    const key = literalKey(lit);
    literals[key] = lit;
    return `var(--lit-${key})`;
  });
  if (COLORISH.test(prop)) {
    v = v.replace(/(^|[\s,(])(white|black)(?=$|[\s,)])/g, (all, pre, word) => {
      const key = literalKey(word);
      literals[key] = word;
      return `${pre}var(--lit-${key})`;
    });
  }
  return v;
}

async function buildCss() {
  const config = require(join(UCA_DIR, "tailwind.config.cjs"));
  config.content = [join(SRC, "**/*.{js,html}")];
  const result = await postcss([tailwindcss(config)]).process(cssSource(), { from: undefined });
  const root = result.root;
  const modes = { light: {}, dark: {} };
  const literals = {};

  // Theme token blocks (:root / .dark) move into props.theme.modes.
  root.walkRules((rule) => {
    const mode = rule.selector === ":root" ? "light" : rule.selector === ".dark" ? "dark" : null;
    if (!mode) return;
    const decls = rule.nodes.filter((n) => n.type === "decl");
    if (!decls.length || !decls.every((d) => d.prop.startsWith("--"))) return;
    decls.forEach((d) => (modes[mode][d.prop.slice(2)] = d.value));
    rule.remove();
  });
  root.walkAtRules("layer", (at) => {
    if (!at.nodes || at.nodes.length === 0) at.remove();
  });
  const fallbacks = new Map();
  root.walkDecls((decl) => {
    decl.value = stripVarFallbacks(decl.value, fallbacks);
  });
  const defined = new Set();
  root.walkDecls((decl) => decl.prop.startsWith("--") && defined.add(decl.prop));
  const defaults = [];
  for (const [name, values] of fallbacks) {
    if (defined.has(name)) continue;
    if (values.size > 1) throw new Error(`${name} has conflicting fallbacks: ${[...values].join(" | ")}`);
    defaults.push(`${name}: ${[...values][0]};`);
  }
  if (defaults.length) root.prepend(postcss.parse(`:root { ${defaults.join(" ")} }`));
  root.walkDecls((decl) => {
    decl.value = replaceLiterals(decl.prop, decl.value, literals);
  });
  return { css: root.toString(), modes, literals };
}

// ---------------------------------------------------------------- theme values (from the original)
function rgbTriplet(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const ACCENTS = {
  "notes-highlight": "#FFE390",
  "notes-highlight-dark": "#9D7D28",
  "notes-search-dark": "#353533",
  "notes-link": "#e2a727",
  "calendar-red": "#FF3B30",
  "calendar-ink": "#1c1c1e",
  "accent-blue": "#0A7CFF",
};

function themeFor(css, modes, literals) {
  const colors = require("tailwindcss/colors");
  const used = new Set([...css.matchAll(/var\(--color-([a-z0-9-]+)\)/g)].map((m) => m[1]));
  const palette = {};
  for (const name of [...used].sort()) {
    if (ACCENTS[name]) {
      palette[name] = rgbTriplet(ACCENTS[name]);
      continue;
    }
    const m = name.match(/^([a-z]+)-(\d+)$/);
    const hex = m ? colors[m[1]]?.[m[2]] : colors[name];
    if (!hex) throw new Error(`No colour value for --color-${name}`);
    palette[name] = rgbTriplet(hex);
  }
  const fontFamily = require("tailwindcss/defaultTheme").fontFamily;
  return {
    palette,
    literals,
    fonts: {
      sans: ["-apple-system", "SF Pro", "SF Pro Display", "SF Pro Text", ...fontFamily.sans].join(", "),
      mono: fontFamily.mono.join(", "),
    },
    modes,
  };
}

// ---------------------------------------------------------------- checks
function verifyCss(css, theme) {
  const problems = [];
  const fallback = css.match(/var\(--[^)]*,/);
  if (fallback) problems.push(`var() fallback remains: ${fallback[0]}`);
  const lit = css.replace(/url\([^)]*\)/g, "").match(/:\s*[^;{}]*(#[0-9a-fA-F]{3,8}\b|\brgba?\([^v)]*\))/);
  if (lit) problems.push(`colour literal remains: ${lit[0]}`);
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  Object.keys(theme.palette).forEach((k) => defined.add(`--color-${k}`));
  Object.keys(theme.literals).forEach((k) => defined.add(`--lit-${k}`));
  Object.keys(theme.fonts).forEach((k) => defined.add(`--font-${k}`));
  Object.keys(theme.modes.light).forEach((k) => defined.add(`--${k}`));
  // Tailwind's coloured-shadow chain: --tw-shadow-colored refers to --tw-shadow-color, and is only
  // read after a shadow-<colour> utility has set both, so it is intentionally undefined until then.
  const lazy = new Set(["--tw-shadow-color"]);
  const missing = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/gi)].map((m) => m[1]))].filter(
    (v) => !defined.has(v) && !lazy.has(v),
  );
  if (missing.length) problems.push(`undefined custom properties: ${missing.join(", ")}`);
  if (problems.length) throw new Error(`CSS check failed:\n- ${problems.join("\n- ")}`);
}

// ---------------------------------------------------------------- JS
async function buildJs() {
  const out = await build({
    entryPoints: [join(SRC, "entry.js")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    alias: { "@": SRC },
    legalComments: "none",
    logLevel: "warning",
  });
  const vendor = read(require.resolve("markdown-it/dist/markdown-it.min.js"));
  const script = ["var componentProps = {};", vendor, out.outputFiles[0].text].join("\n");
  return script.replace(/<\/script/gi, "<\\/script");
}

// ---------------------------------------------------------------- assemble
function assemble({ head, css, body, script }) {
  return `<!doctype html>\n<html lang="en">\n<head>\n${head.trim()}\n<style>\n${css}\n</style>\n</head>\n<body>\n${body.trim()}\n<script>\n${script}\n</script>\n</body>\n</html>\n`;
}

export function injectProps(htmlText, props) {
  const json = JSON.stringify(props).replace(/</g, "\\u003c");
  const marker = "var componentProps = {};";
  if (htmlText.split(marker).length !== 2) throw new Error("expected exactly one componentProps placeholder");
  return htmlText.replace(marker, () => `var componentProps = ${json};`);
}

const LOCAL_ASSETS = ["finder.png", "notes.png", "messages.png", "photos.png", "music.png", "calendar.png", "weather.png",
  "iterm.png", "games.png", "settings.png", "textedit.png", "preview.png", "trash.png", "headshot.jpg", "desktop/versions"];

export async function buildAll({ assetBase = "assets/" } = {}) {
  const { css, modes, literals } = await buildCss();
  const theme = themeFor(css, modes, literals);
  verifyCss(css, theme);
  const head = read(join(SRC, "head.html"));
  const body = read(join(SRC, "body.html"));
  const script = await buildJs();
  const page = assemble({ head, css, body, script });
  const props = await makeTestProps({ theme, assetBase });

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "split"), { recursive: true });
  mkdirSync(join(DIST, "local/assets"), { recursive: true });
  writeFileSync(join(DIST, "phonemac.html"), page);
  writeFileSync(join(DIST, "split/head.html"), head);
  writeFileSync(join(DIST, "split/style.css"), css);
  writeFileSync(join(DIST, "split/html.html"), body);
  writeFileSync(join(DIST, "split/script.js"), script);
  writeFileSync(join(DIST, "split/props.json"), JSON.stringify(props, null, 2));
  writeFileSync(join(DIST, "local/index.html"), injectProps(page, props));
  writeFileSync(join(DIST, "local/records.html"), injectProps(page, recordsVariant(props)));
  writeFileSync(join(DIST, "local/devshell.html"), injectProps(page, devshellVariant(props)));
  // Artifact preview: the publish skeleton supplies doctype/head/body, so ship the inner parts only.
  mkdirSync(join(DIST, "artifact"), { recursive: true });
  const fragment = `<title>${props.meta.previewTitle}</title>\n<style>\n${css}\n</style>\n${body.trim()}\n<script>\n${script}\n</script>\n`;
  // Preview: an appshell stand-in (the artifact's page) hosting the desktop (desktop.html), which
  // hosts record 74 (real code, snapshot) reading a sample inbox — the production nesting, offline.
  // A static host can't answer per ?view=, so each record is its own file (records/view-<id>.html);
  // the stand-in appshell points viewer_iframe requests at them (see tools/preview-host.html).
  const preview = previewVariant(props);
  const desktopHtml = injectProps(page, preview);
  const record74 = withViewerProps(read(join(UCA_DIR, "props/fixtures/records/74.s01.html")), { config: { gin_base: "records/api" } });
  const mailProps = JSON.parse(read(join(UCA_DIR, "records/mail/props.json")));
  const mail = injectProps(read(join(UCA_DIR, "records/mail/mail.html")), {
    ...mailProps,
    config: { ...mailProps.config, gin_base: "records/api" },
    _viewer: { merchant_id: preview.merchant_pk, requested_view: PREVIEW_MAIL_VIEW },
  });
  const inbox = read(join(UCA_DIR, "props/fixtures/inbox.json"));
  const hostFragment = read(join(UCA_DIR, "tools/preview-host.html"));
  for (const dir of ["local", "artifact"]) {
    mkdirSync(join(DIST, dir, "records/api/messages"), { recursive: true });
    writeFileSync(join(DIST, dir, "desktop.html"), desktopHtml);
    writeFileSync(join(DIST, dir, "records/view-74.html"), record74);
    writeFileSync(join(DIST, dir, `records/view-${PREVIEW_MAIL_VIEW}.html`), mail);
    writeFileSync(join(DIST, dir, "records/api/messages/inbox"), inbox);
  }
  writeFileSync(join(DIST, "artifact/phonemac-preview.html"), hostFragment);
  writeFileSync(join(DIST, "local/preview-host.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${hostFragment}</body></html>`);
  cpSync(join(UCA_DIR, "assets/brand"), join(DIST, "local/assets/brand"), { recursive: true });
  cpSync(join(UCA_DIR, "assets/wallpapers"), join(DIST, "local/assets/wallpapers"), { recursive: true });
  for (const a of LOCAL_ASSETS) {
    const from = join(UCA_DIR, "assets/static", a);
    if (existsSync(from)) cpSync(from, join(DIST, "local/assets", a), { recursive: true });
  }
  return { page, props, sizes: { page: page.length, css: css.length, script: script.length } };
}

// Preview (claude.ai artifact) variant. The artifact host only allows same-origin images and requests,
// so the boot logo is bundled and records come from same-origin copies at records/viewer_iframe
// (the shell still fetches `${view_endpoint}_iframe?view=<id>`, as from the database). The record
// file keeps the real URLs.
const PREVIEW_MAIL_VIEW = 900; // Mail has no database id yet; the local copy uses this one

function previewVariant(props) {
  const mailFace = JSON.parse(read(join(UCA_DIR, "records/mail/dev.json")));
  return {
    ...props,
    config: { ...props.config, view_endpoint: "records/viewer" },
    assets: { ...props.assets, bootLogo: "assets/brand/1ovr1-logo.jpg" },
    // Record 50-style: the sample business, with Mail (local) as a tab next to Messages (74).
    tabs: [{ ...mailFace, view_id: PREVIEW_MAIL_VIEW }],
    merchant_id: "sample-merchant",
    merchant_slug: "sample-merchant",
    merchant_pk: 41,
  };
}

// What viewer_iframe does server-side: the record's props, injected ahead of its own scripts.
function withViewerProps(recordHtml, props) {
  const tag = `<script>var componentProps = ${JSON.stringify(props).replace(/</g, "\\u003c")};</script>`;
  return recordHtml.replace(/<head>/i, (h) => `${h}\n${tag}`);
}

// What devshell injects on a merchant's shell (Record 50's props: tabs, merchant_*, a visitor user)
// over the desktop's own props — sample tab faces, not a real merchant's.
function devshellVariant(props) {
  return {
    ...props,
    tabs: JSON.parse(read(join(UCA_DIR, "props/fixtures/tabs.json"))),
    merchant_id: "sample-merchant",
    merchant_slug: "sample-merchant",
    merchant_pk: 41,
  };
}

function recordsVariant(props) {
  const RECORDS = { messages: 9001, photos: 9002 };
  return {
    ...props,
    config: { ...props.config, view_endpoint: "/viewer" },
    apps: props.apps.map((a) => (a.id in RECORDS ? { ...a, view_id: RECORDS[a.id] } : a)),
    phone: { ...props.phone, barAppIds: props.apps.map((a) => a.id) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { sizes } = await buildAll();
  console.log(`built dist/phonemac.html — ${(sizes.page / 1024).toFixed(0)} KB (css ${(sizes.css / 1024).toFixed(0)} KB, script ${(sizes.script / 1024).toFixed(0)} KB)`);
}
