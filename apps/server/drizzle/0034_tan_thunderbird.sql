ALTER TABLE "branches" ADD COLUMN "receipt_footer" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "receipt_show_alamat" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "branches" b SET "receipt_footer" = c."receipt_footer", "receipt_show_alamat" = c."receipt_show_alamat" FROM "companies" c WHERE b."company_id" = c."id";
