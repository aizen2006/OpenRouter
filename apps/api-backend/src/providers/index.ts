import { anthropic } from "./anthropic";
import { openaiCompatible } from "./openaiCompatible";
import type { ProviderAdapter, ProviderTarget } from "./types";

const adapters: Record<string, ProviderAdapter> = {
    anthropic,
};

export function adapterFor(target: ProviderTarget): ProviderAdapter {
    return adapters[target.providerSlug] ?? openaiCompatible;
}

export * from "./types";
