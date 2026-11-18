"use client";

import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

export function firebaseClient() {
  const emulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";
  const projectId = emulator ? "demo-overview" : process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = emulator ? "demo-key" : process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!projectId || !apiKey || (!emulator && (!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || !process.env.NEXT_PUBLIC_FIREBASE_APP_ID))) return null;
  const existing = getApps().find(app => app.name === "overview");
  const app = existing ?? initializeApp({
    projectId,
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }, "overview");
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (!existing && emulator) {
    connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8180);
  }
  return { auth, db };
}
