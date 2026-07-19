CREATE TYPE "public"."supply_mutasi_tipe" AS ENUM('masuk', 'pakai', 'auto', 'koreksi');--> statement-breakpoint
CREATE TABLE "supplies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"satuan" text DEFAULT 'pcs' NOT NULL,
	"harga_beli" numeric(14, 2) DEFAULT 0 NOT NULL,
	"stok_minimum" numeric(16, 3) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"catatan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supply_id" uuid NOT NULL,
	"tipe" "supply_mutasi_tipe" NOT NULL,
	"qty" numeric(16, 3) NOT NULL,
	"total_harga" numeric(14, 2),
	"tanggal" date NOT NULL,
	"catatan" text,
	"user_id" uuid,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supply_id" uuid NOT NULL,
	"qty" numeric(16, 3) NOT NULL,
	"per_hari" integer DEFAULT 1 NOT NULL,
	"mulai" date NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"terakhir_diterapkan" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD CONSTRAINT "supply_mutations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD CONSTRAINT "supply_mutations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD CONSTRAINT "supply_mutations_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_mutations" ADD CONSTRAINT "supply_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_rules" ADD CONSTRAINT "supply_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_rules" ADD CONSTRAINT "supply_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_rules" ADD CONSTRAINT "supply_rules_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_company_nama_uq" ON "supplies" USING btree ("company_id","nama");--> statement-breakpoint
CREATE INDEX "supply_mutations_branch_supply_idx" ON "supply_mutations" USING btree ("branch_id","supply_id","tanggal");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_mutations_auto_uq" ON "supply_mutations" USING btree ("supply_id","branch_id","tanggal") WHERE "supply_mutations"."tipe" = 'auto';--> statement-breakpoint
CREATE UNIQUE INDEX "supply_rules_branch_supply_uq" ON "supply_rules" USING btree ("branch_id","supply_id");