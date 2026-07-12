CREATE TABLE "faktur_dana" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"faktur_id" uuid NOT NULL,
	"nominal" numeric(14, 2) NOT NULL,
	"catatan" text,
	"user_id" uuid,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faktur_dana_nominal_ck" CHECK ("faktur_dana"."nominal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "faktur_dana" ADD CONSTRAINT "faktur_dana_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktur_dana" ADD CONSTRAINT "faktur_dana_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktur_dana" ADD CONSTRAINT "faktur_dana_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "faktur_dana_faktur_idx" ON "faktur_dana" USING btree ("faktur_id");