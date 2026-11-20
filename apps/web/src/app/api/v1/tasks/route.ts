import { createTask, listTasks } from "@tuck/db";
import { taskInput } from "@tuck/shared";
import { route } from "@/server/api";

export const GET = route({ permission: "crm:read" }, async ({ url, tx, auth }) => tx((t) => listTasks(t, auth.organizationId, { status: url.searchParams.get("status") ?? undefined, assignee: url.searchParams.get("mine") ? auth.userId : undefined })));
export const POST = route({ permission: "crm:write", body: taskInput }, async ({ body, tx, auth }) => tx((t) => createTask(t, auth.organizationId, auth.userId, body)));
