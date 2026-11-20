// Builds the Chrome extension into dist/. `node build.mjs --zip` also writes a Web Store upload zip.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const zip = process.argv.includes("--zip");
const apiBase = process.env.TUCK_API_BASE_URL || "http://localhost:3000";
if (!/^https?:\/\/[^\s]+$/.test(apiBase)) throw new Error(`Invalid TUCK_API_BASE_URL: ${apiBase}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "icons"), { recursive: true });

const common = {
  bundle: true,
  target: "chrome116",
  minify: process.env.NODE_ENV === "production",
  sourcemap: process.env.NODE_ENV === "production" ? false : "linked",
  define: { __TUCK_API_BASE_URL__: JSON.stringify(apiBase), "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development") },
  legalComments: "none",
  logLevel: "warning",
};

// Extension pages and the service worker are ES modules.
await build({
  ...common,
  format: "esm",
  outdir: dist,
  entryPoints: { background: "src/background.ts", sidepanel: "src/sidepanel/main.ts", popup: "src/popup.ts" },
});
// Content scripts cannot be modules: bundle each as an IIFE.
await build({
  ...common,
  format: "iife",
  outdir: join(dist, "content"),
  entryPoints: {
    "linkedin-company": "src/content/linkedin-company.ts",
    "linkedin-person": "src/content/linkedin-person.ts",
    gmail: "src/content/gmail.ts",
  },
});

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
manifest.version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
for (const f of ["sidepanel.html", "popup.html", "sidepanel.css"]) cpSync(join(here, "public", f), join(dist, f));

// ---- icons: brass "T" mark on navy, rendered to PNG without external tooling
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(size) {
  const navy = [15, 27, 45, 255], brass = [176, 141, 87, 255], clear = [0, 0, 0, 0];
  const r = size * 0.2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      // rounded square
      const dx = Math.max(r - x - 0.5, 0, x + 0.5 - (size - r)), dy = Math.max(r - y - 0.5, 0, y + 0.5 - (size - r));
      let px = dx * dx + dy * dy > r * r ? clear : navy;
      // "T" glyph
      const u = x / size, v = y / size;
      if (px !== clear && ((v > 0.22 && v < 0.36 && u > 0.22 && u < 0.78) || (u > 0.43 && u < 0.57 && v >= 0.36 && v < 0.8))) px = brass;
      row.push(...px);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(join(dist, "icons", `icon${s}.png`), icon(s));

if (zip) {
  const out = join(dist, "tuck-advisors-extension.zip");
  try {
    execFileSync("zip", ["-qr", out, ".", "-x", "*.map", "-x", "*.zip"], { cwd: dist });
    console.log(`Packaged ${out}`);
  } catch {
    throw new Error("`zip` CLI not found — install it or zip the dist/ folder manually for the Chrome Web Store.");
  }
}
console.log(`Built extension → ${dist} (API base ${apiBase})${existsSync(join(dist, "background.js")) ? "" : " [missing background.js]"}`);
