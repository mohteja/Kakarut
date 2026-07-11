CREATE TABLE "open_bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"qty" numeric(10, 2) NOT NULL,
	"dine_in_override" boolean,
	"catatan" text
);
--> statement-breakpoint
CREATE TABLE "open_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"meja_id" uuid,
	"meja_label" text,
	"customer_nama" text,
	"customer_wa" text,
	"catatan" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD CONSTRAINT "open_bill_items_bill_id_open_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."open_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD CONSTRAINT "open_bill_items_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bills" ADD CONSTRAINT "open_bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bills" ADD CONSTRAINT "open_bills_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bills" ADD CONSTRAINT "open_bills_meja_id_meja_id_fk" FOREIGN KEY ("meja_id") REFERENCES "public"."meja"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bills" ADD CONSTRAINT "open_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "open_bill_items_bill_idx" ON "open_bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "open_bills_company_branch_idx" ON "open_bills" USING btree ("company_id","branch_id","updated_at");