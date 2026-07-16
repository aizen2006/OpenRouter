import type { Message, Options } from "../types/types";

export interface ProviderTarget {
    modelId: string;
    providerId: string;
    providerSlug: string;
    baseUrl: string | null;
    providerModelId: string;
    pricePerInputToken: string;
    pricePerOutputToken: string;
    contextLength: number;
    maxOutputTokens: number | null;
    priority: number;
}

export interface ChatRequest {
    messages: Message[];
    options: Options;
}

export interface Usage {
    promptTokens: number;
    completionTokens: number;
}

export interface ChatResult {
    content: string;
    usage: Usage;
    finishReason: string;
}

export type StreamChunk =
    | { type: "delta"; content: string }
    | { type: "done"; usage: Usage; finishReason: string };

export class ProviderError extends Error {
    constructor(
        message: string,
        public status: number,
        // 429 / 5xx / network / timeout → true (try the next provider)
        // 400 / 401 / 403 / 413 → false (the request itself is bad, fail fast)
        public retryable: boolean,
    ) {
        super(message);
        this.name = "ProviderError";
    }
}

export interface ProviderAdapter {
    chat(req: ChatRequest, target: ProviderTarget): Promise<ChatResult>;
    chatStream(req: ChatRequest, target: ProviderTarget): AsyncGenerator<StreamChunk>;
}

export function apiKeyFor(target: ProviderTarget): string {
    const envName = `${target.providerSlug.toUpperCase().replace(/-/g, "_")}_API_KEY`;
    const key = process.env[envName];
    if (!key) {
        throw new ProviderError(`Missing ${envName} for provider ${target.providerSlug}`, 500, true);
    }
    return key;
}
