import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";

const MINUTE = 60_000;
export const CODE_LIFETIME = 5 * MINUTE;
export const SESSION_LIFETIME = 12 * 60 * MINUTE;

export class EmailCodeError extends Error {
  status: number;
  retryAt?: number;
  constructor(message: string, status = 400, retryAt?: number) {
    super(message);
    this.status = status;
    this.retryAt = retryAt;
  }
}
export interface Login {
  uid: string;
  email: string;
  authTime: number;
  provider: string;
}
type Challenge = Login & {
  id: string; nonce: string; hash: string; expiresAt: number; resendAt: number;
  attempts: number; sends: number; windowStart: number;
  state: "sending" | "sent" | "used" | "cancelled" | "failed";
};

export function emailCodeService(db: Firestore, auth: Auth, secret: string,
  send: (email: string, code: string) => Promise<void>, clock = Date.now) {
  const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  const challengeRef = (uid: string) => db.collection("_emailCodes").doc(digest(uid));
  const grantRef = (id: string) => db.collection("_otpSessions").doc(id);
  const matches = (data: Challenge | undefined, login: Login, id: string) =>
    data?.id === id && data.authTime === login.authTime && data.email === login.email && data.provider === login.provider;

  return {
    async request(login: Login, id: string, resend = false) {
      const ref = challengeRef(login.uid);
      const nonce = randomUUID();
      const result = await db.runTransaction(async tx => {
        const prior = (await tx.get(ref)).data() as Challenge | undefined;
        const now = clock();
        if (matches(prior, login, id) && prior && !resend && (prior.state === "sent" || prior.state === "sending")) {
          return { code: null, expiresAt: prior.expiresAt, resendAt: prior.resendAt };
        }
        const sameWindow = prior && now < prior.windowStart + 60 * MINUTE;
        if (prior && now < prior.resendAt && (prior.state !== "used" || prior.id === id)) {
          throw new EmailCodeError("Please wait before requesting another code.", 429, prior.resendAt);
        }
        if (sameWindow && prior.sends >= 5) {
          throw new EmailCodeError("You’ve requested five codes. Try again later.", 429, prior.windowStart + 60 * MINUTE);
        }
        let code: string;
        do {
          code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        } while (prior && digest(prior.nonce + ":" + code) === prior.hash);
        const expiresAt = now + CODE_LIFETIME, resendAt = now + MINUTE;
        tx.set(ref, { ...login, id, nonce, hash: digest(nonce + ":" + code), expiresAt, resendAt,
          attempts: 0, state: "sending", sends: sameWindow ? prior.sends + 1 : 1,
          windowStart: sameWindow ? prior.windowStart : now } satisfies Challenge);
        return { code, expiresAt, resendAt };
      });
      if (result.code !== null) {
        let delivered = false;
        try { await send(login.email, result.code); delivered = true; }
        finally {
          await db.runTransaction(async tx => {
            const current = (await tx.get(ref)).data();
            if (current?.nonce === nonce && current.state === "sending") tx.update(ref, { state: delivered ? "sent" : "failed" });
          });
          if (!delivered) throw new EmailCodeError("We couldn’t send your code. Please try again.", 503, result.resendAt);
        }
      }
      return { expiresAt: result.expiresAt, resendAt: result.resendAt };
    },

    async cancel(login: Login, id: string) {
      const ref = challengeRef(login.uid);
      await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data() as Challenge | undefined;
        if (matches(data, login, id) && data?.state !== "used") tx.update(ref, { state: "cancelled" });
      });
    },

    async verify(login: Login, id: string, code: string) {
      const ref = challengeRef(login.uid);
      const accepted = await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data() as Challenge | undefined;
        if (!data || !matches(data, login, id) || data.state !== "sent" || data.expiresAt <= clock() || data.attempts >= 5) return false;
        const ok = timingSafeEqual(Buffer.from(data.hash, "hex"), Buffer.from(digest(data.nonce + ":" + code), "hex"));
        tx.update(ref, { attempts: data.attempts + 1, state: ok ? "used" : "sent" });
        return ok;
      });
      if (!accepted) throw new EmailCodeError("That code is incorrect, expired, or no longer available.");
      const user = await auth.getUser(login.uid);
      if (user.disabled || user.email?.toLowerCase() !== login.email) throw new EmailCodeError("Sign in again to verify this email.", 403);
      if (!user.emailVerified) await auth.updateUser(login.uid, { emailVerified: true });
      const grant = randomUUID();
      const token = await auth.createCustomToken(login.uid, { overviewOtpSession: grant });
      await grantRef(grant).create({ uid: login.uid, email: login.email, expiresAt: clock() + SESSION_LIFETIME });
      return { token };
    },

    async session(uid: string, email: string, grant: string, logout: boolean) {
      const ref = grantRef(grant);
      const data = (await ref.get()).data();
      if (!data || data.uid !== uid || data.email !== email) throw new EmailCodeError("Sign in again to continue.", 401);
      if (logout || data.expiresAt <= clock()) {
        await ref.delete();
        if (!logout) throw new EmailCodeError("Your session expired. Sign in again.", 401);
      }
      return { expiresAt: data.expiresAt as number };
    },
  };
}
