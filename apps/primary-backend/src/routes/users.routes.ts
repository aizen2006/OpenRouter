import { Router, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import {
    creditTransactionsTable,
    db,
    generationsTable,
    modelsTable,
    providersTable,
    usersTable,
} from "@repo/db";
import { auth } from "../middleware/auth.middleware";
import { limiter } from "../middleware/ratelimit.middleware";
import { hash, verify } from "../utils/bcrypt";

const app = Router();

app.use(limiter);
app.use(auth);

function parsePagination(req: Request): { limit: number; offset: number } {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    return { limit, offset };
}

app.get("/me", async (req: Request, res: Response) => {
    try {
        const [user] = await db
            .select({
                id: usersTable.id,
                name: usersTable.name,
                email: usersTable.email,
                creditBalance: usersTable.creditBalance,
                createdAt: usersTable.created_at,
            })
            .from(usersTable)
            .where(eq(usersTable.id, req.user!.id));

        if (!user) return res.status(404).json({ message: "User not found" });

        return res.status(200).json(user);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.patch("/me", async (req: Request, res: Response) => {
    const { name, currentPassword, newPassword } = req.body;

    if (!name && !newPassword) {
        return res.status(400).json({ message: "Nothing to update" });
    }
    if (newPassword && !currentPassword) {
        return res.status(400).json({ message: "currentPassword is required to change the password" });
    }

    try {
        const updates: { name?: string; password?: string } = {};

        if (name) {
            if (typeof name !== "string" || name.trim().length === 0) {
                return res.status(400).json({ message: "Enter a valid name" });
            }
            updates.name = name.trim();
        }

        if (newPassword) {
            const [user] = await db
                .select({ password: usersTable.password })
                .from(usersTable)
                .where(eq(usersTable.id, req.user!.id));

            const isValid = user && (await verify(currentPassword, user.password));
            if (!isValid) {
                return res.status(401).json({ message: "Current password is incorrect" });
            }
            updates.password = await hash(newPassword);
        }

        await db.update(usersTable).set(updates).where(eq(usersTable.id, req.user!.id));

        return res.status(200).json({ message: "Profile updated successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.get("/me/generations", async (req: Request, res: Response) => {
    const { limit, offset } = parsePagination(req);
    try {
        const generations = await db
            .select({
                id: generationsTable.id,
                model: modelsTable.model_slug,
                provider: providersTable.provider_slug,
                status: generationsTable.status,
                prompt_tokens: generationsTable.prompt_tokens,
                completion_tokens: generationsTable.completion_tokens,
                total_cost: generationsTable.total_cost,
                latency_ms: generationsTable.latency_ms,
                created_at: generationsTable.created_at,
            })
            .from(generationsTable)
            .innerJoin(modelsTable, eq(modelsTable.id, generationsTable.modelId))
            .innerJoin(providersTable, eq(providersTable.id, generationsTable.providerId))
            .where(eq(generationsTable.userId, req.user!.id))
            .orderBy(desc(generationsTable.created_at))
            .limit(limit)
            .offset(offset);

        return res.status(200).json({ generations, limit, offset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.get("/me/transactions", async (req: Request, res: Response) => {
    const { limit, offset } = parsePagination(req);
    try {
        const transactions = await db
            .select({
                id: creditTransactionsTable.id,
                type: creditTransactionsTable.type,
                amount: creditTransactionsTable.amount,
                balance_after: creditTransactionsTable.balance_after,
                generationId: creditTransactionsTable.generationId,
                paymentId: creditTransactionsTable.paymentId,
                created_at: creditTransactionsTable.created_at,
            })
            .from(creditTransactionsTable)
            .where(eq(creditTransactionsTable.userId, req.user!.id))
            .orderBy(desc(creditTransactionsTable.created_at))
            .limit(limit)
            .offset(offset);

        return res.status(200).json({ transactions, limit, offset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

export { app };
