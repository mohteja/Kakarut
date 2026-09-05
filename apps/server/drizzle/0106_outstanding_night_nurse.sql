CREATE TABLE "ingredient_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"jenis" text NOT NULL,
	"sebab" text NOT NULL,
	"detail" text NOT NULL,
	"harga_lama" numeric(14, 2),
	"harga_baru" numeric(14, 2),
	"biaya_lama" numeric(14, 2),
	"biaya_baru" numeric(14, 2),
	"oleh_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient_logs" ADD CONSTRAINT "ingredient_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_logs" ADD CONSTRAINT "ingredient_logs_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_logs" ADD CONSTRAINT "ingredient_logs_oleh_user_id_users_id_fk" FOREIGN KEY ("oleh_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredient_logs_company_bahan_idx" ON "ingredient_logs" USING btree ("company_id","ingredient_id","created_at");