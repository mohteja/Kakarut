ALTER TABLE "shifts" ADD COLUMN "selisih_status" "penyesuaian_status";--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "selisih_alasan" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "disetujui_oleh" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "disetujui_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "tolak_alasan" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_disetujui_oleh_users_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;