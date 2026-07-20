CREATE TYPE "public"."supply_beli_status" AS ENUM('menunggu', 'tiba', 'batal');--> statement-breakpoint
ALTER TYPE "public"."dokumen_jenis" ADD VALUE 'beli_perlengkapan';--> statement-breakpoint
CREATE TABLE "supply_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ck_branch_id" uuid NOT NULL,
	"supply_id" uuid NOT NULL,
	"qty" numeric(16, 3) NOT NULL,
	"total_harga" numeric(14, 2),
	"tujuan_branch_id" uuid,
	"status" "supply_beli_status" DEFAULT 'menunggu' NOT NULL,
	"catatan" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kirim_transfer_id" uuid,
	"tiba_by" uuid,
	"tiba_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_ck_branch_id_branches_id_fk" FOREIGN KEY ("ck_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_tujuan_branch_id_branches_id_fk" FOREIGN KEY ("tujuan_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_kirim_transfer_id_supply_transfers_id_fk" FOREIGN KEY ("kirim_transfer_id") REFERENCES "public"."supply_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_purchases" ADD CONSTRAINT "supply_purchases_tiba_by_users_id_fk" FOREIGN KEY ("tiba_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supply_purchases_ck_status_idx" ON "supply_purchases" USING btree ("ck_branch_id","status");