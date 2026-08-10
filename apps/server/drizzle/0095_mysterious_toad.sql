ALTER TABLE "open_bills" DROP CONSTRAINT "open_bills_sale_id_sales_id_fk";
--> statement-breakpoint
ALTER TABLE "open_bills" ADD CONSTRAINT "open_bills_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;