CREATE TYPE "public"."klarifikasi_status" AS ENUM('belum', 'sudah');--> statement-breakpoint
CREATE TYPE "public"."penyesuaian_kategori" AS ENUM('waste_bahan', 'waste_matang', 'waste_gagal', 'koreksi_pencatatan', 'lainnya');--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "klarifikasi_status" "klarifikasi_status";--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "penyesuaian_kategori" "penyesuaian_kategori";--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "klarifikasi_catatan" text;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "klarifikasi_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "klarifikasi_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_klarifikasi_by_users_id_fk" FOREIGN KEY ("klarifikasi_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;