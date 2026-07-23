ALTER TABLE "ingredients" ADD COLUMN "masa_simpan_hari" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "lead_time_hari" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "exp_date" date;--> statement-breakpoint
CREATE INDEX "productions_exp_idx" ON "productions" USING btree ("branch_id","exp_date") WHERE "productions"."exp_date" IS NOT NULL;