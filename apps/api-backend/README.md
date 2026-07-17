# api-backend

The inference gateway — serves `POST /chat/completions` on port **3001**, authenticated with an `X-API-Key` header. See the [root README](../../README.md) for the project overview and setup.

## Request pipeline

```
User Request
│
├── Auth middleware                          src/middlewares/auth.middleware.ts
│     ├── validate key format, sha256 hash lookup
│     ├── Redis cache (10 min TTL), revocation-aware
│     └── throttled last_used_at tracking
│
├── Rate limiter                             src/middlewares/ratelimit.middleware.ts
│     └── fixed window per key in Redis (100 req/min)
│
├── Credit check                             src/libs/usage.ts
│     └── 402 when the balance is empty (soft floor)
│
├── Provider registry                        src/libs/ProviderRegistry.ts
│     ├── model slug → active providers, priority-ordered
│     └── one joined query, Redis-cached 5 min
│         (admin mutations evict providers:{slug})
│
├── Router                                   src/libs/router.ts
│     ├── walk providers in priority order
│     ├── skip providers on cooldown (circuit breaker:
│     │   3 failures / 30s window, Redis INCR+EXPIRE)
│     ├── fail over on 429 / 5xx / network errors
│     ├── fail fast on 4xx (the request itself is bad)
│     └── streaming: failover possible until the first
│         byte reaches the client, termination after
│
├── Provider adapters                        src/providers/
│     ├── openaiCompatible.ts  default — OpenAI, Groq,
│     │   Together, DeepSeek, anything speaking the
│     │   chat-completions dialect (raw fetch + SSE)
│     ├── anthropic.ts         official @anthropic-ai/sdk
│     └── index.ts             slug → adapter map
│         upstream keys: {SLUG}_API_KEY convention
│
├── Usage recorder                           src/libs/usage.ts
│     ├── generations row: tokens, cost, latency, provider
│     ├── credit debit + ledger entry in one transaction
│     └── fire-and-forget — off the request path
│
└── Response: JSON, or SSE when options.stream is true
```

## Adding a provider

- **OpenAI-compatible:** no code. Insert a `providers` row with its `base_url`, set `{SLUG}_API_KEY` in the env, add `model_providers` routes (via `/admin` or the seed script).
- **Different API shape:** write an adapter in `src/providers/` implementing `ProviderAdapter` (`chat` + `chatStream`) and register it in `src/providers/index.ts`.

## Remaining work

- Record failed generations (`status: "error"`) — only successes are logged today.
- Harder credit enforcement (reserve/hold instead of the soft floor).
- Health check endpoint, graceful shutdown, integration tests for router failover.
