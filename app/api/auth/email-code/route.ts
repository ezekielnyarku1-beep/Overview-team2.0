import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { emailCodeSender } from "@/lib/email-code-sender";
import { EmailCodeError, emailCodeService } from "@/lib/email-otp";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function admin() {
  return getApps().find(app => app.name === "email-code-server") ?? initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    credential: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) : applicationDefault(),
  }, "email-code-server");
}

export async function GET() {
  let configured = false;
  if (emailCodeSender() && (process.env.EMAIL_OTP_SECRET?.length ?? 0) >= 32) {
    try { await admin().options.credential?.getAccessToken(); configured = true; } catch { /* Credentials are unavailable. */ }
  }
  return json({ configured, deliveryVerified: false });
}

async function readAction(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new EmailCodeError("Invalid request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw new EmailCodeError("Request too large.", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const protocol = request.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol;
    if (request.headers.get("origin") !== `${protocol}//${host}`) return json({ error: "Invalid request origin." }, 403);
    if (Number(request.headers.get("content-length")) > 2048) return json({ error: "Request too large." }, 413);
    const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json({ error: "Sign in to continue." }, 401);
    const body = await readAction(request);
    if (!body || !["start", "resend", "verify", "cancel", "session", "logout"].includes(body.action)) return json({error:"Invalid action."}, 400);
    const app = admin(), auth = getAuth(app);
    const account = await auth.verifyIdToken(token, true).catch(error => {
      if (["auth/argument-error","auth/invalid-id-token","auth/id-token-expired","auth/id-token-revoked","auth/user-disabled","auth/user-not-found"].includes(error.code)) {
        throw new EmailCodeError("Sign in again to continue.", 401);
      }
      throw error;
    });
    const secret = process.env.EMAIL_OTP_SECRET;
    if (!secret || secret.length < 32) throw new EmailCodeError("Verification is temporarily unavailable.",503);
    const send = emailCodeSender();
    const service = emailCodeService(getFirestore(app), auth, secret, send ?? (async () => { throw new Error("Delivery unavailable"); }));
    const provider = account.firebase.sign_in_provider;
    const email = account.email?.toLowerCase();
    if (!email) throw new EmailCodeError("An email address is required.",403);
    if (body.action === "session" || body.action === "logout") {
      const grant = account.overviewOtpSession;
      if (provider !== "custom" || !account.email_verified || typeof grant !== "string" || !uuid.test(grant)) {
        throw new EmailCodeError("Email verification is required.",403);
      }
      return json(await service.session(account.uid, email, grant, body.action === "logout"));
    }
    if (!["password","google.com"].includes(provider)) throw new EmailCodeError("Sign in with email/password or Google.",403);
    if (typeof body.id !== "string" || !uuid.test(body.id)) throw new EmailCodeError("Restart email verification.");
    const login = { uid: account.uid, email, provider, authTime: account.auth_time };
    if (body.action === "cancel") {
      await service.cancel(login, body.id);
      return json({ cancelled: true });
    }
    if (body.action === "verify") {
      if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new EmailCodeError("Enter the six-digit code.");
      return json(await service.verify(login, body.id, body.code));
    }
    if (!send) throw new EmailCodeError("Email delivery is temporarily unavailable. Try again later.",503);
    return json(await service.request(login, body.id, body.action === "resend"));
  } catch (error) {
    if (error instanceof EmailCodeError) return json({error:error.message, retryAt:error.retryAt}, error.status);
    if (error instanceof SyntaxError) return json({error:"Invalid request."},400);
    return json({error:"Verification is temporarily unavailable. Please try again."},503);
  }
}
