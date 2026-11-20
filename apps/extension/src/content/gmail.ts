import type { PageContext } from "@tuck/shared";
import { z } from "zod";
import { gmailThreadIdFromUrl } from "../lib/context";
import { compact, isExtensionRuntime, safeContext, visibleText, startObserver } from "./common";

const email = z.string().email();

/**
 * Reads ONLY the thread currently open in the Gmail UI: its subject and the participant addresses
 * Gmail renders (elements carrying an `email` attribute inside the conversation view). Message bodies
 * are never read, and nothing outside the open conversation (inbox lists, other threads) is touched.
 */
export function parseGmailThread(doc: Document, url: string): PageContext | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "mail.google.com") return null;

  const subjectEl = doc.querySelector("h2.hP");
  // No open conversation (inbox / list view) => nothing to report.
  if (!subjectEl) return null;

  const legacyId = subjectEl.getAttribute("data-legacy-thread-id") ?? undefined;
  const threadId = legacyId || gmailThreadIdFromUrl(url);
  const subject = visibleText(subjectEl, 500);

  // Scope participant lookup to the conversation container when present.
  const scope: ParentNode = subjectEl.closest("[role='main']") ?? doc;
  const seen = new Map<string, { name?: string; email: string }>();
  for (const el of Array.from(scope.querySelectorAll("[email]"))) {
    const addr = (el.getAttribute("email") ?? "").trim().toLowerCase();
    if (!email.safeParse(addr).success || seen.has(addr)) continue;
    const name = (el.getAttribute("name") ?? visibleText(el, 200))?.trim();
    seen.set(addr, compact({ email: addr, name: name && name.toLowerCase() !== addr ? name.slice(0, 200) : undefined }));
    if (seen.size >= 50) break;
  }

  return safeContext(compact({ kind: "gmail_thread", url, threadId, subject, participants: [...seen.values()] }));
}

if (isExtensionRuntime()) {
  startObserver(() => parseGmailThread(document, location.href) ?? { kind: "unsupported", url: location.href }, 800);
}
