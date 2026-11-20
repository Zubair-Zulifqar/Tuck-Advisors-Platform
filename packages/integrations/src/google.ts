import { type Env, type Logger, MissingCredentialsError, httpJson, silentLogger } from "./core";

/**
 * Google OAuth 2.0 (web server flow) + minimal Gmail and Docs clients. Scopes are requested
 * incrementally and only for features a user explicitly enables:
 *  - gmail.readonly → read a single thread's headers for reply detection / CRM logging
 *  - gmail.compose → create drafts (never send automatically)
 *  - documents (drive.file) → create a Google Doc only when the user clicks "Export"
 */
export const GOOGLE_SCOPES = {
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  docs: "https://www.googleapis.com/auth/drive.file",
} as const;

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
}

export class GoogleOAuth {
  constructor(
    private cfg: { clientId: string; clientSecret: string; redirectUri: string },
    private fetchImpl?: typeof fetch,
  ) {}
  authorizeUrl(scopes: string[], state: string) {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  private async token(form: Record<string, string>): Promise<GoogleTokens> {
    const r = await httpJson<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>("https://oauth2.googleapis.com/token", {
      provider: "google",
      form: { client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, ...form },
      fetchImpl: this.fetchImpl,
    });
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000, scope: r.scope };
  }
  exchangeCode(code: string) {
    return this.token({ code, grant_type: "authorization_code", redirect_uri: this.cfg.redirectUri });
  }
  refresh(refreshToken: string) {
    return this.token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  }
}

function header(headers: { name: string; value: string }[] | undefined, name: string) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export function parseAddressList(v: string | null): { name?: string; email: string }[] {
  if (!v) return [];
  const out: { name?: string; email: string }[] = [];
  for (const part of v.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(part) ?? /^\s*()([^\s<>]+@[^\s<>]+)\s*$/.exec(part);
    if (m?.[2]) out.push({ name: m[1]?.trim() || undefined, email: m[2].trim().toLowerCase() });
  }
  return out;
}

export class GmailClient {
  constructor(
    private accessToken: string,
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
  ) {}
  private get<T>(path: string) {
    return httpJson<T>(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      provider: "gmail",
      headers: { authorization: `Bearer ${this.accessToken}` },
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
  }
  /** Metadata only (no bodies): subject, participants, message ids. */
  async getThreadMetadata(threadId: string) {
    const t = await this.get<{ id: string; messages?: { id: string; internalDate: string; payload?: { headers?: { name: string; value: string }[] } }[] }>(
      `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=In-Reply-To`,
    );
    const messages = (t.messages ?? []).map((m) => ({
      id: m.id,
      at: new Date(Number(m.internalDate)).toISOString(),
      from: parseAddressList(header(m.payload?.headers, "From"))[0] ?? null,
      to: parseAddressList(header(m.payload?.headers, "To")),
      cc: parseAddressList(header(m.payload?.headers, "Cc")),
      subject: header(m.payload?.headers, "Subject"),
    }));
    return { threadId: t.id, subject: messages[0]?.subject ?? null, messages };
  }
  /** Reply detection: has anyone other than `ownAddresses` written in this thread after `since`? */
  async findReplies(threadId: string, ownAddresses: string[], since: Date) {
    const meta = await this.getThreadMetadata(threadId);
    const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
    return meta.messages.filter((m) => m.from && !own.has(m.from.email) && new Date(m.at) > since);
  }
  /** Creates a DRAFT for a human to review and send from Gmail. Never sends. */
  async createDraft(m: { to: string; subject: string; text: string; threadId?: string }) {
    const raw = Buffer.from(`To: ${m.to}\r\nSubject: ${m.subject.replace(/[\r\n]/g, " ")}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${m.text}`).toString("base64url");
    return httpJson<{ id: string }>("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      provider: "gmail",
      headers: { authorization: `Bearer ${this.accessToken}` },
      body: { message: { raw, threadId: m.threadId } },
      fetchImpl: this.fetchImpl,
    });
  }
}

export class GoogleDocsClient {
  constructor(
    private accessToken: string,
    private fetchImpl?: typeof fetch,
  ) {}
  /** Creates a document in the user's Drive with plain-text content. Called only on explicit user action. */
  async createDocument(title: string, text: string) {
    const doc = await httpJson<{ documentId: string }>("https://docs.googleapis.com/v1/documents", {
      provider: "google_docs",
      headers: { authorization: `Bearer ${this.accessToken}` },
      body: { title },
      fetchImpl: this.fetchImpl,
    });
    await httpJson(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
      provider: "google_docs",
      headers: { authorization: `Bearer ${this.accessToken}` },
      body: { requests: [{ insertText: { location: { index: 1 }, text } }] },
      fetchImpl: this.fetchImpl,
    });
    return { documentId: doc.documentId, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
  }
}

export function createGoogleOAuth(env: Env, fetchImpl?: typeof fetch) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI)
    throw new MissingCredentialsError("Google OAuth", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]);
  return new GoogleOAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI }, fetchImpl);
}
