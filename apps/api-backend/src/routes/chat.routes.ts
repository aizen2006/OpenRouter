import express, { type Request, type Response } from "express";
import type { Message, Options } from "../types/types";
import { resolveProviders } from "../libs/ProviderRegistry";
import { routeChat, routeChatStream } from "../libs/router";
import { getCreditBalance, recordFailedGeneration, recordGeneration } from "../libs/usage";
import { ProviderError, type ChatRequest, type StreamChunk, type Usage } from "../providers";

const app = express();

const VALID_ROLES = new Set(["system", "user", "assistant", "tool"]);

// Validation helper
function validationError(messages: unknown, model: unknown): string | null {
    if (typeof model !== "string" || !model) return "`model` is required";
    if (!Array.isArray(messages) || messages.length === 0) {
        return "`messages` must be a non-empty array";
    }
    for (const m of messages) {
        if (!m || !VALID_ROLES.has(m.role) || typeof m.content !== "string") {
            return "each message needs a valid `role` and string `content`";
        }
    }
    return null;
}

app.post("/completions", async (req: Request, res: Response) => {
    const messages: Message[] = req.body.messages;
    const model: string = req.body.model;
    const options: Options = req.body.options ?? {};

    const invalid = validationError(messages, model);
    if (invalid) return res.status(400).json({ error: invalid });

    const startedAt = Date.now();

    try {
        // Checks models continuity
        const targets = await resolveProviders(model);
        if (targets.length === 0) {
            return res.status(404).json({ error: `Model '${model}' not found or discontinued` });
        }
        // Check's user's balances
        const balance = await getCreditBalance(req.apiKey!.userId);
        if (balance <= 0) {
            return res.status(402).json({ error: "Insufficient credits" });
        }

        const chatReq: ChatRequest = { messages, options };
        
        // Helper for Record's generation

        const record =(usage: Usage, target: Parameters<typeof recordGeneration>[0]["target"]) =>
            recordGeneration({
                userId: req.apiKey!.userId,
                apikeyId: req.apiKey!.id,
                target,
                usage,
                latencyMs: Date.now() - startedAt,
            }).catch((err) => console.error("[usage] failed to record generation:", err));

        // Check's if streaming true
        if (options.stream) {
            const { firstChunk, rest, target } = await routeChatStream(chatReq, targets);

            // header's for SSE
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders(); // send's the header's before stream arive's
            
            // Streaming helper function
            const writeChunk = (chunk: StreamChunk) => {
                if (chunk.type === "delta") {
                    res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
                } else {
                    res.write(
                        `data: ${JSON.stringify({
                            usage: {
                                prompt_tokens: chunk.usage.promptTokens,
                                completion_tokens: chunk.usage.completionTokens,
                            },
                            finish_reason: chunk.finishReason,
                        })}\n\n`,
                    );
                    // After stream's ended record's generations
                    record(chunk.usage, target);
                }
            };

            try {
                writeChunk(firstChunk);
                for await (const chunk of rest) writeChunk(chunk);
                res.write("data: [DONE]\n\n");
            } catch (err) {
                // First bytes already went out — can't fail over, only terminate.
                console.error("[chat] stream terminated:", err);
                res.write(`data: ${JSON.stringify({ error: "Upstream provider failed mid-stream" })}\n\n`);
            }
            return res.end();
        }
        // For Non Streaming Call's 
        const { result, target } = await routeChat(chatReq, targets);
        record(result.usage, target);

        return res.json({
            model,
            provider: target.providerSlug,
            content: result.content,
            finish_reason: result.finishReason,
            usage: {
                prompt_tokens: result.usage.promptTokens,
                completion_tokens: result.usage.completionTokens,
            },
        });
    } catch (err) {
        console.error("[chat] request failed:", err);
        if (err instanceof ProviderError) {
            if (err.target) {
                recordFailedGeneration({
                    userId: req.apiKey!.userId,
                    apikeyId: req.apiKey!.id,
                    target: err.target,
                    latencyMs: Date.now() - startedAt,
                    errorMessage: err.message,
                }).catch((e) => console.error("[usage] failed to record error generation:", e));
            }
            // 4xx from the provider is the caller's problem (bad params, too long);
            // everything else means we couldn't serve the request.
            const status = !err.retryable && err.status >= 400 && err.status < 500 ? err.status : 502;
            return res.status(status).json({ error: err.message });
        }
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

export { app };
