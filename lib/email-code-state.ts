import type { User } from "firebase/auth";

const storageKey = "overview:email-challenge";
let current: { login: string; id: string } | null = null;

export function clearChallenge() {
  current = null;
  try { sessionStorage.removeItem(storageKey); } catch { /* Private browsing. */ }
}

export function challengeId(login: string) {
  if (current?.login === login) return current.id;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (stored?.login === login && typeof stored.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.id)) {
      current = { login, id: stored.id };
      return current.id;
    }
  } catch { /* An inaccessible or stale entry starts a new challenge. */ }
  current = { login, id: crypto.randomUUID() };
  try { sessionStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Keep the in-memory fallback. */ }
  return current.id;
}

export class VerificationError extends Error {
  status: number;
  retryAt?: number;
  constructor(message: string, status: number, retryAt?: number) {
    super(message); this.status = status; this.retryAt = retryAt;
  }
}

export async function emailAction<T>(user: User, action: string, data: Record<string, string> = {}): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch("/api/auth/email-code", {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...data }),
  });
  const result = await response.json();
  if (!response.ok) throw new VerificationError(result.error || "Please try again.", response.status, result.retryAt);
  return result;
}
