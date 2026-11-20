import { pageContext, type PageContext } from "@tuck/shared";

/**
 * Shared content-script plumbing. Content scripts are read-only observers: they never click, scroll,
 * fetch, or call private platform APIs. They read text the signed-in user can already see and pass
 * it to the extension's own background worker.
 */
export function visibleText(el: Element | null | undefined, max = 500): string | undefined {
  if (!el) return undefined;
  const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

export function firstText(root: ParentNode, selectors: string[], max = 500): string | undefined {
  for (const s of selectors) {
    const v = visibleText(root.querySelector(s), max);
    if (v) return v;
  }
  return undefined;
}

export function isExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id;
}

/** Drop undefined keys so zod optional fields validate cleanly. */
export function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}

export function safeContext(candidate: unknown): PageContext | null {
  const r = pageContext.safeParse(candidate);
  return r.success ? r.data : null;
}

/**
 * Re-parse on SPA navigation / lazy rendering, debounced, and only post when the result changes.
 * Uses a MutationObserver on the document (no polling of network or hidden APIs).
 */
export function startObserver(parse: () => PageContext | null, debounceMs = 600): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = "";
  const run = () => {
    const ctx = parse();
    if (!ctx) return;
    const key = JSON.stringify(ctx);
    if (key === last) return;
    last = key;
    chrome.runtime.sendMessage({ type: "context", context: ctx }).catch(() => undefined);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };
  const obs = new MutationObserver(schedule);
  obs.observe(document.body, { childList: true, subtree: true, characterData: false });
  window.addEventListener("hashchange", schedule);
  window.addEventListener("popstate", schedule);
  // Side panel can ask for a fresh read of the current page.
  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, reply) => {
    if (msg?.type === "requestContext") {
      last = "";
      reply({ context: parse() });
    }
    return false;
  });
  run();
  return () => {
    obs.disconnect();
    if (timer) clearTimeout(timer);
  };
}
