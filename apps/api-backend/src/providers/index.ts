import { anthropic } from "./anthropic";
import { openaiCompatible } from "./openaiCompatible";
import type { ProviderAdapter, ProviderTarget } from "./types";

// Most providers (OpenAI, Groq, Together, Fireworks, DeepSeek, Mistral...)
// speak the OpenAI chat-completions dialect, so that adapter is the default.
// Only genuinely different APIs get a bespoke entry.
const adapters: Record<string, ProviderAdapter> = {
    anthropic,
};

export function adapterFor(target: ProviderTarget): ProviderAdapter {
    return adapters[target.providerSlug] ?? openaiCompatible;
}

export * from "./types";
