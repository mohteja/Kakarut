CREATE TYPE "public"."attendance_tipe" AS ENUM('masuk', 'keluar');--> statement-breakpoint
CREATE TABLE "attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tipe" "attendance_tipe" NOT NULL,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	"attend_date" date NOT NULL,
	"catatan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "employee_code" text;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendances_company_branch_date_idx" ON "attendances" USING btree ("company_id","branch_id","attend_date");--> statement-breakpoint
CREATE INDEX "attendances_user_date_idx" ON "attendances" USING btree ("user_id","attend_date");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_company_kode_uq" ON "memberships" USING btree ("company_id","employee_code") WHERE "memberships"."employee_code" IS NOT NULL;