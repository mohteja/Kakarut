CREATE TABLE "menu_price_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"harga_lama" numeric(12, 2),
	"harga_baru" numeric(12, 2) NOT NULL,
	"mult_lama" numeric(7, 3),
	"mult_baru" numeric(7, 3),
	"sebab" text NOT NULL,
	"oleh_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "food_cost_maks" numeric(5, 2) DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "harga_tebakan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_price_logs" ADD CONSTRAINT "menu_price_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_price_logs" ADD CONSTRAINT "menu_price_logs_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_price_logs" ADD CONSTRAINT "menu_price_logs_oleh_user_id_users_id_fk" FOREIGN KEY ("oleh_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_price_logs_company_menu_idx" ON "menu_price_logs" USING btree ("company_id","menu_id","created_at");