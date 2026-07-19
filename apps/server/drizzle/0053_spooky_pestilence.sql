CREATE TABLE "supply_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supply_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"is_utama" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplies" ADD COLUMN "kategori" text;--> statement-breakpoint
ALTER TABLE "supplies" ADD COLUMN "boleh_eceran" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "supplies" ADD COLUMN "dilacak" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplies" ADD COLUMN "storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "supply_suppliers" ADD CONSTRAINT "supply_suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_suppliers" ADD CONSTRAINT "supply_suppliers_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_suppliers" ADD CONSTRAINT "supply_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supply_suppliers_pair_uq" ON "supply_suppliers" USING btree ("supply_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_suppliers_utama_uq" ON "supply_suppliers" USING btree ("supply_id") WHERE "supply_suppliers"."is_utama";--> statement-breakpoint
CREATE INDEX "supply_suppliers_company_idx" ON "supply_suppliers" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE set null ON UPDATE no action;