CREATE TABLE "token_dicabut" (
	"jti" text PRIMARY KEY NOT NULL,
	"kedaluwarsa" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
