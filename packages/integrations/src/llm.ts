import type { z } from "zod";
import { type Env, IntegrationError, type Logger, MissingCredentialsError, RateLimiter, httpJson, silentLogger } from "./core";

export interface LlmPrompt {
  system: string;
  user: string;
  /** Short task label for logs/metrics. */
  task: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly mock: boolean;
  /**
   * Returns JSON validated against `schema`. `fallback` is ONLY used by the mock provider (local dev
   * without credentials); its output must be built from the supplied sources, never invented facts.
   */
  completeJson<S extends z.ZodTypeAny>(schema: S, prompt: LlmPrompt, fallback: () => z.input<S>): Promise<z.output<S>>;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  readonly mock = false;
  private limiter = new RateLimiter(10, 2);
  constructor(
    private apiKey: string,
    private model = "gpt-4o-mini",
    private baseUrl = "https://api.openai.com/v1",
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
  ) {}

  async completeJson<S extends z.ZodTypeAny>(schema: S, prompt: LlmPrompt, _fallback?: () => z.input<S>): Promise<z.output<S>> {
    const messages: { role: string; content: string }[] = [
      {
        role: "system",
        content:
          prompt.system +
          "\n\nRespond with a single JSON object only. Never invent facts: if information is not in the provided sources, mark it as unknown.",
      },
      { role: "user", content: prompt.user },
    ];
    // One repair round-trip if the model returns JSON that fails validation.
    for (let round = 0; round < 2; round++) {
      const res = await httpJson<ChatResponse>(`${this.baseUrl}/chat/completions`, {
        provider: "openai",
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: { model: this.model, messages, temperature: 0.2, response_format: { type: "json_object" } },
        timeoutMs: 60_000,
        limiter: this.limiter,
        fetchImpl: this.fetchImpl,
        logger: this.logger,
      });
      const content = res.choices?.[0]?.message?.content ?? "";
      this.logger.info("llm.completion", { task: prompt.task, model: this.model, usage: res.usage });
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = undefined;
      }
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      messages.push({ role: "assistant", content }, {
        role: "user",
        content: `That JSON did not match the required schema: ${JSON.stringify(result.error.issues.slice(0, 8))}. Return corrected JSON only.`,
      });
    }
    throw new IntegrationError(`OpenAI returned output that failed validation for task ${prompt.task}`, "openai", 502, false);
  }
}

/** Local-development provider. Clearly flagged as mock in every report it touches. */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock-llm";
  readonly mock = true;
  async completeJson<S extends z.ZodTypeAny>(schema: S, _prompt: LlmPrompt, fallback: () => z.input<S>): Promise<z.output<S>> {
    return schema.parse(fallback());
  }
}

export function createLlmProvider(env: Env, opts: { fetchImpl?: typeof fetch; logger?: Logger; allowMock?: boolean } = {}): LlmProvider {
  if (env.OPENAI_API_KEY) return new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-4o-mini", env.OPENAI_BASE_URL || undefined, opts.fetchImpl, opts.logger);
  if (opts.allowMock ?? env.NODE_ENV !== "production") return new MockLlmProvider();
  throw new MissingCredentialsError("OpenAI", ["OPENAI_API_KEY"]);
}
