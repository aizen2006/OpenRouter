import "./env";
import express from 'express';
import cors from "cors"
import cookieParser from "cookie-parser";
import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { redis } from "@repo/redis";
import { app as auth } from './routes/auth.routes';
import { app as apikeys } from './routes/apikeys.routes';
import { app as models } from './routes/models.routes';
import { app as users } from './routes/users.routes';
import { app as admin } from './routes/admin.routes';

const PORT = process.env.PORT ?? 3000;


const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// health probe
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

// routers
app.use('/auth',auth)
app.use('/apikeys',apikeys)
app.use('/models',models)
app.use('/users',users)
app.use('/admin',admin)



// Catch all Middleware
app.use((req, res) => {
    res.status(404).json({
        error: "Not Found",
        path: req.originalUrl
    });
});

const server = app.listen(PORT ,()=>{
    console.log(`The server is running on PORT : ${PORT}`);
} );

function shutdown(signal: string) {
    console.log(`[server] ${signal} received, closing...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
