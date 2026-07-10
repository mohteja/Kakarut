CREATE TYPE "public"."penyesuaian_status" AS ENUM('menunggu', 'disetujui');--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "penyesuaian_status" "penyesuaian_status" DEFAULT 'disetujui' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "disetujui_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "disetujui_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "tolak_alasan" text;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_disetujui_by_users_id_fk" FOREIGN KEY ("disetujui_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;