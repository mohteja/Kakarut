ALTER TYPE "public"."konfirmasi_status" ADD VALUE 'rencana' BEFORE 'menunggu';--> statement-breakpoint
ALTER TYPE "public"."konfirmasi_status" ADD VALUE 'dikerjakan' BEFORE 'menunggu';--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "worker_id" uuid;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;