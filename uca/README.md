# phonemac — UCA 3.0 build

A plain-JS, single-file port of the macOS desktop. It does not use React. Everything it shows comes from `componentProps`.

```
npm run build   # dist/phonemac.html (record file), dist/split/*, dist/local/ (test props)
npm run test    # headless checks + pixel diff vs reference/ (npm run reference to recapture)
```

## Layouts

- **Desktop**: menu bar, windows and Dock. When the Dock is wider than the window, it scrolls sideways. In that mode magnification is off and edges fade.
- **Phone**: chosen by device signals, not window width. One full-screen stage, plus the appshell-style bottom bar:
  - The bar is centred while the icons fit, and scrolls sideways (with edge fades) once they don't.
  - Apps you switch away from stay warm: hidden, slept and woken, not rebuilt. Past `phone.warmLimit`, the least recently used app is torn down.
  - The grab handle above the bar hides or shows it: tap it, swipe it, or press Enter.

## Where an app comes from

For each entry in `apps[]`, in order:

1. **`view_id` set**: the app is its own record. It is loaded from `` `${config.viewEndpoint}_iframe?view=<view_id>` ``, which is the same URL the appshell uses for a tab. It runs in a sandboxed `srcdoc` iframe with the appshell's sandbox flags.
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

## Props used by the phone shell

`phone.{barAppIds, barHeight, handleHeight, itemSize, iconSize, gap, paddingX, dotSize, warmLimit, swipeThreshold, tapSlop}`, `storage.phoneState`, and the strings `phone.*` and `record.*`. The test values are in `tools/make-props.mjs`.

`dist/local/records.html` is a test variant with every app on the bar, and with Messages and Photos hosted as records from the test server's mock viewer endpoint.
