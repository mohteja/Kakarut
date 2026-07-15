CREATE TABLE "ingredient_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"is_utama" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient_suppliers" ADD CONSTRAINT "ingredient_suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_suppliers" ADD CONSTRAINT "ingredient_suppliers_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_suppliers" ADD CONSTRAINT "ingredient_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_suppliers_pair_uq" ON "ingredient_suppliers" USING btree ("ingredient_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_suppliers_utama_uq" ON "ingredient_suppliers" USING btree ("ingredient_id") WHERE "ingredient_suppliers"."is_utama";--> statement-breakpoint
CREATE INDEX "ingredient_suppliers_company_idx" ON "ingredient_suppliers" USING btree ("company_id");