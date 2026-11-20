import { type Env, type Logger, MissingCredentialsError, RateLimiter, httpJson, silentLogger } from "./core";

export interface OutboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}
export interface SendResult {
  providerMessageId: string;
  /** "accepted" = provider accepted for delivery. "simulated" = mock, nothing was sent. */
  status: "accepted" | "simulated";
}
export interface EmailProvider {
  readonly name: string;
  readonly mock: boolean;
  send(m: OutboundEmail): Promise<SendResult>;
}

export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  readonly mock = false;
  private limiter = new RateLimiter(2, 2);
  constructor(
    private apiKey: string,
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
  ) {}
  async send(m: OutboundEmail): Promise<SendResult> {
    const r = await httpJson<{ id: string }>("https://api.resend.com/emails", {
      provider: "resend",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: { from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, reply_to: m.replyTo, headers: m.headers, tags: m.tags },
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retry: { maxAttempts: 2 },
    });
    return { providerMessageId: r.id, status: "accepted" };
  }
}

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock-email";
  readonly mock = true;
  outbox: (OutboundEmail & { id: string })[] = [];
  async send(m: OutboundEmail): Promise<SendResult> {
    const id = `sim_${this.outbox.length + 1}_${Date.now()}`;
    this.outbox.push({ ...m, id });
    return { providerMessageId: id, status: "simulated" };
  }
}

export function createEmailProvider(env: Env, opts: { fetchImpl?: typeof fetch; logger?: Logger; allowMock?: boolean } = {}): EmailProvider {
  if (env.RESEND_API_KEY) return new ResendProvider(env.RESEND_API_KEY, opts.fetchImpl, opts.logger);
  if (opts.allowMock ?? env.NODE_ENV !== "production") return new MockEmailProvider();
  throw new MissingCredentialsError("Resend", ["RESEND_API_KEY"]);
}

/** Normalises Resend webhook events (delivered/bounced/complained) into Tuck message statuses. */
export function mapResendEvent(evt: { type?: string; data?: { email_id?: string } }) {
  const id = evt.data?.email_id;
  if (!id) return null;
  const map: Record<string, "delivered" | "bounced" | "complained"> = {
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
  };
  const status = map[evt.type ?? ""];
  return status ? { providerMessageId: id, status } : null;
}
