#!/usr/bin/env node
// Lightweight secret scanner run in CI and before every push: `node scripts/scan-secrets.mjs`.
// Walks the working tree (skipping build output and dependencies) and fails on likely credentials.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".venv", ".data", ".git", "coverage", "playwright-report", "test-results", "__pycache__", ".pytest_cache"]);
const SKIP_FILES = new Set(["package-lock.json"]);
const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".zip", ".woff", ".woff2", ".pdf", ".wasm", ".data"]);

const RULES = [
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ["AWS access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ["Webhook signing secret", /\bwhsec_[A-Za-z0-9+/=]{24,}/g],
  ["Resend key", /\bre_[A-Za-z0-9]{24,}/g],
  ["Generic API key assignment", /["']?(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{32,}["']/gi],
  ["Postgres URL with password", /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{8,}@(?!localhost|127\.0\.0\.1|postgres[:/]|db[:/])[^\s"']+/g],
];

// Obvious test fixtures / placeholders.
const ALLOW = [/sk-test/i, /sk-secret/i, /example/i, /REPLACE/i, /placeholder/i, /dummy/i, /fake/i, /xxxx/i, /<[^>]+>/];

const findings = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (!SKIP_FILES.has(name) && !BINARY.has(extname(name).toLowerCase()) && st.size < 2_000_000 && !/^\.env(\.(?!example).*)?$/.test(name)) scan(p);
  }
}
function scan(file) {
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    for (const [label, re] of RULES) {
      for (const m of line.matchAll(re)) {
        if (ALLOW.some((a) => a.test(m[0]) || a.test(line))) continue;
        findings.push(`${relative(root, file)}:${i + 1}  ${label}: ${m[0].slice(0, 12)}…`);
      }
    }
  });
}

walk(root);
if (findings.length) {
  console.error(`✗ Possible secrets found (${findings.length}):\n  ${findings.join("\n  ")}`);
  process.exit(1);
}
console.log("✓ No secrets detected.");
