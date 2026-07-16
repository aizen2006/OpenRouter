import { db, modelProvidersTable, modelsTable, providersTable } from "@repo/db";
import { redis } from "@repo/redis";
import { and, desc, eq } from "drizzle-orm";
import type { ProviderTarget } from "../providers/types";

const CACHE_TTL = 300; // seconds — safety net; delete `providers:{slug}` on admin edits

// Returns the active providers that can serve this model, best-priority first.
// Empty array ⇒ the model is unknown, discontinued, or has no active provider.
export async function resolveProviders(modelSlug: string): Promise<ProviderTarget[]> {
    const cacheKey = `providers:${modelSlug}`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) return JSON.parse(cached);

    const targets: ProviderTarget[] = await db
        .select({
            modelId: modelsTable.id,
            providerId: providersTable.id,
            providerSlug: providersTable.provider_slug,
            baseUrl: providersTable.base_url,
            providerModelId: modelProvidersTable.provider_model_id,
            pricePerInputToken: modelProvidersTable.price_per_input_token,
            pricePerOutputToken: modelProvidersTable.price_per_output_token,
            contextLength: modelProvidersTable.context_length,
            maxOutputTokens: modelProvidersTable.max_output_tokens,
            priority: modelProvidersTable.priority,
        })
        .from(modelsTable)
        .innerJoin(modelProvidersTable, eq(modelProvidersTable.modelId, modelsTable.id))
        .innerJoin(providersTable, eq(providersTable.id, modelProvidersTable.providerId))
        .where(
            and(
                eq(modelsTable.model_slug, modelSlug),
                eq(modelsTable.is_active, true),
                eq(modelProvidersTable.is_active, true),
                eq(providersTable.is_active, true),
            ),
        )
        .orderBy(desc(modelProvidersTable.priority));

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(targets));
    return targets;
}
