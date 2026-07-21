CREATE TABLE "sync_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"client_ref" uuid NOT NULL,
	"device_id" text,
	"user_id" uuid,
	"tipe" text NOT NULL,
	"waktu" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"kode" integer NOT NULL,
	"hasil_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "ada_transaksi_susulan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_commands_company_ref_uq" ON "sync_commands" USING btree ("company_id","client_ref");