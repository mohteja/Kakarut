ALTER TABLE "sale_refunds" ADD COLUMN "disetujui_oleh" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_refund_hash" text;--> statement-breakpoint
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_disetujui_oleh_users_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;