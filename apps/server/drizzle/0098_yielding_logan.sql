CREATE TABLE "peringatan_terkirim" (
	"key" text PRIMARY KEY NOT NULL,
	"terakhir_at" timestamp with time zone DEFAULT now() NOT NULL
);
