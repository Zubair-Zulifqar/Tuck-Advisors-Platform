import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicHttpUrl, type ResearchSource } from "@tuck/shared";
import { type Env, IntegrationError, type Logger, RateLimiter, httpJson, silentLogger } from "./core";

export interface SearchOptions {
  numResults?: number;
  includeDomains?: string[];
  startPublishedDate?: string;
  category?: "company" | "news" | "research paper" | "tweet" | "personal site" | "financial report";
}

export interface ResearchProvider {
  readonly name: string;
  readonly mock: boolean;
  search(query: string, opts?: SearchOptions): Promise<ResearchSource[]>;
  getContents(urls: string[]): Promise<ResearchSource[]>;
  findSimilar(url: string, numResults?: number): Promise<ResearchSource[]>;
}

export function sourceId(url: string): string {
  return "src_" + createHash("sha1").update(url).digest("hex").slice(0, 12);
}

// ------------------------------------------------------------------ Exa
interface ExaResult {
  url: string;
  title?: string | null;
  text?: string;
  publishedDate?: string | null;
  summary?: string;
}

export class ExaProvider implements ResearchProvider {
  readonly name = "exa";
  readonly mock = false;
  private limiter = new RateLimiter(5, 5);
  constructor(
    private apiKey: string,
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
    private baseUrl = "https://api.exa.ai",
  ) {}

  private map(r: ExaResult): ResearchSource {
    const published = r.publishedDate && !Number.isNaN(Date.parse(r.publishedDate)) ? new Date(r.publishedDate).toISOString() : undefined;
    return {
      id: sourceId(r.url),
      url: r.url,
      title: (r.title ?? "").slice(0, 500),
      provider: "exa",
      retrievedAt: new Date().toISOString(),
      excerpt: (r.text ?? r.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
      publishedAt: published,
    };
  }
  private call<T>(path: string, body: unknown) {
    return httpJson<T>(`${this.baseUrl}${path}`, {
      provider: "exa",
      headers: { "x-api-key": this.apiKey },
      body,
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
  }
  async search(query: string, o: SearchOptions = {}) {
    const res = await this.call<{ results?: ExaResult[] }>("/search", {
      query,
      type: "auto",
      numResults: o.numResults ?? 8,
      includeDomains: o.includeDomains,
      startPublishedDate: o.startPublishedDate,
      category: o.category,
      contents: { text: { maxCharacters: 3000 } },
    });
    return (res.results ?? []).filter((r) => r.url).map((r) => this.map(r));
  }
  async getContents(urls: string[]) {
    const res = await this.call<{ results?: ExaResult[] }>("/contents", { urls, text: { maxCharacters: 4000 } });
    return (res.results ?? []).filter((r) => r.url).map((r) => this.map(r));
  }
  async findSimilar(url: string, numResults = 8) {
    const res = await this.call<{ results?: ExaResult[] }>("/findSimilar", { url, numResults, excludeSourceDomain: true, contents: { text: { maxCharacters: 1500 } } });
    return (res.results ?? []).filter((r) => r.url).map((r) => this.map(r));
  }
}

// ------------------------------------------------------------------ Direct website fetcher
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** DNS-rebinding/SSRF guard: every resolved address must be public. */
export async function assertPublicHost(hostname: string, resolver: (h: string) => Promise<{ address: string }[]> = (h) => lookup(h, { all: true })) {
  const addrs = await resolver(hostname).catch(() => {
    throw new IntegrationError("Website hostname could not be resolved", "website", 400);
  });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new IntegrationError("URL resolves to a non-public address", "website", 400);
}

const UA = "TuckAdvisorsResearchBot/1.0 (+https://github.com/Zubair-Zulifqar/Tuck-Advisors-Platform)";

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));
}

export function extractPage(html: string) {
  const pick = (re: RegExp) => decodeEntities(re.exec(html)?.[1]?.trim() ?? "");
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const body = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return { title, description, text: body };
}

/** Disallow check against robots.txt for our UA or "*" (prefix rules only, conservative). */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  const disallow: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (!k) continue;
    if (k.toLowerCase() === "user-agent") applies = v === "*" || UA.toLowerCase().includes(v.toLowerCase());
    else if (applies && k.toLowerCase() === "disallow" && v) disallow.push(v);
  }
  return !disallow.some((d) => path.startsWith(d));
}

/**
 * Fetches a company's own public website (homepage / about) with an SSRF guard, robots.txt check,
 * size and time limits. Used directly by the analyzer and as the content source when Exa is absent.
 */
export class WebsiteFetcher implements ResearchProvider {
  readonly name = "website";
  readonly mock = false;
  constructor(
    private fetchImpl: typeof fetch = fetch,
    private maxBytes = 1_500_000,
    private resolver?: (h: string) => Promise<{ address: string }[]>,
  ) {}

  async fetchOne(url: string): Promise<ResearchSource | null> {
    if (!isPublicHttpUrl(url)) throw new IntegrationError("URL must be a public http(s) address", "website", 400);
    const u = new URL(url);
    try {
      const robots = await this.get(`${u.origin}/robots.txt`, 5000);
      if (robots.ok && !robotsAllows(robots.text, u.pathname || "/")) return null;
    } catch {
      /* no robots.txt => allowed */
    }
    const page = await this.get(url, 12_000);
    if (!page.ok) throw new IntegrationError(`Website responded with HTTP ${page.status}`, "website", page.status, page.status >= 500);
    if (!isPublicHttpUrl(page.finalUrl)) throw new IntegrationError("Redirected to a non-public address", "website", 400);
    const { title, description, text } = extractPage(page.text);
    return {
      id: sourceId(page.finalUrl),
      url: page.finalUrl,
      title: title.slice(0, 500),
      provider: "website",
      retrievedAt: new Date().toISOString(),
      excerpt: [description, text].filter(Boolean).join(" — ").slice(0, 4000),
    };
  }

  private async get(url: string, timeoutMs: number) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let current = url;
      for (let hop = 0; hop < 4; hop++) {
        await assertPublicHost(new URL(current).hostname, this.resolver);
        const res = await this.fetchImpl(current, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "manual", signal: ctrl.signal });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          current = new URL(res.headers.get("location")!, current).toString();
          if (!isPublicHttpUrl(current)) throw new IntegrationError("Redirected to a non-public address", "website", 400);
          continue;
        }
        const reader = res.body?.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > this.maxBytes) {
              await reader.cancel();
              break;
            }
            chunks.push(value);
          }
        }
        const text = reader ? new TextDecoder().decode(Buffer.concat(chunks)) : await res.text();
        return { ok: res.ok, status: res.status, text, finalUrl: current };
      }
      throw new IntegrationError("Too many redirects", "website", 400);
    } catch (e) {
      if (e instanceof IntegrationError) throw e;
      throw new IntegrationError((e as Error).name === "AbortError" ? "Website timed out" : "Website could not be reached", "website", 504, true);
    } finally {
      clearTimeout(t);
    }
  }

  async getContents(urls: string[]) {
    const out: ResearchSource[] = [];
    for (const u of urls) {
      const s = await this.fetchOne(u).catch(() => null);
      if (s) out.push(s);
    }
    return out;
  }
  async search(): Promise<ResearchSource[]> {
    return []; // a website fetcher cannot search the web; callers must treat empty as "no data"
  }
  async findSimilar(): Promise<ResearchSource[]> {
    return [];
  }
}

/** Combines Exa (search/discovery) with direct website retrieval; degrades to website-only without a key. */
export class CompositeResearchProvider implements ResearchProvider {
  readonly name: string;
  readonly mock = false;
  constructor(
    private website: WebsiteFetcher,
    private exa?: ExaProvider,
  ) {
    this.name = exa ? "exa+website" : "website";
  }
  search(q: string, o?: SearchOptions) {
    return this.exa ? this.exa.search(q, o) : Promise.resolve([]);
  }
  findSimilar(url: string, n?: number) {
    return this.exa ? this.exa.findSimilar(url, n) : Promise.resolve([]);
  }
  async getContents(urls: string[]) {
    const direct = await this.website.getContents(urls);
    const missing = urls.filter((u) => !direct.some((d) => new URL(d.url).hostname === new URL(u).hostname));
    if (this.exa && missing.length) direct.push(...(await this.exa.getContents(missing).catch(() => [])));
    return direct;
  }
  get hasSearch() {
    return !!this.exa;
  }
}

export function createResearchProvider(
  env: Env,
  opts: { fetchImpl?: typeof fetch; logger?: Logger; resolver?: (h: string) => Promise<{ address: string }[]> } = {},
) {
  const website = new WebsiteFetcher(opts.fetchImpl, undefined, opts.resolver);
  const exa = env.EXA_API_KEY ? new ExaProvider(env.EXA_API_KEY, opts.fetchImpl, opts.logger) : undefined;
  return new CompositeResearchProvider(website, exa);
}
