ALTER TABLE "branches" ADD COLUMN "central_kitchen_id" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_central_kitchen_id_branches_id_fk" FOREIGN KEY ("central_kitchen_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "branches" b SET "central_kitchen_id" = ck."id"
FROM (
  SELECT DISTINCT ON ("company_id") "id", "company_id"
  FROM "branches" WHERE "tipe" = 'central_kitchen'
  ORDER BY "company_id", "created_at" ASC
) ck
WHERE b."company_id" = ck."company_id" AND b."tipe" = 'store' AND b."central_kitchen_id" IS NULL;
