import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brass";
const variants: Record<Variant, string> = {
  primary: "bg-navy text-ivory hover:bg-navy-600 dark:bg-ivory dark:text-navy dark:hover:bg-ivory-300",
  brass: "bg-brass text-white hover:bg-brass-600",
  secondary: "surface hover:border-brass/60",
  ghost: "hover:bg-black/5 dark:hover:bg-white/5",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};
const base = "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass/50";

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(base, variants[variant], className)} {...p} />;
}
export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(base, variants[variant], className)} {...p} />;
}
export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("surface rounded-lg shadow-card", className)} {...p} />;
}
export function CardHeader({ title, action, subtitle }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b hairline px-5 py-3.5">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="muted mt-0.5 text-xs">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Badge({ tone = "neutral", className, children }: { tone?: "neutral" | "good" | "warn" | "bad" | "info" | "brass"; className?: string; children: ReactNode }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
    bad: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
    info: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
    brass: "bg-brass-50 text-brass-700 dark:bg-brass-700/30 dark:text-brass-100",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone], className)}>{children}</span>;
}
export function StageBadge({ stage }: { stage: string }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", STAGE_TONE[stage])}>{STAGE_LABEL[stage] ?? stage}</span>;
}
export function EmailStatus({ status }: { status: string }) {
  const map: Record<string, ["good" | "warn" | "bad" | "neutral", string]> = {
    provider_verified: ["good", "Verified (provider)"],
    manually_verified: ["good", "Verified (manual)"],
    unverified: ["warn", "Unverified"],
    invalid: ["bad", "Invalid"],
  };
  const [tone, text] = map[status] ?? ["neutral", status];
  return <Badge tone={tone}>{text}</Badge>;
}
export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="muted mt-1 max-w-2xl text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed hairline px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="muted mt-1 text-sm">{children}</div>}
    </div>
  );
}
export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <Card className="h-full p-4 transition hover:border-brass/50">
      <p className="muted text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-2 font-serif text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="muted mt-1 text-xs">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b hairline">
            {head.map((h, i) => (
              <th key={i} className="muted whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ className, ...p }: ComponentProps<"td">) => <td className={cn("px-4 py-2.5 align-top", className)} {...p} />;

export function Provenance({ p }: { p: string }) {
  if (p === "sourced") return <Badge tone="good">Sourced</Badge>;
  if (p === "assessment") return <Badge tone="info">AI assessment</Badge>;
  return <Badge tone="neutral">Unknown</Badge>;
}
