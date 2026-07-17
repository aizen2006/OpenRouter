import Anthropic from "@anthropic-ai/sdk";
import {
    apiKeyFor,
    ProviderError,
    type ChatRequest,
    type ChatResult,
    type ProviderAdapter,
    type ProviderTarget,
    type StreamChunk,
} from "./types";

// One client per baseUrl — the router owns retries/failover, so the SDK's
// own retry loop is disabled to avoid double-retrying a downed provider.
const clients = new Map<string, Anthropic>();

function clientFor(target: ProviderTarget): Anthropic {
    const key = target.baseUrl ?? "default";
    let client = clients.get(key);
    if (!client) {
        client = new Anthropic({
            apiKey: apiKeyFor(target),
            ...(target.baseUrl && { baseURL: target.baseUrl }),
            maxRetries: 0, // disabled retry
        });
        clients.set(key, client);
    }
    return client;
}

// Anthropic takes the system prompt as a top-level param, not a message role.
function toAnthropicParams(req: ChatRequest, target: ProviderTarget) {
    const system = req.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n");

    const messages: Anthropic.MessageParam[] = req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
        }));

    const { options } = req;
    const maxTokens = Math.min(
        options.max_tokens ?? target.maxOutputTokens ?? 16000,
        target.maxOutputTokens ?? Infinity,
    );

    return {
        model: target.providerModelId,
        max_tokens: maxTokens,
        ...(system && { system }),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.top_p !== undefined && { top_p: options.top_p }),
        messages,
    };
}

function toProviderError(err: unknown, target: ProviderTarget): ProviderError {
    if (err instanceof Anthropic.RateLimitError) {
        return new ProviderError(`${target.providerSlug}: rate limited`, 429, true);
    }
    if (err instanceof Anthropic.InternalServerError) {
        return new ProviderError(`${target.providerSlug}: upstream 5xx`, err.status ?? 500, true);
    }
    if (err instanceof Anthropic.APIConnectionError) {
        return new ProviderError(`${target.providerSlug}: connection failed`, 502, true);
    }
    if (err instanceof Anthropic.APIError) {
        return new ProviderError(
            `${target.providerSlug}: ${err.message}`,
            typeof err.status === "number" ? err.status : 502,
            false,
        );
    }
    return new ProviderError(
        `${target.providerSlug}: ${err instanceof Error ? err.message : "unknown error"}`,
        502,
        true,
    );
}

// For Non Streaming Chat

async function chat(req: ChatRequest, target: ProviderTarget): Promise<ChatResult> {
    try {
        const response = await clientFor(target).messages.create(toAnthropicParams(req, target));
        const content = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
        return {
            content,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
            },
            finishReason: response.stop_reason ?? "end_turn",
        };
    } catch (err) {
        throw toProviderError(err, target);
    }
}

// Use a generator Function for Streaming Chat

async function* chatStream(req: ChatRequest, target: ProviderTarget): AsyncGenerator<StreamChunk> {
    const stream = clientFor(target).messages.stream(toAnthropicParams(req, target));
    try {
        for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                yield { type: "delta", content: event.delta.text };
            }
        }
        const final = await stream.finalMessage();
        yield {
            type: "done",
            usage: {
                promptTokens: final.usage.input_tokens,
                completionTokens: final.usage.output_tokens,
            },
            finishReason: final.stop_reason ?? "end_turn",
        };
    } catch (err) {
        throw toProviderError(err, target);
    }
}

export const anthropic: ProviderAdapter = { chat, chatStream };
