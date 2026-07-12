# OpenRouter (self-hosted)

**A unified interface for LLMs — self-hosted.**

One API, one API key, every model. Instead of wiring up OpenAI, Anthropic, and every other provider separately, point your app at this gateway. It routes each request to the right provider, meters usage against a credit balance, and gives you one place to see what you spent, on what, and why.

This is a Turborepo/Bun monorepo, under active development. See [Status](#status) for what's real today vs. what's designed but not wired up yet.

## Why

- **Unified API.** One endpoint, one key, any model behind it — swap providers without touching client code.
- **Provider routing.** A model isn't tied to one vendor. Register `llama-3-70b` once; back it with several providers, each with its own pricing, context window, and upstream model id, and let the gateway choose between them.
- **Usage-based billing.** No subscriptions. Users hold a credit balance and spend it per request, priced per input/output token, per provider.
- **Full observability.** Every request is logged as a `generation` — tokens in/out, cost, latency, status, and which provider actually served it. Usage and billing are audited from real request logs, not estimated.

## Quickstart (target interface)

> The completions proxy below is the interface this gateway is being built toward — it is **not implemented yet**. See [Status](#status). Auth (sign-up/sign-in/API keys) is real today.

```ts
const response = await fetch("https://your-instance.example.com/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "llama-3-70b",
    messages: [{ role: "user", content: "What model are you running on?" }],
  }),
});
```

Same request shape as the OpenAI SDK — swap the base URL and key, keep your existing code.

## Status

**Working:**
- Account system: sign-up, sign-in (JWT in an `httpOnly` cookie), logout.
- Email verification and password reset, via short-lived tokens stored in Redis and delivered by a BullMQ-backed email queue (Resend).
- Auth middleware that gates routes on a valid session + verified email.
- Rate limiting on auth endpoints.
- Database schema covering users, API keys, providers, models, per-provider model pricing, generations (usage log), credit ledger, and payments.

**Not built yet:**
- The actual completions/chat proxy that routes a request to a provider and streams a response back.
- API key issuance endpoints (schema and hashing utility exist; the route is a stub).
- Provider/model CRUD and admin-side management.
- Billing/payments integration (schema exists; no payment provider wired up).

## Architecture

This is a monorepo managed with [Turborepo](https://turborepo.dev/) and [Bun](https://bun.sh/) workspaces.

```
apps/
  primary-backend/   Express API — auth, (planned) API keys, models, users
  api-backend/        (reserved for the model-routing/completions proxy)
  web/                Next.js app (dashboard/marketing — scaffold only, not built out yet)

packages/
  db/                 Drizzle ORM schema + Postgres client, shared as @repo/db
  cache/              Redis client + BullMQ email queue/worker, shared as @repo/redis
  ui/                 Shared React components
  eslint-config/      Shared ESLint config
  typescript-config/  Shared tsconfig bases
```

**Request flow (auth, today):** `apps/primary-backend` talks to Postgres via `@repo/db` (Drizzle) and to Redis via `@repo/redis`. Verification/reset tokens live in Redis with a TTL; sending the actual email is offloaded to a BullMQ job so the request/response cycle doesn't block on an outbound email API call.

**Data model:** see `packages/db/src/schema.ts`. The core relationship is `models` ↔ `providers` via `model_providers` — that junction table is what makes multi-provider routing and per-provider pricing possible. `generations` is the usage log everything else (cost, credits) derives from.

## Tech stack

- **Runtime/tooling:** Bun, Turborepo, TypeScript
- **API:** Express 5
- **Database:** PostgreSQL via Drizzle ORM (`drizzle-kit` for migrations)
- **Cache/queue:** Redis + BullMQ
- **Email:** Resend
- **Auth:** JWT (`jsonwebtoken`) + `bcrypt` password hashing, cookie-based sessions
- **Frontend:** Next.js (scaffold)

## Getting started

### Prerequisites

- [Bun](https://bun.sh/) 1.3+
- A PostgreSQL database
- A Redis instance
- A [Resend](https://resend.com/) API key (for transactional email)

### Install

```sh
bun install
```

### Environment variables

Each app/package reads its own env vars (via `.env` files, not committed). At minimum:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `packages/db` | Postgres connection string |
| `REDIS_URL` | `packages/cache` | Redis connection string |
| `RESEND_API_KEY` | `packages/cache` | Sending verification/reset emails |
| `JWT_SECRET` | `primary-backend` | Signing session JWTs |
| `SALT_ROUNDS` | `primary-backend` | bcrypt cost factor (optional, defaults to 12) |
| `API_PREFIX` | `primary-backend` | Prefix for generated API keys (optional, defaults to `sk_`) |
| `NODE_ENV` | `primary-backend` | Toggles `secure` cookies in production |
| `PORT` | `primary-backend` | API server port (defaults to `3000`) |

### Database setup

```sh
cd packages/db
bunx drizzle-kit generate   # generate a migration from the schema
bunx drizzle-kit migrate    # apply migrations to DATABASE_URL
```

### Run

```sh
bun run dev     # runs all apps/packages in dev mode via Turborepo
```

Or target a single app:

```sh
turbo dev --filter=primary-backend
```

## Monorepo commands

| Command | Description |
| --- | --- |
| `bun run dev` | Run all apps in dev mode |
| `bun run build` | Build all apps/packages |
| `bun run lint` | Lint all apps/packages |
| `bun run check-types` | Type-check all apps/packages |
| `bun run format` | Format the repo with Prettier |

## Contributing

This is an early-stage, evolving project — expect breaking schema and API changes. Issues and PRs are welcome.
