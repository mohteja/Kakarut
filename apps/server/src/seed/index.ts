/**
 * Seed database: platform super-admin + tenant Basooopa (cabang Pusat,
 * owner, kasir) + katalog lengkap dari basooopa-backend-data.json.
 *
 * Idempotent: memakai upsert berbasis natural key — aman dijalankan ulang.
 * Di akhir, HPP semua menu dihitung ulang dari DB dan dibandingkan dengan
 * nilai referensi `hpp_wb` dari Excel; seed GAGAL bila selisih > Rp1.
 */
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  hargaJualBulat,
  hargaPerUnit,
  hargaSaranPaket,
  hitungHpp,
  type KomponenHpp,
} from "@kakarut/shared";
import { env } from "../config/env";
import { db, pool } from "../db/client";
import {
  branches,
  companies,
  ingredients,
  memberships,
  menuCategories,
  menuComponents,
  menus,
  stockOpnames,
  users,
} from "../db/schema";
import seedData from "./data/basooopa-backend-data.json";

interface MasterRow {
  id: string;
  nama: string;
  harga_beli: number;
  isi: number;
  kategori: string;
  catatan: string;
}
interface RecipeRow {
  menu: string;
  kategori: string;
  mult: number;
  jual: number;
  komponen: { bahan: string; qty: number }[];
  hpp_wb?: number;
}
interface PaketRow {
  menu: string;
  base: string;
  base_mult: number;
  jual: number;
}

const data = seedData as unknown as {
  _meta: {
    komponen_kemasan_take_away: string[];
    komponen_complement: string;
  };
  catOrder: string[];
  masters: MasterRow[];
  recipes: RecipeRow[];
  paketYamin: PaketRow[];
};

const PAKET_TOPPINGS: { bahan: string; qty: number }[] = [
  { bahan: "baso urat kecil", qty: 2 },
  { bahan: "baso aci original", qty: 2 },
];
const PAKET_KATEGORI = "Paket Yamin";

const tanggalHariIni = (tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

async function main() {
  const packagingSet = new Set(data._meta.komponen_kemasan_take_away);
  const complementSlug = data._meta.komponen_complement;

  const credentials: { peran: string; email: string; password: string }[] = [];

  await db.transaction(async (tx) => {
    // 1. Platform super-admin
    await tx
      .insert(users)
      .values({
        email: env.SEED_SUPERADMIN_EMAIL.toLowerCase(),
        passwordHash: bcrypt.hashSync(env.SEED_SUPERADMIN_PASSWORD, 10),
        nama: "Super Admin",
        isSuperAdmin: true,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { isSuperAdmin: true, isActive: true },
      });
    credentials.push({
      peran: "Super Admin (platform)",
      email: env.SEED_SUPERADMIN_EMAIL.toLowerCase(),
      password: env.SEED_SUPERADMIN_PASSWORD,
    });

    // 2. Perusahaan Basooopa + cabang Pusat
    const [company] = await tx
      .insert(companies)
      .values({ nama: "Basooopa", slug: "basooopa" })
      .onConflictDoUpdate({ target: companies.slug, set: { nama: "Basooopa" } })
      .returning();

    const [branch] = await tx
      .insert(branches)
      .values({ companyId: company.id, nama: "Pusat" })
      .onConflictDoUpdate({
        target: [branches.companyId, branches.nama],
        set: { isActive: true },
      })
      .returning();

    // 3. Owner + kasir demo
    const [owner] = await tx
      .insert(users)
      .values({
        email: env.SEED_OWNER_EMAIL.toLowerCase(),
        passwordHash: bcrypt.hashSync(env.SEED_OWNER_PASSWORD, 10),
        nama: "Owner Basooopa",
      })
      .onConflictDoUpdate({ target: users.email, set: { isActive: true } })
      .returning();
    await tx
      .insert(memberships)
      .values({ userId: owner.id, companyId: company.id, role: "owner" })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.companyId],
        set: { role: "owner" },
      });
    credentials.push({
      peran: "Owner Basooopa",
      email: env.SEED_OWNER_EMAIL.toLowerCase(),
      password: env.SEED_OWNER_PASSWORD,
    });

    const [kasir] = await tx
      .insert(users)
      .values({
        email: env.SEED_KASIR_EMAIL.toLowerCase(),
        passwordHash: bcrypt.hashSync(env.SEED_KASIR_PASSWORD, 10),
        nama: "Kasir Pusat",
      })
      .onConflictDoUpdate({ target: users.email, set: { isActive: true } })
      .returning();
    await tx
      .insert(memberships)
      .values({
        userId: kasir.id,
        companyId: company.id,
        role: "cashier",
        branchId: branch.id,
      })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.companyId],
        set: { role: "cashier", branchId: branch.id },
      });
    credentials.push({
      peran: "Kasir cabang Pusat",
      email: env.SEED_KASIR_EMAIL.toLowerCase(),
      password: env.SEED_KASIR_PASSWORD,
    });

    // 4. Kategori menu sesuai catOrder
    const categoryIdByName = new Map<string, string>();
    for (const [i, nama] of data.catOrder.entries()) {
      const [cat] = await tx
        .insert(menuCategories)
        .values({ companyId: company.id, nama, sortOrder: i })
        .onConflictDoUpdate({
          target: [menuCategories.companyId, menuCategories.nama],
          set: { sortOrder: i },
        })
        .returning();
      categoryIdByName.set(nama, cat.id);
    }

    // 5. Bahan (masters)
    const ingredientIdBySlug = new Map<string, string>();
    for (const m of data.masters) {
      const [row] = await tx
        .insert(ingredients)
        .values({
          companyId: company.id,
          slug: m.id,
          nama: m.nama,
          hargaBeli: m.harga_beli,
          isi: m.isi,
          kategori: (["baso", "minuman", "lain"].includes(m.kategori)
            ? m.kategori
            : "lain") as "baso" | "minuman" | "lain",
          catatan: m.catatan || null,
          isPackaging: packagingSet.has(m.id),
          isComplement: m.id === complementSlug,
        })
        .onConflictDoUpdate({
          target: [ingredients.companyId, ingredients.slug],
          set: {
            nama: m.nama,
            hargaBeli: m.harga_beli,
            isi: m.isi,
            isPackaging: packagingSet.has(m.id),
            isComplement: m.id === complementSlug,
            isActive: true,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      ingredientIdBySlug.set(m.id, row.id);
    }
    console.log(`Bahan: ${ingredientIdBySlug.size} baris`);

    // 6. Resep → menu reguler (dedupe nama: kemunculan TERAKHIR menang,
    //    mis. 5 minuman yang muncul di "Teh & Basic" lalu "Minuman Segar")
    const recipeByName = new Map<string, { r: RecipeRow; order: number }>();
    for (const [i, r] of data.recipes.entries()) {
      if (recipeByName.has(r.menu)) {
        console.warn(
          `  duplikat menu "${r.menu}" — memakai versi kategori "${r.kategori}"`,
        );
      }
      recipeByName.set(r.menu, { r, order: i });
    }

    const menuIdByName = new Map<string, string>();
    for (const { r, order } of recipeByName.values()) {
      const categoryId = categoryIdByName.get(r.kategori);
      if (!categoryId) throw new Error(`Kategori tidak dikenal: ${r.kategori}`);
      const [menu] = await tx
        .insert(menus)
        .values({
          companyId: company.id,
          categoryId,
          nama: r.menu,
          tipe: "regular",
          mult: r.mult,
          hargaJual: r.jual,
          sortOrder: order,
        })
        .onConflictDoUpdate({
          target: [menus.companyId, menus.nama],
          set: {
            categoryId,
            tipe: "regular",
            mult: r.mult,
            baseMenuId: null,
            baseMult: null,
            hargaJual: r.jual,
            sortOrder: order,
            isActive: true,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      menuIdByName.set(r.menu, menu.id);
    }

    // 7. Paket Yamin → menu tipe 'paket'
    for (const [i, p] of data.paketYamin.entries()) {
      const baseId = menuIdByName.get(p.base);
      if (!baseId) throw new Error(`Menu dasar paket tidak ditemukan: ${p.base}`);
      const categoryId = categoryIdByName.get(PAKET_KATEGORI);
      if (!categoryId) throw new Error(`Kategori ${PAKET_KATEGORI} tidak ada`);
      const [menu] = await tx
        .insert(menus)
        .values({
          companyId: company.id,
          categoryId,
          nama: p.menu,
          tipe: "paket",
          baseMenuId: baseId,
          baseMult: p.base_mult,
          hargaJual: p.jual,
          sortOrder: i,
        })
        .onConflictDoUpdate({
          target: [menus.companyId, menus.nama],
          set: {
            categoryId,
            tipe: "paket",
            mult: null,
            baseMenuId: baseId,
            baseMult: p.base_mult,
            hargaJual: p.jual,
            sortOrder: i,
            isActive: true,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      menuIdByName.set(p.menu, menu.id);
    }
    console.log(`Menu: ${menuIdByName.size} baris (reguler + paket)`);

    // Komponen: hapus lalu isi ulang agar re-seed menyegarkan resep.
    const allMenuIds = [...menuIdByName.values()];
    await tx.delete(menuComponents).where(inArray(menuComponents.menuId, allMenuIds));

    const componentRows: (typeof menuComponents.$inferInsert)[] = [];
    for (const { r } of recipeByName.values()) {
      const menuId = menuIdByName.get(r.menu)!;
      // Bahan yang muncul dua kali dalam satu resep (mis. Berry Snow Fantasy)
      // digabung dengan menjumlahkan qty — sama seperti penjumlahan baris Excel.
      const qtyByIngredient = new Map<string, number>();
      for (const k of r.komponen) {
        if (k.qty <= 0) continue; // ada komponen qty=0 di data sumber
        const ingredientId = ingredientIdBySlug.get(k.bahan);
        if (!ingredientId) throw new Error(`Bahan tidak dikenal: ${k.bahan}`);
        qtyByIngredient.set(ingredientId, (qtyByIngredient.get(ingredientId) ?? 0) + k.qty);
      }
      for (const [ingredientId, qty] of qtyByIngredient) {
        componentRows.push({ menuId, ingredientId, qty });
      }
    }
    for (const p of data.paketYamin) {
      const menuId = menuIdByName.get(p.menu)!;
      for (const t of PAKET_TOPPINGS) {
        componentRows.push({
          menuId,
          ingredientId: ingredientIdBySlug.get(t.bahan)!,
          qty: t.qty,
        });
      }
    }
    await tx.insert(menuComponents).values(componentRows);
    console.log(`Komponen resep: ${componentRows.length} baris`);

    // 8. Stok demo (opname awal) — hanya bila cabang belum punya opname
    if (env.SEED_DEMO_STOCK) {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stockOpnames)
        .where(eq(stockOpnames.branchId, branch.id));
      if (count === 0) {
        const today = tanggalHariIni(company.timezone);
        const opnameRows = data.masters.map((m) => ({
          companyId: company.id,
          branchId: branch.id,
          ingredientId: ingredientIdBySlug.get(m.id)!,
          qty: Math.max(m.isi, 50),
          opnameDate: today,
          catatan: "Stok awal demo (seed)",
          userId: owner.id,
        }));
        await tx.insert(stockOpnames).values(opnameRows);
        console.log(`Stok awal demo: ${opnameRows.length} baris opname`);
      } else {
        console.log("Stok demo dilewati (cabang sudah punya opname).");
      }
    }

    // 9. Self-check: hitung ulang HPP dari DB vs hpp_wb
    const dbIngredients = await tx
      .select()
      .from(ingredients)
      .where(eq(ingredients.companyId, company.id));
    const ingById = new Map(dbIngredients.map((i) => [i.id, i]));
    const dbComponents = await tx
      .select()
      .from(menuComponents)
      .where(inArray(menuComponents.menuId, allMenuIds));
    const compsByMenu = new Map<string, KomponenHpp[]>();
    for (const c of dbComponents) {
      const ing = ingById.get(c.ingredientId)!;
      const list = compsByMenu.get(c.menuId) ?? [];
      list.push({
        qty: c.qty,
        hargaPerUnit: hargaPerUnit(ing.hargaBeli, ing.isi),
        isPackaging: ing.isPackaging,
        isComplement: ing.isComplement,
      });
      compsByMenu.set(c.menuId, list);
    }

    let checked = 0;
    for (const { r } of recipeByName.values()) {
      if (r.hpp_wb == null) continue;
      const hpp = hitungHpp(compsByMenu.get(menuIdByName.get(r.menu)!) ?? []);
      if (Math.abs(hpp - r.hpp_wb) > 1) {
        throw new Error(
          `Self-check HPP gagal: "${r.menu}" hitung=${hpp.toFixed(2)} referensi=${r.hpp_wb}`,
        );
      }
      checked++;
    }
    for (const p of data.paketYamin) {
      const baseHpp = hitungHpp(compsByMenu.get(menuIdByName.get(p.base)!) ?? []);
      const toppingCost = hitungHpp(compsByMenu.get(menuIdByName.get(p.menu)!) ?? []);
      const bulat = hargaJualBulat(hargaSaranPaket(baseHpp, p.base_mult, toppingCost));
      if (bulat !== p.jual) {
        throw new Error(
          `Self-check paket gagal: "${p.menu}" bulat=${bulat} harusnya ${p.jual}`,
        );
      }
      checked++;
    }
    console.log(`Self-check HPP: ${checked} menu cocok dengan referensi (±Rp1).`);
  });

  console.log("\n=== Seed selesai — kredensial akun ===");
  for (const c of credentials) {
    console.log(`${c.peran.padEnd(24)} | ${c.email.padEnd(36)} | ${c.password}`);
  }
  console.log("(Segera ganti password ini setelah testing.)\n");

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
