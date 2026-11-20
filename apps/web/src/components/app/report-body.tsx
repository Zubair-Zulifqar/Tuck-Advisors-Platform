import { Provenance } from "@/components/ui";

type Claim = { text: string; provenance: string; sourceIds?: string[]; confidence?: string };
const isClaim = (v: unknown): v is Claim => !!v && typeof v === "object" && "text" in v && "provenance" in v;
const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Renders any structured research output, showing provenance for each claim. All text is escaped by React. */
export function ReportBody({ content, sources }: { content: unknown; sources: { id: string }[] }) {
  const cite = (ids: string[] = []) => ids.map((id) => { const i = sources.findIndex((s) => s.id === id); return i >= 0 ? <a key={id} href={`#src-${id}`} className="ml-1 align-super text-xs text-brass-600">[{i + 1}]</a> : null; });
  const render = (v: unknown, key: string, depth: number): React.ReactNode => {
    if (isClaim(v))
      return (
        <div key={key} className="flex flex-col gap-1 py-1.5 sm:flex-row sm:gap-3">
          {key && !/^\d+$/.test(key) && <span className="label w-40 shrink-0 !mb-0 pt-1">{label(key)}</span>}
          <span className="shrink-0"><Provenance p={v.provenance} /></span>
          <span className={`text-sm ${v.provenance === "unknown" ? "muted italic" : ""}`}>{v.text}{cite(v.sourceIds)}{v.confidence && v.provenance !== "unknown" && <span className="muted ml-2 text-xs">({v.confidence} confidence)</span>}</span>
        </div>
      );
    if (Array.isArray(v)) {
      if (!v.length) return key ? <div key={key} className="py-1 text-sm"><span className="label">{label(key)}</span><span className="muted italic">None found</span></div> : null;
      return (
        <div key={key} className="py-2">
          {key && !/^\d+$/.test(key) && <h3 className="mb-1 font-serif text-lg font-semibold">{label(key)}</h3>}
          {typeof v[0] === "string" ? <ul className="list-disc space-y-1 pl-5 text-sm">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ul> : v.map((x, i) => <div key={i} className={depth > 0 ? "border-l hairline pl-3" : ""}>{render(x, String(i), depth + 1)}</div>)}
        </div>
      );
    }
    if (v && typeof v === "object")
      return (
        <div key={key} className={depth > 0 ? "py-1" : "space-y-1"}>
          {key && !/^\d+$/.test(key) && <h3 className="mt-2 font-serif text-lg font-semibold">{label(key)}</h3>}
          {Object.entries(v).map(([k, x]) => render(x, k, depth + 1))}
        </div>
      );
    if (v === null || v === undefined || v === "") return null;
    return <p key={key} className="py-1 text-sm">{key && !/^\d+$/.test(key) && <span className="label inline !mb-0 mr-2">{label(key)}</span>}{String(v)}</p>;
  };
  return <div className="divide-y divide-[var(--border)]">{render(content, "", 0)}</div>;
}
