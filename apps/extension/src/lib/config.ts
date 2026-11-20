declare const __TUCK_API_BASE_URL__: string | undefined;

/** Inlined at build time from TUCK_API_BASE_URL. Never contains secrets. */
export const DEFAULT_BASE_URL: string =
  (typeof __TUCK_API_BASE_URL__ !== "undefined" && __TUCK_API_BASE_URL__) || "http://localhost:3000";

export const REQUEST_TIMEOUT_MS = 20_000;

/** Normalise a user-supplied backend URL to its origin; rejects non-http(s) and plain-http non-local hosts. */
export function normalizeBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid URL, e.g. https://app.tuckadvisors.com");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new Error("The platform URL must use HTTPS (plain HTTP is only allowed for localhost).");
  }
  return u.origin;
}

/** Match pattern for chrome.permissions.request covering exactly the backend origin. */
export function originPattern(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
}
