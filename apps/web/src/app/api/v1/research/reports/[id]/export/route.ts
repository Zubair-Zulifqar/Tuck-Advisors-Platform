import { z } from "zod";
import { NotFoundError, createActivity } from "@tuck/db";
import { GoogleDocsClient, MissingCredentialsError } from "@tuck/integrations";
import { route } from "@/server/api";
import { reportToText } from "@/lib/report-text";

/**
 * Export a report to Google Docs — only on explicit user action, using a Google access token the user
 * obtained through the OAuth consent flow (drive.file scope). Without one we return the plain text so the
 * user can copy it; nothing is ever created in Google on their behalf automatically.
 */
const body = z.object({ googleAccessToken: z.string().min(10).max(4096).optional(), confirm: z.literal(true) });

export const POST = route({ permission: "research:run", body, rate: [10, 60_000] }, async ({ params, body, tx, auth }) => {
  const report = await tx(async (t) => {
    const { rows } = await t.query<{ id: string; title: string; content: unknown; sources: { url: string; title: string }[]; company_id: string | null }>(
      "select id, title, content, sources, company_id from public.research_reports where organization_id = $1 and id = $2",
      [auth.organizationId, params.id],
    );
    if (!rows[0]) throw new NotFoundError("Report");
    return rows[0];
  });
  const text = reportToText(report.title, report.content, report.sources);
  if (!body.googleAccessToken) {
    if (!process.env.GOOGLE_CLIENT_ID) throw new MissingCredentialsError("Google Docs export", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]);
    return { exported: false, text, message: "Connect Google (Settings → Integrations) to export to Docs." };
  }
  const doc = await new GoogleDocsClient(body.googleAccessToken).createDocument(report.title, text);
  await tx((t) => createActivity(t, auth.organizationId, auth.userId, { type: "system", subject: `Exported "${report.title}" to Google Docs`, companyId: report.company_id ?? undefined, metadata: { documentId: doc.documentId } }));
  return { exported: true, url: doc.url };
});
