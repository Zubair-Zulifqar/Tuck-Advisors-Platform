import type { PageContext } from "@tuck/shared";
import { detectContext } from "../lib/context";
import { compact, firstText, isExtensionRuntime, safeContext, startObserver, visibleText } from "./common";

/** Parses the visible top card of a LinkedIn profile page for the signed-in user. Read-only. */
export function parseLinkedinPerson(doc: Document, url: string): PageContext | null {
  const base = detectContext(url);
  if (base.kind !== "linkedin_person") return null;

  const name = firstText(doc, ["main h1", "h1"], 200);
  const headline = firstText(doc, ["main .text-body-medium.break-words", "[data-generated-suggestion-target] .text-body-medium"], 500);
  const location = firstText(doc, ["main .text-body-small.inline.t-black--light.break-words", "[data-test-id='profile-location']"], 200);

  let currentCompany: string | undefined;
  const labelled = doc.querySelector("[aria-label^='Current company']");
  const aria = labelled?.getAttribute("aria-label");
  if (aria) {
    const m = aria.match(/^Current company:\s*(.+?)(?:\.\s*Click.*)?$/i);
    currentCompany = m?.[1]?.trim().slice(0, 200);
  }
  if (!currentCompany && labelled) currentCompany = visibleText(labelled, 200);
  if (!currentCompany && headline) {
    const at = headline.match(/\bat\s+(.+)$/i);
    if (at?.[1]) currentCompany = at[1].slice(0, 200);
  }

  return safeContext(compact({ ...base, name, headline, location, currentCompany }));
}

if (isExtensionRuntime()) {
  startObserver(() => parseLinkedinPerson(document, location.href));
}
