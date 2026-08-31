ALTER TABLE "email_verification_tokens" DROP CONSTRAINT "email_verification_tokens_token_hash_unique";--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD COLUMN "percobaan" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "email_verification_hash_idx" ON "email_verification_tokens" USING btree ("token_hash");