type ClaimLike = { text: string; provenance?: string };

function isClaim(v: unknown): v is ClaimLike {
  return !!v && typeof v === "object" && "text" in v && typeof (v as ClaimLike).text === "string";
}

const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Plain-text rendering of any structured report (used for copy, Google Docs export and email). */
export function reportToText(title: string, content: unknown, sources: { url: string; title: string }[] = []): string {
  const out: string[] = [title, "=".repeat(Math.min(title.length, 80)), ""];
  const walk = (v: unknown, key: string, depth: number) => {
    const pad = "  ".repeat(depth);
    if (isClaim(v)) out.push(`${pad}${key ? `${label(key)}: ` : "- "}${v.text}${v.provenance ? ` [${v.provenance}]` : ""}`);
    else if (Array.isArray(v)) {
      if (!v.length) return;
      if (key) out.push(`${pad}${label(key)}:`);
      v.forEach((x) => (typeof x === "string" ? out.push(`${pad}  - ${x}`) : walk(x, "", depth + 1)));
    } else if (v && typeof v === "object") {
      if (key) out.push(`${pad}${label(key)}:`);
      for (const [k, x] of Object.entries(v)) walk(x, k, key ? depth + 1 : depth);
    } else if (v !== null && v !== undefined && v !== "") out.push(`${pad}${key ? `${label(key)}: ` : "- "}${String(v)}`);
  };
  walk(content, "", 0);
  if (sources.length) out.push("", "Sources", ...sources.map((s, i) => `${i + 1}. ${s.title || s.url} — ${s.url}`));
  return out.join("\n");
}
