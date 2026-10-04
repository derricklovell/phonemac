// Snapshots a record's s01 (what the appshell boots for an s01 tab) into props/fixtures/records/<id>.s01.html
// so tests and the preview run the record's real code offline. Usage: node tools/fetch-record.mjs 74
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { UCA_DIR } from "./shared.mjs";

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) throw new Error("usage: node tools/fetch-record.mjs <record id>");
// curl rather than fetch: it honours HTTPS_PROXY on sandboxed machines.
const body = execFileSync("curl", ["-sSf", "-H", "Content-Type: application/json", `https://api.1ovr1.com/api:o-B1LTj7/get_pages/${id}`], { maxBuffer: 1 << 26 });
const [page] = JSON.parse(body);
if (!page || !page.s01 || !page.s01.trim()) throw new Error(`record ${id} has no s01`);
const out = join(UCA_DIR, `props/fixtures/records/${id}.s01.html`);
writeFileSync(out, page.s01);
console.log(`record ${id} (${page.name}): s01 ${page.s01.length} chars → ${out}`);
