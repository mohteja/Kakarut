CREATE TABLE "faktur_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"faktur_id" uuid NOT NULL,
	"jalur" "pengadaan" NOT NULL,
	"aksi" text NOT NULL,
	"detail" text,
	"user_id" uuid,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faktur_logs" ADD CONSTRAINT "faktur_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktur_logs" ADD CONSTRAINT "faktur_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktur_logs" ADD CONSTRAINT "faktur_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "faktur_logs_faktur_idx" ON "faktur_logs" USING btree ("faktur_id","waktu");--> statement-breakpoint
CREATE INDEX "faktur_logs_user_idx" ON "faktur_logs" USING btree ("company_id","user_id","waktu");