import "server-only";
import { dispatchEvent, type DomainEvent } from "@tuck/engine";
import type { AuthContext } from "./auth";
import { getDeps } from "./db";

/** Fire-and-forget domain event; failures are logged, never surfaced to the user's write. */
export async function emit(auth: Pick<AuthContext, "organizationId" | "userId">, event: DomainEvent) {
  const deps = await getDeps();
  try {
    await dispatchEvent(deps, auth.organizationId, { ...event, actorUserId: auth.userId });
  } catch (e) {
    deps.logger.error("events.dispatch_failed", { type: event.type, error: (e as Error).message });
  }
}
