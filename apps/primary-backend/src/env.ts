// Imported FIRST in index.ts so it runs before @repo/db / @repo/redis read
// their env vars at module init — fail fast with a clear message instead.
const required = ["DATABASE_URL", "REDIS_URL"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
    console.error(`[env] Missing required environment variables: ${missing.join(", ")}`);
    console.error("[env] Copy .env.example to .env and fill in the values.");
    process.exit(1);
}

if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
        console.error("[env] JWT_SECRET is required in production — refusing to start with the insecure fallback.");
        process.exit(1);
    }
    console.warn("[env] WARNING: JWT_SECRET is not set — using an insecure fallback. Do not deploy like this.");
}
