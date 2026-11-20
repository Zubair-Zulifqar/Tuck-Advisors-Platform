import Link from "next/link";
import { listDeals } from "@tuck/db";
import { DEAL_STAGES } from "@tuck/shared";
import { Card, PageHeader, StageBadge } from "@/components/ui";
import { DealForm, Disclosure, StageSelect } from "@/components/app/forms";
import { can, query } from "@/server/session";
import { relTime } from "@/lib/format";

export default async function DealsPage() {
  const d = await query(async (tx, auth) => ({
    deals: await listDeals(tx, auth.organizationId),
    companies: (await tx.query<{ id: string; name: string; kind: string }>("select id, name, kind from companies where organization_id = $1 and deleted_at is null order by name limit 500", [auth.organizationId])).rows,
    auth,
  }));
  const w = can(d.auth, "crm:write");
  return (
    <>
      <PageHeader eyebrow="Pipeline" title="Deal pipeline" description="Move deals between stages; every stage change is logged and can trigger automations."
        actions={w ? <Disclosure label="New deal"><DealForm companies={d.companies} /></Disclosure> : undefined} />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {DEAL_STAGES.map((s) => {
          const deals = d.deals.filter((x) => x.stage === s);
          return (
            <section key={s} className="w-64 shrink-0" aria-label={`${s} stage`}>
              <div className="mb-2 flex items-center justify-between"><StageBadge stage={s} /><span className="muted text-xs">{deals.length}</span></div>
              <div className="space-y-2">
                {deals.map((x) => (
                  <Card key={x.id} className="p-3 text-sm">
                    <p className="font-medium">{x.name}</p>
                    <p className="muted mt-1 text-xs">
                      {x.target_name && <>Target: <Link href={`/app/companies/${x.target_company_id}`} className="underline">{x.target_name}</Link><br /></>}
                      {x.buyer_name && <>Buyer: <Link href={`/app/companies/${x.buyer_company_id}`} className="underline">{x.buyer_name}</Link><br /></>}
                      {x.side.replace("_", "-")} · in stage {relTime(x.stage_changed_at)}
                    </p>
                    {w && <div className="mt-2"><StageSelect dealId={x.id} stage={x.stage} /></div>}
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
