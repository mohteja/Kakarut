CREATE TABLE "menu_addon_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"min_pilih" integer DEFAULT 0 NOT NULL,
	"maks_pilih" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_addon_groups_min_ck" CHECK ("menu_addon_groups"."min_pilih" >= 0),
	CONSTRAINT "menu_addon_groups_maks_ck" CHECK ("menu_addon_groups"."maks_pilih" IS NULL OR "menu_addon_groups"."maks_pilih" >= GREATEST("menu_addon_groups"."min_pilih", 1))
);
--> statement-breakpoint
CREATE TABLE "menu_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"harga" numeric(12, 2) DEFAULT 0 NOT NULL,
	"maks_jumlah" integer,
	"ingredient_id" uuid,
	"qty_bahan" numeric(12, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_addons_harga_ck" CHECK ("menu_addons"."harga" >= 0),
	CONSTRAINT "menu_addons_maks_jumlah_ck" CHECK ("menu_addons"."maks_jumlah" IS NULL OR "menu_addons"."maks_jumlah" >= 1),
	CONSTRAINT "menu_addons_bahan_ck" CHECK (("menu_addons"."ingredient_id" IS NULL) = ("menu_addons"."qty_bahan" IS NULL) AND ("menu_addons"."qty_bahan" IS NULL OR "menu_addons"."qty_bahan" <> 0))
);
--> statement-breakpoint
CREATE TABLE "open_bill_item_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"open_bill_item_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"addon_id" uuid,
	"grup_nama" text NOT NULL,
	"nama" text NOT NULL,
	"harga" numeric(12, 2) NOT NULL,
	"jumlah" integer DEFAULT 1 NOT NULL,
	"ingredient_id" uuid,
	"qty_bahan" numeric(12, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "open_bill_item_addons_jumlah_ck" CHECK ("open_bill_item_addons"."jumlah" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sale_item_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"addon_id" uuid,
	"grup_nama" text NOT NULL,
	"nama" text NOT NULL,
	"harga" numeric(12, 2) NOT NULL,
	"jumlah" integer DEFAULT 1 NOT NULL,
	"ingredient_id" uuid,
	"qty_bahan" numeric(12, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sale_item_addons_jumlah_ck" CHECK ("sale_item_addons"."jumlah" >= 1)
);
--> statement-breakpoint
ALTER TABLE "menu_addon_groups" ADD CONSTRAINT "menu_addon_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_addon_groups" ADD CONSTRAINT "menu_addon_groups_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_addons" ADD CONSTRAINT "menu_addons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_addons" ADD CONSTRAINT "menu_addons_group_id_menu_addon_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."menu_addon_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_addons" ADD CONSTRAINT "menu_addons_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bill_item_addons" ADD CONSTRAINT "open_bill_item_addons_open_bill_item_id_open_bill_items_id_fk" FOREIGN KEY ("open_bill_item_id") REFERENCES "public"."open_bill_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bill_item_addons" ADD CONSTRAINT "open_bill_item_addons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bill_item_addons" ADD CONSTRAINT "open_bill_item_addons_addon_id_menu_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."menu_addons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_bill_item_addons" ADD CONSTRAINT "open_bill_item_addons_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item_addons" ADD CONSTRAINT "sale_item_addons_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item_addons" ADD CONSTRAINT "sale_item_addons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item_addons" ADD CONSTRAINT "sale_item_addons_addon_id_menu_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."menu_addons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item_addons" ADD CONSTRAINT "sale_item_addons_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_addon_groups_menu_idx" ON "menu_addon_groups" USING btree ("menu_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_addon_groups_menu_nama_uq" ON "menu_addon_groups" USING btree ("menu_id","nama") WHERE "menu_addon_groups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "menu_addons_group_idx" ON "menu_addons" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "open_bill_item_addons_item_idx" ON "open_bill_item_addons" USING btree ("open_bill_item_id");--> statement-breakpoint
CREATE INDEX "sale_item_addons_item_idx" ON "sale_item_addons" USING btree ("sale_item_id");