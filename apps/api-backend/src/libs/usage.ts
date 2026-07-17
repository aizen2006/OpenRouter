import { creditTransactionsTable, db, generationsTable, usersTable } from "@repo/db";
import { eq, sql } from "drizzle-orm";
import type { ProviderTarget, Usage } from "../providers";

export function computeCost(usage: Usage, target: ProviderTarget): string {
    const cost =
        usage.promptTokens * Number(target.pricePerInputToken) +
        usage.completionTokens * Number(target.pricePerOutputToken);
    return cost.toFixed(8);
}

export async function getCreditBalance(userId: string): Promise<number> {
    const [user] = await db
        .select({ creditBalance: usersTable.creditBalance })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
    return user ? Number(user.creditBalance) : 0;
}

interface RecordGenerationInput {
    userId: string;
    apikeyId: string | null;
    target: ProviderTarget;
    usage: Usage;
    latencyMs: number;
}

// Failed requests are logged for observability but never billed — we don't
// know the upstream token usage, so tokens/cost stay zero.
export async function recordFailedGeneration(
    input: Omit<RecordGenerationInput, "usage"> & { errorMessage: string },
): Promise<void> {
    await db.insert(generationsTable).values({
        userId: input.userId,
        apikeyId: input.apikeyId,
        modelId: input.target.modelId,
        providerId: input.target.providerId,
        status: "error",
        latency_ms: input.latencyMs,
        error_message: input.errorMessage.slice(0, 1000),
    });
}

// Writes the generation row, debits credits, and logs the ledger entry in one
// transaction. Called fire-and-forget after the response is sent — the user
// shouldn't wait on billing writes.
export async function recordGeneration(input: RecordGenerationInput): Promise<void> {
    const cost = computeCost(input.usage, input.target);

    await db.transaction(async (tx) => {
        const [generation] = await tx
            .insert(generationsTable)
            .values({
                userId: input.userId,
                apikeyId: input.apikeyId,
                modelId: input.target.modelId,
                providerId: input.target.providerId,
                status: "success",
                prompt_tokens: input.usage.promptTokens,
                completion_tokens: input.usage.completionTokens,
                total_cost: cost,
                latency_ms: input.latencyMs,
            })
            .returning({ id: generationsTable.id });

        const [user] = await tx
            .update(usersTable)
            .set({
                creditBalance: sql`GREATEST(${usersTable.creditBalance} - ${cost}, 0)`,
            })
            .where(eq(usersTable.id, input.userId))
            .returning({ balance: usersTable.creditBalance });

        await tx.insert(creditTransactionsTable).values({
            userId: input.userId,
            type: "usage",
            amount: `-${cost}`,
            balance_after: user!.balance,
            generationId: generation!.id,
        });
    });
}
