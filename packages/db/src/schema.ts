import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    numeric,
    pgEnum,
    pgTable as tb,
    text,
    timestamp,
    unique,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
};

export const generationStatusEnum = pgEnum("generation_status", [
    "pending",
    "success",
    "error",
]);

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
    "purchase",
    "usage",
    "refund",
    "bonus",
    "adjustment",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
    "pending",
    "succeeded",
    "failed",
    "refunded",
]);

export const usersTable = tb("users", {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    email: text().notNull().unique(),
    password: text().notNull(),
    emailVerified: boolean().default(false).notNull(),
    creditBalance: numeric({ precision: 12, scale: 6 }).default("10").notNull(),
    ...timestamps,
}, (table) => [
    check("users_credit_balance_non_negative", sql`${table.creditBalance} >= 0`),
]);

export const apikeysTable = tb("apikeys", {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    apikey_name: text().notNull(),
    key_prefix: text().notNull(),
    key_hash: text().notNull().unique(),
    last_used_at: timestamp({ withTimezone: true }),
    revoked_at: timestamp({ withTimezone: true }),
    ...timestamps,
}, (table) => [
    index("apikeys_userId_idx").on(table.userId),
]);

export const providersTable = tb("providers", {
    id: uuid().primaryKey().defaultRandom(),
    provider_name: text().notNull(),
    provider_slug: text().notNull().unique(),
    base_url: text(),
    is_active: boolean().default(true).notNull(),
    ...timestamps,
});

export const modelsTable = tb("models", {
    id: uuid().primaryKey().defaultRandom(),
    model_name: text().notNull(),
    model_slug: text().notNull().unique(),
    description: text(),
    // e.g. ["text", "image"] in / ["text"] out — kept generic since providers add
    // more modalities over time and a fixed enum would need constant migrations.
    input_modalities: jsonb().$type<string[]>().default([]).notNull(),
    output_modalities: jsonb().$type<string[]>().default([]).notNull(),
    is_active: boolean().default(true).notNull(),
    ...timestamps,
});

export const modelProvidersTable = tb("model_providers", {
    id: uuid().primaryKey().defaultRandom(),
    modelId: uuid().notNull().references(() => modelsTable.id, { onDelete: "cascade" }),
    providerId: uuid().notNull().references(() => providersTable.id, { onDelete: "cascade" }),
    provider_model_id: text().notNull(),
    price_per_input_token: numeric({ precision: 14, scale: 10 }).notNull(),
    price_per_output_token: numeric({ precision: 14, scale: 10 }).notNull(),
    context_length: integer().notNull(),
    max_output_tokens: integer(),
    priority: integer().default(0).notNull(),
    is_active: boolean().default(true).notNull(),
    ...timestamps,
}, (table) => [
    unique("model_providers_model_provider_unique").on(table.modelId, table.providerId),
    index("model_providers_modelId_idx").on(table.modelId),
    check("model_providers_prices_non_negative", sql`${table.price_per_input_token} >= 0 AND ${table.price_per_output_token} >= 0`),
]);


export const generationsTable = tb("generations", {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    apikeyId: uuid().references(() => apikeysTable.id, { onDelete: "set null" }),
    modelId: uuid().notNull().references(() => modelsTable.id, { onDelete: "restrict" }),
    providerId: uuid().notNull().references(() => providersTable.id, { onDelete: "restrict" }),
    status: generationStatusEnum().notNull().default("pending"),
    prompt_tokens: integer().default(0).notNull(),
    completion_tokens: integer().default(0).notNull(),
    total_cost: numeric({ precision: 14, scale: 8 }).default("0").notNull(),
    latency_ms: integer(),
    error_message: text(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("generations_userId_created_at_idx").on(table.userId, table.created_at),
    index("generations_apikeyId_idx").on(table.apikeyId),
    check("generations_tokens_non_negative", sql`${table.prompt_tokens} >= 0 AND ${table.completion_tokens} >= 0`),
]);

export const paymentsTable = tb("payments", {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    amount: numeric({ precision: 12, scale: 2 }).notNull(),
    currency: text().default("usd").notNull(),
    status: paymentStatusEnum().notNull().default("pending"),
    payment_provider: text().notNull(),
    payment_provider_ref: text().notNull(),
    ...timestamps,
}, (table) => [
    unique("payments_provider_ref_unique").on(table.payment_provider, table.payment_provider_ref),
    index("payments_userId_idx").on(table.userId),
    check("payments_amount_positive", sql`${table.amount} > 0`),
]);

export const creditTransactionsTable = tb("credit_transactions", {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: creditTransactionTypeEnum().notNull(),
    // Positive for credits (purchase/refund/bonus), negative for debits (usage).
    amount: numeric({ precision: 12, scale: 6 }).notNull(),
    balance_after: numeric({ precision: 12, scale: 6 }).notNull(),
    generationId: uuid().references(() => generationsTable.id, { onDelete: "set null" }),
    paymentId: uuid().references(() => paymentsTable.id, { onDelete: "set null" }),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("credit_transactions_userId_created_at_idx").on(table.userId, table.created_at),
]);
