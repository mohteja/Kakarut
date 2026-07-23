CREATE INDEX "productions_branch_date_idx" ON "productions" USING btree ("branch_id","prod_date");--> statement-breakpoint
CREATE INDEX "productions_rencana_idx" ON "productions" USING btree ("rencana_id") WHERE "productions"."rencana_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "supply_purchases_faktur_idx" ON "supply_purchases" USING btree ("faktur_id") WHERE "supply_purchases"."faktur_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "supply_purchases_rencana_idx" ON "supply_purchases" USING btree ("rencana_id") WHERE "supply_purchases"."rencana_id" IS NOT NULL;