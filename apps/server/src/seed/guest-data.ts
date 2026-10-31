import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { hargaAddon, type PilihanAddon } from "@kakarut/shared";
import { db } from "../db/client";
import {
  branches,
  companies,
  ingredients,
  meja,
  memberships,
  menuAddonGroups,
  menuAddons,
  menuCategories,
  menuComponents,
  menus,
  openBillItemAddons,
  openBillItems,
  openBills,
  productions,
  stockOpnames,
  suppliers,
  users,
} from "../db/schema";
import { sekaliSaja } from "../lib/boot-flags";
import { tanggalDi } from "../lib/time";
import { createSale } from "../modules/penjualan/service";
import { resolveKodeKaryawan } from "../modules/users/service";

/**
 * DATA DEMO LENGKAP untuk perusahaan TAMU — supaya pengunjung bisa mencoba
 * hampir semua layar tanpa harus mengisi apa pun dulu: menu ber-add-on (satu
 * grup WAJIB), open bill di meja, member dengan riwayat belanja, supplier &
 * pembelian, karyawan dapur/tim, dan penjualan tiga minggu terakhir.
 *
 * TAMBAH, BUKAN TIMPA (keputusan pemilik 2026-10-26). Perusahaan demo dipakai
 * bersama dan sudah hidup di production; isinya mungkin sudah diubah
 * pengunjung. Karena itu tiap baris master dikunci nama/slug dan hanya
 * DITAMBAHKAN bila belum ada, menu yang sudah punya grup add-on tak disentuh,
 * dan meja yang sedang punya bill dilewati.
 *
 * SEKALI JALAN. Penjualan, bill, dan pembelian bukan data berkunci — menjalankannya
 * tiap boot akan menggandakannya. `sekaliSaja` mencatat penandanya sesudah
 * selesai; versi kunci (`_v2`) dinaikkan bila isi demo diperbarui lagi.
 */
const KUNCI = "demo_tamu_v2";

const BAHAN_BARU = [
  { slug: "telur", nama: "Telur Ayam", harga: 2500, satuan: "butir", stok: 120 },
  { slug: "ayam", nama: "Ayam Suwir", harga: 4000, satuan: "porsi", stok: 80 },
  { slug: "sawi", nama: "Sawi Hijau", harga: 500, satuan: "porsi", stok: 150 },
  { slug: "bawang-goreng", nama: "Bawang Goreng", harga: 300, satuan: "porsi", stok: 200 },
  { slug: "sambal", nama: "Sambal", harga: 300, satuan: "porsi", stok: 200 },
  { slug: "nasi", nama: "Nasi Putih", harga: 2000, satuan: "porsi", stok: 100 },
  { slug: "teh", nama: "Teh Seduh", harga: 800, satuan: "gelas", stok: 150 },
  { slug: "jeruk", nama: "Jeruk Peras", harga: 2500, satuan: "gelas", stok: 80 },
  { slug: "kopi", nama: "Espresso Shot", harga: 3000, satuan: "shot", stok: 120 },
  { slug: "susu", nama: "Susu Segar", harga: 2500, satuan: "gelas", stok: 80 },
  { slug: "cup", nama: "Cup + Tutup TA", harga: 700, satuan: "pcs", stok: 300, kemasan: true },
  { slug: "box", nama: "Box Makanan TA", harga: 1200, satuan: "pcs", stok: 200, kemasan: true },
] as const;

type MenuBaru = {
  nama: string;
  kat: "Makanan" | "Minuman" | "Paket";
  jual: number;
  resep: [string, number][];
  /** paket: menu dasar & pengalinya */
  dasar?: string;
};

const MENU_BARU: MenuBaru[] = [
  { nama: "Mie Ayam Bakso", kat: "Makanan", jual: 20000, resep: [["mie", 1], ["kuah", 1], ["ayam", 1], ["bakso", 4], ["sawi", 1], ["box", 1]] },
  { nama: "Bakso Urat", kat: "Makanan", jual: 20000, resep: [["bakso", 6], ["mie", 1], ["kuah", 1], ["bawang-goreng", 1], ["box", 1]] },
  { nama: "Nasi Ayam Bawang", kat: "Makanan", jual: 17000, resep: [["nasi", 1], ["ayam", 1], ["telur", 1], ["sambal", 1], ["box", 1]] },
  { nama: "Kopi Susu", kat: "Minuman", jual: 15000, resep: [["kopi", 1], ["susu", 1], ["es", 1], ["cup", 1]] },
  { nama: "Es Kopi Hitam", kat: "Minuman", jual: 12000, resep: [["kopi", 1], ["es", 1], ["cup", 1]] },
  { nama: "Teh Tarik", kat: "Minuman", jual: 10000, resep: [["teh", 1], ["susu", 1], ["cup", 1]] },
  { nama: "Jus Jeruk", kat: "Minuman", jual: 12000, resep: [["jeruk", 1], ["es", 1], ["cup", 1]] },
  { nama: "Paket Hemat Bakso + Es Teh", kat: "Paket", jual: 16000, resep: [["teh", 1], ["gula", 1], ["es", 1]], dasar: "Bakso Biasa" },
];

type AddonSpec = { nama: string; harga: number; maks?: number; bahan?: [string, number] };
type GrupSpec = { nama: string; min?: number; maks?: number; addons: AddonSpec[] };

const PEDAS: GrupSpec = {
  nama: "Level pedas",
  min: 1,
  maks: 1,
  addons: [
    { nama: "Tidak pedas", harga: 0, maks: 1 },
    { nama: "Sedang", harga: 0, maks: 1, bahan: ["sambal", 1] },
    { nama: "Pedas", harga: 0, maks: 1, bahan: ["sambal", 2] },
  ],
};
const TAMBAHAN_MIE: GrupSpec = {
  nama: "Tambahan",
  addons: [
    { nama: "Extra mie", harga: 4000, maks: 2, bahan: ["mie", 1] },
    { nama: "Telur", harga: 4000, maks: 2, bahan: ["telur", 1] },
    { nama: "Bakso", harga: 3000, maks: 3, bahan: ["bakso", 3] },
    { nama: "Tanpa sayur", harga: 0, maks: 1 },
  ],
};
const TAMBAHAN_BAKSO: GrupSpec = {
  nama: "Tambahan",
  addons: [
    { nama: "Extra bakso", harga: 3000, maks: 3, bahan: ["bakso", 3] },
    { nama: "Extra mie", harga: 4000, maks: 2, bahan: ["mie", 1] },
    { nama: "Telur", harga: 4000, maks: 2, bahan: ["telur", 1] },
  ],
};
const KUAH: GrupSpec = {
  nama: "Catatan kuah",
  maks: 1,
  addons: [
    { nama: "Kuah pisah", harga: 0, maks: 1 },
    { nama: "Tanpa seledri", harga: 0, maks: 1 },
  ],
};
const GULA: GrupSpec = {
  nama: "Gula",
  maks: 1,
  addons: [
    { nama: "Normal", harga: 0, maks: 1 },
    { nama: "Less sugar", harga: 0, maks: 1 },
    { nama: "Tanpa gula", harga: 0, maks: 1 },
  ],
};
const UKURAN: GrupSpec = { nama: "Ukuran", maks: 1, addons: [{ nama: "Jumbo", harga: 3000, maks: 1, bahan: ["es", 1] }] };
const TAMBAHAN_KOPI: GrupSpec = {
  nama: "Tambahan",
  addons: [
    { nama: "Extra shot", harga: 5000, maks: 2, bahan: ["kopi", 1] },
    { nama: "Susu oat", harga: 4000, maks: 1 },
  ],
};

/**
 * Grup add-on per menu. SATU grup WAJIB ("Level pedas" di Mie Ayam) — sengaja,
 * keputusan pemilik: tamu harus bisa mencoba alur wajib-pilih. Konsekuensinya
 * (APK ponsel lama tak bisa menjual Mie Ayam) sudah diterima.
 */
const ADDON_MENU: Record<string, GrupSpec[]> = {
  "Mie Ayam": [PEDAS, TAMBAHAN_MIE],
  "Mie Ayam Bakso": [TAMBAHAN_MIE],
  "Bakso Spesial": [TAMBAHAN_BAKSO, KUAH],
  "Bakso Biasa": [TAMBAHAN_BAKSO, KUAH],
  "Bakso Urat": [TAMBAHAN_BAKSO, KUAH],
  "Es Teh Manis": [GULA, UKURAN],
  "Es Jeruk": [GULA, UKURAN],
  "Teh Tarik": [GULA],
  "Kopi Susu": [TAMBAHAN_KOPI, GULA],
  "Es Kopi Hitam": [TAMBAHAN_KOPI, GULA],
};

const SUPPLIER = [
  { nama: "Toko Daging Pak Darto", kategori: "daging", telepon: "081211110001", beli: ["bakso", "ayam"] },
  { nama: "Sayur Segar Bu Ani", kategori: "sayur", telepon: "081211110002", beli: ["sawi", "telur", "jeruk"] },
  { nama: "Grosir Minuman Jaya", kategori: "minuman", telepon: "081211110003", beli: ["kopi", "susu", "teh", "cup"] },
] as const;

const KARYAWAN = [
  { email: "dapur-demo@terakasir.app", nama: "Dapur Demo", role: "kitchen" as const },
  { email: "tim-demo@terakasir.app", nama: "Tim Demo", role: "tim" as const },
];

const MEMBER = [
  { nama: "Budi Santoso", wa: "081300000001" },
  { nama: "Siti Rahma", wa: "081300000002" },
  { nama: "Andi Wijaya", wa: "081300000003" },
  { nama: "Dewi Lestari", wa: "081300000004" },
  { nama: "Rizky Pratama", wa: "081300000005" },
  { nama: "Maya Sari", wa: "081300000006" },
];

/** Jalankan sekali untuk perusahaan demo. Dipanggil `provisionGuest` tiap boot. */
export async function lengkapiDataDemoSekali(companyId: string, ownerId: string, kasirId: string) {
  return sekaliSaja(KUNCI, () => lengkapiDataDemo(companyId, ownerId, kasirId));
}

/** Isi data demo. Mengembalikan jumlah penjualan demo yang tercatat. */
export async function lengkapiDataDemo(companyId: string, ownerId: string, kasirId: string): Promise<number> {
  // Cabang tertua = cabang demo. Dibaca semua (perusahaan demo cuma punya
  // satu-dua cabang) lalu diambil yang pertama.
  const daftarCabang = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.companyId, companyId))
    .orderBy(asc(branches.createdAt), asc(branches.id));
  const [perusahaan] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (daftarCabang.length === 0 || !perusahaan) return 0;
  const branchId = daftarCabang[0].id;

  /*
   * SENGAJA TANPA TRANSAKSI. Tiap tulisan master di bawah sudah idempoten
   * sendiri (kunci unik + `onConflictDoNothing`, atau "hanya bila belum
   * ada"), jadi kegagalan di tengah aman diulang boot berikutnya — penanda
   * `sekaliSaja` baru tercatat sesudah semuanya selesai. Transaksi panjang
   * dengan belasan kueri per-baris justru menahan satu koneksi kolam selama
   * boot (`round-trip-per-baris`).
   */
  const tx = db;
  {
    // ── Bahan baru (stok awal hanya untuk yang BARU dibuat) ────────────────
    const bahanBaru = await tx
      .insert(ingredients)
      .values(
        BAHAN_BARU.map((b) => ({
          companyId,
          slug: b.slug,
          nama: b.nama,
          hargaBeli: b.harga,
          isi: 1,
          satuan: b.satuan,
          kategori: "lain",
          isPackaging: "kemasan" in b ? b.kemasan : false,
          stokMinimum: Math.ceil(b.stok * 0.15),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: ingredients.id, slug: ingredients.slug });
    if (bahanBaru.length > 0) {
      const stokBySlug = new Map<string, number>(BAHAN_BARU.map((b) => [b.slug, b.stok]));
      const hari = tanggalDi(perusahaan.timezone);
      await tx.insert(stockOpnames).values(
        bahanBaru.map((b) => ({
          companyId,
          branchId,
          ingredientId: b.id,
          qty: stokBySlug.get(b.slug) ?? 0,
          opnameDate: hari,
          catatan: "Stok awal demo (tamu)",
          userId: ownerId,
        })),
      );
    }
    const semuaBahan = await tx
      .select({ id: ingredients.id, slug: ingredients.slug, harga: ingredients.hargaBeli })
      .from(ingredients)
      .where(and(eq(ingredients.companyId, companyId), eq(ingredients.isActive, true)));
    const bahanId = new Map(semuaBahan.map((b) => [b.slug, b.id]));
    const hargaBahan = new Map(semuaBahan.map((b) => [b.slug, b.harga]));

    // ── Meja tambahan (cabang baru cuma punya "Meja 1") ────────────────────
    // Supaya ada meja TERISI (open bill demo) dan meja kosong untuk dicoba.
    await tx
      .insert(meja)
      .values(
        [2, 3, 4, 5, 6].map((no, i) => ({
          companyId,
          branchId,
          nama: `Meja ${no}`,
          tipe: "dine_in" as const,
          posX: 20 + (i % 3) * 30,
          posY: 70 + Math.floor(i / 3) * 15,
        })),
      )
      .onConflictDoNothing();

    // ── Kategori & menu baru ───────────────────────────────────────────────
    await tx
      .insert(menuCategories)
      .values(["Makanan", "Minuman", "Paket"].map((nama, i) => ({ companyId, nama, sortOrder: i })))
      .onConflictDoNothing();
    const kategori = await tx
      .select({ id: menuCategories.id, nama: menuCategories.nama })
      .from(menuCategories)
      .where(eq(menuCategories.companyId, companyId));
    const katId = new Map(kategori.map((k) => [k.nama, k.id]));

    const menuAda = await tx
      .select({ id: menus.id, nama: menus.nama })
      .from(menus)
      .where(eq(menus.companyId, companyId));
    const menuId = new Map(menuAda.map((m) => [m.nama, m.id]));
    for (const [i, m] of MENU_BARU.entries()) {
      if (menuId.has(m.nama) || !katId.has(m.kat)) continue;
      const dasarId = m.dasar ? menuId.get(m.dasar) : undefined;
      if (m.dasar && !dasarId) continue; // menu dasar paket sudah dihapus pengunjung
      const [baru] = await tx
        .insert(menus)
        .values({
          companyId,
          categoryId: katId.get(m.kat)!,
          nama: m.nama,
          tipe: dasarId ? "paket" : "regular",
          mult: dasarId ? null : 1.5,
          baseMenuId: dasarId ?? null,
          baseMult: dasarId ? 1 : null,
          hargaJual: m.jual,
          sortOrder: 20 + i,
        })
        .onConflictDoNothing()
        .returning({ id: menus.id });
      if (!baru) continue;
      menuId.set(m.nama, baru.id);
      const resep = m.resep.filter(([slug]) => bahanId.has(slug));
      if (resep.length > 0) {
        await tx
          .insert(menuComponents)
          .values(resep.map(([slug, qty]) => ({ menuId: baru.id, ingredientId: bahanId.get(slug)!, qty })));
      }
    }

    // ── Add-on: hanya menu AKTIF yang belum punya grup add-on ──────────────
    const menuAktif = await tx
      .select({ id: menus.id, nama: menus.nama })
      .from(menus)
      .where(and(eq(menus.companyId, companyId), eq(menus.isActive, true)));
    const sasaran = menuAktif.filter((m) => ADDON_MENU[m.nama]);
    const sudahBerGrup = new Set(
      sasaran.length === 0
        ? []
        : (
            await tx
              .select({ menuId: menuAddonGroups.menuId })
              .from(menuAddonGroups)
              .where(
                and(
                  eq(menuAddonGroups.companyId, companyId),
                  inArray(
                    menuAddonGroups.menuId,
                    sasaran.map((m) => m.id),
                  ),
                  isNull(menuAddonGroups.deletedAt),
                ),
              )
          ).map((g) => g.menuId),
    );
    for (const m of sasaran) {
      if (sudahBerGrup.has(m.id)) continue;
      for (const [gi, g] of ADDON_MENU[m.nama].entries()) {
        const [grup] = await tx
          .insert(menuAddonGroups)
          .values({ companyId, menuId: m.id, nama: g.nama, minPilih: g.min ?? 0, maksPilih: g.maks ?? null, sortOrder: gi })
          .returning({ id: menuAddonGroups.id });
        await tx.insert(menuAddons).values(
          g.addons.map((a, ai) => {
            const bahan = a.bahan && bahanId.has(a.bahan[0]) ? a.bahan : null;
            return {
              companyId,
              groupId: grup.id,
              nama: a.nama,
              harga: a.harga,
              maksJumlah: a.maks ?? null,
              ingredientId: bahan ? bahanId.get(bahan[0])! : null,
              qtyBahan: bahan ? bahan[1] : null,
              sortOrder: ai,
            };
          }),
        );
      }
    }

    // ── Supplier & pembelian (2 minggu terakhir) ───────────────────────────
    await tx
      .insert(suppliers)
      .values(SUPPLIER.map((s) => ({ companyId, nama: s.nama, kategori: s.kategori, telepon: s.telepon })))
      .onConflictDoNothing();
    const daftarSupplier = await tx
      .select({ id: suppliers.id, nama: suppliers.nama })
      .from(suppliers)
      .where(eq(suppliers.companyId, companyId));
    const supplierId = new Map(daftarSupplier.map((s) => [s.nama, s.id]));
    const beli: (typeof productions.$inferInsert)[] = [];
    let n = 0;
    for (const s of SUPPLIER) {
      for (const slug of s.beli) {
        const id = bahanId.get(slug);
        if (!id) continue;
        const qty = 20 + (n % 3) * 10;
        const waktu = new Date(Date.now() - (2 + n * 2) * 86_400_000);
        beli.push({
          companyId,
          branchId,
          ingredientId: id,
          qty,
          tipe: "beli",
          totalHarga: qty * (hargaBahan.get(slug) ?? 0),
          supplierId: supplierId.get(s.nama) ?? null,
          userId: ownerId,
          catatan: "Belanja demo (tamu)",
          waktu,
          prodDate: tanggalDi(perusahaan.timezone, waktu),
        });
        n += 1;
      }
    }
    if (beli.length > 0) await tx.insert(productions).values(beli);

    // ── Karyawan dapur & tim (password acak — bukan untuk login) ──────────
    for (const k of KARYAWAN) {
      const [u] = await tx
        .insert(users)
        .values({
          email: k.email,
          passwordHash: bcrypt.hashSync(randomBytes(18).toString("base64url"), 10),
          nama: k.nama,
          emailVerifiedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!u) continue;
      await tx.insert(memberships).values({
        userId: u.id,
        companyId,
        role: k.role,
        branchId,
        employeeCode: await resolveKodeKaryawan(tx, companyId),
      });
    }
  }

  const pilihan = await pilihanPerMenu(companyId);
  const terjual = await penjualanDemo(companyId, branchId, kasirId, pilihan);
  await openBillDemo(companyId, branchId, kasirId, pilihan);
  console.log(`Guest mode: data demo dilengkapi (${terjual} penjualan, add-on, bill, member, supplier).`);
  return terjual;
}

type AddonDemo = {
  id: string;
  nama: string;
  harga: number;
  grupNama: string;
  wajib: boolean;
  ingredientId: string | null;
  qtyBahan: number | null;
};

/** Add-on aktif tiap menu aktif — bahan untuk penjualan & bill demo. */
async function pilihanPerMenu(companyId: string) {
  const baris = await db
    .select({
      menuId: menuAddonGroups.menuId,
      grupNama: menuAddonGroups.nama,
      minPilih: menuAddonGroups.minPilih,
      id: menuAddons.id,
      nama: menuAddons.nama,
      harga: menuAddons.harga,
      ingredientId: menuAddons.ingredientId,
      qtyBahan: menuAddons.qtyBahan,
    })
    .from(menuAddons)
    .innerJoin(menuAddonGroups, eq(menuAddons.groupId, menuAddonGroups.id))
    .where(
      and(
        eq(menuAddons.companyId, companyId),
        eq(menuAddons.isActive, true),
        isNull(menuAddons.deletedAt),
        isNull(menuAddonGroups.deletedAt),
      ),
    )
    .orderBy(asc(menuAddonGroups.sortOrder), asc(menuAddons.sortOrder));
  const menuAktif = await db
    .select({ id: menus.id, nama: menus.nama, harga: menus.hargaJual })
    .from(menus)
    .where(and(eq(menus.companyId, companyId), eq(menus.isActive, true)))
    .orderBy(asc(menus.sortOrder), asc(menus.nama));
  const perMenu = new Map<string, AddonDemo[]>();
  for (const b of baris) {
    const list = perMenu.get(b.menuId) ?? [];
    list.push({ ...b, wajib: b.minPilih >= 1 });
    perMenu.set(b.menuId, list);
  }
  return { menuAktif, perMenu };
}

/**
 * Pilihan add-on deterministik untuk baris ke-`n`: grup WAJIB selalu terisi
 * satu pilihan (bergiliran), dan kira-kira separuh baris mendapat satu add-on
 * opsional (kadang ×2). Selalu sah menurut aturan grup.
 */
function pilihAddon(addons: AddonDemo[] | undefined, n: number): { pilihan: PilihanAddon[]; snap: AddonDemo[] } {
  if (!addons || addons.length === 0) return { pilihan: [], snap: [] };
  const pilihan: PilihanAddon[] = [];
  const snap: AddonDemo[] = [];
  const grupWajib = [...new Set(addons.filter((a) => a.wajib).map((a) => a.grupNama))];
  for (const g of grupWajib) {
    const opsi = addons.filter((a) => a.grupNama === g);
    const a = opsi[n % opsi.length];
    pilihan.push({ id: a.id, jumlah: 1 });
    snap.push(a);
  }
  const opsional = addons.filter((a) => !a.wajib);
  if (opsional.length > 0 && n % 2 === 0) {
    const a = opsional[n % opsional.length];
    const jumlah = a.harga > 0 && n % 4 === 0 ? 2 : 1;
    pilihan.push({ id: a.id, jumlah });
    for (let i = 0; i < jumlah; i += 1) snap.push(a);
  }
  return { pilihan, snap };
}

/** ±40 struk tersebar 21 hari terakhir, sebagian bermember & ber-add-on. */
async function penjualanDemo(
  companyId: string,
  branchId: string,
  kasirId: string,
  { menuAktif, perMenu }: Awaited<ReturnType<typeof pilihanPerMenu>>,
): Promise<number> {
  if (menuAktif.length === 0) return 0;
  const metode = ["tunai", "qris", "transfer"] as const;
  let dibuat = 0;
  // Diurutkan menurut waktu supaya nomor struk urut, dan jamnya jam WIB
  // (10.00–19.00) — `setUTCHours`, sebab server berjalan UTC (laporan uji
  // 31 Okt 2026: demo menumpuk 17.00–02.59 dan nomornya tak urut).
  const urutan40 = Array.from({ length: 40 }, (_, n) => {
    const waktu = new Date(Date.now() - (1 + (n % 21)) * 86_400_000);
    waktu.setUTCHours(10 + (n % 10) - 7, (n * 13) % 60, 0, 0);
    return { n, waktu };
  }).sort((a, b) => a.waktu.getTime() - b.waktu.getTime());
  for (const { n, waktu } of urutan40) {
    const items: { menu_id: string; qty: number; addons?: PilihanAddon[] }[] = [];
    let total = 0;
    const jumlahItem = 1 + (n % 3);
    for (let k = 0; k < jumlahItem; k += 1) {
      const m = menuAktif[(n * 5 + k * 3) % menuAktif.length];
      // Satu menu cukup sekali per struk — dua baris menu sama berbeda add-on
      // sah, tapi demo yang rapi lebih mudah dibaca di riwayat.
      if (items.some((it) => it.menu_id === m.id)) continue;
      const urutan = n + k;
      const addonMenu = perMenu.get(m.id);
      const { pilihan, snap } = pilihAddon(addonMenu, urutan);
      const qty = 1 + (urutan % 2);
      items.push({ menu_id: m.id, qty, ...(pilihan.length > 0 ? { addons: pilihan } : {}) });
      total += (m.harga + hargaAddon(snap.map((a) => ({ harga: a.harga, jumlah: 1 })))) * qty;
    }
    const member = n % 3 === 0 ? MEMBER[(n / 3) % MEMBER.length] : null;
    const bayar = metode[n % 3];
    try {
      await createSale({
        companyId,
        branchId,
        cashierUserId: kasirId,
        isDineIn: n % 4 !== 0,
        metodeBayar: bayar,
        uangDiterima: bayar === "tunai" ? Math.ceil((total * 1.11 + 1) / 10000) * 10000 : null,
        customerNama: member?.nama ?? null,
        customerWa: member?.wa ?? null,
        waktu,
        // Riwayat masa lalu: gerbang stok & aturan add-on hari ini tak relevan
        // untuk transaksi yang "sudah terjadi" (jalur yang sama dengan sinkron
        // offline). Pilihan add-on-nya tetap dirakit sah di atas.
        transaksiSusulan: true,
        items,
      });
      dibuat += 1;
    } catch (e) {
      // Satu struk demo yang gagal (mis. pengunjung menghapus menu di sela
      // boot) tak boleh menggagalkan seluruh demo — tapi tetap DICATAT.
      console.warn("Guest mode: penjualan demo dilewati —", e instanceof Error ? e.message : e);
    }
  }
  return dibuat;
}

/** Tiga open bill di meja dine-in yang sedang kosong, berisi baris ber-add-on. */
async function openBillDemo(
  companyId: string,
  branchId: string,
  kasirId: string,
  { menuAktif, perMenu }: Awaited<ReturnType<typeof pilihanPerMenu>>,
) {
  if (menuAktif.length === 0) return;
  const mejaKosong = await db
    .select({ id: meja.id, nama: meja.nama })
    .from(meja)
    .leftJoin(openBills, and(eq(openBills.mejaId, meja.id), isNull(openBills.closedAt)))
    .where(
      and(
        eq(meja.companyId, companyId),
        eq(meja.branchId, branchId),
        eq(meja.tipe, "dine_in"),
        eq(meja.isActive, true),
        isNull(openBills.id),
      ),
    )
    .orderBy(asc(meja.nama), asc(meja.id));
  const tamu = ["Pak Joko", "Bu Rina", "Mas Fajar"];
  // Menu ber-add-on didahulukan supaya bill demo memperlihatkannya.
  const urut = [...menuAktif].sort((a, b) => (perMenu.has(b.id) ? 1 : 0) - (perMenu.has(a.id) ? 1 : 0));
  // Paling banyak tiga meja — sisanya dibiarkan kosong untuk dicoba tamu.
  for (const [i, m] of mejaKosong.slice(0, 3).entries()) {
    // Barisnya dirakit DI LUAR transaksi — di dalamnya cuma tiga pernyataan.
    const baris = [urut[(i * 2) % urut.length], urut[(i * 2 + 1) % urut.length]].filter(
      (x, j, arr) => arr.findIndex((y) => y.id === x.id) === j,
    );
    const rakit = baris.map((menu, bi) => {
      const urutan = i + bi * 2;
      const { snap } = pilihAddon(perMenu.get(menu.id), urutan);
      // Kelompokkan pilihan ganda (Extra mie ×2) jadi satu snapshot berjumlah.
      const jumlah = new Map<string, { a: AddonDemo; jumlah: number }>();
      for (const a of snap) jumlah.set(a.id, { a, jumlah: (jumlah.get(a.id)?.jumlah ?? 0) + 1 });
      const daftar = [...jumlah.values()];
      // Rumus yang sama dengan rute open bill: harga terkunci TERMASUK add-on.
      const harga = menu.harga + hargaAddon(daftar.map((d) => ({ harga: d.a.harga, jumlah: d.jumlah })));
      return { menu, daftar, harga, qty: 1 + bi };
    });
    await db.transaction(async (tx) => {
      const [bill] = await tx
        .insert(openBills)
        .values({ companyId, branchId, mejaId: m.id, mejaLabel: m.nama, customerNama: tamu[i] ?? null, createdBy: kasirId })
        .returning({ id: openBills.id });
      // Satu pernyataan untuk seluruh baris; `.returning()` sejajar urutan VALUES.
      const item = await tx
        .insert(openBillItems)
        .values(rakit.map((r) => ({ billId: bill.id, menuId: r.menu.id, menuNama: r.menu.nama, hargaSatuan: r.harga, qty: r.qty })))
        .returning({ id: openBillItems.id });
      const pasangan = rakit.flatMap((r, ri) => r.daftar.map((d, si) => ({ openBillItemId: item[ri].id, d, si })));
      if (pasangan.length > 0) {
        await tx.insert(openBillItemAddons).values(
          pasangan.map(({ openBillItemId, d, si }) => ({
            openBillItemId,
            companyId,
            addonId: d.a.id,
            grupNama: d.a.grupNama,
            nama: d.a.nama,
            harga: d.a.harga,
            jumlah: d.jumlah,
            ingredientId: d.a.ingredientId,
            qtyBahan: d.a.qtyBahan,
            sortOrder: si,
          })),
        );
      }
    });
  }
}
