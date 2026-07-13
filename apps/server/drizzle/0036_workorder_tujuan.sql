ALTER TABLE "productions" ADD COLUMN "tujuan_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_tujuan_branch_id_branches_id_fk" FOREIGN KEY ("tujuan_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
