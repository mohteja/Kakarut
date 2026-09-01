CREATE TABLE "email_keadaan" (
	"kunci" text PRIMARY KEY NOT NULL,
	"sukses_pada" timestamp with time zone,
	"sukses_penyedia" text,
	"gagal_pada" timestamp with time zone,
	"gagal_penyedia" text,
	"gagal_pesan" text,
	"gagal_beruntun" integer DEFAULT 0 NOT NULL
);
