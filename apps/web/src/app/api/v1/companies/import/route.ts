import { z } from "zod";
import { ConflictError, createCompany } from "@tuck/db";
import { companyInput } from "@tuck/shared";
import { route } from "@/server/api";
import { parseCsv } from "@/lib/csv";

const body = z.object({ csv: z.string().max(2_000_000), dryRun: z.boolean().default(false) });

/** CSV import with per-row validation and duplicate detection. Columns: name,domain,website,industry,kind,headquarters,tags */
export const POST = route({ permission: "crm:write", body, rate: [10, 60_000] }, async ({ body, tx, auth }) => {
  const rows = parseCsv(body.csv);
  if (rows.length > 2000) throw new ConflictError("Import is limited to 2,000 rows per file");
  const results: { row: number; status: "created" | "duplicate" | "invalid" | "valid"; message?: string; id?: string }[] = [];
  await tx(async (t) => {
    for (const [i, r] of rows.entries()) {
      const parsed = companyInput.safeParse({ ...r, tags: r.tags ? r.tags.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [], kind: r.kind || "prospect" });
      if (!parsed.success) {
        results.push({ row: i + 2, status: "invalid", message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
        continue;
      }
      if (body.dryRun) {
        results.push({ row: i + 2, status: "valid" });
        continue;
      }
      try {
        await t.query("savepoint import_row");
        const c = await createCompany(t, auth.organizationId, auth.userId, parsed.data);
        await t.query("release savepoint import_row");
        results.push({ row: i + 2, status: "created", id: c.id });
      } catch (e) {
        await t.query("rollback to savepoint import_row");
        results.push({ row: i + 2, status: e instanceof ConflictError ? "duplicate" : "invalid", message: (e as Error).message });
      }
    }
  });
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return { total: rows.length, created: count("created"), duplicates: count("duplicate"), invalid: count("invalid"), results };
});
