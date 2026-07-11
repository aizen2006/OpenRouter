import { createClient } from "redis";

export const redis = await createClient({
    url:process.env.REDIS_URL
}).on("error",(err)=> console.error(err)).connect();


if(!redis.isReady) throw new Error("Failed to Configure the redis Client");
