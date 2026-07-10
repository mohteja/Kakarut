ALTER TABLE "stock_opnames" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "system_qty" numeric(16, 6);--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "selisih" numeric(16, 6);