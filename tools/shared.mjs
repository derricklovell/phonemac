// Shared test fixtures for reference capture (original Next.js app) and the UCA port.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const UCA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXED_TIME = "2026-10-02T09:41:00";
export const WIDTHS = [360, 768, 1024, 1440];
export const HEIGHT = 900;
export const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const NOTES = JSON.parse(
  readFileSync(join(UCA_DIR, "props/fixtures/notes.json"), "utf8"),
);

// Answers the original app's Supabase calls with the fixture notes so the
// reference screenshots show the same data the port receives through props.
export async function mockSupabase(page) {
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const reply = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/rest/v1/notes") return reply(NOTES.filter((n) => n.public));
    if (url.pathname === "/rest/v1/rpc/select_note") {
      const { note_slug_arg } = JSON.parse(req.postData() ?? "{}");
      const note = NOTES.find((n) => n.slug === note_slug_arg) ?? null;
      return reply(wantsObject ? note : note ? [note] : []);
    }
    if (url.pathname === "/rest/v1/rpc/select_session_notes") return reply([]);
    return reply(wantsObject ? null : []);
  });
}
