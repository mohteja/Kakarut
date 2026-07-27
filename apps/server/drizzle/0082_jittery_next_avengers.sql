CREATE TYPE "public"."pengajuan_jenis" AS ENUM('cuti', 'libur');--> statement-breakpoint
CREATE TYPE "public"."pengajuan_kategori" AS ENUM('tahunan', 'sakit', 'izin', 'melahirkan', 'penting', 'mingguan', 'tukar_jadwal', 'tanggal_merah');--> statement-breakpoint
CREATE TYPE "public"."pengajuan_status" AS ENUM('menunggu', 'disetujui', 'ditolak');--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid,
	"jenis" "pengajuan_jenis" NOT NULL,
	"kategori" "pengajuan_kategori" NOT NULL,
	"tanggal_mulai" date NOT NULL,
	"tanggal_selesai" date NOT NULL,
	"alasan" text,
	"lampiran_url" text,
	"status" "pengajuan_status" DEFAULT 'menunggu' NOT NULL,
	"diputus_oleh_user_id" uuid,
	"diputus_pada" timestamp with time zone,
	"alasan_tolak" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_diputus_oleh_user_id_users_id_fk" FOREIGN KEY ("diputus_oleh_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_company_status_idx" ON "leave_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "leave_requests_user_mulai_idx" ON "leave_requests" USING btree ("user_id","tanggal_mulai");--> statement-breakpoint
CREATE INDEX "leave_requests_company_rentang_idx" ON "leave_requests" USING btree ("company_id","tanggal_mulai","tanggal_selesai");