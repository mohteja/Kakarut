CREATE TYPE "public"."kebersihan_sesi" AS ENUM('pagi', 'siang', 'malam');--> statement-breakpoint
CREATE TABLE "cleaning_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"nama" text NOT NULL,
	"urutan" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cleaning_report_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"area_id" uuid,
	"area_nama" text NOT NULL,
	"bersih" boolean NOT NULL,
	"catatan" text,
	"foto_url" text,
	"urutan" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cleaning_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"sesi" "kebersihan_sesi" NOT NULL,
	"catatan" text,
	"catatan_owner" text,
	"catatan_owner_oleh_user_id" uuid,
	"catatan_owner_pada" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cleaning_areas" ADD CONSTRAINT "cleaning_areas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_areas" ADD CONSTRAINT "cleaning_areas_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_report_items" ADD CONSTRAINT "cleaning_report_items_report_id_cleaning_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."cleaning_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_report_items" ADD CONSTRAINT "cleaning_report_items_area_id_cleaning_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cleaning_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_reports" ADD CONSTRAINT "cleaning_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_reports" ADD CONSTRAINT "cleaning_reports_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_reports" ADD CONSTRAINT "cleaning_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_reports" ADD CONSTRAINT "cleaning_reports_catatan_owner_oleh_user_id_users_id_fk" FOREIGN KEY ("catatan_owner_oleh_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cleaning_areas_company_aktif_idx" ON "cleaning_areas" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "cleaning_report_items_report_idx" ON "cleaning_report_items" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cleaning_reports_user_tanggal_sesi_uq" ON "cleaning_reports" USING btree ("company_id","user_id","tanggal","sesi");--> statement-breakpoint
CREATE INDEX "cleaning_reports_company_tanggal_idx" ON "cleaning_reports" USING btree ("company_id","tanggal");--> statement-breakpoint
CREATE INDEX "cleaning_reports_company_branch_tanggal_idx" ON "cleaning_reports" USING btree ("company_id","branch_id","tanggal");