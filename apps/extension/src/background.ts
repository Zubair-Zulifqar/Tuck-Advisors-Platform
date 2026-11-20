import { pageContext, type PageContext } from "@tuck/shared";
import { ApiClient } from "./lib/api";
import { AuthManager, chromeAuthStorage } from "./lib/auth";
import { detectContext } from "./lib/context";
import { serializeError } from "./lib/errors";
import type { Broadcast, Reply, Request } from "./lib/messages";

const auth = new AuthManager(chromeAuthStorage(), (i, init) => fetch(i, init));
const api = new ApiClient(auth, (i, init) => fetch(i, init));

// Clicking the toolbar icon opens the popup; the popup offers "Open side panel". Also allow the panel per-tab.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
});

const key = (tabId: number) => `ctx:${tabId}`;

async function saveContext(tabId: number, context: PageContext) {
  await chrome.storage.session.set({ [key(tabId)]: context });
  broadcast({ type: "contextChanged", tabId, context });
}

function broadcast(msg: Broadcast) {
  chrome.runtime.sendMessage(msg).catch(() => undefined); // no listener when the panel is closed
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function currentContext(): Promise<PageContext & { tabId?: number }> {
  const tab = await activeTab();
  if (!tab?.id) return { kind: "unsupported", url: "" };
  const stored = (await chrome.storage.session.get(key(tab.id)))[key(tab.id)];
  const parsed = pageContext.safeParse(stored);
  const urlCtx = detectContext(tab.url, await auth.getBaseUrl());
  // Prefer the richer content-script context only while it still belongs to the tab's current URL.
  if (parsed.success && sameRoute(parsed.data, urlCtx)) return { ...parsed.data, tabId: tab.id };
  return { ...urlCtx, tabId: tab.id };
}

function sameRoute(a: PageContext, b: PageContext) {
  if (a.kind !== b.kind) return false;
  if ("slug" in a && "slug" in b) return a.slug === b.slug;
  if (a.kind === "gmail_thread" && b.kind === "gmail_thread") return !b.threadId || a.threadId === b.threadId;
  return true;
}

async function requestFreshContext() {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "requestContext" })) as { context?: PageContext } | undefined;
    const ctx = pageContext.safeParse(res?.context);
    if (ctx.success) await saveContext(tab.id, ctx.data);
  } catch {
    /* no content script on this page */
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  broadcast({ type: "contextChanged", tabId, context: detectContext(tab?.url, await auth.getBaseUrl()) });
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.url || info.status === "complete") {
    if (tab.active) broadcast({ type: "contextChanged", tabId, context: detectContext(tab.url, await auth.getBaseUrl()) });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(key(tabId)));

async function handle(msg: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case "context": {
      // Only accept page context from our own content scripts running in a tab.
      if (sender.id !== chrome.runtime.id || !sender.tab?.id) throw new Error("Rejected context from unknown sender");
      const ctx = pageContext.parse(msg.context);
      await saveContext(sender.tab.id, ctx);
      return null;
    }
    case "getContext":
      return currentContext();
    case "refreshContext":
      await requestFreshContext();
      return currentContext();
    case "status":
      return auth.status();
    case "setBaseUrl":
      return auth.setBaseUrl(msg.baseUrl);
    case "login": {
      const user = await auth.login(msg.email, msg.password);
      broadcast({ type: "authChanged", status: await auth.status() });
      return user;
    }
    case "logout":
      await auth.logout();
      broadcast({ type: "authChanged", status: await auth.status() });
      return null;
    case "api": {
      try {
        return msg.method === "GET" ? await api.get(msg.path) : await api.post(msg.path, msg.body ?? {});
      } catch (e) {
        if ((e as Error).name === "AuthError") broadcast({ type: "authChanged", status: await auth.status() });
        throw e;
      }
    }
    default:
      throw new Error("Unknown message");
  }
}

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse: (r: Reply) => void) => {
  // Messages from web pages cannot reach onMessage (no externally_connectable), but double-check origin.
  if (sender.id !== chrome.runtime.id) return false;
  if (!msg || typeof msg !== "object" || !("type" in msg)) return false;
  if ((msg as { type: string }).type === "contextChanged" || (msg as { type: string }).type === "authChanged") return false;
  handle(msg, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: serializeError(e) }),
  );
  return true;
});
