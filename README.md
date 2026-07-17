# OpenRouter (self-hosted)

**A unified interface for LLMs — self-hosted.**

One API, one API key, every model. Instead of wiring up OpenAI, Anthropic, Groq, and every other provider separately, point your app at this gateway. It routes each request to the best available provider, falls over automatically when one is down, streams the response back, and meters usage against a credit balance — with a full audit trail of what you spent, on what, and why.

This is a Turborepo/Bun monorepo. The core pipeline — **API key auth → rate limit → model resolution → provider routing with failover → completion (streaming or not) → usage recording → credit debit** — works end to end today. See [Status](#status).

## Quickstart

```ts
const response = await fetch("http://localhost:3001/chat/completions", {
  method: "POST",
  headers: {
    "X-API-Key": OPENROUTER_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "llama-3.3-70b",
    messages: [{ role: "user", content: "What model are you running on?" }],
    options: { stream: true }, // optional — SSE streaming
  }),
});
```

The gateway resolves `llama-3.3-70b` to its active providers (by priority), calls the first healthy one, and streams the answer back. Tokens are counted, cost is computed from that provider's per-token prices, and the user's credit balance is debited — all recorded in the `generations` log and the credit ledger.

## Features

- **Unified API.** One endpoint, one key, any model behind it — swap providers without touching client code.
- **Provider routing with failover.** A model isn't tied to one vendor. Back `llama-3.3-70b` with several providers, each with its own pricing, context window, and upstream model id. Requests walk the providers in priority order; retryable failures (429/5xx/network) fail over to the next, and a Redis-backed circuit breaker puts flapping providers on cooldown so an outage isn't hammered on every request.
- **Streaming.** SSE end to end, with token usage delivered on the final chunk. Failover still works up until the first byte reaches the client.
- **Usage-based billing.** Users hold a credit balance and spend it per request, priced per input/output token, per provider. Every request writes a `generation` row (tokens, cost, latency, provider) and an entry in the credit ledger — billing is audited from real request logs, not estimated.
- **Admin surface.** CRUD for providers, models, and per-provider routes (prices, priority, context limits) plus a manual credit on-ramp — all cache-invalidated so changes take effect immediately.
- **Account system.** Sign-up with email verification, JWT cookie sessions, password reset, API key management with hashed storage and instant revocation.

## Architecture

Monorepo managed with [Turborepo](https://turborepo.dev/) and [Bun](https://bun.sh/) workspaces.

```
apps/
  primary-backend/    Express — accounts, API keys, model catalog, user dashboard APIs, admin  (port 3000)
  api-backend/        Express — the inference gateway: /chat/completions                      (port 3001)
  web/                Next.js dashboard (scaffold only, not built out yet)

packages/
  db/                 Drizzle ORM schema + Postgres client, shared as @repo/db
  cache/              Redis client + BullMQ email queue/worker, shared as @repo/redis
  ui/                 Shared React components
  eslint-config/      Shared ESLint config
  typescript-config/  Shared tsconfig bases
```

### The inference path (`apps/api-backend`)

```
POST /chat/completions
  → auth        API key (X-API-Key) — sha256-hashed lookup, Redis-cached, revocation-aware
  → rate limit  fixed-window per key in Redis
  → registry    model slug → active providers, priority-ordered (one joined query, Redis-cached)
  → router      walk providers: skip cooldowns, fail over on 429/5xx/network, fail fast on 4xx
  → adapter     openaiCompatible (OpenAI, Groq, Together, DeepSeek, ...) or bespoke (Anthropic SDK)
  → respond     JSON or SSE stream
  → record      generations row + credit debit + ledger entry (async, off the request path)
```

Adding a provider that speaks the OpenAI dialect requires **zero code** — insert a row in `providers` with its `base_url`, set `{SLUG}_API_KEY` in the environment, and add routes in `model_providers`. Genuinely different APIs get an adapter in `src/providers/` (see `anthropic.ts`).

### Data model

See `packages/db/src/schema.ts`. The core relationship is `models` ↔ `providers` via `model_providers` — that junction table is what makes multi-provider routing and per-provider pricing possible. `generations` is the usage log everything else (cost, credits, dashboards) derives from; `credit_transactions` is the append-only ledger.

## API

### api-backend (`:3001`) — authenticated with `X-API-Key`

| Endpoint | Description |
| --- | --- |
| `POST /chat/completions` | Chat completion. Body: `{ model, messages, options? }` with `options.stream`, `options.temperature`, `options.top_p`, `options.max_tokens`. |

### primary-backend (`:3000`)

| Endpoint | Auth | Description |
| --- | --- | --- |
| `POST /auth/sign-up` | — | Create account, sends verification email |
| `POST /auth/verify-email?token=` | — | Verify email via token |
| `POST /auth/resend-verification` | — | Re-send the verification email |
| `POST /auth/sign-in` | — | Sets JWT `httpOnly` cookie |
| `POST /auth/forgot-password` / `POST /auth/reset-password?token=` | — | Password reset flow |
| `POST /auth/logout` | — | Clears the session cookie |
| `GET /models`, `GET /models/:slug` | — | Public model catalog with per-provider pricing |
| `GET /users/me` | cookie | Profile + credit balance |
| `PATCH /users/me` | cookie | Change name / password |
| `GET /users/me/generations` | cookie | Paginated usage history |
| `GET /users/me/transactions` | cookie | Paginated credit ledger |
| `GET/POST/PATCH /apikeys` | cookie | API key CRUD (revocation is instant — cache-evicted) |
| `POST /admin/credits` | cookie + admin | Grant/deduct credits (`{email, amount}`) |
| `GET/POST/PATCH /admin/providers` | cookie + admin | Provider CRUD |
| `GET/POST/PATCH /admin/models` | cookie + admin | Model CRUD |
| `GET/POST/PATCH /admin/model-providers` | cookie + admin | Route CRUD: prices, priority, context limits |

Admin = the signed-in user's email is in the `ADMIN_EMAILS` allowlist.

## Getting started

### Prerequisites

- [Bun](https://bun.sh/) 1.3+
- A PostgreSQL database (e.g. [Neon](https://neon.tech/))
- A Redis instance
- A [Resend](https://resend.com/) API key (transactional email)
- API keys for the upstream providers you want to serve (Groq's free tier is the fastest way to see it work)

### Install & configure

```sh
bun install
```

Copy the examples and fill them in — every variable is documented inline:

```sh
cp apps/primary-backend/.env.example apps/primary-backend/.env
cp apps/api-backend/.env.example apps/api-backend/.env
```

Provider keys follow a convention: provider slug uppercased, dashes → underscores, plus `_API_KEY` (`groq` → `GROQ_API_KEY`).

### Database

```sh
cd packages/db
bunx drizzle-kit migrate    # apply migrations to DATABASE_URL
bun run seed                # idempotent: Groq/OpenAI/Anthropic + starter models with pricing
```

> The seeded prices are snapshots — verify against each provider's pricing page before relying on them for real billing.

### Run

```sh
bun run dev                        # everything, via Turborepo
turbo dev --filter=api-backend     # or one app
```

Then: sign up, verify, create an API key from `/apikeys`, and point the Quickstart request at it.

## Status

**Working end to end** (exercised against live providers):
- The full inference pipeline described above, streaming and non-streaming, with real usage recording and credit debits.
- Accounts, email verification, password reset, API key lifecycle.
- Public model catalog, user dashboard APIs (profile, usage history, ledger).
- Admin CRUD + credit on-ramp with immediate cache invalidation.

**Known gaps / next up:**
- The BullMQ email **worker has no entry point** — verification/reset emails are queued but not processed until a worker process runs (`packages/cache/src/worker.ts`). The BullMQ connection also currently defaults to `localhost:6379` regardless of `REDIS_URL`.
- Payment-provider integration is deliberately skipped — credits are granted via `POST /admin/credits`.
- Failed generations aren't recorded yet (only successes); the credit check is a soft floor (a request can take a balance to 0, not below).
- No automated tests yet; no health checks or graceful shutdown.
- The Next.js dashboard is a scaffold.

## Tech stack

Bun · Turborepo · TypeScript · Express 5 · PostgreSQL (Drizzle ORM) · Redis · BullMQ · Resend · JWT + bcrypt · `@anthropic-ai/sdk` · Next.js (scaffold)

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
