import { type Env, type Logger, RateLimiter, httpJson, silentLogger } from "./core";

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  author: string | null;
  excerpt: string;
  postedAt: string;
  retrievedAt: string;
  score: number;
}

export interface RedditProvider {
  readonly name: string;
  readonly mock: boolean;
  search(query: string, opts?: { subreddits?: string[]; limit?: number; timeframe?: "week" | "month" | "year" }): Promise<RedditPost[]>;
}

interface Listing {
  data?: {
    children?: {
      data: { id: string; subreddit: string; title: string; permalink: string; author?: string; selftext?: string; created_utc: number; score: number; over_18?: boolean };
    }[];
  };
}

/**
 * Reddit Data API via OAuth (application-only, client_credentials). Respects the documented 100 QPM
 * budget with a token bucket and identifies itself with a descriptive User-Agent as Reddit requires.
 */
export class RedditApiProvider implements RedditProvider {
  readonly name = "reddit";
  readonly mock = false;
  private token: { value: string; exp: number } | null = null;
  private limiter = new RateLimiter(10, 100 / 60);
  constructor(
    private cfg: { clientId: string; clientSecret: string; userAgent: string },
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
  ) {}
  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const r = await httpJson<{ access_token: string; expires_in: number }>("https://www.reddit.com/api/v1/access_token", {
      provider: "reddit",
      headers: { authorization: `Basic ${basic}`, "user-agent": this.cfg.userAgent },
      form: { grant_type: "client_credentials" },
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
    this.token = { value: r.access_token, exp: Date.now() + r.expires_in * 1000 };
    return r.access_token;
  }
  async search(query: string, o: { subreddits?: string[]; limit?: number; timeframe?: "week" | "month" | "year" } = {}) {
    const token = await this.accessToken();
    const q = new URLSearchParams({ q: query, sort: "new", t: o.timeframe ?? "month", limit: String(Math.min(o.limit ?? 25, 100)), type: "link", restrict_sr: "false" });
    const path = o.subreddits?.length ? `/r/${o.subreddits.map(encodeURIComponent).join("+")}/search` : "/search";
    if (o.subreddits?.length) q.set("restrict_sr", "true");
    const res = await httpJson<Listing>(`https://oauth.reddit.com${path}?${q}`, {
      provider: "reddit",
      headers: { authorization: `Bearer ${token}`, "user-agent": this.cfg.userAgent },
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
    const retrievedAt = new Date().toISOString();
    return (res.data?.children ?? [])
      .map((c) => c.data)
      .filter((d) => !d.over_18)
      .map((d) => ({
        id: d.id,
        subreddit: d.subreddit,
        title: d.title,
        url: `https://www.reddit.com${d.permalink}`,
        author: d.author && d.author !== "[deleted]" ? d.author : null,
        excerpt: (d.selftext ?? "").slice(0, 1500),
        postedAt: new Date(d.created_utc * 1000).toISOString(),
        retrievedAt,
        score: d.score,
      }));
  }
}

/** Synthetic sample posts for local development. Every item is labelled as sample data. */
export class MockRedditProvider implements RedditProvider {
  readonly name = "reddit-mock";
  readonly mock = true;
  async search(query: string) {
    const now = new Date().toISOString();
    const samples = [
      ["mock1", "smallbusiness", "[Sample data] Thinking about selling my 12-year-old HVAC services business — where do I start?", "Owner-operator, recurring maintenance contracts, considering retirement and an exit within 18 months."],
      ["mock2", "sweatystartup", "[Sample data] Looking to acquire a B2B services company in the Midwest", "Search fund backed buyer looking at $1-5M EBITDA businesses."],
      ["mock3", "SaaS", "[Sample data] Bootstrapped vertical SaaS, $2M ARR — had inbound acquisition interest, now what?", "Received an unsolicited LOI from a strategic; want advice on running a process."],
    ];
    return samples.map(([id, sub, title, body]) => ({
      id: id!,
      subreddit: sub!,
      title: title!,
      url: `https://www.reddit.com/r/${sub}/comments/${id}/sample_${encodeURIComponent(query.slice(0, 20))}`,
      author: null,
      excerpt: body!,
      postedAt: now,
      retrievedAt: now,
      score: 0,
    }));
  }
}

export function createRedditProvider(env: Env, opts: { fetchImpl?: typeof fetch; logger?: Logger } = {}): RedditProvider {
  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET)
    return new RedditApiProvider(
      { clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET, userAgent: env.REDDIT_USER_AGENT || "web:tuck-advisors-research:0.1 (by /u/tuck-advisors)" },
      opts.fetchImpl,
      opts.logger,
    );
  return new MockRedditProvider();
}

/** Keyword signal extraction for M&A relevance — transparent and explainable. */
const SIGNALS: Record<string, RegExp> = {
  seller_intent: /\b(sell(ing)? (my|our|the) (business|company)|exit (strategy|plan)|retir(e|ing|ement)|succession|looking for a buyer)\b/i,
  buyer_intent: /\b(acquire|acquisition|buy(ing)? a (business|company)|search fund|roll-?up|looking to buy)\b/i,
  inbound_interest: /\b(LOI|letter of intent|inbound (interest|offer)|unsolicited offer|approached by)\b/i,
  valuation_question: /\b(valuation|multiple|EBITDA|SDE|ARR|what is my business worth)\b/i,
  advisor_need: /\b(broker|M&A advisor|investment bank|banker|where do I start)\b/i,
};

export function extractRedditSignals(post: Pick<RedditPost, "title" | "excerpt">) {
  const text = `${post.title}\n${post.excerpt}`;
  const types = Object.entries(SIGNALS)
    .filter(([, re]) => re.test(text))
    .map(([k]) => k);
  const weights: Record<string, number> = { seller_intent: 0.4, inbound_interest: 0.3, buyer_intent: 0.25, advisor_need: 0.2, valuation_question: 0.1 };
  const score = Math.min(1, types.reduce((s, t) => s + (weights[t] ?? 0), 0));
  return { types, score: Math.round(score * 1000) / 1000 };
}
