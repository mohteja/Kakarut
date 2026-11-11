CREATE TABLE "cek_stok_harian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sesi_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"sesuai" boolean NOT NULL,
	"opname_session_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cek_stok_harian" ADD CONSTRAINT "cek_stok_harian_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_stok_harian" ADD CONSTRAINT "cek_stok_harian_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_stok_harian" ADD CONSTRAINT "cek_stok_harian_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cek_stok_harian" ADD CONSTRAINT "cek_stok_harian_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cek_stok_harian_sesi_bahan_uq" ON "cek_stok_harian" USING btree ("company_id","sesi_id","ingredient_id");--> statement-breakpoint
CREATE INDEX "cek_stok_harian_cabang_tanggal_idx" ON "cek_stok_harian" USING btree ("company_id","branch_id","tanggal");