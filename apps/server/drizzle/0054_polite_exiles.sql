CREATE TYPE "public"."supply_rule_metode" AS ENUM('otomatis', 'manual');--> statement-breakpoint
ALTER TABLE "supply_rules" ADD COLUMN "metode" "supply_rule_metode" DEFAULT 'otomatis' NOT NULL;