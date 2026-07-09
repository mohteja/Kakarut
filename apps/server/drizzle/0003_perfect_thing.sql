CREATE TYPE "public"."konfirmasi_status" AS ENUM('menunggu', 'dikonfirmasi');--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"catatan" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"telepon" text,
	"alamat" text,
	"catatan" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "faktur_id" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "no_faktur" text;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "status" "konfirmasi_status" DEFAULT 'dikonfirmasi' NOT NULL;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_locations_branch_nama_uq" ON "storage_locations" USING btree ("branch_id","nama");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_nama_uq" ON "suppliers" USING btree ("company_id","nama");--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;