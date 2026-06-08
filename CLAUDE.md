# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TRAKON — a production-management tool that visualizes the "ball" (who currently holds responsibility) on a vertical schedule and detects stalls. pnpm monorepo, single deployable app (`@trakon/web`). Phase 0 (MVP) is complete; the codebase is in commercial-deploy prep.

Docs are authoritative and layered: **基本原則 > PRD (`docs/prd/`) > 基本設計書 (`docs/design/00-index.md` … `06-*`) > implementation**. When a design decision is unclear, read the design chapter referenced in code comments (they cite sections like `§3.3`, `§5.3.7`). Code comments and docs are in Japanese.

## Commands

Run from repo root unless noted. Node 20–22 (`.nvmrc`), pnpm 10.

| Command | Purpose |
|---|---|
| `pnpm dev` | Start FE (Vite :5173) + API (Hono :3001) together. Vite proxies `/api` → Hono. |
| `pnpm build` | Build `@trakon/web` (Vite SPA + esbuild server bundle). |
| `pnpm lint` / `pnpm type-check` / `pnpm test` | Run across all workspaces in parallel. |
| `pnpm db:generate` | Regenerate Prisma client. **Required after install / schema changes.** |
| `pnpm db:deploy` | Apply existing migrations to local DB non-interactively (use for setup/local rebuild). |
| `pnpm db:migrate` | Create a new migration (schema-change dev). May hang on a confirm prompt due to the `@unique` vs. raw partial-index diff — prefer `db:deploy` for plain apply. |
| `pnpm db:studio` | Prisma Studio. |

Run a single test (vitest): `pnpm --filter @trakon/web test <path-or-name-pattern>`, e.g. `pnpm --filter @trakon/web test plans` or `... test server/routes/v1/plans.test.ts`. Tests are colocated as `*.test.ts`.

CI (`.github/workflows/ci.yml`) runs `prisma format --check`, lint, type-check, test. Lint is zero-warnings (`--max-warnings 0`), so fix warnings.

### Worktree / fresh-checkout setup
A new worktree or clone needs `pnpm install` **and** `pnpm db:generate` before type-check/build will pass (the Prisma client is generated, not committed). `apps/web/.env.local` holds all real env values and is gitignored — it exists only in the main checkout, not in worktrees. Full local stack (Supabase via Docker) setup is in `README.md`.

## Architecture

### Monorepo layout
- `apps/web` — the only app. Contains **both** the React SPA (`src/`) and the Hono API (`server/`).
- `packages/db` (`@trakon/db`) — Prisma schema, migrations, and the shared `prisma` client singleton.
- `packages/shared` (`@trakon/shared`) — FE/BE-shared Zod schemas, types, constants, and **domain logic** (`domain/ballHolder.ts`).

Workspace packages export raw TypeScript (`exports` → `./src/index.ts`), not compiled JS. This matters for the build (see below).

### Backend: Hono on Vercel
`server/app.ts` builds the Hono app and mounts versioned routes under `/api/v1`. Layering per feature:

`routes/v1/*` (HTTP + Zod parse + middleware chain) → `services/*` (domain logic, returns DTOs) → `@trakon/db` Prisma. `schemas/*` holds the Zod request schemas; `lib/*` holds cross-cutting helpers (env, errors, mailer, tokens, supabaseAdmin, sentry).

**Auth/authz is a middleware chain, not RLS** (Postgres RLS is intentionally unused; all authorization goes through the backend):
1. `requireAuth()` — verifies the Supabase RS256 JWT against the remote JWKS, sets `c.var.authUser`.
2. `attachCurrentUserId()` — resolves `users.id` from the auth user, sets `c.var.currentUserId` (404 `PROFILE_NOT_COMPLETED` if no profile).
3. `requireProjectMember()` / `requireProjectDirector()` — membership/role gate, sets `c.var.project`.

**Authorization failures collapse to 404** (existence and non-membership are deliberately indistinguishable). Throw `ApiException(code, status, message, details?)` from `lib/errors.ts` for errors; `middleware/error.ts` renders the `{ error: { code, message } }` envelope. Success responses use `{ data, meta?, warnings? }`.

### The "ball" domain model
The core concept lives in `packages/shared/src/domain/ballHolder.ts` (design `§2.6`). A `Plan` has `from`/`to` members; the current ball holder is **derived** from the latest `BallEvent` (`tossed` / `completed` / `toss_undone`), not stored. `deriveBallHolder()` and `pickLatestBallEvent()` are shared by FE and BE — change them in one place. Prisma models: `User, Project, ProjectMember, ProjectItem, Plan, BallEvent, Invitation, OAuthIdentity, AuditLog, ShareLink`.

### Frontend: Vite SPA
React 18 + React Router v6 (`src/App.tsx`), TanStack Query for server state, Zustand for client state, Tailwind v4 + shadcn/ui (`src/components/ui/`, exempt from some lint rules). Code is organized by feature under `src/features/*` (auth, projects, plans, dashboard, invitations, shareLinks), each typically owning its own `api.ts` + pages/modals. `src/lib/api.ts` is the fetch wrapper: it injects the Supabase bearer token, prefixes `/api/v1`, unwraps `{ data }`, and throws `ApiClientError`. Auth/session uses `@supabase/supabase-js` client-side; the share flow (`/share/:token`) and invitation accept (`/invitations/:token`) are unauthenticated entry points.

### Build & deploy specifics (non-obvious)
- **Server bundle**: `scripts/build-server.mjs` esbuilds `server/vercel.ts` into `server-bundle/index.js`, inlining `@trakon/*` (because they're raw TS that Vercel's Node runtime can't run) while keeping `@prisma/client` etc. external for nft tracing. `api/index.ts` re-exports this bundle as **named HTTP-method exports** (`GET`/`POST`/…) so Vercel runs it as a Web handler — this avoids a body-streaming 504 with `@hono/node-server` on serverless.
- **Prisma + serverless**: `packages/db/src/index.ts` rewrites `DATABASE_URL` to add `pgbouncer=true` (and `connection_limit=1` on Vercel) for the Supabase transaction pooler. Don't hand-edit the connection string assuming a plain URL.
- **Deploy trigger**: PRs → Vercel Preview; `main` merge stays Preview-only; **publishing a GitHub Release** runs `release-deploy.yml` (prisma migrate deploy + `vercel --prod`, region `hnd1`). Production does not deploy on merge.

### Conventions
- ESM throughout; server imports use explicit `.js` extensions (e.g. `'./app.js'`) even for `.ts` source.
- `@/` aliases `apps/web/src`.
- `consistent-type-imports` is enforced (use `import type`).
- Comments and design docs are Japanese; match that when editing existing files.
