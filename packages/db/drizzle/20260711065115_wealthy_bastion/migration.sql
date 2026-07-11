CREATE TYPE "credit_transaction_type" AS ENUM('purchase', 'usage', 'refund', 'bonus', 'adjustment');--> statement-breakpoint
CREATE TYPE "generation_status" AS ENUM('pending', 'success', 'error');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" uuid NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"amount" numeric(12,6) NOT NULL,
	"balance_after" numeric(12,6) NOT NULL,
	"generationId" uuid,
	"paymentId" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" uuid NOT NULL,
	"apikeyId" uuid,
	"modelId" uuid NOT NULL,
	"providerId" uuid NOT NULL,
	"status" "generation_status" DEFAULT 'pending'::"generation_status" NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric(14,8) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generations_tokens_non_negative" CHECK ("prompt_tokens" >= 0 AND "completion_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"modelId" uuid NOT NULL,
	"providerId" uuid NOT NULL,
	"provider_model_id" text NOT NULL,
	"price_per_input_token" numeric(14,10) NOT NULL,
	"price_per_output_token" numeric(14,10) NOT NULL,
	"context_length" integer NOT NULL,
	"max_output_tokens" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_providers_model_provider_unique" UNIQUE("modelId","providerId"),
	CONSTRAINT "model_providers_prices_non_negative" CHECK ("price_per_input_token" >= 0 AND "price_per_output_token" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" uuid NOT NULL,
	"amount" numeric(12,2) NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payment_status" DEFAULT 'pending'::"payment_status" NOT NULL,
	"payment_provider" text NOT NULL,
	"payment_provider_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_ref_unique" UNIQUE("payment_provider","payment_provider_ref"),
	CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider_name" text NOT NULL,
	"provider_slug" text NOT NULL UNIQUE,
	"base_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apikeys" RENAME COLUMN "apikey" TO "key_prefix";--> statement-breakpoint
ALTER TABLE "apikeys" ADD COLUMN "key_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "apikeys" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apikeys" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "input_modalities" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "output_modalities" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emailVerified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creditBalance" numeric(12,6) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "apikeys" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apikeys" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apikeys" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apikeys" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apikeys" RENAME CONSTRAINT "apikeys_apikey_key" TO "apikeys_key_hash_key";--> statement-breakpoint
ALTER TABLE "apikeys" DROP CONSTRAINT "apikeys_key_hash_key";--> statement-breakpoint
ALTER TABLE "apikeys" ADD CONSTRAINT "apikeys_key_hash_key" UNIQUE("key_hash");--> statement-breakpoint
CREATE INDEX "apikeys_userId_idx" ON "apikeys" ("userId");--> statement-breakpoint
CREATE INDEX "credit_transactions_userId_created_at_idx" ON "credit_transactions" ("userId","created_at");--> statement-breakpoint
CREATE INDEX "generations_userId_created_at_idx" ON "generations" ("userId","created_at");--> statement-breakpoint
CREATE INDEX "generations_apikeyId_idx" ON "generations" ("apikeyId");--> statement-breakpoint
CREATE INDEX "model_providers_modelId_idx" ON "model_providers" ("modelId");--> statement-breakpoint
CREATE INDEX "payments_userId_idx" ON "payments" ("userId");--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_generationId_generations_id_fkey" FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_paymentId_payments_id_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_apikeyId_apikeys_id_fkey" FOREIGN KEY ("apikeyId") REFERENCES "apikeys"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_modelId_models_id_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_providerId_providers_id_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "model_providers" ADD CONSTRAINT "model_providers_modelId_models_id_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_providers" ADD CONSTRAINT "model_providers_providerId_providers_id_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "apikeys" DROP CONSTRAINT "apikeys_userId_users_id_fkey", ADD CONSTRAINT "apikeys_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_credit_balance_non_negative" CHECK ("creditBalance" >= 0);