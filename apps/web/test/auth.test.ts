import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/server/auth";

describe("session tokens", () => {
  const now = Math.floor(Date.now() / 1000);
  it("round-trips valid tokens", () => {
    const t = signToken({ sub: "u1", org: "o1", typ: "web", exp: now + 60 });
    expect(verifyToken(t)).toMatchObject({ sub: "u1", org: "o1", typ: "web" });
  });
  it("rejects expired, tampered and malformed tokens", () => {
    expect(verifyToken(signToken({ sub: "u1", org: "o1", typ: "web", exp: now - 1 }))).toBeNull();
    const t = signToken({ sub: "u1", org: "o1", typ: "ext", exp: now + 60 });
    const [v, body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", org: "o1", typ: "ext", exp: now + 60 })).toString("base64url");
    expect(verifyToken(`${v}.${forged}.${sig}`)).toBeNull();
    expect(verifyToken(`${v}.${body}.${sig}x`)).toBeNull();
    expect(verifyToken("garbage")).toBeNull();
    expect(verifyToken(undefined)).toBeNull();
  });
});
