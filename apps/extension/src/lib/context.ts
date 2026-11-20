import type { PageContext } from "@tuck/shared";

export type ContextKind = PageContext["kind"];

/** URL-only routing. Content scripts enrich this with what is visibly rendered on the page. */
export function detectContext(rawUrl: string | undefined, crmBaseUrl?: string): PageContext {
  const url = rawUrl ?? "";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "unsupported", url };
  }
  if (crmBaseUrl) {
    try {
      const crm = new URL(crmBaseUrl);
      if (u.origin === crm.origin) {
        const m = u.pathname.match(/^\/app\/(companies|contacts|deals)\/([0-9a-f-]{36})/i);
        return { kind: "tuck_crm", url, ...(m ? { entity: m[1], entityId: m[2] } : {}) };
      }
    } catch {
      /* ignore invalid configured URL */
    }
  }
  if (u.protocol === "https:" && u.hostname === "www.linkedin.com") {
    const company = u.pathname.match(/^\/company\/([^/?#]+)/);
    if (company?.[1]) return { kind: "linkedin_company", url: canonicalLinkedin("company", company[1]), slug: decodeURIComponent(company[1]) };
    const person = u.pathname.match(/^\/in\/([^/?#]+)/);
    if (person?.[1]) return { kind: "linkedin_person", url: canonicalLinkedin("in", person[1]), slug: decodeURIComponent(person[1]) };
  }
  if (u.protocol === "https:" && u.hostname === "mail.google.com") {
    const threadId = gmailThreadIdFromUrl(url);
    if (threadId) return { kind: "gmail_thread", url, threadId, participants: [] };
  }
  return { kind: "unsupported", url };
}

export function canonicalLinkedin(type: "company" | "in", slug: string): string {
  return `https://www.linkedin.com/${type}/${slug.replace(/\/+$/, "")}/`;
}

/** Gmail thread URLs look like #inbox/FMfcgz... or #label/x/FMfcgz...; list views have no id segment. */
export function gmailThreadIdFromUrl(url: string): string | undefined {
  const hash = url.split("#")[1];
  if (!hash) return undefined;
  const parts = hash.split("?")[0]!.split("/");
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && last && /^[A-Za-z0-9_-]{16,}$/.test(last)) return last;
  return undefined;
}
