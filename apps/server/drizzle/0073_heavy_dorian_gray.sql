ALTER TYPE "public"."supply_beli_status" ADD VALUE 'diproses' BEFORE 'tiba';--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD COLUMN "diproses_by" uuid;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD COLUMN "diproses_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_diproses_by_users_id_fk" FOREIGN KEY ("diproses_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;