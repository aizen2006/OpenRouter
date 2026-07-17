# api-backend

The **inference gateway**. Serves OpenAI-style chat completions on port **3001**, authenticated with an `X-API-Key` header. Routes each request to the best available upstream provider, fails over automatically, streams responses, and bills usage against the user's credit balance.

See the [root README](../../README.md) for the project overview; [primary-backend](../primary-backend/README.md) handles accounts, API keys, and admin.

---

## Running

```sh
cp .env.example .env   # fill in the values
bun run src/index.ts   # or from the repo root: turbo dev --filter=api-backend
bun test               # integration + unit tests (needs REDIS_URL)
```

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string |
| `REDIS_URL` | ✅ | Redis — key cache, rate limits, registry cache, circuit breaker |
| `PORT` | — | Defaults to `3001` |
| `{SLUG}_API_KEY` | per provider | Upstream keys. Convention: provider slug uppercased, dashes → underscores (`groq` → `GROQ_API_KEY`) |

Boot fails fast with a clear message if a required variable is missing.

---

## API reference

### `GET /health`

No auth. Probes Postgres and Redis.

```json
200 { "status": "ok", "db_ms": 12, "redis_ms": 3 }
503 { "status": "degraded" }
```

### `POST /chat/completions`

Headers: `X-API-Key: sk_...` · `Content-Type: application/json`

**Request body**

```jsonc
{
  "model": "llama-3.3-70b",            // model_slug from the catalog (required)
  "messages": [                         // required, non-empty
    { "role": "user", "content": "Hello" }
    // roles: "system" | "user" | "assistant" | "tool"
  ],
  "options": {                          // all optional
    "stream": false,
    "temperature": 0.7,
    "top_p": 0.9,
    "max_tokens": 1024
  }
}
```

**Response (non-streaming)**

```json
{
  "model": "llama-3.3-70b",
  "provider": "groq",
  "content": "Hello! How can I help?",
  "finish_reason": "stop",
  "usage": { "prompt_tokens": 42, "completion_tokens": 12 }
}
```

`provider` is whoever actually served the request — it can differ between calls when failover kicks in.

**Response (`options.stream: true`)** — Server-Sent Events:

```
data: {"content":"Hel"}
data: {"content":"lo!"}
data: {"usage":{"prompt_tokens":42,"completion_tokens":12},"finish_reason":"stop"}
data: [DONE]
```

**Error codes**

| Status | Meaning |
| --- | --- |
| 400 | Invalid body, or the upstream rejected the request (message passed through, e.g. `max_tokens` over the model's limit) |
| 401 | Missing/invalid/revoked API key |
| 402 | Credit balance is empty |
| 404 | Unknown or discontinued model slug |
| 429 | Rate limit exceeded (100 req/min per key; `Retry-After` header set) |
| 502 | All providers for the model failed or are on cooldown |

---

## Request pipeline

```
POST /chat/completions
│
├── Auth                    src/middlewares/auth.middleware.ts
│     sha256-hash the key → Redis cache (10 min TTL) → DB fallback,
│     revoked keys filtered; throttled last_used_at tracking (1 write/min)
│
├── Rate limit              src/middlewares/ratelimit.middleware.ts
│     fixed window per key in Redis, X-RateLimit-* headers
│
├── Credit check            src/libs/usage.ts
│     402 when balance <= 0 (soft floor)
│
├── Provider registry       src/libs/ProviderRegistry.ts
│     model slug → active providers, priority-ordered
│     one joined query over models ⋈ model_providers ⋈ providers,
│     Redis-cached 5 min; admin mutations evict providers:{slug}
│
├── Router                  src/libs/router.ts
│     walk providers in priority order:
│       · skip providers on cooldown (circuit breaker — 3 failures
│         in 30s via Redis INCR+EXPIRE)
│       · 429 / 5xx / network error → mark failure, try next
│       · 4xx → fail fast (no provider can fix a bad request)
│     streaming: the first chunk is pulled inside the failover loop,
│     so failover works until the first byte reaches the client;
│     after that an upstream failure terminates the stream
│
├── Provider adapter        src/providers/
│     normalized ChatRequest → provider wire format → ChatResult/chunks
│
└── Usage recorder          src/libs/usage.ts   (fire-and-forget)
      success → generations row (tokens, cost, latency, provider)
                + credit debit + ledger entry in one DB transaction
      failure → generations row with status "error" and the message,
                zero cost, attributed to the provider that failed
```

## Provider system

| File | Role |
| --- | --- |
| `src/providers/types.ts` | `ProviderAdapter` interface, `ChatRequest`/`ChatResult`/`StreamChunk`, `ProviderError` (carries `status` + `retryable`), env-key resolution |
| `src/providers/openaiCompatible.ts` | **Default adapter** — raw fetch + SSE parsing against `{base_url}/chat/completions`. Covers OpenAI, Groq, Together, DeepSeek, Mistral, and anything else speaking the dialect |
| `src/providers/anthropic.ts` | Bespoke adapter on the official `@anthropic-ai/sdk` (system-prompt extraction, required `max_tokens`, typed error mapping). SDK retries disabled — the router owns failover |
| `src/providers/index.ts` | slug → adapter map; unknown slugs fall through to `openaiCompatible` |

**Adding a provider:**

- *OpenAI-compatible* — no code. Insert a `providers` row with its `base_url` (via `/admin/providers` or the seed script), set `{SLUG}_API_KEY`, add `model_providers` routes.
- *Different API shape* — implement `ProviderAdapter` (`chat` + `chatStream`) in `src/providers/` and register the slug in `index.ts`.

## Billing semantics

- Cost = `prompt_tokens × price_per_input_token + completion_tokens × price_per_output_token`, using the prices of the provider that **actually served** the request.
- Recording is async (after the response) — users never wait on billing writes.
- The generations log is the source of truth; `credit_transactions` is the append-only ledger with `balance_after` on every row.
- Failed requests are logged for observability but never billed.

## Project structure

```
src/
├── index.ts                     boot: env check, /health, middleware, shutdown
├── env.ts                       fail-fast env validation (imported first)
├── middlewares/
│   ├── auth.middleware.ts
│   └── ratelimit.middleware.ts
├── libs/
│   ├── ProviderRegistry.ts      model → providers resolution + cache
│   ├── router.ts                failover + circuit breaker
│   ├── usage.ts                 cost computation, generation + billing writes
│   └── hash.ts
├── providers/                   adapter layer (see above)
├── routes/
│   └── chat.routes.ts           POST /chat/completions
└── __tests__/
    ├── router.test.ts           real-HTTP failover/breaker/streaming tests
    └── usage.test.ts            cost computation
```

## Tests

`bun test` — the router tests spin up fake OpenAI-compatible providers with `Bun.serve` and exercise the real router + adapter over HTTP: failover on 5xx, fail-fast on 4xx, circuit-breaker cooldown after 3 failures, and streaming failover. Redis is required (breaker state); each test uses fresh provider UUIDs so state never collides.
