import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Overview — Project Tracker", description: "Organize projects, manage activities, and track progress." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body></html>;
}

