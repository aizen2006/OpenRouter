import { eq, and } from "drizzle-orm";
import { db, modelProvidersTable, modelsTable, providersTable } from "./index";

// Idempotent seed for the routing tables — run with `bun run seed` from
// packages/db. Prices are per-token (USD) — verify against each provider's
// current pricing page before going live.

const providers = [
    { provider_name: "Groq", provider_slug: "groq", base_url: "https://api.groq.com/openai/v1" },
    { provider_name: "OpenAI", provider_slug: "openai", base_url: "https://api.openai.com/v1" },
    // base_url null → the Anthropic adapter uses the SDK's default endpoint
    { provider_name: "Anthropic", provider_slug: "anthropic", base_url: null },
];

const models = [
    {
        model_name: "Llama 3.3 70B",
        model_slug: "llama-3.3-70b",
        description: "Meta's Llama 3.3 70B instruction-tuned model",
        input_modalities: ["text"],
        output_modalities: ["text"],
    },
    {
        model_name: "GPT-4o Mini",
        model_slug: "gpt-4o-mini",
        description: "OpenAI's small multimodal model",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
    },
    {
        model_name: "Claude Haiku 4.5",
        model_slug: "claude-haiku-4.5",
        description: "Anthropic's fastest, most cost-effective model",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
    },
];

// model_slug + provider_slug → how to call it and what it costs
const modelProviders = [
    {
        model_slug: "llama-3.3-70b",
        provider_slug: "groq",
        provider_model_id: "llama-3.3-70b-versatile",
        price_per_input_token: "0.0000005900",
        price_per_output_token: "0.0000007900",
        context_length: 131072,
        max_output_tokens: 32768,
        priority: 10,
    },
    {
        model_slug: "gpt-4o-mini",
        provider_slug: "openai",
        provider_model_id: "gpt-4o-mini",
        price_per_input_token: "0.0000001500",
        price_per_output_token: "0.0000006000",
        context_length: 128000,
        max_output_tokens: 16384,
        priority: 10,
    },
    {
        model_slug: "claude-haiku-4.5",
        provider_slug: "anthropic",
        provider_model_id: "claude-haiku-4-5",
        price_per_input_token: "0.0000010000",
        price_per_output_token: "0.0000050000",
        context_length: 200000,
        max_output_tokens: 64000,
        priority: 10,
    },
];

async function seed() {
    const providerIds = new Map<string, string>();
    for (const p of providers) {
        const [existing] = await db
            .select({ id: providersTable.id })
            .from(providersTable)
            .where(eq(providersTable.provider_slug, p.provider_slug));
        if (existing) {
            providerIds.set(p.provider_slug, existing.id);
            continue;
        }
        const [created] = await db.insert(providersTable).values(p).returning({ id: providersTable.id });
        providerIds.set(p.provider_slug, created!.id);
        console.log(`+ provider ${p.provider_slug}`);
    }

    const modelIds = new Map<string, string>();
    for (const m of models) {
        const [existing] = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .where(eq(modelsTable.model_slug, m.model_slug));
        if (existing) {
            modelIds.set(m.model_slug, existing.id);
            continue;
        }
        const [created] = await db.insert(modelsTable).values(m).returning({ id: modelsTable.id });
        modelIds.set(m.model_slug, created!.id);
        console.log(`+ model ${m.model_slug}`);
    }

    for (const mp of modelProviders) {
        const modelId = modelIds.get(mp.model_slug)!;
        const providerId = providerIds.get(mp.provider_slug)!;
        const [existing] = await db
            .select({ id: modelProvidersTable.id })
            .from(modelProvidersTable)
            .where(and(eq(modelProvidersTable.modelId, modelId), eq(modelProvidersTable.providerId, providerId)));
        if (existing) continue;

        const { model_slug, provider_slug, ...values } = mp;
        await db.insert(modelProvidersTable).values({ ...values, modelId, providerId });
        console.log(`+ ${mp.model_slug} via ${mp.provider_slug}`);
    }

    console.log("Seed complete.");
}

await seed();
process.exit(0);
