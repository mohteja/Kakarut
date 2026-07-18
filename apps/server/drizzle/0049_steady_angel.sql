ALTER TABLE "productions" ADD COLUMN "untuk_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "dari_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_untuk_branch_id_branches_id_fk" FOREIGN KEY ("untuk_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_dari_branch_id_branches_id_fk" FOREIGN KEY ("dari_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;