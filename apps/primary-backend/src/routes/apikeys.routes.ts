import { Router ,type Request ,type Response } from 'express';
import { auth } from '../middleware/auth.middleware';
import createApiKey from '../utils/createAPIkey';
import { limiter } from '../middleware/ratelimit.middleware';
import { hashToken } from '../utils/token';
import { apikeysTable , db } from '@repo/db';
import { eq ,and ,isNull} from 'drizzle-orm';
import { redis } from '@repo/redis';


const app = Router();

// protected routes with rate limiting
app.use(limiter);
app.use(auth);

// get all users apikey , get a apikey , create , delete , patch

app.get("/", async (req: Request, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    try {
        const keys = await db
            .select({
                id: apikeysTable.id,
                keyName: apikeysTable.apikey_name,
                keyPrefix: apikeysTable.key_prefix,
                createdAt: apikeysTable.created_at,
                lastUsedAt: apikeysTable.last_used_at,
                revokedAt: apikeysTable.revoked_at,
            })
            .from(apikeysTable)
            .where(eq(apikeysTable.userId, userId));

        return res.status(200).json({
            keys,
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Internal Server Error",
        });
    }
});

app.get("/:id", async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const id = req.params.id as string;

    if (!userId) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    if (!id) {
        return res.status(400).json({
            message: "Invalid API key ID",
        });
    }

    try {
        const [key] = await db
            .select({
                id: apikeysTable.id,
                keyName: apikeysTable.apikey_name,
                keyPrefix: apikeysTable.key_prefix,
                createdAt: apikeysTable.created_at,
                lastUsedAt: apikeysTable.last_used_at,
                revokedAt: apikeysTable.revoked_at,
            })
            .from(apikeysTable)
            .where(
                and(
                    eq(apikeysTable.id, id),
                    eq(apikeysTable.userId, userId)
                )
            );

        if (!key) {
            return res.status(404).json({
                message: "API key not found",
            });
        }

        return res.status(200).json(key);
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Internal Server Error",
        });
    }
});

app.post('/',async(req:Request,res:Response)=>{
    //input validation
    const keyName = req.body.keyName;
    if(!keyName) return res.status(400).json({
        message:"enter a valid apikey name"
    });

    const userId = req.user?.id;
    if(!userId) return res.status(401).json({
        message:"user not authrized to do this task"
    });

    try {
        const apiKey = createApiKey();
        const hashedApiKey = hashToken(apiKey);
        const apiPrefix = apiKey.slice(0,8);
        const [key] = await db.insert(apikeysTable)
        .values({userId,apikey_name:keyName,key_prefix:apiPrefix,key_hash:hashedApiKey})
        .returning();

        if(!key){
            return res.status(500).json({
                message:"Failed to create Api key"
            })
        }

        return res.status(201).json({
            apiKey:apiKey,
            message:"Api Key created successfully"
        })
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message:"Internal Server Error"
        })
    }

});

app.patch('/:id',async(req:Request,res:Response)=>{
    // input validation
    const apiKeyId = req.params.id as string;
    const { keyName } = req.body;
    if(!keyName || !apiKeyId) return res.status(400).json({
        message: " Enter a valid api key name or id "
    });
    try {
        const [key] =  await db.update(apikeysTable)
        .set({apikey_name:keyName})
        .where(
            and(
            eq(apikeysTable.id, apiKeyId),
            eq(apikeysTable.userId, req.user!.id)
            )
        )
        .returning();

        if(!key) return res.status(404).json({
            message:"ApiKey not found"
        });

        return res.status(200).json({
            message:"Successfully changed the name of the key"
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message:"Internal Server Error"
        });
    }

});

app.delete('/:id',async(req:Request,res:Response)=>{
    const apiKeyId = req.params.id as string;
    if(!apiKeyId) return res.status(400).json({
        message:"Enter a valid apikey Id"
    });
    try {
        const [key] =  await db.update(apikeysTable)
        .set({revoked_at: new Date()})
        .where(
            and(
                eq(apikeysTable.id,apiKeyId),
                eq(apikeysTable.userId, req.user!.id),
                isNull(apikeysTable.revoked_at)
            )
        )
        .returning();

        if(!key) return res.status(404).json({
            message:"ApiKey not found"
        });

        // the api-backend caches key lookups under apiKey:{key_hash} — evict it
        // so the revocation takes effect immediately instead of after the TTL
        await redis.del(`apiKey:${key.key_hash}`);

        return res.sendStatus(204);
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message:"Internal Server Error"
        });
    }
});

export { app };