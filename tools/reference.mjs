// Captures reference screenshots and DOM dumps from the running original app.
// The original Next.js app is no longer in the tree; check it out from git history
// (`git worktree add ../original b62bfe8`) to recapture. The committed reference/ shots are what tests use.
// Usage: start the original (`next dev -p 3000` with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321),
// then `node tools/reference.mjs [baseUrl]`.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXED_TIME, HEIGHT, PHONE_UA, UCA_DIR, WIDTHS, mockSupabase } from "./shared.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = join(UCA_DIR, "reference");
mkdirSync(join(outDir, "dom"), { recursive: true });

const SCENES = [
  // name, path, prepare(page)
  ["desktop", "/notes", async () => {}],
  [
    "notes-only",
    "/notes",
    async (page) => {
      const close = page.locator('[aria-label="Close window"]').first();
      // Close Messages (back window) so the Notes window is shown alone.
      const messages = page.locator('[data-app="messages"], .messages-app').first();
      const target = (await messages.count())
        ? messages.locator('[aria-label="Close window"]').first()
        : close;
      if (await target.count()) await target.evaluate((el) => el.click());
    },
  ],
];

const browser = await chromium.launch();
const errors = [];
for (const width of WIDTHS) {
  for (const [name, path, prepare] of SCENES) {
    // The original chooses its phone layout from the user agent, so emulate a phone at 360.
    const phone = width === 360
      ? { isMobile: true, hasTouch: true, userAgent: PHONE_UA, deviceScaleFactor: 1 }
      : {};
    const context = await browser.newContext({ viewport: { width, height: HEIGHT }, ...phone });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    page.on("pageerror", (e) => errors.push(`${name}@${width}: ${e.message}`));
    await mockSupabase(page);
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(2500);
    await prepare(page);
    await page.waitForTimeout(800);
    await page.mouse.move(width / 2, 300);
    await page.screenshot({ path: join(outDir, `${name}-${width}.png`) });
    if (width === 1440) {
      const html = await page.evaluate(() => document.body.innerHTML);
      writeFileSync(join(outDir, "dom", `${name}.html`), html);
    }
    await context.close();
  }
}
await browser.close();
console.log(errors.length ? errors.join("\n") : "no page errors");
console.log("reference written to", outDir);
