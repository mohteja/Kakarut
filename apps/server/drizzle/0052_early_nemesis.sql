CREATE TYPE "public"."supply_kirim_status" AS ENUM('dikirim', 'diterima');--> statement-breakpoint
ALTER TYPE "public"."dokumen_jenis" ADD VALUE 'kiriman_perlengkapan';--> statement-breakpoint
ALTER TYPE "public"."dokumen_jenis" ADD VALUE 'opname_perlengkapan';--> statement-breakpoint
ALTER TYPE "public"."supply_mutasi_tipe" ADD VALUE 'kirim';--> statement-breakpoint
ALTER TYPE "public"."supply_mutasi_tipe" ADD VALUE 'terima';--> statement-breakpoint
CREATE TABLE "supply_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dari_branch_id" uuid NOT NULL,
	"ke_branch_id" uuid NOT NULL,
	"supply_id" uuid NOT NULL,
	"qty" numeric(16, 3) NOT NULL,
	"status" "supply_kirim_status" DEFAULT 'dikirim' NOT NULL,
	"catatan" text,
	"user_id" uuid,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	"diterima_by" uuid,
	"diterima_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD COLUMN "status" "penyesuaian_status" DEFAULT 'disetujui' NOT NULL;--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD COLUMN "system_qty" numeric(16, 3);--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD COLUMN "qty_fisik" numeric(16, 3);--> statement-breakpoint
ALTER TABLE "supply_transfers" ADD CONSTRAINT "supply_transfers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_transfers" ADD CONSTRAINT "supply_transfers_dari_branch_id_branches_id_fk" FOREIGN KEY ("dari_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_transfers" ADD CONSTRAINT "supply_transfers_ke_branch_id_branches_id_fk" FOREIGN KEY ("ke_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_transfers" ADD CONSTRAINT "supply_transfers_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_transfers" ADD CONSTRAINT "supply_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_transfers" ADD CONSTRAINT "supply_transfers_diterima_by_users_id_fk" FOREIGN KEY ("diterima_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supply_transfers_ke_status_idx" ON "supply_transfers" USING btree ("ke_branch_id","status");