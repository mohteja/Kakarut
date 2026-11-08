CREATE TYPE "public"."gaji_dasar" AS ENUM('bulanan', 'harian');--> statement-breakpoint
CREATE TYPE "public"."gaji_periode_status" AS ENUM('draft', 'final', 'dibayar');--> statement-breakpoint
CREATE TABLE "gaji_periode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"mulai" date NOT NULL,
	"selesai" date NOT NULL,
	"status" "gaji_periode_status" DEFAULT 'draft' NOT NULL,
	"difinalkan_pada" timestamp with time zone,
	"dibayar_pada" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gaji_setelan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dasar" "gaji_dasar" NOT NULL,
	"nominal" numeric(14, 2) NOT NULL,
	"jam_masuk" text,
	"jam_pulang" text,
	"toleransi_telat_menit" integer DEFAULT 0 NOT NULL,
	"potongan_alpa_per_hari" numeric(14, 2),
	"potongan_telat_per_kali" numeric(14, 2) DEFAULT 0 NOT NULL,
	"upah_lembur_per_jam" numeric(14, 2) DEFAULT 0 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gaji_slip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"periode_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bonus" numeric(14, 2) DEFAULT 0 NOT NULL,
	"penyesuaian" numeric(14, 2) DEFAULT 0 NOT NULL,
	"catatan" text,
	"total" numeric(14, 2) NOT NULL,
	"rincian" jsonb NOT NULL,
	"dihitung_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gaji_tunjangan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"nominal" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kasbon" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"nominal" numeric(14, 2) NOT NULL,
	"cicilan_per_periode" numeric(14, 2) NOT NULL,
	"catatan" text,
	"dibuat_oleh_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kasbon_potongan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kasbon_id" uuid NOT NULL,
	"slip_id" uuid NOT NULL,
	"nominal" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "gaji_tanggal_mulai" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "gaji_cuti_dibayar" jsonb DEFAULT '["tahunan","sakit","melahirkan","penting","mingguan","tukar_jadwal","tanggal_merah"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gaji_periode" ADD CONSTRAINT "gaji_periode_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaji_setelan" ADD CONSTRAINT "gaji_setelan_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaji_setelan" ADD CONSTRAINT "gaji_setelan_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaji_slip" ADD CONSTRAINT "gaji_slip_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaji_slip" ADD CONSTRAINT "gaji_slip_periode_id_gaji_periode_id_fk" FOREIGN KEY ("periode_id") REFERENCES "public"."gaji_periode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaji_slip" ADD CONSTRAINT "gaji_slip_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaji_tunjangan" ADD CONSTRAINT "gaji_tunjangan_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaji_tunjangan" ADD CONSTRAINT "gaji_tunjangan_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kasbon" ADD CONSTRAINT "kasbon_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kasbon" ADD CONSTRAINT "kasbon_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kasbon" ADD CONSTRAINT "kasbon_dibuat_oleh_user_id_users_id_fk" FOREIGN KEY ("dibuat_oleh_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kasbon_potongan" ADD CONSTRAINT "kasbon_potongan_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kasbon_potongan" ADD CONSTRAINT "kasbon_potongan_kasbon_id_kasbon_id_fk" FOREIGN KEY ("kasbon_id") REFERENCES "public"."kasbon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kasbon_potongan" ADD CONSTRAINT "kasbon_potongan_slip_id_gaji_slip_id_fk" FOREIGN KEY ("slip_id") REFERENCES "public"."gaji_slip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gaji_periode_company_mulai_uq" ON "gaji_periode" USING btree ("company_id","mulai");--> statement-breakpoint
CREATE UNIQUE INDEX "gaji_setelan_company_user_uq" ON "gaji_setelan" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gaji_slip_periode_user_uq" ON "gaji_slip" USING btree ("periode_id","user_id");--> statement-breakpoint
CREATE INDEX "gaji_tunjangan_company_user_idx" ON "gaji_tunjangan" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "kasbon_company_user_idx" ON "kasbon" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kasbon_potongan_kasbon_slip_uq" ON "kasbon_potongan" USING btree ("kasbon_id","slip_id");--> statement-breakpoint
CREATE INDEX "kasbon_potongan_company_idx" ON "kasbon_potongan" USING btree ("company_id");