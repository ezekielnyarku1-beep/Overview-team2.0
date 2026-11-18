# Overview Teams sign-in

Users sign in with Google or email and password, then enter a six-digit code sent by Resend. On password registration the same code verifies ownership of the signup address. An already verified email still requires a new code at the next sign-in. Password reset continues to use the existing Firebase reset flow.

## Access and session state

The email-code route verifies the Firebase ID token and its revocation status. It derives the account, provider, email and primary authentication time from that token. A per-login challenge ID allows a pending screen to resume after a refresh. A cryptographically random code expires in five minutes. The server stores an HMAC, limits a challenge to five guesses and an account to five sends per hour, and enforces a 60-second resend cooldown. Resending replaces the old challenge. Delivery failure leaves the workspace locked.

Successful redemption consumes the code in a Firestore transaction. The server creates a private grant for that account and email, then returns a Firebase custom token containing the grant ID for that session. The workspace checks the grant before loading projects. Firestore independently requires a verified email, the custom sign-in provider, a matching unexpired grant and the existing project permissions. Clients cannot read or write the private verification collections. Browser storage contains only a challenge reference. Firebase manages its own sign-in state.

A verified session lasts up to 12 hours. Page refreshes preserve that session. Signing out deletes its grant before clearing the Firebase session. Returning users complete both steps again. Other signed-in devices keep their own grants.

## Existing project configuration

Use the existing Firebase project and email/password and Google providers. Firebase's public web configuration identifies the browser app. Keep the following values in server environment variables, outside source control.

- `RESEND_API_KEY` holds the existing sending key.
- `EMAIL_FROM` holds the Resend sender address. Sending to users requires a verified sending domain.
- `EMAIL_OTP_SECRET` holds a stable, high-entropy secret of at least 32 characters. Use the same value on every server instance.
- `FIREBASE_SERVICE_ACCOUNT_JSON` supplies Firebase Admin credentials when workload identity or Application Default Credentials are unavailable. The server must verify users, update signup email verification, sign custom tokens, and read and write Firestore.

## Local verification

Run `npm run typecheck`, `npm run build` and `node scripts/test-email-recovery.mjs`. From the root, run the following Firebase CLI commands against the disposable demo project.

```sh
firebase emulators:exec --project demo-overview --only auth,firestore "node scripts/test-auth.mjs"
firebase emulators:exec --project demo-overview --only auth,firestore "node scripts/test-email-mobile.mjs"
```

The browser suite uses an isolated test app, local signup and Google sign-in, the actual API and Firestore rules, and a captured Resend transport. For release, also exercise both providers against the intended Firebase configuration and receive and redeem a real Resend email. Keep deployment on hold until those checks pass.

To send one live smoke-test email, set `OVERVIEW_TEST_RECIPIENT` to an authorized test mailbox and run the mobile command above with `--live-resend` after the script filename, inside the quotes. This mode loads only the Resend key and sender from the app's local configuration and uses disposable Firebase identities and data. It reports the accepted message ID for checking the delivery event in Resend.
