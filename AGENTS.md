## Firebase workflow

## Verification preference

For every code change, run checks appropriate to the requested behavior and inspect the results. Include relevant error paths and access checks. Fix failures and retest before reporting completion. Distinguish code/build checks, emulator tests, browser tests, and real delivery tests; never claim an unperformed check passed. Preserve existing data and design.

Always look for and use the appropriate Firebase agent skills in `.agents/skills/` for Firebase tasks. The existing Firebase project is `overview-teams-8167c`. Use Firebase Authentication (email/password and Google) and Cloud Firestore for the backend. Inspect existing project resources before creating replacements.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
