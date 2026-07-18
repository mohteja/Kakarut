CREATE TYPE "public"."dokumen_jenis" AS ENUM('beli', 'produksi', 'opname');--> statement-breakpoint
CREATE TABLE "dokumen_counters" (
	"company_id" uuid NOT NULL,
	"jenis" "dokumen_jenis" NOT NULL,
	"last_nomor" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "dokumen_counters_company_id_jenis_pk" PRIMARY KEY("company_id","jenis")
);
--> statement-breakpoint
CREATE TABLE "dokumen_nomor" (
	"company_id" uuid NOT NULL,
	"ref_id" uuid NOT NULL,
	"jenis" "dokumen_jenis" NOT NULL,
	"nomor" integer NOT NULL,
	"nomor_teks" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokumen_nomor_company_id_ref_id_pk" PRIMARY KEY("company_id","ref_id")
);
--> statement-breakpoint
ALTER TABLE "dokumen_counters" ADD CONSTRAINT "dokumen_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokumen_nomor" ADD CONSTRAINT "dokumen_nomor_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dokumen_nomor_urut_idx" ON "dokumen_nomor" USING btree ("company_id","jenis","nomor");