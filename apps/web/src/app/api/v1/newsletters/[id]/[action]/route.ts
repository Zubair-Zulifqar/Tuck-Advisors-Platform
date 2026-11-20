import { z } from "zod";
import { transitionNewsletter } from "@tuck/engine";
import { ForbiddenError, NotFoundError } from "@tuck/db";
import { roleHas } from "@tuck/shared";
import { route } from "@/server/api";

const body = z.object({ scheduledAt: z.string().datetime().optional() }).default({});

export const POST = route({ permission: "outreach:draft", body }, async ({ params, body, tx, auth }) => {
  const action = params.action as "submit" | "approve" | "schedule";
  if (!["submit", "approve", "schedule"].includes(action)) throw new NotFoundError("Action");
  if (action !== "submit" && !roleHas(auth.role, "newsletter:approve")) throw new ForbiddenError("Only admins can approve or schedule newsletters");
  return tx((t) => transitionNewsletter(t, auth.organizationId, auth.userId, params.id!, action, body.scheduledAt));
});
