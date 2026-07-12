ALTER TYPE "public"."branch_tipe" ADD VALUE 'kantor';--> statement-breakpoint
CREATE TABLE "menu_branches" (
	"menu_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "menu_branches_menu_id_branch_id_pk" PRIMARY KEY("menu_id","branch_id")
);
--> statement-breakpoint
ALTER TABLE "menu_branches" ADD CONSTRAINT "menu_branches_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_branches" ADD CONSTRAINT "menu_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "companies" SET "plan" = 'pro' WHERE "id" IN (SELECT "company_id" FROM "branches" GROUP BY "company_id" HAVING count(*) > 1);--> statement-breakpoint
UPDATE "companies" SET "plan" = 'lite' WHERE "plan" = 'free';
