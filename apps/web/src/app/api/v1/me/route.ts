import { permissionsFor } from "@tuck/shared";
import { preflight, route } from "@/server/api";

export const OPTIONS = preflight;
export const GET = route({}, async ({ auth }) => ({
  user: { id: auth.userId, email: auth.email, name: auth.name, role: auth.role, permissions: permissionsFor(auth.role) },
  organization: { id: auth.organizationId, name: auth.organizationName },
}));
