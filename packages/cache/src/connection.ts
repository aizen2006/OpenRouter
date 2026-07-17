import IORedis from "ioredis";

// BullMQ needs an ioredis connection (the node-redis client in redis.ts is
// for app-level caching). maxRetriesPerRequest: null is required by Worker.
export const bullConnection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});
