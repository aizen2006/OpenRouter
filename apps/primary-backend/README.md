# primary-backend

The account & management API — port **3000**. Handles everything except inference: accounts, sessions, API keys, the public model catalog, user dashboard data, and admin. See the [root README](../../README.md) for the project overview and setup.

## Routes

| Mount | File | Auth | What it does |
| --- | --- | --- | --- |
| `/auth` | `src/routes/auth.routes.ts` | — | Sign-up + email verification, sign-in (JWT `httpOnly` cookie), resend-verification, forgot/reset password, logout |
| `/models` | `src/routes/models.routes.ts` | — | Public model catalog with per-provider pricing (Redis-cached 5 min) |
| `/apikeys` | `src/routes/apikeys.routes.ts` | cookie | API key CRUD — sha256-hashed at rest, only the prefix is stored readable; revocation instantly evicts the api-backend's auth cache |
| `/users` | `src/routes/users.routes.ts` | cookie | `GET/PATCH /me`, paginated `/me/generations` usage history and `/me/transactions` credit ledger |
| `/admin` | `src/routes/admin.routes.ts` | cookie + `ADMIN_EMAILS` | Credit on-ramp (`POST /credits`), CRUD for providers / models / model-provider routes — every mutation evicts the registry + catalog caches |

## Middleware

- `auth.middleware.ts` — verifies the JWT cookie, loads the user, requires a verified email.
- `admin.middleware.ts` — allowlist gate: signed-in email must be in `ADMIN_EMAILS` (comma-separated).
- `ratelimit.middleware.ts` — per-IP limiter (`express-rate-limit`) on sensitive routes.

## Notes

- Emails (verification, reset) are queued to BullMQ via `@repo/redis`; a worker process must be running to actually send them — see the root README's known gaps.
- Set a real `JWT_SECRET` — the fallback in `src/utils/token.ts` is a placeholder string.
- Env vars are documented in `.env.example`.

## Remaining work

- Health check endpoint, graceful shutdown, env validation at boot.
- Integration tests (auth flows, admin cache invalidation).
