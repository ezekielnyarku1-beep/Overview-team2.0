"use client";
import { createContext, useContext, useState } from "react";
type DemoContextValue = { resetEmail: string; setResetEmail: (email: string) => void };
const DemoContext = createContext<DemoContextValue | null>(null);
export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [resetEmail, setResetEmail] = useState("");
  return <DemoContext.Provider value={{ resetEmail, setResetEmail }}>{children}</DemoContext.Provider>;
}
export function useDemo() { const value = useContext(DemoContext); if (!value) throw new Error("DemoProvider is required"); return value; }
