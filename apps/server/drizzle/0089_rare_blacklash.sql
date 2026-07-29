CREATE TYPE "public"."pesanan_status" AS ENUM('dikerjakan', 'selesai', 'batal');--> statement-breakpoint
CREATE TABLE "pesanan_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid,
	"open_bill_id" uuid,
	"aksi" text NOT NULL,
	"status_lama" "pesanan_status",
	"status_baru" "pesanan_status",
	"user_id" uuid,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_bills" ADD COLUMN "pesanan_status" "pesanan_status" DEFAULT 'dikerjakan' NOT NULL;--> statement-breakpoint
ALTER TABLE "open_bills" ADD COLUMN "pesanan_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "open_bills" ADD COLUMN "pesanan_status_oleh" uuid;--> statement-breakpoint
ALTER TABLE "open_bills" ADD COLUMN "sajian_takeaway" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "open_bills" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "open_bills" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "pesanan_status" "pesanan_status" DEFAULT 'dikerjakan' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "pesanan_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "pesanan_status_oleh" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "sajian_takeaway" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "asal_open_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "pesanan_logs" ADD CONSTRAINT "pesanan_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pesanan_logs" ADD CONSTRAINT "pesanan_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pesanan_logs" ADD CONSTRAINT "pesanan_logs_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pesanan_logs" ADD CONSTRAINT "pesanan_logs_open_bill_id_open_bills_id_fk" FOREIGN KEY ("open_bill_id") REFERENCES "public"."open_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pesanan_logs" ADD CONSTRAINT "pesanan_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pesanan_logs_sale_idx" ON "pesanan_logs" USING btree ("sale_id","waktu");--> statement-breakpoint
CREATE INDEX "pesanan_logs_bill_idx" ON "pesanan_logs" USING btree ("open_bill_id","waktu");--> statement-breakpoint
CREATE INDEX "pesanan_logs_cabang_idx" ON "pesanan_logs" USING btree ("company_id","branch_id","waktu");--> statement-breakpoint
CREATE INDEX "pesanan_logs_user_idx" ON "pesanan_logs" USING btree ("company_id","user_id","waktu");--> statement-breakpoint
ALTER TABLE "open_bills" ADD CONSTRAINT "open_bills_pesanan_status_oleh_users_id_fk" FOREIGN KEY ("pesanan_status_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bills" ADD CONSTRAINT "open_bills_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_pesanan_status_oleh_users_id_fk" FOREIGN KEY ("pesanan_status_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;