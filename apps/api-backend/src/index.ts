import "./env";
import express from "express";
import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { redis } from "@repo/redis";
import { app as chat } from "./routes/chat.routes";
import { auth } from "./middlewares/auth.middleware";
import { rateLimit } from "./middlewares/ratelimit.middleware";

const PORT = process.env.PORT ?? 3001;

const app = express();

// health probe — registered before auth so load balancers don't need a key
app.get("/health", async (_req, res) => {
    try {
        const dbStart = Date.now();
        await db.execute(sql`select 1`);
        const db_ms = Date.now() - dbStart;

        const redisStart = Date.now();
        await redis.ping();
        const redis_ms = Date.now() - redisStart;

        return res.status(200).json({ status: "ok", db_ms, redis_ms });
    } catch (error) {
        console.error("[health]", error);
        return res.status(503).json({ status: "degraded" });
    }
});

//Auth and rateLimit
app.use(auth);
app.use(rateLimit);
app.use(express.json());

//routes
app.use('/chat',chat);

// Catch all Middleware
app.use((_, res) => {
    res.status(404).json({
        error: "Not Found"
    });
});

const server = app.listen(PORT,()=>{
    console.log(`the api-server is running on port ${PORT}`)
})

function shutdown(signal: string) {
    console.log(`[server] ${signal} received, closing...`);
    server.close(() => process.exit(0));
    // don't hang forever on open connections (e.g. long streams)
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
