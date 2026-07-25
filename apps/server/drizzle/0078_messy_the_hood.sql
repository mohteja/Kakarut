CREATE TABLE "ingredient_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"teks" text NOT NULL,
	"foto_url" text
);
--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "foto_hasil_url" text;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "foto_packing_url" text;--> statement-breakpoint
ALTER TABLE "ingredient_steps" ADD CONSTRAINT "ingredient_steps_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredient_steps_ingredient_idx" ON "ingredient_steps" USING btree ("ingredient_id");