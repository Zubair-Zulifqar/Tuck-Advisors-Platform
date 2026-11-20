import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3219);

/** Browser tests run against a production build with an isolated in-memory-style embedded database. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /public\.spec/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      SEED_PASSWORD: "e2e-demo-password-123",
      ALLOW_EMBEDDED_DB: "true",
      ALLOW_DEMO_SEED: "true",
      ALLOW_MOCK_PROVIDERS: "true",
      SESSION_SECRET: randomBytes(32).toString("hex"), // ephemeral per run
      PGLITE_DIR: `${process.env.TMPDIR ?? "/tmp"}/tuck-e2e-${Date.now()}`,
    },
  },
});
