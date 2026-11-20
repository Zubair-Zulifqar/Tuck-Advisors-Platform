import type { ActivityRow } from "@tuck/db";
import { Badge, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export function Timeline({ items }: { items: ActivityRow[] }) {
  if (!items.length) return <Empty title="No activity yet" />;
  return (
    <ol className="relative space-y-4 border-l hairline pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-brass" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={a.type === "comment" ? "brass" : "neutral"}>{a.type.replace("_", " ")}</Badge>
            <span className="font-medium">{a.subject}</span>
            {(a.metadata as { draft?: boolean }).draft && <Badge tone="warn">draft — not sent</Badge>}
          </div>
          {a.body && <p className="muted mt-1 whitespace-pre-line text-sm">{a.body}</p>}
          <p className="muted mt-0.5 text-xs">{a.actor_name ?? "System"} · {fmtDate(a.occurred_at, true)}</p>
        </li>
      ))}
    </ol>
  );
}
