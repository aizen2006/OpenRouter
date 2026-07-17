import {
    apiKeyFor,
    ProviderError,
    type ChatRequest,
    type ChatResult,
    type ProviderAdapter,
    type ProviderTarget,
    type StreamChunk,
} from "./types";

const REQUEST_TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 300_000;

// helper function

function buildBody(req: ChatRequest, target: ProviderTarget, stream: boolean) {
    const { options } = req;
    return {
        model: target.providerModelId,
        messages: req.messages,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.top_p !== undefined && { top_p: options.top_p }),
        ...(options.max_tokens !== undefined && { max_tokens: options.max_tokens }),
        ...(stream && { stream: true, stream_options: { include_usage: true } }),
    };
}

// POST Call Handler

async function post(req: ChatRequest, target: ProviderTarget, stream: boolean): Promise<Response> {
    if (!target.baseUrl) {
        throw new ProviderError(`Provider ${target.providerSlug} has no base_url`, 500, true);
    }
    const url = `${target.baseUrl.replace(/\/$/, "")}/chat/completions`;

    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKeyFor(target)}`,
            },
            body: JSON.stringify(buildBody(req, target, stream)),
            signal: AbortSignal.timeout(stream ? STREAM_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        // network failure / timeout — the provider never answered
        throw new ProviderError(
            `${target.providerSlug}: ${err instanceof Error ? err.message : "network error"}`,
            502,
            true,
        );
    }

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        throw new ProviderError(
            `${target.providerSlug} returned ${res.status}: ${body.slice(0, 500)}`,
            res.status,
            retryable,
        );
    }
    return res;
}

// For Non Streaming Chat's

async function chat(req: ChatRequest, target: ProviderTarget): Promise<ChatResult> {
    const res = await post(req, target, false);
    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    if (!choice) {
        throw new ProviderError(`${target.providerSlug}: malformed response`, 502, true);
    }
    return {
        content: choice.message?.content ?? "",
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        },
        finishReason: choice.finish_reason ?? "stop",
    };
}

// For Streaming Chat's
// Use a generator function


async function* chatStream(req: ChatRequest, target: ProviderTarget): AsyncGenerator<StreamChunk> {
    const res = await post(req, target, true);
    if (!res.body) {
        throw new ProviderError(`${target.providerSlug}: empty stream body`, 502, true);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const usage = { promptTokens: 0, completionTokens: 0 };
    let finishReason = "stop";

    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });

        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);

            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;

            let data: any;
            try {
                data = JSON.parse(payload);
            } catch {
                continue;
            }

            const delta = data.choices?.[0]?.delta?.content;
            if (delta) yield { type: "delta", content: delta };

            if (data.choices?.[0]?.finish_reason) finishReason = data.choices[0].finish_reason;
            if (data.usage) {
                usage.promptTokens = data.usage.prompt_tokens ?? 0;
                usage.completionTokens = data.usage.completion_tokens ?? 0;
            }
        }
    }

    yield { type: "done", usage, finishReason };
}

export const openaiCompatible: ProviderAdapter = { chat, chatStream };
