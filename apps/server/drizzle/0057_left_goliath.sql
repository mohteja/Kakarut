CREATE TABLE "storage_location_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_location_ingredients" ADD CONSTRAINT "storage_location_ingredients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_location_ingredients" ADD CONSTRAINT "storage_location_ingredients_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_location_ingredients" ADD CONSTRAINT "storage_location_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_location_ingredients_uq" ON "storage_location_ingredients" USING btree ("storage_location_id","ingredient_id");--> statement-breakpoint
CREATE INDEX "storage_location_ingredients_ing_idx" ON "storage_location_ingredients" USING btree ("ingredient_id");