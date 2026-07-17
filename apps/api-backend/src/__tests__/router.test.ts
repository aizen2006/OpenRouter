import { afterAll, expect, test } from "bun:test";
import { redis } from "@repo/redis";
import { routeChat, routeChatStream } from "../libs/router";
import { ProviderError, type ChatRequest, type ProviderTarget, type StreamChunk } from "../providers";

// The fake providers use the default openaiCompatible adapter (slug isn't in
// the adapter map) — the router/adapters are exercised for real over HTTP.
process.env.FAKETEST_API_KEY = "test-key";

const chatReq: ChatRequest = {
    messages: [{ role: "user", content: "hi" }],
    options: {},
};

const okCompletion = {
    choices: [{ message: { content: "hello from fake" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 3 },
};

const servers: ReturnType<typeof Bun.serve>[] = [];

function serve(handler: (req: Request) => Response | Promise<Response>): string {
    const srv = Bun.serve({ port: 0, fetch: handler });
    servers.push(srv);
    return `http://localhost:${srv.port}`;
}

function makeTarget(baseUrl: string): ProviderTarget {
    return {
        modelId: crypto.randomUUID(),
        providerId: crypto.randomUUID(), // fresh per test → isolated breaker state
        providerSlug: "faketest",
        baseUrl,
        providerModelId: "fake-model",
        pricePerInputToken: "0.000001",
        pricePerOutputToken: "0.000002",
        contextLength: 8192,
        maxOutputTokens: 1024,
        priority: 0,
    };
}

afterAll(async () => {
    for (const srv of servers) srv.stop(true);
    try {
        redis.destroy();
    } catch {
        // already closed
    }
});

test("fails over from a 5xx provider to a healthy one", async () => {
    let aHits = 0;
    let bHits = 0;
    const a = makeTarget(serve(() => {
        aHits++;
        return new Response("boom", { status: 500 });
    }));
    const b = makeTarget(serve(() => {
        bHits++;
        return Response.json(okCompletion);
    }));

    const { result, target } = await routeChat(chatReq, [a, b]);

    expect(result.content).toBe("hello from fake");
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
    expect(target.providerId).toBe(b.providerId);
    expect(aHits).toBe(1);
    expect(bHits).toBe(1);
});

test("does NOT fail over on a 4xx — the request itself is bad", async () => {
    const a = makeTarget(serve(() => new Response("bad request", { status: 400 })));
    let bHits = 0;
    const b = makeTarget(serve(() => {
        bHits++;
        return Response.json(okCompletion);
    }));

    let caught: unknown;
    try {
        await routeChat(chatReq, [a, b]);
    } catch (err) {
        caught = err;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).status).toBe(400);
    expect((caught as ProviderError).retryable).toBe(false);
    expect((caught as ProviderError).target?.providerId).toBe(a.providerId);
    expect(bHits).toBe(0);
});

test("throws a 502 when every provider fails", async () => {
    const a = makeTarget(serve(() => new Response("boom", { status: 503 })));

    let caught: unknown;
    try {
        await routeChat(chatReq, [a]);
    } catch (err) {
        caught = err;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).status).toBe(502);
    expect((caught as ProviderError).message).toContain("All providers failed");
});

test("circuit breaker puts a provider on cooldown after 3 failures", async () => {
    let aHits = 0;
    const a = makeTarget(serve(() => {
        aHits++;
        return new Response("boom", { status: 503 });
    }));
    const b = makeTarget(serve(() => Response.json(okCompletion)));

    for (let i = 0; i < 3; i++) {
        await routeChat(chatReq, [a, b]); // each: A fails, B serves
    }
    expect(aHits).toBe(3);

    // 4th request: A must be skipped without being called
    const { target } = await routeChat(chatReq, [a, b]);
    expect(target.providerId).toBe(b.providerId);
    expect(aHits).toBe(3);
});

test("streaming fails over before the first byte and then streams", async () => {
    const a = makeTarget(serve(() => new Response("boom", { status: 500 })));
    const sse = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "hel" } }] })}`,
        "",
        `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}`,
        "",
        "data: [DONE]",
        "",
    ].join("\n");
    const b = makeTarget(serve(() => new Response(sse, { headers: { "Content-Type": "text/event-stream" } })));

    const { firstChunk, rest, target } = await routeChatStream(chatReq, [a, b]);
    expect(target.providerId).toBe(b.providerId);

    const chunks: StreamChunk[] = [firstChunk];
    for await (const chunk of rest) chunks.push(chunk);

    const text = chunks.filter((c) => c.type === "delta").map((c: any) => c.content).join("");
    expect(text).toBe("hello");

    const done = chunks.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
        expect(done.usage).toEqual({ promptTokens: 5, completionTokens: 2 });
        expect(done.finishReason).toBe("stop");
    }
});
