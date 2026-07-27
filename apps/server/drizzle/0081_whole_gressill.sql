CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	"status" integer NOT NULL,
	"metode" text NOT NULL,
	"jalur" text NOT NULL,
	"jalur_pola" text NOT NULL,
	"pesan" text NOT NULL,
	"stack" text,
	"sidik" text NOT NULL,
	"user_id" uuid,
	"company_id" uuid,
	"peran" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_logs_waktu_idx" ON "error_logs" USING btree ("waktu");--> statement-breakpoint
CREATE INDEX "error_logs_sidik_idx" ON "error_logs" USING btree ("sidik");--> statement-breakpoint
CREATE INDEX "error_logs_status_idx" ON "error_logs" USING btree ("status");