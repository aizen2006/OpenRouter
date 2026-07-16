import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, modelProvidersTable, modelsTable, providersTable } from "@repo/db";
import { redis } from "@repo/redis";
import { limiter } from "../middleware/ratelimit.middleware";

const app = Router();

// Public model catalog — no auth. Cached 5 mins; admin routes that edit
// models/providers must delete catalog:* keys so changes show up immediately.
const CACHE_TTL = 300;

interface CatalogProvider {
    provider: string;
    provider_model_id: string;
    price_per_input_token: string;
    price_per_output_token: string;
    context_length: number;
    max_output_tokens: number | null;
}

interface CatalogModel {
    name: string;
    slug: string;
    description: string | null;
    input_modalities: string[];
    output_modalities: string[];
    providers: CatalogProvider[];
}

async function loadCatalog(slug?: string): Promise<CatalogModel[]> {
    const conditions = [
        eq(modelsTable.is_active, true),
        eq(modelProvidersTable.is_active, true),
        eq(providersTable.is_active, true),
    ];
    if (slug) conditions.push(eq(modelsTable.model_slug, slug));

    const rows = await db
        .select({
            name: modelsTable.model_name,
            slug: modelsTable.model_slug,
            description: modelsTable.description,
            input_modalities: modelsTable.input_modalities,
            output_modalities: modelsTable.output_modalities,
            provider: providersTable.provider_slug,
            provider_model_id: modelProvidersTable.provider_model_id,
            price_per_input_token: modelProvidersTable.price_per_input_token,
            price_per_output_token: modelProvidersTable.price_per_output_token,
            context_length: modelProvidersTable.context_length,
            max_output_tokens: modelProvidersTable.max_output_tokens,
        })
        .from(modelsTable)
        .innerJoin(modelProvidersTable, eq(modelProvidersTable.modelId, modelsTable.id))
        .innerJoin(providersTable, eq(providersTable.id, modelProvidersTable.providerId))
        .where(and(...conditions));

    const bySlug = new Map<string, CatalogModel>();
    for (const row of rows) {
        let model = bySlug.get(row.slug);
        if (!model) {
            model = {
                name: row.name,
                slug: row.slug,
                description: row.description,
                input_modalities: row.input_modalities,
                output_modalities: row.output_modalities,
                providers: [],
            };
            bySlug.set(row.slug, model);
        }
        model.providers.push({
            provider: row.provider,
            provider_model_id: row.provider_model_id,
            price_per_input_token: row.price_per_input_token,
            price_per_output_token: row.price_per_output_token,
            context_length: row.context_length,
            max_output_tokens: row.max_output_tokens,
        });
    }
    return [...bySlug.values()];
}

app.get("/", limiter, async (_req: Request, res: Response) => {
    try {
        const cached = await redis.get("catalog:models");
        if (cached !== null) return res.status(200).json({ models: JSON.parse(cached) });

        const models = await loadCatalog();
        await redis.setEx("catalog:models", CACHE_TTL, JSON.stringify(models));

        return res.status(200).json({ models });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

app.get("/:slug", limiter, async (req: Request, res: Response) => {
    const slug = req.params.slug as string;
    try {
        const cacheKey = `catalog:models:${slug}`;
        const cached = await redis.get(cacheKey);
        if (cached !== null) return res.status(200).json(JSON.parse(cached));

        const [model] = await loadCatalog(slug);
        if (!model) return res.status(404).json({ message: "Model not found" });

        await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(model));
        return res.status(200).json(model);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

export { app };
