"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword, GoogleAuthProvider, onIdTokenChanged,
  sendPasswordResetEmail, signInWithEmailAndPassword,
  signInWithPopup, signOut, type User,
} from "firebase/auth";
import {
  collection, deleteField, doc, FieldPath, onSnapshot, query, runTransaction, setDoc,
  updateDoc, where,
} from "firebase/firestore";
import { firebaseClient } from "@/lib/firebase-client";
import { firebaseErrorMessage } from "@/lib/firebase-errors";
import { Brand } from "@/components/brand";
import Tracker, { type Item, descendants } from "@/components/tracker";
import styles from "@/app/tracker.module.css";
import accountStyles from "@/app/account.module.css";
import { EmailVerification } from "@/components/email-code-sign-in";
import { clearChallenge, emailAction, VerificationError } from "@/lib/email-code-state";
import { Eye, EyeOff } from "lucide-react";

const roles = { admin: "Administrator", editor: "Editor", viewer: "Viewer" } as const;
type Role = keyof typeof roles;
type Project = {
  owner: string; members: Record<string, Role>; invites: Record<string, Role>;
  items: Item[]; revision: number;
};
type Client = NonNullable<ReturnType<typeof firebaseClient>>;
type Access =
  | { step: "loading" | "signed-out" }
  | { step: "restart"; user: User }
  | { step: "verify-email"; user: User; login: string }
  | { step: "workspace"; user: User; administrator: boolean; grant: string };

async function leave(client: Client) {
  const account = client.auth.currentUser;
  if (account) {
    try {
      if ((await account.getIdTokenResult()).claims.overviewOtpSession) await emailAction(account, "logout");
    } catch (error) {
      const invalidToken = error instanceof Error && "code" in error &&
        ["auth/user-token-expired", "auth/invalid-user-token", "auth/user-disabled", "auth/user-not-found"].includes(String(error.code));
      if (!invalidToken && !(error instanceof VerificationError && error.status === 401)) throw error;
    }
  }
  clearChallenge();
  await signOut(client.auth);
}

export default function FirebaseWorkspace() {
  const [client, setClient] = useState<Client | null>(null);
  const [access, setAccess] = useState<Access>({ step: "loading" });
  const [error, setError] = useState("");
  useEffect(() => {
    const connection = firebaseClient();
    if (!connection) { setAccess({ step: "signed-out" }); return; }
    setClient(connection);
    let active = true;
    let revision = 0;
    let expiry: ReturnType<typeof setTimeout>;
    async function check(account: User | null) {
      const current = ++revision;
      clearTimeout(expiry);
      let result: Access = { step: "signed-out" };
      if (account) {
        result = { step: "restart", user: account };
        try {
          const token = await account.getIdTokenResult();
          if (account.email && (token.signInProvider === "google.com" || token.signInProvider === "password")) {
            result = { step: "verify-email", user: account, login: JSON.stringify([account.uid, token.signInProvider, token.authTime]) };
          } else if (token.signInProvider === "custom" && typeof token.claims.overviewOtpSession === "string") {
            const { expiresAt } = await emailAction<{ expiresAt: number }>(account, "session");
            if (!active || current !== revision) return;
            if (expiresAt > Date.now()) {
              result = { step: "workspace", user: account, administrator: token.claims.admin === true, grant: token.claims.overviewOtpSession };
              expiry = setTimeout(() => { if (active) setAccess({ step: "restart", user: account }); }, expiresAt - Date.now());
            }
          }
        } catch { /* Session validation fails closed. */ }
      }
      if (active && current === revision) setAccess(result);
    }
    const unsubscribe = onIdTokenChanged(connection.auth, account => {
      setAccess({ step: "loading" });
      void check(account);
    });
    const resume = () => { if (document.visibilityState === "visible") void check(connection.auth.currentUser); };
    document.addEventListener("visibilitychange", resume);
    return () => { active = false; clearTimeout(expiry); unsubscribe(); document.removeEventListener("visibilitychange", resume); };
  }, []);
  if (access.step === "loading") return <main id="main-content" className={styles.main}>Checking your session…</main>;
  if (!client) return <main id="main-content" className={styles.main}><Brand /><h1>Connect Firebase</h1></main>;
  if (access.step === "workspace") return <Workspace key={access.grant} client={client} user={access.user} administrator={access.administrator} />;
  if (access.step === "signed-out") return <Account client={client} />;
  return <main id="main-content" className={accountStyles.page}><div className={accountStyles.card}><Brand />
    {access.step === "verify-email"
      ? <EmailVerification key={access.login} user={access.user} auth={client.auth} login={access.login} back={() => leave(client)} />
      : <div className={accountStyles.form}><h1>Sign in again</h1><p>Your verified session is unavailable.</p>
        <button className="button primary" onClick={() => void leave(client).catch(() => setError("Check your connection and retry signing out."))}>Back to sign in</button>
        {error && <p role="alert">{error}</p>}</div>}
  </div></main>;
}

function Account({client}: {client: Client}) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("account");
    if (requested === "signup" || requested === "reset") {
      setMode(requested);
      url.searchParams.delete("account");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    clearChallenge();
    try { await action(); }
    catch (error) { setMessage(firebaseErrorMessage(error)); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "signup" && password !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      document.getElementById("confirm-password")?.focus();
      return;
    }
    setPasswordError("");
    void perform(async () => {
      if (mode === "reset") {
        await sendPasswordResetEmail(client.auth, email.trim());
        setMessage("If an account exists for this email, you’ll receive reset instructions.");
      } else if (mode === "signup") {
        await createUserWithEmailAndPassword(client.auth, email.trim(), password);
        setPassword("");
        setConfirmPassword("");
        setMessage("");
      } else {
        await signInWithEmailAndPassword(client.auth, email.trim(), password);
      }
    });
  }
  function switchMode(next: typeof mode) {
    clearChallenge();
    setMode(next);
    setConfirmPassword("");
    setPasswordError("");

    setPassword("");
    setMessage("");
    setShowPassword(false);
  }
  return <main id="main-content" className={accountStyles.page}>
    <div className={accountStyles.card}>
    <Brand />
    <form className={accountStyles.form} onSubmit={submit} aria-busy={busy}>
      <h1>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password"}</h1>
      <div className={accountStyles.fields}>
        <label htmlFor="account-email">Email address</label>
        <input id="account-email" type="email" autoComplete="username" placeholder="you@example.com" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} />
        {mode !== "reset" && <>
          <div className={accountStyles.labelRow}><label htmlFor="account-password">Password</label>{mode === "signin" && <button type="button" className={accountStyles.link} disabled={busy} onClick={() => switchMode("reset")}>Forgot password?</button>}</div>
          <div className={accountStyles.password}>
            <input id="account-password" type={showPassword ? "text" : "password"} placeholder="Enter your password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 6 : undefined} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          {mode === "signup" && <>
            <small id="password-guidance">Use at least 6 characters.</small>
            <label htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required disabled={busy} value={confirmPassword} aria-invalid={!!passwordError} aria-describedby={passwordError ? "password-match-error" : undefined} onChange={e => {setConfirmPassword(e.target.value);setPasswordError("");}} />
            {passwordError && <p id="password-match-error" role="alert">{passwordError}</p>}
          </>}
        </>}
      </div>
      <div className={accountStyles.buttons}>
        <button className="button primary" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</button>
        {mode === "signin" ? <>
          <div className={accountStyles.divider}><span>or</span></div>
          <button type="button" className="button" disabled={busy} onClick={() => void perform(() => signInWithPopup(client.auth, new GoogleAuthProvider()))}><span className={accountStyles.google} aria-hidden="true">G</span>Continue with Google</button>
          <p className={accountStyles.switch}>Don’t have an account? <button type="button" className={accountStyles.link} disabled={busy} onClick={() => switchMode("signup")}>Sign up</button></p>
        </> : <>
          {mode === "signup" && <><div className={accountStyles.divider}><span>or</span></div><button type="button" className="button" disabled={busy} onClick={() => void perform(() => signInWithPopup(client.auth, new GoogleAuthProvider()))}><span className={accountStyles.google} aria-hidden="true">G</span>Continue with Google</button></>}
          <button type="button" className={accountStyles.link} disabled={busy} onClick={() => switchMode("signin")}>Back to sign in</button>
        </>}
      </div>
    </form>
    {message && <p role="status" className={accountStyles.message}>{message}</p>}
    </div>
  </main>;
}

function Workspace({client, user, administrator}: {client: Client; user: User; administrator: boolean}) {
  const [projects, setProjects] = useState<Record<string, Project> | null>(null);
  const [error, setError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  useEffect(() => onSnapshot(administrator ? collection(client.db, "trackerProjects") : query(collection(client.db, "trackerProjects"),
    where(new FieldPath("members", user.uid), "in", Object.keys(roles))),
    snapshot => {
      setProjects(Object.fromEntries(snapshot.docs.map(entry => [entry.id, entry.data() as Project])));
      setError("");
    }, error => {
      setProjects(null);
      setError(firebaseErrorMessage(error));
    }), [client, user.uid, administrator]);

  async function persist(projectId: string, allItems: Item[]) {
    const root = allItems.find(item => item.id === projectId && item.kind === "Project");
    if (!root) throw new Error("Missing project");
    const items = [root, ...descendants(allItems, projectId)];
    const previous = projects?.[projectId];
    const ref = doc(client.db, "trackerProjects", projectId);
    if (!previous) {
      await setDoc(ref, { owner: user.uid, members: { [user.uid]: "admin" }, invites: {}, items, revision: 0 });
      return;
    }
    await runTransaction(client.db, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists() || snapshot.data().revision !== previous.revision) {
        throw new Error("This project changed. Reopen the edit with the latest values.");
      }
      transaction.update(ref, { items, revision: previous.revision + 1 });
    });
  }

  async function acceptInvite() {
    const params = new URLSearchParams(location.search);
    const id = params.get("invite");
    const role = params.get("role");
    if (!id || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || !role || !Object.hasOwn(roles, role) || !user.email) {
      setError("This invitation link is invalid.");
      return;
    }
    setInviteBusy(true);
    try {
      await updateDoc(doc(client.db, "trackerProjects", id),
        new FieldPath("members", user.uid), role,
        new FieldPath("invites", user.email.toLowerCase()), deleteField());
      history.replaceState(null, "", "/");
      setError("");
    } catch {
      setError("Could not accept this invitation. Sign in with the invited email and check with the project administrator.");
    } finally { setInviteBusy(false); }
  }

  const [hasInvite, setHasInvite] = useState(false);
  const [localProjects, setLocalProjects] = useState<Item[]>([]);
  useEffect(() => {
    setHasInvite(new URLSearchParams(location.search).has("invite"));
    try {
      const data = JSON.parse(localStorage.getItem("overview-tracker-v1") ?? "[]");
      if (Array.isArray(data)) setLocalProjects(data);
    } catch { /* Leave the original browser data untouched. */ }
  }, []);
  const localRoots = localProjects.filter(item => item.kind === "Project" && !projects?.[`${user.uid}-${item.id}`]);
  async function importLocal() {
    setImportBusy(true);
    try {
      for (const root of localRoots) {
        const idMap = new Map([root, ...descendants(localProjects, root.id)].map(item => [item.id, `${user.uid}-${item.id}`]));
        await persist(idMap.get(root.id)!, [root, ...descendants(localProjects, root.id)].map(item => ({
          ...item, id: idMap.get(item.id)!, parent: item.parent ? idMap.get(item.parent)! : null,
        })));
      }
    } catch {
      setError("Some browser projects could not be imported. Your browser copy is still available.");
    } finally { setImportBusy(false); }
  }

  return <>
    <div className={styles.session}>
      <span>{user.email}</span>
      {hasInvite && <button className="button primary" disabled={inviteBusy} onClick={async () => {
        await acceptInvite();
        setHasInvite(new URLSearchParams(location.search).has("invite"));
      }}>Accept project invitation</button>}
      {projects && localRoots.length > 0 &&
        <button className="button" disabled={importBusy} onClick={() => void importLocal()}>Import browser projects</button>}
      <button className="button" onClick={() => void leave(client).catch(() => setError("Could not sign out. Try again."))}>Sign out</button>
    </div>
    {error && <p role="alert" className={styles.session}>{error}</p>}
    {projects ? <Tracker items={Object.values(projects).flatMap(entry => entry.items)} saveProject={persist}
      canEdit={id => administrator || ["admin", "editor"].includes(projects[id]?.members[user.uid])}
      accessPanel={id => projects[id] && <UserAccess key={id} client={client} id={id} project={projects[id]} uid={user.uid} administrator={administrator} />} />
      : <main id="main-content" className={styles.main}>Loading projects…</main>}
  </>;
}

function UserAccess({client, id, project, uid, administrator}: {client: Client; id: string; project: Project; uid: string; administrator: boolean}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const admin = administrator || project.members[uid] === "admin";
  async function change(map: "members" | "invites", key: string, value: Role | ReturnType<typeof deleteField>) {
    setMessage("");
    try {
      await updateDoc(doc(client.db, "trackerProjects", id), new FieldPath(map, key), value);
      return true;
    } catch { setMessage("Could not update access. Try again."); return false; }
  }
  function showLink(inviteRole: Role) {
    setLink(`${location.origin}/?${new URLSearchParams({invite: id, role: inviteRole})}`);
  }
  return <details className={styles.panel}>
    <summary>User Access · {administrator ? "Administrator" : roles[project.members[uid]]}</summary>
    <ul className={styles.tree}>
      {Object.entries(project.members).map(([member, memberRole]) => <li className={styles.row} key={member}>
        <span>{member === uid ? "You" : member === project.owner ? "Project owner" : member}</span>
        {admin && member !== project.owner ? <div className={styles.actions}>
          <select aria-label={`Role for ${member}`} value={memberRole} onChange={e => void change("members", member, e.target.value as Role)}>
            {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select><button className="button" onClick={() => void change("members", member, deleteField())}>Remove access</button>
        </div> : <span>{roles[memberRole]}</span>}
      </li>)}
    </ul>
    {admin && <>
      <form onSubmit={async event => {
        event.preventDefault();
        const invited = email.trim().toLowerCase();
        if (await change("invites", invited, role)) { setEmail(""); showLink(role); }
      }}>
        <div className={styles.fields}>
          <label>Invite email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>Invitation role<select value={role} onChange={e => setRole(e.target.value as Role)}>
            {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        <button className="button primary">Create invitation</button>
      </form>
      {link && <div className={styles.fields}><label>Invitation link<input readOnly value={link} onFocus={e => e.target.select()} /></label></div>}
      <ul className={styles.tree}>{Object.entries(project.invites).map(([invited, inviteRole]) => <li className={styles.row} key={invited}>
        <span>{invited} · {roles[inviteRole]} · Pending</span>
        <div className={styles.actions}><button className="button" onClick={() => showLink(inviteRole)}>Show link</button><button className="button" onClick={() => void change("invites", invited, deleteField())}>Revoke</button></div>
      </li>)}</ul>
    </>}
    {message && <p role="alert">{message}</p>}
  </details>;
}
