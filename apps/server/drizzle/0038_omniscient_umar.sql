CREATE TABLE "ingredient_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"input_ingredient_id" uuid NOT NULL,
	"qty" numeric(12, 4) NOT NULL,
	CONSTRAINT "ingredient_components_qty_ck" CHECK ("ingredient_components"."qty" > 0),
	CONSTRAINT "ingredient_components_self_ck" CHECK ("ingredient_components"."ingredient_id" <> "ingredient_components"."input_ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "production_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty" numeric(16, 6) NOT NULL,
	"tanggal" date NOT NULL,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "min_beli" numeric(16, 6) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "bahan_produksi" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredient_components" ADD CONSTRAINT "ingredient_components_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_components" ADD CONSTRAINT "ingredient_components_input_ingredient_id_ingredients_id_fk" FOREIGN KEY ("input_ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_components_pair_uq" ON "ingredient_components" USING btree ("ingredient_id","input_ingredient_id");--> statement-breakpoint
CREATE INDEX "production_consumptions_branch_ing_idx" ON "production_consumptions" USING btree ("branch_id","ingredient_id","waktu");--> statement-breakpoint
CREATE UNIQUE INDEX "production_consumptions_row_uq" ON "production_consumptions" USING btree ("production_id","ingredient_id");