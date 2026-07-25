CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	"pemicu" text NOT NULL,
	"oleh_user_id" uuid,
	"status" text NOT NULL,
	"storage_mode" text NOT NULL,
	"object_key" text,
	"ukuran_bytes" bigint,
	"jumlah_tabel" integer,
	"jumlah_baris" bigint,
	"durasi_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_oleh_user_id_users_id_fk" FOREIGN KEY ("oleh_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_runs_waktu_idx" ON "backup_runs" USING btree ("waktu");