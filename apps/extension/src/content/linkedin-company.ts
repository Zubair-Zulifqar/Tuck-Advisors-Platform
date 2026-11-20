import type { PageContext } from "@tuck/shared";
import { detectContext } from "../lib/context";
import { compact, firstText, isExtensionRuntime, safeContext, startObserver, visibleText } from "./common";

/**
 * Parses a LinkedIn company page that is already rendered for the signed-in user.
 * Reads the top card and, when the user has opened the "About" tab, its definition list.
 */
export function parseLinkedinCompany(doc: Document, url: string): PageContext | null {
  const base = detectContext(url);
  if (base.kind !== "linkedin_company") return null;

  const name = firstText(doc, ["main h1", "h1"], 200);
  const tagline = firstText(doc, [".org-top-card-summary__tagline", "[data-test-id='about-us__tagline']"], 500);

  const about: Record<string, string> = {};
  let website: string | undefined;
  for (const dt of Array.from(doc.querySelectorAll("dl dt"))) {
    const label = visibleText(dt, 80)?.toLowerCase();
    const dd = dt.nextElementSibling;
    if (!label || !dd || dd.tagName !== "DD") continue;
    const value = visibleText(dd, 300);
    if (value) about[label] = value;
    if (label.startsWith("website")) {
      const href = dd.querySelector("a[href^='http']")?.getAttribute("href") ?? value;
      if (href && /^https?:\/\//i.test(href)) website = href.slice(0, 500);
    }
  }
  const topInfo = Array.from(doc.querySelectorAll(".org-top-card-summary-info-list__info-item"))
    .map((e) => visibleText(e, 200))
    .filter(Boolean) as string[];

  const industry = about["industry"] ?? topInfo[0];
  const headquarters = about["headquarters"] ?? topInfo.find((t) => /,/.test(t) && !/employees|followers/i.test(t));
  const employeeRange = (about["company size"] ?? topInfo.find((t) => /employees/i.test(t)))?.replace(/\s*employees.*$/i, "").slice(0, 60);

  return safeContext(compact({ ...base, name, tagline, industry, headquarters, website, employeeRange }));
}

if (isExtensionRuntime()) {
  startObserver(() => parseLinkedinCompany(document, location.href));
}
