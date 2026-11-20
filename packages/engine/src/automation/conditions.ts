import type { Condition } from "@tuck/shared";

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function evaluateCondition(c: Condition, ctx: unknown): boolean {
  const v = getPath(ctx, c.path);
  const target = c.value;
  switch (c.op) {
    case "exists":
      return v !== undefined && v !== null && v !== "";
    case "not_exists":
      return v === undefined || v === null || v === "";
    case "eq":
      return v === target;
    case "neq":
      return v !== target;
    case "in":
      return Array.isArray(target) && target.includes(v);
    case "not_in":
      return Array.isArray(target) && !target.includes(v);
    case "contains":
      if (Array.isArray(v)) return v.includes(target);
      return typeof v === "string" && typeof target === "string" && v.toLowerCase().includes(target.toLowerCase());
    case "gt":
      return typeof v === "number" && typeof target === "number" && v > target;
    case "gte":
      return typeof v === "number" && typeof target === "number" && v >= target;
    case "lt":
      return typeof v === "number" && typeof target === "number" && v < target;
    case "lte":
      return typeof v === "number" && typeof target === "number" && v <= target;
  }
}

export function evaluateConditions(conditions: Condition[], mode: "all" | "any", ctx: unknown) {
  if (!conditions.length) return { passed: true, failed: [] as Condition[] };
  const results = conditions.map((c) => ({ c, ok: evaluateCondition(c, ctx) }));
  const failed = results.filter((r) => !r.ok).map((r) => r.c);
  return { passed: mode === "all" ? failed.length === 0 : failed.length < conditions.length, failed };
}

/** Trigger config is a shallow equality filter on the event payload, e.g. {to: "nda"} for deal.stage_changed. */
export function triggerMatches(config: Record<string, unknown>, payload: Record<string, unknown>) {
  return Object.entries(config).every(([k, v]) => (k === "cron" ? true : Array.isArray(v) ? v.includes(payload[k]) : payload[k] === v));
}

/** Render "{{payload.companyName}}" style tokens inside action params (strings only, one level deep). */
export function renderParams(params: Record<string, unknown>, ctx: unknown): Record<string, unknown> {
  const render = (s: string) => s.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, p: string) => String(getPath(ctx, p) ?? ""));
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? render(v) : v]));
}
