import type { Request, Response , NextFunction} from "express";
import { apikeysTable, db } from '@repo/db';
import { eq } from "drizzle-orm";
import { hashToken } from "../libs/hash";
import { redis } from "@repo/redis";

const API_KEY_CACHE_TTL = 600;
const API_KEY_REGEX = /^sk_[A-Za-z0-9_-]{64}$/;

export async function auth(req:Request,res:Response,next:NextFunction){
    const apiKey = req.get("X-API-Key");
    // validation
    if(!apiKey){
        return res.status(400).json({
            message:"Invalid API key"
        })
    }
    
    if (!API_KEY_REGEX.test(apiKey)) {
        return res.status(401).json({
            message: "Invalid API key",
        });
    }
    const hashedKey = hashToken(apiKey);
    try {

        const cache = await redis.get(`apiKey:${hashedKey}`);
    
        if(cache === null){
            // Cache miss
            const [info] = await db
            .select({id:apikeysTable.id,userId:apikeysTable.userId})
            .from(apikeysTable)
            .where(eq(apikeysTable.key_hash,hashedKey));
    
    
            if(!info){
                return res.status(401).json({
                    message:"Invalid API key"
                })
            }
            // cache the ApiKey  with a TTL of 5 mins
            await redis.setEx(`apiKey:${hashedKey}`,API_KEY_CACHE_TTL,JSON.stringify({
                apiKeyId: info.id,
                userId: info.userId,
            }));
            req.apiKey = {
                id:info.id,
                apiKey:apiKey,
                userId:info.userId
            }
            return next();
        }else{
            // Cache hit
            const key_details = JSON.parse(cache)

            req.apiKey = {
                id:key_details.apiKeyId,
                apiKey:apiKey,
                userId:key_details.userId
            }
            return next();
        }
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message:"Internal Server Error"
        });
    }
}