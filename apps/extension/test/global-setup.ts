import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Build once so manifest tests can verify every referenced file exists in dist/. */
export default function setup() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "pipe", env: { ...process.env, TUCK_API_BASE_URL: "http://localhost:3000" } });
}
