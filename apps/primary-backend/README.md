# primary-backend

The **account & management API** — port **3000**. Everything except inference lives here: accounts and sessions, API keys, the public model catalog, user dashboard data, and the admin surface. The inference gateway is [api-backend](../api-backend/README.md); project overview in the [root README](../../README.md).

Browser clients authenticate with a JWT in an `httpOnly` cookie (set by sign-in). Admin routes additionally require the signed-in email to be in the `ADMIN_EMAILS` allowlist.

---

## Running

```sh
cp .env.example .env    # fill in the values
bun run src/index.ts    # or from the repo root: turbo dev --filter=primary-backend
```

The email worker is a **separate process** (`bun run worker` in `packages/cache`) — without it, verification/reset emails are queued but never sent.

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string |
| `REDIS_URL` | ✅ | Redis — token store, caches, email queue |
| `JWT_SECRET` | prod | Session signing key. Insecure fallback in dev (warning logged); refuses to boot without it in production |
| `ADMIN_EMAILS` | for /admin | Comma-separated emails allowed on admin routes |
| `FRONTEND_URL` | — | CORS origin allowed to send cookies (defaults to reflecting the request origin) |
| `RESEND_API_KEY` | worker | Transactional email (used by the worker process) |
| `SALT_ROUNDS` | — | bcrypt cost factor (default 10) |
| `API_PREFIX` | — | Generated API key prefix (default `sk_`) |
| `PORT` / `NODE_ENV` | — | Server port (3000) / `production` enables secure cookies |

---

## Route reference

### `GET /health` — no auth

```json
200 { "status": "ok", "db_ms": 12, "redis_ms": 3 }     503 { "status": "degraded" }
```

### `/auth` — public, IP rate-limited

| Method & path | Body | Behavior |
| --- | --- | --- |
| `POST /auth/sign-up` | `{ name, email, password }` | Creates the account, queues a verification email (15-min token in Redis). `201`, or `409` if the email exists |
| `POST /auth/verify-email?token=` | — | Marks the email verified, consumes the token. `400` on expired/invalid token |
| `POST /auth/resend-verification` | `{ email }` | Queues a fresh verification email. Always `200` with a neutral message — never reveals account state |
| `POST /auth/sign-in` | `{ email, password }` | Sets the JWT cookie (10 h). `401` bad credentials, `403` email not verified |
| `POST /auth/forgot-password` | `{ email }` | Queues a reset email. Always `200` — never reveals account existence |
| `POST /auth/reset-password?token=` | `{ password }` | Sets the new password, consumes the token |
| `POST /auth/logout` | — | Clears the session cookie |

### `/models` — public model catalog, cached 5 min

| Method & path | Returns |
| --- | --- |
| `GET /models` | All active models with their provider offerings |
| `GET /models/:slug` | One model, `404` if unknown/inactive |

```json
{
  "name": "Llama 3.3 70B",
  "slug": "llama-3.3-70b",
  "description": "...",
  "input_modalities": ["text"],
  "output_modalities": ["text"],
  "providers": [
    {
      "provider": "groq",
      "provider_model_id": "llama-3.3-70b-versatile",
      "price_per_input_token": "0.0000005900",
      "price_per_output_token": "0.0000007900",
      "context_length": 131072,
      "max_output_tokens": 32768
    }
  ]
}
```

### `/apikeys` — cookie auth

Keys are sha256-hashed at rest; only the 8-char prefix stays readable. The full key is returned **once**, at creation.

| Method & path | Body | Behavior |
| --- | --- | --- |
| `GET /apikeys` | — | List the user's keys (name, prefix, created/last-used/revoked timestamps) |
| `GET /apikeys/:id` | — | One key's metadata |
| `POST /apikeys` | `{ keyName }` | Create — response contains the full `apiKey` string, store it now |
| `PATCH /apikeys/:id` | `{ keyName }` | Rename |
| `DELETE /apikeys/:id` | — | Soft-revoke (`revoked_at`) **and evict the api-backend's auth cache**, so revocation is instant. `204` |

### `/users` — cookie auth

| Method & path | Query/body | Returns |
| --- | --- | --- |
| `GET /users/me` | — | `{ id, name, email, creditBalance, createdAt }` |
| `PATCH /users/me` | `{ name? }` and/or `{ currentPassword, newPassword }` | Rename and/or change password (current password verified) |
| `GET /users/me/generations` | `?limit=20&offset=0` (max 100) | Usage history, newest first: model, provider, status, tokens, cost, latency |
| `GET /users/me/transactions` | `?limit=20&offset=0` | Credit ledger, newest first: type, amount, `balance_after`, linked generation/payment |

### `/admin` — cookie auth + `ADMIN_EMAILS`

Every catalog mutation **evicts the affected Redis caches** (api-backend registry `providers:{slug}` + public catalog `catalog:models*`), so changes take effect immediately.

| Method & path | Body | Behavior |
| --- | --- | --- |
| `POST /admin/credits` | `{ email, amount }` | **Credit on-ramp** (payments stand-in). Positive grants, negative deducts; writes an `adjustment` ledger row. `400` if the balance would go negative |
| `GET /admin/providers` | — | All providers, including inactive |
| `POST /admin/providers` | `{ provider_name, provider_slug, base_url?, is_active? }` | Create. `409` on duplicate slug. For OpenAI-compatible providers `base_url` is the API root; `null` lets a bespoke adapter use its SDK default |
| `PATCH /admin/providers/:id` | `{ provider_name?, base_url?, is_active? }` | Update. Slug is immutable (it maps to the `{SLUG}_API_KEY` env var and adapter registry) |
| `GET /admin/models` | — | All models, including inactive |
| `POST /admin/models` | `{ model_name, model_slug, description?, input_modalities?, output_modalities?, is_active? }` | Create. `409` on duplicate slug |
| `PATCH /admin/models/:id` | any of the above except slug | Update |
| `GET /admin/model-providers` | — | All routes, joined to readable slugs |
| `POST /admin/model-providers` | `{ model_slug, provider_slug, provider_model_id, price_per_input_token, price_per_output_token, context_length, max_output_tokens?, priority?, is_active? }` | Create a route. Prices are decimal **strings** (per token). `409` if the pair already exists |
| `PATCH /admin/model-providers/:id` | prices / `priority` / `context_length` / `max_output_tokens` / `provider_model_id` / `is_active` | Update a route |

**Adding a brand-new model end to end:**

```sh
POST /admin/providers        # once per vendor (skip if it exists)
POST /admin/models           # the model itself
POST /admin/model-providers  # wire model → provider with prices & priority
# set {SLUG}_API_KEY in api-backend's env if the provider is new
```

---

## Middleware

| File | What it does |
| --- | --- |
| `src/middleware/auth.middleware.ts` | Verifies the JWT cookie, loads the user, requires a verified email → `req.user` |
| `src/middleware/admin.middleware.ts` | `ADMIN_EMAILS` allowlist gate (runs after auth) |
| `src/middleware/ratelimit.middleware.ts` | Per-IP limiter (`express-rate-limit`, 100 req / 15 min) on sensitive routes |

## Project structure

```
src/
├── index.ts                 boot: env check, CORS + cookies, /health, routers, shutdown
├── env.ts                   fail-fast env validation (imported first)
├── middleware/              auth / admin / ratelimit
├── routes/
│   ├── auth.routes.ts       sign-up, verify, sign-in, reset, logout
│   ├── apikeys.routes.ts    key lifecycle
│   ├── models.routes.ts     public catalog
│   ├── users.routes.ts      profile, usage history, ledger
│   └── admin.routes.ts      credits + catalog CRUD
└── utils/                   bcrypt, jwt/token hashing, key generation, email templates
```

## Notes

- Emails are queued to BullMQ (`@repo/redis`) and sent by the worker process via Resend — run `bun run worker` in `packages/cache` alongside this server.
- Verification/reset tokens are sha256-hashed, stored in Redis with a 15-minute TTL, and single-use.
- Auth responses are deliberately neutral (forgot-password, resend-verification) to avoid leaking which emails have accounts.
