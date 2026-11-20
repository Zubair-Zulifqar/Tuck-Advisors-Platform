import { type Queryable, asSystem, NotFoundError } from "@tuck/db";
import { extractRedditSignals } from "@tuck/integrations";
import type { EngineDeps } from "../deps";
import { dispatchEvent } from "../automation/runtime";

export const DEFAULT_SUBREDDITS = ["smallbusiness", "Entrepreneur", "sweatystartup", "SaaS", "businessbroker", "acquisition"];

/** Search Reddit via the official API, keep only posts with M&A signals, and store them with source URL + retrieval time. */
export async function scanReddit(deps: EngineDeps, orgId: string, input: { query: string; subreddits?: string[]; minScore?: number }) {
  const posts = await deps.reddit.search(input.query, { subreddits: input.subreddits?.length ? input.subreddits : DEFAULT_SUBREDDITS, limit: 50 });
  const scored = posts.map((p) => ({ post: p, ...extractRedditSignals(p) })).filter((p) => p.types.length && p.score >= (input.minScore ?? 0.2));
  const saved = await asSystem(deps.db, async (tx) => {
    let n = 0;
    for (const s of scored) {
      const r = await tx.query(
        `insert into public.reddit_signals (organization_id, post_id, subreddit, title, url, author, excerpt, signal_types, score, posted_at, retrieved_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (organization_id, post_id) do update set score = excluded.score, signal_types = excluded.signal_types, retrieved_at = excluded.retrieved_at
         returning id`,
        [orgId, s.post.id, s.post.subreddit, s.post.title.slice(0, 500), s.post.url, s.post.author, s.post.excerpt.slice(0, 1500), s.types, s.score, s.post.postedAt, s.post.retrievedAt],
      );
      n += r.rows.length;
    }
    return n;
  });
  return { provider: deps.reddit.name, mock: deps.reddit.mock, scanned: posts.length, matched: scored.length, saved };
}

export async function listRedditSignals(tx: Queryable, orgId: string) {
  const { rows } = await tx.query("select * from public.reddit_signals where organization_id = $1 order by score desc, retrieved_at desc limit 200", [orgId]);
  return rows;
}

/** Promote a Reddit signal into a CRM opportunity (deduplicated by source URL). */
export async function convertSignalToOpportunity(deps: EngineDeps, orgId: string, userId: string, signalId: string) {
  const opp = await asSystem(
    deps.db,
    async (tx) => {
      const { rows } = await tx.query<{ id: string; title: string; url: string; excerpt: string; signal_types: string[]; retrieved_at: string; opportunity_id: string | null }>(
        "select * from public.reddit_signals where organization_id = $1 and id = $2",
        [orgId, signalId],
      );
      const s = rows[0];
      if (!s) throw new NotFoundError("Signal");
      if (s.opportunity_id) return { id: s.opportunity_id, created: false };
      const ins = await tx.query<{ id: string }>(
        `insert into public.opportunities (organization_id, title, source, source_url, summary, signals, retrieved_at)
         values ($1,$2,'reddit',$3,$4,$5,$6)
         on conflict (organization_id, source_url) where source_url is not null do update set summary = excluded.summary returning id`,
        [orgId, s.title, s.url, s.excerpt, JSON.stringify(s.signal_types), s.retrieved_at],
      );
      await tx.query("update public.reddit_signals set opportunity_id = $2 where id = $1", [signalId, ins.rows[0]!.id]);
      return { id: ins.rows[0]!.id, created: true };
    },
    userId,
  );
  if (opp.created) await dispatchEvent(deps, orgId, { type: "target.discovered", payload: { opportunityId: opp.id, source: "reddit" }, dedupeKey: `opp:${opp.id}` });
  return opp;
}
