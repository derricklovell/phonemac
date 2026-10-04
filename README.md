# phonemac — macOS desktop appshell (1ovr1 UCA 3.0)

A macOS-style desktop for the 1ovr1 appshell, meant to be served in Record 50's place by the `appshell` / `devshell` endpoints. It's one plain HTML/JS file, with no React and no framework. Everything it shows comes from `componentProps`, which the endpoint injects in place of `var componentProps = {};`.

## How the appshell endpoints populate it

`appshell` (visitors) and `devshell` (signed in, `auth = "user"`) load Record 50 and build its props per request:

- **Merchant:** found from the host (`x_forwarded_host` → `merchant_hosts`), the `x_merchant_id` header, or the signed-in user.
- **Props built:** `tabs` (each app's own dev json: `view_id`, `name`, `icon` path, `color`, `dock`, `s01_only`), `config` (`view_endpoint`, `gin_base`, `messages_view_id`, …), `merchant_id` / `merchant_slug` / `merchant_pk`, `app` / `seo` branding, and a visitor `user`.
- **Injection:** the props replace `var componentProps = {};` in the record's `s01` (live) or `devs01` (dev).

The desktop reads that same shape:

- **Tabs:** every entry in `tabs` becomes a Dock app (phone-bar app on phones), with its icon drawn from the tab's path and colour. A tab whose `view_id` a desktop app already has joins it, so Messages (74) keeps its macOS icon. New tabs use the template `desktop.recordApp`.
- **Records:** opened from `config.view_endpoint` with `/viewer` → `/viewer_iframe`, as Record 50 does. The API picks the build by the page's Origin (`get_ip_info`): `app.*` gets the dev build and `www.*` the live one. Any other origin gets an empty answer, which falls back to `config.pages_endpoint`.
- **Session:** found the way Record 50 finds it:
  1. the `authToken` cookie, or the white-label gate's `gin_dev_token`;
  2. the cached `gin_profile` straight away;
  3. then `GET {gin_base}/auth/me`.
  
  Records get the session in `app:restore`. Viewer requests carry the Bearer token and `x-merchant-id`, as the white-label shell's fetch does.
- **The desktop's own namespaces** (`apps`, `dock`, `desktop`, `phone`, `strings`, `icons`, `theme`, …) are added to Record 50's props alongside these.

## Setup

```
npm install              # build/test tools only; the page itself has no dependencies
npm run build            # dist/phonemac.html (the record file), dist/split/*, dist/local/ (test props), dist/artifact/ (claude.ai preview)
npm test                 # headless checks + pixel diff against reference/
npm run check            # build + test
node tools/live.mjs --env MERCHANT_TOKEN   # the desktop with a real account's devshell props, live API, read-only (writes stopped)
node tools/fetch-record.mjs 74   # refresh a record snapshot in props/fixtures/records/
```

The tests use Playwright's Chromium. Cloud sessions have it preinstalled at `/opt/pw-browsers`.

## Repository layout

| path | what |
|---|---|
| `src/` | the page: `head.html`, `body.html`, `styles/`, and the JS modules bundled into one script (`main.js` is the entry point; `apps/` holds hosted and ported apps) |
| `src/lib/`, `src/styles/original/`, `assets/static/`, `props/data/` | pieces reused from the original Next.js site (see ATTRIBUTION.md) |
| `records/` | apps built as their own database records (Mail); see `records/README.md` |
| `props/fixtures/` | test data: sample notes, a sample inbox, sample tabs, and read-only record snapshots (54, 74) |
| `tools/` | build (`build.mjs`), test props (`make-props.mjs`), tests (`test.mjs`), live check, preview host |
| `reference/` | screenshots of the original site that the pixel diffs compare against |

## Layouts

- **Desktop**: menu bar, windows and Dock. When the Dock is wider than the window, it scrolls sideways. In that mode magnification is off and edges fade.
- **Phone**: chosen by device signals, not window width. One full-screen stage, plus the appshell-style bottom bar:
  - The bar is centred while the icons fit, and scrolls sideways (with edge fades) once they don't.
  - Apps you switch away from stay warm: hidden, slept and woken, not rebuilt. Past `phone.warmLimit`, the least recently used app is torn down.
  - The grab handle above the bar hides or shows it: tap it, swipe it, or press Enter.

## Where an app comes from

For each entry in `apps[]`, in order:

1. **`view_id` set**: the app is its own record. It is loaded from `` `${config.view_endpoint}` → `/viewer_iframe?view=<view_id>` ``, which is the same URL the appshell uses for a tab. It runs in a sandboxed `srcdoc` iframe with the appshell's sandbox flags.
2. **Ported in this file**: listed in `features.portedApps`. Currently only `notes`.
3. **Otherwise**: a labelled placeholder.

## gin: messages answered for record apps

| from the record | shell does |
|---|---|
| `app:ready` | replies `app:restore {view_id, state, ts, authed, user, appearance, scheme}`, then `route:set` if a route was saved |
| `app:state {state}` | saves it to localStorage (`storage.appStatePrefix` + view_id) |
| `route:changed {route}` | saves it to sessionStorage (`storage.appRoutePrefix` + view_id) |
| `messages:unread {n}` | shows a badge on the app's phone-bar icon and Dock icon |

The shell sends `shell:sleep` when an app is hidden and `shell:wake` when it is shown again.

## Light / dark / system

The Apple menu has a Theme switch (Light, Dark, System). Settings stores the choice as `settings.appearance`, with the default coming from `settings.defaults`.

- `setAppearance()` in `src/settings-store.js` is the only way to change it.
- Built-in apps follow the `dark` class on `<html>`. Nothing keys off `prefers-color-scheme`, so a manual choice always wins.
- Colours swap in one frame, like the original's `disableTransitionOnChange`.
- System mode follows the OS live. Other open tabs follow too.

Record apps get `appearance` (`light|dark|system`) and `scheme` (`light|dark`) in `app:restore`. They also get `{gin:'shell:appearance', appearance, scheme}` on every change. Inside the record's frame, `prefers-color-scheme` reports the OS, not this setting, so records should follow the message.

## Apple menu avatar

The Apple menu button shows the user's avatar, using the appshell's bar-avatar logic.

- **Who:** the user the host shell reports (`app:context.user`, or `auth:user` when signed in). Otherwise `componentProps.user`, which takes `{displayName, username, avatarUrl}`.
- **Picture:** `profile_picture_url`, else `avatar_url` / `avatarUrl`, else `avatar`. The picture fills the circle.
- **No picture, or it fails to load:** the first two letters of the username, uppercased. With no username, the display name's initials, else "?".
- **Signed in through the shell:** a light ring and a green dot.
- **Live updates:** `{gin:'profile:avatar', url}` from the host shell or a hosted record swaps the picture. Only http(s), root-relative and `data:image/` URLs are accepted.
- **Signing out:** `auth:user` with `authed:false` reverts to `componentProps.user`.

## Loading screen

Restart, Log Out, and powering on after Shut Down all show `assets.bootLogo` on `desktop.boot.background`. The image is `desktop.boot.logoHeight` px tall, with `desktop.boot.logoGap` px between it and the progress bar.

The test logo is a 1080px square on #262626 with its own padding. At 200px tall its mark is about 80px, which was the Apple icon's size.

## Hosted records and the appshell session

Messages is record 74 (`apps[].view_id`).

**Loading:** see "How the appshell endpoints populate it" above.

**Session pass-through (when embedded):** if this page is itself a tab inside the appshell, so hosted records talk to this page, not the appshell. This page stands in for the appshell towards them:

- The session the appshell restored to this page (`app:restore`: user, `auth_token`) is restored to each record. It's kept in memory only.
- `auth:user` sign-in/out is passed down to the records. On sign-in this page asks the appshell for a fresh `app:restore`.
- `app:event` from a record goes to the other records and up to the appshell. The appshell's own `app:event` and `shell:active` messages are passed down.
- `shell:active:get` is answered with the view id of the hosted app in front.
- `apps:open {view_id, context}` opens a record hosted here (and delivers `view:context`). Any other view id is passed up to the appshell.

**Standalone (no appshell):** there's no session. Record 74 shows "Sign in to see your messages."

## Previewing on claude.ai

The artifact host only allows same-origin images and requests (`img-src 'self'`). So the preview is the production nesting, run offline:

- `tools/preview-host.html` is a stand-in for the appshell. It's the artifact's page, and it hosts `desktop.html` (this page with preview props) and restores a sample session. Its token is a placeholder.
- The desktop hosts record 74's real code, from the snapshot at `props/fixtures/records/74.s01.html` (refresh it with `node tools/fetch-record.mjs 74`), served at `records/viewer_iframe`. Its props point `gin_base` at `records/api`, where `props/fixtures/inbox.json` (sample data in the `/messages/inbox` shape) is served.
- Replies and state changes can't be saved in the preview, because it's static.

Tests run the same nesting against a mock of `api.1ovr1.com`. The mock checks that the inbox and send requests carry the session's Bearer token.

## Window move / resize with hosted apps

While a window is dragged or resized, iframes stop taking pointer events, so the pointer can cross a hosted app without the drag being lost. Moves are applied once per frame, and the release position is applied too, so the window lands exactly where the pointer let go.

Clicking inside a hosted app's iframe brings its window to the front.

## Props used by the phone shell

`phone.{barAppIds, barHeight, handleHeight, itemSize, iconSize, gap, paddingX, dotSize, warmLimit, swipeThreshold, tapSlop}`, `storage.phoneState`, and the strings `phone.*` and `record.*`. The test values are in `tools/make-props.mjs`.

`dist/local/records.html` is a test variant with every app on the bar, and with Messages and Photos hosted as records from the test server's mock viewer endpoint.
