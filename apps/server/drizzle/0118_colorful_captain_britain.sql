CREATE TABLE "kunci_perangkat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"nama" text,
	"tv" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terakhir_dipakai" timestamp with time zone,
	"kedaluwarsa_pada" timestamp with time zone NOT NULL,
	"dicabut_pada" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kunci_perangkat" ADD CONSTRAINT "kunci_perangkat_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kunci_perangkat_hash_uq" ON "kunci_perangkat" USING btree ("hash");