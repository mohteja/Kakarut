ALTER TABLE "sales" ADD COLUMN "diskon" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "diskon_persen" numeric(5, 2);