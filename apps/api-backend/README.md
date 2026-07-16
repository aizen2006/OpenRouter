# Api-backend

User Request
│
├── Authentication Middleware
│     ├── Validate API Key
│     ├── Redis Cache (10 min TTL)
│     └── Cache Hit/Miss
│
├── Rate Limiter
│
├── Credit Validation
│
├── Provider Selection
│     ├── Get providers supporting the requested model
│     ├── Filter unhealthy providers
│     ├── Rank providers (latency, success rate, cost, load)
│     ├── Load balancer selects the best candidate
│     └── Fallback if the selected provider fails
│
├── Provider Adapter
│     └── Send request to the selected provider
│
├── Usage Recorder
│     ├── Record tokens, latency, provider, cost, etc.
│     └── Deduct user credits
│
└── Return Response