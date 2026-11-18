export type Role = "Administrator" | "Editor" | "Viewer";
export type Member = { id: string; name: string; email: string; role: Role; status: "Active" | "Invited" | "Revoked" };
export const DEMO_PASSWORD = "Demo123!";
export const demoUsers: Member[] = [
  { id: "alex", name: "Alex Morgan", email: "admin@example.com", role: "Administrator", status: "Active" },
  { id: "jordan", name: "Jordan Lee", email: "editor@example.com", role: "Editor", status: "Active" },
  { id: "sam", name: "Sam Taylor", email: "viewer@example.com", role: "Viewer", status: "Active" },
];
export const initialMembers: Member[] = [...demoUsers,
  { id: "maya", name: "Maya Patel", email: "maya@example.com", role: "Editor", status: "Active" },
  { id: "chris", name: "Chris Wilson", email: "chris@example.com", role: "Editor", status: "Invited" },
  { id: "olivia", name: "Olivia Chen", email: "olivia@example.com", role: "Viewer", status: "Invited" },
];
export const roles: Role[] = ["Administrator", "Editor", "Viewer"];
export function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
