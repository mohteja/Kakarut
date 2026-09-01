CREATE TABLE "email_percobaan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	"konteks" text NOT NULL,
	"tujuan" text NOT NULL,
	"hasil" text NOT NULL,
	"sebab" text,
	"penyedia" text,
	"pesan" text
);
--> statement-breakpoint
CREATE INDEX "email_percobaan_waktu_idx" ON "email_percobaan" USING btree ("waktu");