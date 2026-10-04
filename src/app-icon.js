// An app's icon. Desktop apps ship a picture (assets[app.icon]); a Record 50 tab carries its face as
// a 24×24 stroke path and a colour (tab.icon / tab.color), drawn here as a rounded tile like the
// Dock's pictures — the same face the appshell's bar shows, so it is edited where the app is edited.
import { html, asset } from "./core.js";

export function appIconHtml(app, imgClass, imgStyle) {
  if (app.glyph) {
    return html`<span data-glyph class="flex h-full w-full items-center justify-center rounded-[22%] text-white shadow-md" style="background:${app.glyph.color}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="h-[56%] w-[56%]"><path d="${app.glyph.path}"></path></svg>
    </span>`;
  }
  return html`<img alt="" draggable="false" decoding="async" src="${asset(app.icon)}" class="${imgClass}" style="${imgStyle}">`;
}
