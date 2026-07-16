import type { Request, Response , NextFunction} from "express";
import { apikeysTable, db } from '@repo/db';
import { eq } from "drizzle-orm";
import { hashToken } from "../libs/hash";


export async function auth(req:Request,res:Response,next:NextFunction){
    const apiKey = req.headers["x-api-key"] as string;
    // validation
    if(!apiKey){
        return res.status(400).json({
            message:"Please send a valid ApiKey"
        })
    }
    // Authentication
    try {
        const [info] = await db.select({id:apikeysTable.id,userId:apikeysTable.userId}).from(apikeysTable).where(eq(apikeysTable.key_hash,hashToken(apiKey)))
        if(!info){
            return res.status(401).json({
                message:"Please send a valid ApiKey"
            })
        }
        req.apiKey = {
            id:info.id,
            apiKey:apiKey,
            userId:info.userId
        }
        return next();
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message:"Internal Server Error"
        })
    }
}