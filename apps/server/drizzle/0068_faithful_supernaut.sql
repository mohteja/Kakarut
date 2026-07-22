CREATE TABLE "ingredient_produksi_branches" (
	"ingredient_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "ingredient_produksi_branches_ingredient_id_branch_id_pk" PRIMARY KEY("ingredient_id","branch_id")
);
--> statement-breakpoint
ALTER TABLE "ingredient_produksi_branches" ADD CONSTRAINT "ingredient_produksi_branches_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_produksi_branches" ADD CONSTRAINT "ingredient_produksi_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;