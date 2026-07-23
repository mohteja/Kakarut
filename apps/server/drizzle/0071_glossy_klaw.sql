CREATE TABLE "boot_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"selesai_at" timestamp with time zone DEFAULT now() NOT NULL
);
