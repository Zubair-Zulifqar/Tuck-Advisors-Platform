export const STAGE_LABEL: Record<string, string> = { sourced: "Sourced", qualified: "Qualified", engaged: "Engaged", nda: "NDA", diligence: "Diligence", loi: "LOI", closing: "Closing", won: "Won", lost: "Lost" };
export const STAGE_TONE: Record<string, string> = {
  sourced: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  qualified: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  engaged: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200",
  nda: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  diligence: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  loi: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  closing: "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  lost: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
};
export function fmtDate(d: string | Date | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", withTime ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
}
export function relTime(d: string | Date) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  const abs = Math.abs(s);
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "just now";
  if (abs < 3600) return fmt.format(-Math.round(s / 60), "minute");
  if (abs < 86400) return fmt.format(-Math.round(s / 3600), "hour");
  return fmt.format(-Math.round(s / 86400), "day");
}
