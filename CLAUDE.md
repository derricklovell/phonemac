# phonemac — macOS desktop appshell (1ovr1 UCA 3.0)

A macOS-style desktop that takes Record 50's place: the `appshell` / `devshell` endpoints serve it, injecting Record 50's props (`tabs`, `config`, `merchant_*`, `app` / `seo`) in place of `var componentProps = {};`. It's one plain HTML/JS file, with no React and no framework. Read `README.md` for how the endpoints populate it and for the gin: protocol. The endpoint code is in the Xano workspace `gin`: `api/g/appshell_GET.xs`, `devshell_GET.xs` and `viewer_iframe_GET.xs`. Read it with the Xano CLI, using `XANO_CLI_TOKEN` and the instance `https://api.1ovr1.com`, workspace 1.

## Commands

- `npm install`, then `npm run check`: build + all headless checks. Run it after every change. It must end with every check PASS and `Console errors: none`.
- `npm run build` writes `dist/phonemac.html`, the record file. Its props placeholder is `var componentProps = {};`.
- `node tools/live.mjs --env MERCHANT_TOKEN` runs the desktop with that account's real `devshell` props against the live API, opened top-level with the `authToken` cookie, as the gate leaves it. Requests go out with `Origin: https://app.1ovr1.com`, because the API picks builds by Origin. Writes are stopped locally. Its screenshot shows real data: don't open or commit it.

## Rules (UCA 3.0)

- **componentProps is the only source of truth.** Nothing user-specific or hardcoded in the page: strings, URLs, ids, sizes, colours and icons all come from props. Test values live in `tools/make-props.mjs` and `props/`.
- **Zero-fallback.** No `var(--x, fallback)`, no default values for props. A missing prop fails visibly via `need()` / `MissingProp`, and empty props render a specific error.
- **Init order:** `applyCSSProps()` → `buildLUT()` → `boot()`.
- **One file.** CSS and JS are inlined by `tools/build.mjs`. Colours are CSS variables; the build fails on literals or fallbacks.
- **No secrets in the page, props, repo or preview, ever.** Session tokens travel only by postMessage, held in memory (see `src/shell.js` `getSession`). Tokens for local checks come from environment variables, never from chat or files.
- Expose `window.qcEmbed`. Never declare a `QC_EMBED` global.
- No React. Plain ES modules bundled by esbuild into an IIFE.

## How things fit

- `src/main.js` is the entry point: it picks the desktop or phone shell by device signals (never window width), registers the apps, and handles hash routing.
- `src/wm.js` is the window manager. `src/dock.js`, `src/menubar.js` and `src/phone.js` are the shells; `src/overlays.js` handles boot, lock, sleep and so on.
- Apps come from `apps[]` (the desktop's own) plus Record 50's `tabs[]`. Each tab becomes a record app, built from the `desktop.recordApp` template; see `buildApps()` in `main.js`.
- The session (top-level) works like Record 50's: the `authToken` cookie or `gin_dev_token`, then the cached `gin_profile`, then `auth/me`. See `bootSession()` in `shell.js`.
- How each app is provided:
  - `view_id` set: a record loaded like an appshell tab (`src/apps/record.js`). It's fetched from `viewer_iframe`, with `get_pages` s01 as the fallback.
  - Otherwise, a ported app (`src/apps/notes.js`), or a placeholder (`src/apps/pending.js`).
- If the page is instead embedded as a tab inside the appshell, it takes the session from the host's `app:restore`, passes it down to the records it hosts, and passes requests it can't serve up to the host.
- `src/settings-store.js` `setAppearance()` is the only way to change light/dark/system.

## Testing

- `tools/test.mjs` mocks `api.1ovr1.com`. Records come from snapshots in `props/fixtures/records/`; the inbox is sample data.
- Pixel diffs against `reference/` (the original site) target ≤ 0.5%. Known gaps are the unported apps, and Messages, which is now the real record 74 rather than the original's Messages app.
- The claude.ai preview only allows same-origin requests. `dist/artifact/` bundles an appshell stand-in, the desktop, record snapshots and sample data. Republish it with the Artifact tool, passing `dist/artifact/phonemac-preview.html` plus those files.

## 1ovr1 database

- Use the `gin-ide` skill. Read records with `get_pages`. Write with `save_code` only when the user asks, after a backup, and read the record back afterwards.
- Never touch Record 50 (the appshell) or Record 101 (the template) as part of app work.
- Ask before reading production data. Never print private message contents.
