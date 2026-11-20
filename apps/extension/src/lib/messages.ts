import type { PageContext } from "@tuck/shared";
import type { AuthStatus } from "./auth";
import { deserializeError, type SerializedError } from "./errors";

/** Messages handled by the background service worker. */
export type Request =
  | { type: "context"; context: PageContext } // from content scripts
  | { type: "getContext" }
  | { type: "refreshContext" }
  | { type: "status" }
  | { type: "setBaseUrl"; baseUrl: string }
  | { type: "login"; email: string; password: string }
  | { type: "logout" }
  | { type: "api"; method: "GET" | "POST"; path: string; body?: unknown };

/** Broadcasts from background to extension pages. */
export type Broadcast = { type: "contextChanged"; tabId: number; context: PageContext } | { type: "authChanged"; status: AuthStatus };

export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: SerializedError };

/** Side-panel/popup → background RPC with typed errors restored on the caller side. */
export async function rpc<T>(req: Request): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(req)) as Reply<T> | undefined;
  if (!reply) throw new Error("The extension background worker did not respond. Try reopening the panel.");
  if (!reply.ok) throw deserializeError(reply.error);
  return reply.data;
}
