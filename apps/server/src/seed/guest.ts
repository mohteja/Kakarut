import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../db/client";
import {
  branches,
  companies,
  ingredients,
  memberships,
  menuCategories,
  menuComponents,
  menus,
  stockOpnames,
  storageLocations,
  users,
} from "../db/schema";
import { tanggalDi } from "../lib/time";
import { seedKategoriBahanPerusahaan } from "../modules/kategori-bahan/service";
import { seedMejaDefault } from "../modules/meja/defaults";
import { createSale } from "../modules/penjualan/service";
import { seedUnitsPerusahaan } from "../modules/satuan/service";
import { resolveKodeKaryawan } from "../modules/users/service";

/**
 * Akun & perusahaan TAMU (guest mode) — dipakai bersama siapa pun untuk
 * mencoba aplikasi. Dua peran: owner & kasir. Cabang demo TANPA geofence
 * (lat/lng kosong) → absen bisa dari mana saja. Diprovisi otomatis saat boot
 * (idempoten), lengkap dengan data dummy (menu, bahan, stok, transaksi).
 */
export const GUEST = {
  slug: "terakasir-demo",
  ownerEmail: "owner-demo@terakasir.app",
  kasirEmail: "kasir-demo@terakasir.app",
  password: "demoterakasir",
} as const;

const BAHAN = [
  { slug: "bakso", nama: "Bakso Sapi", harga: 1000, satuan: "pcs", stok: 600 },
  { slug: "mie", nama: "Mie Kuning", harga: 2000, satuan: "porsi", stok: 250 },
  { slug: "kuah", nama: "Kaldu Kuah", harga: 1500, satuan: "porsi", stok: 250 },
  { slug: "es", nama: "Es Batu", harga: 500, satuan: "gelas", stok: 400 },
  { slug: "sirup", nama: "Sirup", harga: 1000, satuan: "gelas", stok: 150 },
] as const;

const MENU: { nama: string; kat: "Makanan" | "Minuman"; jual: number; resep: [string, number][] }[] = [
  { nama: "Bakso Spesial", kat: "Makanan", jual: 18000, resep: [["bakso", 8], ["mie", 1], ["kuah", 1]] },
  { nama: "Bakso Biasa", kat: "Makanan", jual: 13000, resep: [["bakso", 5], ["mie", 1], ["kuah", 1]] },
  { nama: "Mie Ayam", kat: "Makanan", jual: 15000, resep: [["mie", 1], ["kuah", 1]] },
  { nama: "Es Teh Manis", kat: "Minuman", jual: 5000, resep: [["es", 1], ["sirup", 1]] },
  { nama: "Es Jeruk", kat: "Minuman", jual: 8000, resep: [["es", 1], ["sirup", 1]] },
  { nama: "Air Mineral", kat: "Minuman", jual: 4000, resep: [] },
];

/** Provisi akun+perusahaan tamu bila belum ada. Aman dipanggil tiap boot. */
export async function provisionGuest(dbc: Db = db): Promise<boolean> {
  const hash = bcrypt.hashSync(GUEST.password, 10);
  // 1) Dua user tamu (idempoten; aktifkan bila pernah dinonaktifkan).
  const [owner] = await dbc
    .insert(users)
    .values({ email: GUEST.ownerEmail, passwordHash: hash, nama: "Owner Demo (Tamu)" })
    .onConflictDoUpdate({ target: users.email, set: { isActive: true, deletedAt: null } })
    .returning();
  const [kasir] = await dbc
    .insert(users)
    .values({ email: GUEST.kasirEmail, passwordHash: hash, nama: "Kasir Demo (Tamu)" })
    .onConflictDoUpdate({ target: users.email, set: { isActive: true, deletedAt: null } })
    .returning();

  // 2) Sudah ada perusahaan demo? Pastikan keanggotaan, lalu selesai.
  const [ada] = await dbc.select({ id: companies.id }).from(companies).where(eq(companies.slug, GUEST.slug));
  if (ada) {
    await pastikanKeanggotaan(dbc, ada.id, owner.id, kasir.id, null);
    return false;
  }

  // 3) Provisi baru + data dummy dalam satu transaksi.
  const hasil = await dbc.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ nama: "Terakasir Demo", slug: GUEST.slug, plan: "lite" })
      .returning();
    // Cabang tanpa lat/lng → geofence absen mati (absen bebas dari mana pun).
    const [branch] = await tx
      .insert(branches)
      .values({ companyId: company.id, nama: "Cabang Demo" })
      .returning();
    await seedMejaDefault(tx, company.id, branch.id);
    await seedUnitsPerusahaan(tx, company.id);
    await seedKategoriBahanPerusahaan(tx, company.id);
    await tx.insert(storageLocations).values({ companyId: company.id, branchId: branch.id, nama: "Gudang Demo" });

    await pastikanKeanggotaan(tx, company.id, owner.id, kasir.id, branch.id);

    // Kategori menu
    const catId = new Map<string, string>();
    for (const [i, nama] of ["Makanan", "Minuman"].entries()) {
      const [c] = await tx.insert(menuCategories).values({ companyId: company.id, nama, sortOrder: i }).returning();
      catId.set(nama, c.id);
    }
    // Bahan baku
    const ingId = new Map<string, string>();
    for (const b of BAHAN) {
      const [row] = await tx
        .insert(ingredients)
        .values({ companyId: company.id, slug: b.slug, nama: b.nama, hargaBeli: b.harga, isi: 1, satuan: b.satuan, kategori: "lain" })
        .returning();
      ingId.set(b.slug, row.id);
    }
    // Menu + resep (HPP)
    const hargaByMenuId = new Map<string, number>();
    const compRows: { menuId: string; ingredientId: string; qty: number }[] = [];
    for (const [i, m] of MENU.entries()) {
      const [menu] = await tx
        .insert(menus)
        .values({ companyId: company.id, categoryId: catId.get(m.kat)!, nama: m.nama, tipe: "regular", mult: 1, hargaJual: m.jual, sortOrder: i })
        .returning();
      hargaByMenuId.set(menu.id, m.jual);
      for (const [slug, qty] of m.resep) compRows.push({ menuId: menu.id, ingredientId: ingId.get(slug)!, qty });
    }
    if (compRows.length) await tx.insert(menuComponents).values(compRows);

    // Stok awal (opname disetujui by default)
    const today = tanggalDi(company.timezone);
    await tx.insert(stockOpnames).values(
      BAHAN.map((b) => ({
        companyId: company.id,
        branchId: branch.id,
        ingredientId: ingId.get(b.slug)!,
        qty: b.stok,
        opnameDate: today,
        catatan: "Stok awal demo (tamu)",
        userId: owner.id,
      })),
    );
    return { companyId: company.id, branchId: branch.id, hargaByMenuId };
  });

  // 4) Transaksi dummy (di luar tx — createSale mengelola transaksinya sendiri):
  //    ~14 struk tersebar 7 hari terakhir agar dashboard & laporan terisi.
  const menuIds = [...hasil.hargaByMenuId.keys()];
  const sekarang = Date.now();
  let dibuat = 0;
  for (let n = 0; n < 14; n += 1) {
    // Sebar ke hari 0..6 lalu (beberapa hari ini juga).
    const hariLalu = n % 7;
    const jam = 9 + (n % 8); // 09:00–16:00
    const waktu = new Date(sekarang - hariLalu * 86_400_000);
    waktu.setHours(jam, (n * 7) % 60, 0, 0);
    // 1–3 item acak-terkendali (deterministik cukup untuk demo).
    const jumlahItem = 1 + (n % 3);
    const items: { menu_id: string; qty: number }[] = [];
    let total = 0;
    for (let k = 0; k < jumlahItem; k += 1) {
      const mid = menuIds[(n + k * 3) % menuIds.length];
      const qty = 1 + ((n + k) % 2);
      items.push({ menu_id: mid, qty });
      total += (hasil.hargaByMenuId.get(mid) ?? 0) * qty;
    }
    try {
      await createSale({
        companyId: hasil.companyId,
        branchId: hasil.branchId,
        cashierUserId: kasir.id,
        isDineIn: n % 2 === 0,
        metodeBayar: n % 3 === 0 ? "qris" : "tunai",
        uangDiterima: Math.ceil((total + 5000) / 5000) * 5000,
        waktu,
        items,
      });
      dibuat += 1;
    } catch {
      /* lewati bila gagal (mis. stok kurang) — demo tetap jalan */
    }
  }
  console.log(`Guest mode: perusahaan demo dibuat (${dibuat} transaksi dummy).`);
  return true;
}

/** Owner + kasir menjadi anggota perusahaan demo (kasir terkunci cabang). */
async function pastikanKeanggotaan(
  tx: Db | Tx,
  companyId: string,
  ownerId: string,
  kasirId: string,
  branchId: string | null,
): Promise<void> {
  await tx
    .insert(memberships)
    .values({ userId: ownerId, companyId, role: "owner" })
    .onConflictDoUpdate({ target: [memberships.userId, memberships.companyId], set: { role: "owner", archivedAt: null } });
  const kode = await resolveKodeKaryawan(tx, companyId);
  // branchId hanya diketahui saat provisi baru; saat idempoten, jangan menimpa
  // cabang yang mungkin sudah benar (biarkan set yang ada).
  await tx
    .insert(memberships)
    .values({ userId: kasirId, companyId, role: "cashier", branchId: branchId ?? undefined, employeeCode: kode })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.companyId],
      set: { role: "cashier", archivedAt: null, ...(branchId ? { branchId } : {}) },
    });
}
