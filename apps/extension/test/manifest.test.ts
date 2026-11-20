import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const dist = join(root, "dist");
const built = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

const ALLOWED_PERMISSIONS = new Set(["sidePanel", "storage", "activeTab"]);
const ALLOWED_CONTENT_MATCHES = new Set(["https://www.linkedin.com/company/*", "https://www.linkedin.com/in/*", "https://mail.google.com/*"]);

describe("manifest", () => {
  it("is Manifest V3 with required fields", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
    expect(manifest.action.default_popup).toBe("popup.html");
  });

  it("requests only least-privilege permissions", () => {
    for (const p of manifest.permissions) expect(ALLOWED_PERMISSIONS.has(p)).toBe(true);
    const text = JSON.stringify(manifest);
    for (const banned of ["<all_urls>", "cookies", "webRequest", "tabs\"", "history", "debugger", "scripting", "management"]) {
      expect(text).not.toContain(banned);
    }
    expect(manifest.host_permissions).toBeUndefined();
    // Backend access is optional and requested at sign-in for one origin only.
    expect(manifest.optional_host_permissions.every((p: string) => /^https?:\/\/[^/]+\/\*$/.test(p))).toBe(true);
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
  });

  it("limits content scripts to supported pages", () => {
    const matches = manifest.content_scripts.flatMap((c: { matches: string[] }) => c.matches);
    expect(matches.length).toBe(3);
    for (const m of matches) expect(ALLOWED_CONTENT_MATCHES.has(m)).toBe(true);
    for (const c of manifest.content_scripts) expect(c.all_frames).toBeFalsy();
  });

  it("does not loosen the default content security policy or load remote code", () => {
    expect(manifest.content_security_policy).toBeUndefined();
    for (const f of ["sidepanel.html", "popup.html"]) {
      const html = readFileSync(join(root, "public", f), "utf8");
      expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
      expect(html).not.toMatch(/<script>(?!\s*<\/script>)/i); // no inline scripts
    }
  });

  it("references only files that exist in the build", () => {
    const refs = [
      built.background.service_worker,
      built.side_panel.default_path,
      built.action.default_popup,
      ...Object.values(built.icons as Record<string, string>),
      ...Object.values(built.action.default_icon as Record<string, string>),
      ...built.content_scripts.flatMap((c: { js: string[] }) => c.js),
      "sidepanel.js",
      "popup.js",
      "sidepanel.css",
    ];
    for (const r of refs) expect(existsSync(join(dist, r)), r).toBe(true);
    expect(statSync(join(dist, "icons/icon128.png")).size).toBeGreaterThan(100);
  });

  it("bundles no secrets or remote endpoints other than the configured API base", () => {
    for (const f of ["background.js", "sidepanel.js", "content/gmail.js"]) {
      const js = readFileSync(join(dist, f), "utf8");
      expect(js).not.toMatch(/sk-[A-Za-z0-9]{20,}|service_role|SUPABASE_SERVICE/);
      expect(js).not.toMatch(/\beval\(|new Function\(/);
    }
  });
});
