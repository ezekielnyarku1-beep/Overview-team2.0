"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { signInWithCustomToken, type Auth, type User } from "firebase/auth";
import { ArrowRight, Mail, RotateCw } from "lucide-react";
import { challengeId, clearChallenge, emailAction, VerificationError } from "@/lib/email-code-state";
import styles from "@/app/otp.module.css";

type Timing = { expiresAt: number; resendAt: number };
type Props = { user: User; auth: Auth; login: string; back: () => Promise<void> };

export function EmailVerification({ user, auth, login, back }: Props) {
  const [id] = useState(() => challengeId(login));
  const initial = useRef<Promise<Timing> | null>(null);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const [digits, setDigits] = useState("");
  const [timing, setTiming] = useState<Timing>({ expiresAt: 0, resendAt: 0 });
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState<"send" | "verify" | "leave" | null>("send");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const cooldown = Math.max(0, Math.ceil((timing.resendAt - now) / 1000));
  const expired = timing.expiresAt > 0 && now >= timing.expiresAt;
  const ready = timing.expiresAt > 0 && !expired;

  function failed(reason: unknown) {
    setError(reason instanceof VerificationError ? reason.message : "We couldn’t complete the request. Check your connection and try again.");
    if (reason instanceof VerificationError && reason.retryAt) {
      const until = reason.retryAt;
      setTiming(previous => ({ ...previous, resendAt: until }));
    }
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    initial.current ??= emailAction<Timing>(user, "start", { id });
    initial.current.then(result => { if (active) setTiming(result); })
      .catch(reason => { if (active) failed(reason); })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; mounted.current = false; };
  }, [user, id]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);

  async function resend() {
    if (busy || cooldown) return;
    setBusy("send"); setError(""); setAnnouncement("");
    try {
      const result = await emailAction<Timing>(user, "resend", { id });
      if (!mounted.current) return;
      setTiming(result); setNow(Date.now()); setDigits("");
      setAnnouncement("A new code is on its way.");
      input.current?.focus();
    } catch (reason) { if (mounted.current) failed(reason); }
    finally { if (mounted.current) setBusy(null); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || digits.length !== 6) return;
    setBusy("verify"); setError("");
    try {
      const { token } = await emailAction<{token: string}>(user, "verify", { id, code: digits });
      if (!mounted.current || auth.currentUser !== user) return;
      await signInWithCustomToken(auth, token);
      clearChallenge();
    } catch (reason) {
      if (mounted.current) { failed(reason); setDigits(""); input.current?.focus(); }
    } finally { if (mounted.current) setBusy(null); }
  }

  return <form className={styles.panel} onSubmit={verify} aria-labelledby="otp-heading">
    <div className={styles.seal} aria-hidden="true"><Mail size={29} strokeWidth={1.6} /></div>
    <h1 id="otp-heading">{user.emailVerified ? "Check your inbox" : "Verify your email"}</h1>
    <p className={styles.caption}>{busy === "send" ? "Requesting a six-digit code for" : ready ? "Enter the six-digit code sent to" : "Email verification for"} <strong>{user.email}</strong></p>
    <label htmlFor="email-otp" className={styles.label}>Verification code</label>
    <div className={styles.entry} data-error={Boolean(error && ready)}>
      <input ref={input} id="email-otp" autoComplete="one-time-code" inputMode="numeric" type="text"
        maxLength={6} pattern="[0-9]{6}" value={digits} aria-describedby="otp-help otp-error"
        aria-invalid={Boolean(error && ready)} readOnly={!ready || busy === "verify"}
        onChange={event => { setDigits(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
        onPaste={event => { if (ready && !busy) { event.preventDefault(); setDigits(event.clipboardData.getData("text").replace(/\D/g,"").slice(0,6)); setError(""); } }} />
      <div className={styles.slots} aria-hidden="true">{Array.from({length:6}, (_,i) =>
        <span key={i} data-filled={Boolean(digits[i])} data-next={i === digits.length}>{digits[i] || "·"}</span>)}</div>
    </div>
    <p id="otp-help" className={styles.help}>{expired ? "This code has expired. Request another below." : "Each code is valid for 5 minutes."}</p>
    <p id="otp-error" role="alert" className={styles.error}>{error}</p>
    <button className={styles.submit} disabled={!ready || digits.length !== 6 || !!busy}>{busy === "verify" ? "Verifying…" : "Verify and continue"}<ArrowRight size={17} aria-hidden="true" /></button>
    <div className={styles.actions}>
      <button type="button" onClick={resend} disabled={!!busy || cooldown > 0}><RotateCw aria-hidden="true" size={14}/>{cooldown ? `Resend in ${cooldown}s` : "Resend code"}</button>
      <button type="button" disabled={busy === "verify" || busy === "leave"} onClick={async () => {
        setBusy("leave");
        try { await emailAction(user, "cancel", { id }); await back(); } catch (reason) { failed(reason); setBusy(null); }
      }}>Sign out</button>
    </div>
    <div role="status" className={styles.help}>{announcement}</div>
  </form>;
}
