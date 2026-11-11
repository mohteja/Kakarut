CREATE TABLE "ruangan_meja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"pos_x" integer DEFAULT 5 NOT NULL,
	"pos_y" integer DEFAULT 5 NOT NULL,
	"lebar" integer DEFAULT 40 NOT NULL,
	"tinggi" integer DEFAULT 40 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meja" ADD COLUMN "ruangan_id" uuid;--> statement-breakpoint
ALTER TABLE "ruangan_meja" ADD CONSTRAINT "ruangan_meja_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruangan_meja" ADD CONSTRAINT "ruangan_meja_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ruangan_meja_cabang_nama_uq" ON "ruangan_meja" USING btree ("branch_id","nama");--> statement-breakpoint
ALTER TABLE "meja" ADD CONSTRAINT "meja_ruangan_id_ruangan_meja_id_fk" FOREIGN KEY ("ruangan_id") REFERENCES "public"."ruangan_meja"("id") ON DELETE set null ON UPDATE no action;