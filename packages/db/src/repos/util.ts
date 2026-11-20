export class NotFoundError extends Error {
  status = 404;
  constructor(what: string) {
    super(`${what} not found`);
  }
}
export class ConflictError extends Error {
  status = 409;
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "You do not have permission to perform this action") {
    super(message);
  }
}
export class ValidationError extends Error {
  status = 422;
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Escape LIKE wildcards in user search input. */
export function likePattern(q: string): string {
  return "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

export function clampLimit(n: unknown, def = 50, max = 200): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : def;
}

/** Build "col = $n" fragments for a whitelisted patch object. */
export function buildSet(patch: Record<string, unknown>, columns: Record<string, string>, params: unknown[], jsonKeys: string[] = []) {
  const sets: string[] = [];
  for (const [k, col] of Object.entries(columns)) {
    const v = patch[k];
    if (v === undefined) continue;
    params.push(jsonKeys.includes(k) ? JSON.stringify(v) : v);
    sets.push(`${col} = $${params.length}`);
  }
  return sets;
}
