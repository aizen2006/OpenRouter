import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
    creditTransactionsTable,
    db,
    modelProvidersTable,
    modelsTable,
    providersTable,
    usersTable,
} from "@repo/db";
import { redis } from "@repo/redis";
import { auth } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin.middleware";
import { limiter } from "../middleware/ratelimit.middleware";

const app = Router();

app.use(limiter);
app.use(auth);
app.use(adminOnly);

// Both the api-backend registry (providers:{slug}) and the public catalog
// (catalog:models*) cache per model slug — every mutation below must evict
// the affected slugs or changes sit invisible until the TTL expires.
async function invalidateModelCaches(slugs: string[]): Promise<void> {
    const keys = ["catalog:models"];
    for (const slug of slugs) {
        keys.push(`catalog:models:${slug}`, `providers:${slug}`);
    }
    await redis.del(keys);
}

async function slugsForProvider(providerId: string): Promise<string[]> {
    const rows = await db
        .select({ slug: modelsTable.model_slug })
        .from(modelProvidersTable)
        .innerJoin(modelsTable, eq(modelsTable.id, modelProvidersTable.modelId))
        .where(eq(modelProvidersTable.providerId, providerId));
    return rows.map((r) => r.slug);
}

function isValidPrice(value: unknown): boolean {
    return typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
}

// ---------------------------------------------------------------- credits

// Manual credit on-ramp (stand-in for payments). Positive amount grants,
// negative deducts — the DB check constraint keeps balances >= 0.
app.post("/credits", async (req: Request, res: Response) => {
    const { email, amount } = req.body;
    const value = Number(amount);

    if (!email || !Number.isFinite(value) || value === 0) {
        return res.status(400).json({ message: "Send a valid `email` and non-zero `amount`" });
    }

    try {
        const [user] = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.email, email));
        if (!user) return res.status(404).json({ message: "User not found" });

        const amountStr = value.toFixed(6);

        const balance = await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(usersTable)
                .set({ creditBalance: sql`${usersTable.creditBalance} + ${amountStr}` })
                .where(eq(usersTable.id, user.id))
                .returning({ balance: usersTable.creditBalance });

            await tx.insert(creditTransactionsTable).values({
                userId: user.id,
                type: "adjustment",
                amount: amountStr,
                balance_after: updated!.balance,
            });
            return updated!.balance;
        });

        return res.status(200).json({ message: "Credits adjusted", balance });
    } catch (error) {
        const pgCode = (error as any)?.code ?? (error as any)?.cause?.code;
        if (pgCode === "23514") {
            // users_credit_balance_non_negative check
            return res.status(400).json({ message: "Adjustment would make the balance negative" });
        }
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

// -------------------------------------------------------------- providers

app.get("/providers", async (_req: Request, res: Response) => {
    try {
        const providers = await db.select().from(providersTable);
        return res.status(200).json({ providers });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.post("/providers", async (req: Request, res: Response) => {
    const { provider_name, provider_slug, base_url, is_active } = req.body;
    if (!provider_name || !provider_slug) {
        return res.status(400).json({ message: "`provider_name` and `provider_slug` are required" });
    }

    try {
        const [provider] = await db
            .insert(providersTable)
            .values({
                provider_name,
                provider_slug,
                base_url: base_url ?? null,
                is_active: is_active ?? true,
            })
            .returning();
        return res.status(201).json(provider);
    } catch (error) {
        const pgCode = (error as any)?.code ?? (error as any)?.cause?.code;
        if (pgCode === "23505") {
            return res.status(409).json({ message: "Provider slug already exists" });
        }
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

// provider_slug is deliberately immutable — the api-backend maps it to the
// {SLUG}_API_KEY env var and the adapter registry.
app.patch("/providers/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { provider_name, base_url, is_active } = req.body;

    const updates: Record<string, unknown> = {};
    if (provider_name !== undefined) updates.provider_name = provider_name;
    if (base_url !== undefined) updates.base_url = base_url;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nothing to update" });
    }

    try {
        const [provider] = await db
            .update(providersTable)
            .set(updates)
            .where(eq(providersTable.id, id))
            .returning();
        if (!provider) return res.status(404).json({ message: "Provider not found" });

        await invalidateModelCaches(await slugsForProvider(id));
        return res.status(200).json(provider);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

// ----------------------------------------------------------------- models

app.get("/models", async (_req: Request, res: Response) => {
    try {
        const models = await db.select().from(modelsTable);
        return res.status(200).json({ models });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.post("/models", async (req: Request, res: Response) => {
    const { model_name, model_slug, description, input_modalities, output_modalities, is_active } = req.body;
    if (!model_name || !model_slug) {
        return res.status(400).json({ message: "`model_name` and `model_slug` are required" });
    }

    try {
        const [model] = await db
            .insert(modelsTable)
            .values({
                model_name,
                model_slug,
                description: description ?? null,
                input_modalities: input_modalities ?? ["text"],
                output_modalities: output_modalities ?? ["text"],
                is_active: is_active ?? true,
            })
            .returning();

        await invalidateModelCaches([model!.model_slug]);
        return res.status(201).json(model);
    } catch (error) {
        const pgCode = (error as any)?.code ?? (error as any)?.cause?.code;
        if (pgCode === "23505") {
            return res.status(409).json({ message: "Model slug already exists" });
        }
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.patch("/models/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { model_name, description, input_modalities, output_modalities, is_active } = req.body;

    const updates: Record<string, unknown> = {};
    if (model_name !== undefined) updates.model_name = model_name;
    if (description !== undefined) updates.description = description;
    if (input_modalities !== undefined) updates.input_modalities = input_modalities;
    if (output_modalities !== undefined) updates.output_modalities = output_modalities;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nothing to update" });
    }

    try {
        const [model] = await db
            .update(modelsTable)
            .set(updates)
            .where(eq(modelsTable.id, id))
            .returning();
        if (!model) return res.status(404).json({ message: "Model not found" });

        await invalidateModelCaches([model.model_slug]);
        return res.status(200).json(model);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

// -------------------------------------------------------- model-providers

app.get("/model-providers", async (_req: Request, res: Response) => {
    try {
        const routes = await db
            .select({
                id: modelProvidersTable.id,
                model: modelsTable.model_slug,
                provider: providersTable.provider_slug,
                provider_model_id: modelProvidersTable.provider_model_id,
                price_per_input_token: modelProvidersTable.price_per_input_token,
                price_per_output_token: modelProvidersTable.price_per_output_token,
                context_length: modelProvidersTable.context_length,
                max_output_tokens: modelProvidersTable.max_output_tokens,
                priority: modelProvidersTable.priority,
                is_active: modelProvidersTable.is_active,
            })
            .from(modelProvidersTable)
            .innerJoin(modelsTable, eq(modelsTable.id, modelProvidersTable.modelId))
            .innerJoin(providersTable, eq(providersTable.id, modelProvidersTable.providerId));
        return res.status(200).json({ routes });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.post("/model-providers", async (req: Request, res: Response) => {
    const {
        model_slug,
        provider_slug,
        provider_model_id,
        price_per_input_token,
        price_per_output_token,
        context_length,
        max_output_tokens,
        priority,
        is_active,
    } = req.body;

    if (!model_slug || !provider_slug || !provider_model_id) {
        return res.status(400).json({
            message: "`model_slug`, `provider_slug` and `provider_model_id` are required",
        });
    }
    if (!isValidPrice(price_per_input_token) || !isValidPrice(price_per_output_token)) {
        return res.status(400).json({
            message: "Prices must be non-negative decimal strings, e.g. \"0.0000005900\"",
        });
    }
    if (!Number.isInteger(context_length) || context_length <= 0) {
        return res.status(400).json({ message: "`context_length` must be a positive integer" });
    }

    try {
        const [model] = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .where(eq(modelsTable.model_slug, model_slug));
        if (!model) return res.status(404).json({ message: "Model not found" });

        const [provider] = await db
            .select({ id: providersTable.id })
            .from(providersTable)
            .where(eq(providersTable.provider_slug, provider_slug));
        if (!provider) return res.status(404).json({ message: "Provider not found" });

        const [route] = await db
            .insert(modelProvidersTable)
            .values({
                modelId: model.id,
                providerId: provider.id,
                provider_model_id,
                price_per_input_token,
                price_per_output_token,
                context_length,
                max_output_tokens: max_output_tokens ?? null,
                priority: priority ?? 0,
                is_active: is_active ?? true,
            })
            .returning();

        await invalidateModelCaches([model_slug]);
        return res.status(201).json(route);
    } catch (error) {
        const pgCode = (error as any)?.code ?? (error as any)?.cause?.code;
        if (pgCode === "23505") {
            return res.status(409).json({ message: "This model/provider route already exists" });
        }
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.patch("/model-providers/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const {
        provider_model_id,
        price_per_input_token,
        price_per_output_token,
        context_length,
        max_output_tokens,
        priority,
        is_active,
    } = req.body;

    const updates: Record<string, unknown> = {};
    if (provider_model_id !== undefined) updates.provider_model_id = provider_model_id;
    if (price_per_input_token !== undefined) {
        if (!isValidPrice(price_per_input_token)) {
            return res.status(400).json({ message: "Invalid `price_per_input_token`" });
        }
        updates.price_per_input_token = price_per_input_token;
    }
    if (price_per_output_token !== undefined) {
        if (!isValidPrice(price_per_output_token)) {
            return res.status(400).json({ message: "Invalid `price_per_output_token`" });
        }
        updates.price_per_output_token = price_per_output_token;
    }
    if (context_length !== undefined) updates.context_length = context_length;
    if (max_output_tokens !== undefined) updates.max_output_tokens = max_output_tokens;
    if (priority !== undefined) updates.priority = priority;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nothing to update" });
    }

    try {
        const [route] = await db
            .update(modelProvidersTable)
            .set(updates)
            .where(eq(modelProvidersTable.id, id))
            .returning();
        if (!route) return res.status(404).json({ message: "Route not found" });

        const [model] = await db
            .select({ slug: modelsTable.model_slug })
            .from(modelsTable)
            .where(eq(modelsTable.id, route.modelId));
        if (model) await invalidateModelCaches([model.slug]);

        return res.status(200).json(route);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

export { app };
