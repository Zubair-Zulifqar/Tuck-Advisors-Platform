import { z } from "zod";
import { approveExecution, cancelExecution, retryExecution } from "@tuck/engine";
import { ForbiddenError } from "@tuck/db";
import { roleHas } from "@tuck/shared";
import { route } from "@/server/api";

const body = z.object({ action: z.enum(["approve", "cancel", "retry"]) });

export const POST = route({ permission: "automation:manage", body }, async ({ params, body, tx, auth }) =>
  tx(async (t) => {
    if (body.action === "approve") {
      if (!roleHas(auth.role, "automation:approve")) throw new ForbiddenError();
      await approveExecution(t, auth.organizationId, auth.userId, params.id!);
    } else if (body.action === "cancel") await cancelExecution(t, auth.organizationId, params.id!);
    else await retryExecution(t, auth.organizationId, params.id!);
    return { ok: true, action: body.action };
  }),
);
