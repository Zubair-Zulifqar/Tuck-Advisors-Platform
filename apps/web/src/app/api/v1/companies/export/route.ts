import { listCompanies } from "@tuck/db";
import { route } from "@/server/api";
import { toCsv } from "@/lib/csv";

export const GET = route({ permission: "crm:read", rate: [10, 60_000] }, async ({ tx, auth, url }) => {
  const items = await tx(async (t) => {
    const all = [];
    for (let offset = 0; offset < 10_000; offset += 200) {
      const page = await listCompanies(t, auth.organizationId, { limit: 200, offset, kind: url.searchParams.get("kind") ?? undefined });
      all.push(...page.items);
      if (page.items.length < 200) break;
    }
    return all;
  });
  const csv = toCsv(items.map((c) => ({ name: c.name, domain: c.domain ?? "", website: c.website ?? "", industry: c.industry ?? "", kind: c.kind, headquarters: c.headquarters ?? "", tags: c.tags.join(";"), created_at: c.created_at })));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="companies-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
});
