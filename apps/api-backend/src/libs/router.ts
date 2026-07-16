import { redis } from "@repo/redis";
import {
    adapterFor,
    ProviderError,
    type ChatRequest,
    type ChatResult,
    type ProviderTarget,
    type StreamChunk,
} from "../providers";

// Poor-man's circuit breaker: 3 failures inside 30s puts a provider on
// cooldown so an outage doesn't get hammered on every request.
const FAILURE_THRESHOLD = 3;
const COOLDOWN_SECONDS = 30;

async function isCoolingDown(providerId: string): Promise<boolean> {
    const count = await redis.get(`provider:fail:${providerId}`);
    return Number(count) >= FAILURE_THRESHOLD;
}

async function markFailure(providerId: string): Promise<void> {
    const key = `provider:fail:${providerId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, COOLDOWN_SECONDS);
}

function shouldFailover(err: unknown): boolean {
    return !(err instanceof ProviderError) || err.retryable;
}

export interface RoutedChat {
    result: ChatResult;
    target: ProviderTarget; // whoever actually served it — needed for pricing/logging
}

export async function routeChat(req: ChatRequest, targets: ProviderTarget[]): Promise<RoutedChat> {
    let lastError: unknown;

    for (const target of targets) {
        if (await isCoolingDown(target.providerId)) continue;
        try {
            const result = await adapterFor(target).chat(req, target);
            return { result, target };
        } catch (err) {
            if (!shouldFailover(err)) throw err; // the request itself is bad — no provider will fix it
            await markFailure(target.providerId);
            console.error(`[router] ${target.providerSlug} failed:`, err);
            lastError = err;
        }
    }

    throw lastError instanceof ProviderError
        ? new ProviderError(`All providers failed: ${lastError.message}`, 502, false)
        : new ProviderError("No provider available for this model", 502, false);
}

export interface RoutedStream {
    firstChunk: StreamChunk;
    rest: AsyncGenerator<StreamChunk>;
    target: ProviderTarget;
}

// Streaming failover is only possible before the first byte reaches the
// client, so we pull the first chunk here (inside the failover loop) and hand
// the caller that chunk plus the live iterator. After this returns, an
// upstream failure means terminating the stream, not retrying.
export async function routeChatStream(
    req: ChatRequest,
    targets: ProviderTarget[],
): Promise<RoutedStream> {
    let lastError: unknown;

    for (const target of targets) {
        if (await isCoolingDown(target.providerId)) continue;
        const stream = adapterFor(target).chatStream(req, target);
        try {
            const first = await stream.next();
            if (first.done) throw new ProviderError(`${target.providerSlug}: empty stream`, 502, true);
            return { firstChunk: first.value, rest: stream, target };
        } catch (err) {
            if (!shouldFailover(err)) throw err;
            await markFailure(target.providerId);
            console.error(`[router] ${target.providerSlug} stream failed:`, err);
            lastError = err;
        }
    }

    throw lastError instanceof ProviderError
        ? new ProviderError(`All providers failed: ${lastError.message}`, 502, false)
        : new ProviderError("No provider available for this model", 502, false);
}
