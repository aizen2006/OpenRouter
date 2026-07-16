import type { NextFunction, Request, Response } from "express";
import { redis } from "@repo/redis";

const WINDOW = 60; // seconds
const LIMIT = 100; // requests per minute

export async function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction
) {
    if (!req.apiKey) {
        return res.status(401).json({
        message: "Unauthorized",
        });
    }

    const key = `ratelimit:${req.apiKey.id}`;
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / WINDOW);
    const redisKey = `${key}:${window}`;

    try {
        const requests = await redis.incr(redisKey);

        if (requests === 1) {
        await redis.expire(redisKey, WINDOW);
        }

        if (requests > LIMIT) {
        const ttl = await redis.ttl(redisKey);

        res.setHeader("Retry-After", ttl);
        res.setHeader("X-RateLimit-Limit", LIMIT);
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("X-RateLimit-Reset", now + ttl);

        return res.status(429).json({
            message: "Rate limit exceeded",
        });
        }

        const ttl = await redis.ttl(redisKey);

        res.setHeader("X-RateLimit-Limit", LIMIT);
        res.setHeader("X-RateLimit-Remaining", LIMIT - requests);
        res.setHeader("X-RateLimit-Reset", now + ttl);

        next();
    } catch (error) {
        console.error(error);

        return res.status(500).json({
        message: "Internal Server Error",
        });
    }
}