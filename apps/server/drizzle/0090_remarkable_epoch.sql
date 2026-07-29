CREATE TABLE "meja_kosong_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"meja_id" uuid NOT NULL,
	"aksi" text NOT NULL,
	"paksa" boolean DEFAULT false NOT NULL,
	"detail" text,
	"user_id" uuid,
	"sampai" timestamp with time zone NOT NULL,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meja_kosong_logs" ADD CONSTRAINT "meja_kosong_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meja_kosong_logs" ADD CONSTRAINT "meja_kosong_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meja_kosong_logs" ADD CONSTRAINT "meja_kosong_logs_meja_id_meja_id_fk" FOREIGN KEY ("meja_id") REFERENCES "public"."meja"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meja_kosong_logs" ADD CONSTRAINT "meja_kosong_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meja_kosong_logs_meja_idx" ON "meja_kosong_logs" USING btree ("meja_id","waktu");--> statement-breakpoint
CREATE INDEX "meja_kosong_logs_cabang_idx" ON "meja_kosong_logs" USING btree ("company_id","branch_id","waktu");--> statement-breakpoint
CREATE INDEX "meja_kosong_logs_user_idx" ON "meja_kosong_logs" USING btree ("company_id","user_id","waktu");--> statement-breakpoint
CREATE INDEX "open_bills_meja_aktif_idx" ON "open_bills" USING btree ("branch_id","meja_id") WHERE "open_bills"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sales_meja_idx" ON "sales" USING btree ("branch_id","meja_id","waktu");