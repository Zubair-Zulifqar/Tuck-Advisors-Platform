import { describe, expect, it } from "vitest";
import { ApiClient } from "../src/lib/api";
import { AuthManager } from "../src/lib/auth";
import { ApiError, AuthError, NetworkError } from "../src/lib/errors";
import { httpJson } from "../src/lib/http";
import { USER, json, memoryStorage, mockFetch, tokens } from "./helpers";

const BASE = "http://localhost:3000";

describe("AuthManager", () => {
  it("logs in and stores access token in session storage, refresh token in local storage", async () => {
    const storage = memoryStorage({ baseUrl: BASE });
    const fetch = mockFetch({ "POST /api/extension/auth/login": () => json(200, { data: tokens(1) }) });
    const auth = new AuthManager(storage, fetch);
    expect(await auth.login("a@b.test", "pw")).toEqual(USER);
    expect(storage.session.data.accessToken).toBe("access-1");
    expect(storage.local.data.refreshToken).toBe("refresh-1");
    expect(storage.local.data.accessToken).toBeUndefined();
    expect((await auth.status()).state).toBe("signed_in");
  });

  it("maps 401 at login to a friendly message", async () => {
    const auth = new AuthManager(memoryStorage(), mockFetch({ "POST /api/extension/auth/login": () => json(401, { error: { message: "Invalid" } }) }));
    await expect(auth.login("a@b.test", "bad")).rejects.toThrow("Incorrect email or password.");
  });

  it("refreshes an expired access token exactly once for concurrent callers (single flight)", async () => {
    const storage = memoryStorage({ baseUrl: BASE, refreshToken: "refresh-0" }, { accessToken: "old", accessExpiresAt: Date.now() - 1 });
    let calls = 0;
    const fetch = mockFetch({
      "POST /api/extension/auth/refresh": async (init) => {
        calls++;
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: "refresh-0" });
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { data: tokens(2) });
      },
    });
    const auth = new AuthManager(storage, fetch);
    const results = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    expect(results).toEqual(["access-2", "access-2", "access-2"]);
    expect(calls).toBe(1);
    expect(storage.local.data.refreshToken).toBe("refresh-2"); // rotated
  });

  it("marks the session expired when refresh is rejected", async () => {
    const storage = memoryStorage({ baseUrl: BASE, refreshToken: "revoked" });
    const auth = new AuthManager(storage, mockFetch({ "POST /api/extension/auth/refresh": () => json(401, { error: { message: "revoked" } }) }));
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(AuthError);
    expect(storage.local.data.refreshToken).toBeUndefined();
    expect((await auth.status()).state).toBe("expired");
  });

  it("keeps the session when refresh fails due to the network", async () => {
    const storage = memoryStorage({ baseUrl: BASE, refreshToken: "r" });
    const auth = new AuthManager(storage, async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(NetworkError);
    expect(storage.local.data.refreshToken).toBe("r");
  });

  it("logout revokes server-side and clears storage even if the server is down", async () => {
    const storage = memoryStorage({ baseUrl: BASE, refreshToken: "refresh-9", user: USER }, { accessToken: "a", accessExpiresAt: Date.now() + 60_000 });
    let revoked = "";
    const auth = new AuthManager(
      storage,
      mockFetch({
        "POST /api/extension/auth/logout": (init) => {
          revoked = JSON.parse(String(init.body)).refreshToken;
          return json(500, { error: { message: "down" } });
        },
      }),
    );
    await auth.logout();
    expect(revoked).toBe("refresh-9");
    expect(storage.local.data.refreshToken).toBeUndefined();
    expect(storage.session.data.accessToken).toBeUndefined();
    expect((await auth.status()).state).toBe("signed_out");
  });

  it("changing the backend URL drops tokens bound to the old backend", async () => {
    const storage = memoryStorage({ baseUrl: BASE, refreshToken: "r" });
    const auth = new AuthManager(storage, mockFetch({}));
    await auth.setBaseUrl("https://app.tuck.test/path");
    expect(storage.local.data.baseUrl).toBe("https://app.tuck.test");
    expect(storage.local.data.refreshToken).toBeUndefined();
  });
});

describe("ApiClient", () => {
  it("retries once with a refreshed token after a 401", async () => {
    const storage = memoryStorage({ baseUrl: BASE, refreshToken: "refresh-0" }, { accessToken: "stale", accessExpiresAt: Date.now() + 600_000 });
    const seen: string[] = [];
    const fetch = mockFetch({
      "GET /api/v1/me": (init) => {
        const auth = (init.headers as Record<string, string>).Authorization!;
        seen.push(auth);
        return auth === "Bearer access-5" ? json(200, { data: { user: USER } }) : json(401, { error: { message: "expired" } });
      },
      "POST /api/extension/auth/refresh": () => json(200, { data: tokens(5) }),
    });
    const api = new ApiClient(new AuthManager(storage, fetch), fetch);
    expect(await api.get("/api/v1/me")).toEqual({ user: USER });
    expect(seen).toEqual(["Bearer stale", "Bearer access-5"]);
  });

  it("surfaces 409 duplicates with details", async () => {
    const storage = memoryStorage({ baseUrl: BASE, refreshToken: "r" }, { accessToken: "a", accessExpiresAt: Date.now() + 600_000 });
    const dup = [{ id: "c1", name: "Northwind Analytics", domain: "northwind-analytics.example", reason: "domain" }];
    const fetch = mockFetch({ "POST /api/v1/companies": () => json(409, { error: { message: "A matching company already exists", details: { duplicates: dup } } }) });
    const api = new ApiClient(new AuthManager(storage, fetch), fetch);
    const err = (await api.post("/api/v1/companies", { name: "Northwind" }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.duplicates).toEqual(dup);
  });

  it("refuses to call endpoints outside /api/v1", async () => {
    const api = new ApiClient(new AuthManager(memoryStorage(), mockFetch({})), mockFetch({}));
    await expect(api.get("/api/admin/secrets")).rejects.toThrow(/Only \/api\/v1/);
  });

  it("throws AuthError when not signed in", async () => {
    const fetch = mockFetch({});
    const api = new ApiClient(new AuthManager(memoryStorage({ baseUrl: BASE }), fetch), fetch);
    await expect(api.get("/api/v1/me")).rejects.toBeInstanceOf(AuthError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("httpJson", () => {
  it("maps network failures to NetworkError", async () => {
    const err = (await httpJson(async () => {
      throw new TypeError("Failed to fetch");
    }, BASE, "/api/v1/me").catch((e) => e)) as NetworkError;
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.timeout).toBe(false);
  });

  it("times out slow requests with AbortController", async () => {
    const slow = (_: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const err = (await httpJson(slow, BASE, "/api/v1/me", { timeoutMs: 20 }).catch((e) => e)) as NetworkError;
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.timeout).toBe(true);
  });

  it("maps server errors and non-JSON bodies", async () => {
    const e1 = await httpJson(async () => json(500, { error: { message: "boom" } }), BASE, "/x").catch((e) => e);
    expect(e1).toMatchObject({ name: "ApiError", status: 500, message: "boom" });
    const e2 = await httpJson(async () => new Response("<html>", { status: 200 }), BASE, "/x").catch((e) => e);
    expect(e2).toBeInstanceOf(ApiError);
  });

  it("never sends cookies (credentials: omit)", async () => {
    let init: RequestInit | undefined;
    await httpJson(async (_u, i) => ((init = i), json(200, { data: 1 })), BASE, "/x");
    expect(init?.credentials).toBe("omit");
  });
});
