DROP INDEX "storage_location_ingredients_uq";--> statement-breakpoint
ALTER TABLE "storage_location_ingredients" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_location_ingredients" ADD COLUMN "supply_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_location_ingredients" ADD CONSTRAINT "storage_location_ingredients_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_location_supplies_uq" ON "storage_location_ingredients" USING btree ("storage_location_id","supply_id") WHERE "storage_location_ingredients"."supply_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "storage_location_ingredients_sup_idx" ON "storage_location_ingredients" USING btree ("supply_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_location_ingredients_uq" ON "storage_location_ingredients" USING btree ("storage_location_id","ingredient_id") WHERE "storage_location_ingredients"."ingredient_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_location_ingredients" ADD CONSTRAINT "storage_location_items_target_ck" CHECK (("storage_location_ingredients"."ingredient_id" IS NOT NULL) <> ("storage_location_ingredients"."supply_id" IS NOT NULL));