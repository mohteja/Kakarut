CREATE TABLE "ingredient_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredients" ALTER COLUMN "kategori" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ingredients" ALTER COLUMN "kategori" SET DATA TYPE text USING "kategori"::text;--> statement-breakpoint
ALTER TABLE "ingredients" ALTER COLUMN "kategori" SET DEFAULT 'lain';--> statement-breakpoint
ALTER TABLE "ingredient_categories" ADD CONSTRAINT "ingredient_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_categories_company_nama_uq" ON "ingredient_categories" USING btree ("company_id","nama");--> statement-breakpoint
DROP TYPE "public"."bahan_kategori";
