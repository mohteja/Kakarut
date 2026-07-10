CREATE TYPE "public"."meja_tipe" AS ENUM('dine_in', 'takeaway');--> statement-breakpoint
CREATE TABLE "meja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"tipe" "meja_tipe" DEFAULT 'dine_in' NOT NULL,
	"pos_x" integer DEFAULT 0 NOT NULL,
	"pos_y" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "meja_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "meja_label" text;--> statement-breakpoint
ALTER TABLE "meja" ADD CONSTRAINT "meja_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meja" ADD CONSTRAINT "meja_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meja_branch_nama_uq" ON "meja" USING btree ("branch_id","nama");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_meja_id_meja_id_fk" FOREIGN KEY ("meja_id") REFERENCES "public"."meja"("id") ON DELETE set null ON UPDATE no action;