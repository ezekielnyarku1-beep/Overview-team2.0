import { FirebaseError } from "firebase/app";

export function firebaseErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) return "The request could not be completed. Please try again.";
  const messages: Record<string, string> = {
    "auth/invalid-action-code": "This email link is invalid or has already been used. Request a new link.",
    "auth/expired-action-code": "This email link has expired. Request a new link.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/email-already-in-use": "This email already has an account. Sign in or reset your password.",
    "auth/weak-password": "Choose a stronger password with at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please wait before trying again.",
    "auth/network-request-failed": "Could not reach Firebase. Check your internet connection and try again.",
    "auth/popup-blocked": "Allow the Google sign-in popup in your browser, then try again.",
    "auth/popup-closed-by-user": "Google sign-in was closed. Try again when you are ready.",
    "auth/unauthorized-domain": "This hostname is not authorized for Google sign-in. Use localhost locally, or add the deployed hostname in Firebase Authentication settings.",
    "auth/operation-not-allowed": "This sign-in provider is not enabled in Firebase Authentication.",
    "auth/account-exists-with-different-credential": "This email uses another sign-in method. Sign in with that method first.",
    "permission-denied": "Access was denied. Ask the project administrator to check your role.",
    "unavailable": "Firestore is temporarily unavailable. Check your connection and try again.",
  };
  return messages[error.code] ?? `The request could not be completed (${error.code}). Please try again.`;
}
