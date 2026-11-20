import { describe, expect, it } from "vitest";
import { rateLimit } from "@/server/ratelimit";

describe("rateLimit", () => {
  it("blocks after the limit and resets after the window", () => {
    const k = `t:${Math.random()}`;
    expect(rateLimit(k, 2, 1000, 0).ok).toBe(true);
    expect(rateLimit(k, 2, 1000, 1).ok).toBe(true);
    const third = rateLimit(k, 2, 1000, 2);
    expect(third.ok).toBe(false);
    expect(third.retryAfterMs).toBe(998);
    expect(rateLimit(k, 2, 1000, 1001).ok).toBe(true);
  });
});
