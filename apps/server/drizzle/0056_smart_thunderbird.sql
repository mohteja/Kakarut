CREATE TYPE "public"."metode_hpp" AS ENUM('average', 'fifo');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "metode_hpp" "metode_hpp" DEFAULT 'average' NOT NULL;