export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
  get duplicates(): { id: string; name: string; domain?: string | null; email?: string | null; reason?: string }[] {
    const d = this.details as { duplicates?: unknown } | undefined;
    return this.status === 409 && Array.isArray(d?.duplicates) ? (d!.duplicates as never) : [];
  }
}

/** Not signed in, session expired, or refresh token revoked. UI should show the login view. */
export class AuthError extends Error {
  override name = "AuthError";
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
  }
}

export class NetworkError extends Error {
  override name = "NetworkError";
  constructor(
    message: string,
    public timeout = false,
  ) {
    super(message);
  }
}

export interface SerializedError {
  name: string;
  message: string;
  status?: number;
  details?: unknown;
  timeout?: boolean;
}

/** Errors cross the background ↔ side panel message boundary as plain objects. */
export function serializeError(e: unknown): SerializedError {
  if (e instanceof ApiError) return { name: e.name, message: e.message, status: e.status, details: e.details };
  if (e instanceof NetworkError) return { name: e.name, message: e.message, timeout: e.timeout };
  if (e instanceof AuthError) return { name: e.name, message: e.message, status: 401 };
  return { name: "Error", message: e instanceof Error ? e.message : String(e) };
}

export function deserializeError(s: SerializedError): Error {
  if (s.name === "ApiError") return new ApiError(s.message, s.status ?? 500, s.details);
  if (s.name === "NetworkError") return new NetworkError(s.message, s.timeout);
  if (s.name === "AuthError") return new AuthError(s.message);
  return new Error(s.message);
}
