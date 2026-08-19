import type { MetodeBayar } from "./types";

/**
 * DATA CONTOH UNTUK CETAK UJI.
 *
 * Sebelum ini, satu-satunya cara melihat bagaimana struk keluar dari printer
 * adalah MELAKUKAN TRANSAKSI SUNGGUHAN. Jadi tiap kali kertasnya diganti,
 * printernya dipindah, atau footer struk diubah, seseorang menjual sesuatu
 * lalu membatalkannya — dan pembatalan itu masuk laporan.
 *
 * Yang dibuat di sini cuma DATANYA. Yang menggambarnya tetap komponen yang
 * sama persis dengan yang dipakai kasir (`ReceiptModal`, `DokumenBelanjaModal`).
 * Itu disengaja: pratinjau yang punya kode gambarnya sendiri akan bergeser
 * dari yang asli, dan pratinjau yang bergeser lebih buruk daripada tak ada —
 * ia mengatakan tata letaknya beres justru ketika tidak.
 *
 * SEMUA CONTOH DITANDAI. Struk contoh yang tercecer di meja kasir tak boleh
 * bisa disangka nota sungguhan, jadi nomor, nama menu, dan catatannya semua
 * menyebut dirinya contoh.
 *
 * KENAPA DI `shared`, BUKAN DI `apps/web` bersama komponennya. Berkas ini cuma
 * DATA, dan data yang bisa dieksekusi uji lebih berharga daripada data yang
 * cuma bisa dibaca: aritmetika struk contoh (subtotal, PB1, kembalian) harus
 * konsisten, dan itu hanya terbukti dengan menjalankannya. Uji unit repo ini
 * berjalan di proyek server, yang tak bisa membaca tipe dari `apps/web` — versi
 * pertama berkas ini ada di sana, dan seluruh nilainya terbaca `any`.
 *
 * Tipe kembaliannya sengaja DIBIARKAN DISIMPULKAN, tanpa antarmuka baru di
 * sini. Yang mengikatnya ke bentuk yang sebenarnya adalah pembungkus tipis di
 * `apps/web/src/lib/contoh-cetak.ts` yang beranotasi `: SaleResult` /
 * `: FakturGroup`. Begitu bentuk aslinya berubah, yang gagal adalah typecheck
 * web — bukan tampilan cetak yang baru ketahuan sesudah kertasnya keluar.
 */

/** Angka pada contoh sengaja "bulat tapi tak rapi" supaya pembulatan ikut teruji. */
const HARGA_A = 27_500;
const HARGA_B = 18_000;

export interface OpsiContohStruk {
  branchId: string;
  branchNama: string;
  kasir?: string | null;
  /** dipakai uji: waktu tetap agar hasilnya bisa dibandingkan */
  waktu?: string;
}

export function contohStruk(opts: OpsiContohStruk) {
  const items = [
    { nama: "Contoh Nasi Goreng", harga: HARGA_A, qty: 2 },
    { nama: "Contoh Es Teh Manis", harga: HARGA_B, qty: 1 },
  ];
  const subtotal = items.reduce((t, i) => t + i.harga * i.qty, 0);
  const diskon = 5_000;
  const pb1 = Math.round((subtotal - diskon) * 0.1);
  const total = subtotal - diskon + pb1;
  return {
    sale: {
      id: "contoh",
      branchId: opts.branchId,
      // Bukan format nomor sungguhan: struk contoh yang tercecer tak boleh
      // bisa dicari di Riwayat, dan tak boleh disangka nota yang hilang.
      nomor: "CONTOH-CETAK-UJI",
      subtotal,
      diskon,
      diskonPersen: null,
      pb1Amount: pb1,
      total,
      waktu: opts.waktu ?? new Date().toISOString(),
      isDineIn: true,
      mejaLabel: "A1",
      customerNama: "Contoh Pelanggan",
      customerWa: null,
      metodeBayar: "tunai" as MetodeBayar,
      uangDiterima: Math.ceil(total / 10_000) * 10_000,
      catatan: "CETAK UJI — bukan transaksi",
      subtotalAsal: null,
      diskonAsal: null,
      pb1Asal: null,
      refundTotal: 0,
    },
    items: items.map((i, n) => ({
      id: `contoh-${n}`,
      menuNama: i.nama,
      hargaSatuan: i.harga,
      qty: i.qty,
      lineTotal: i.harga * i.qty,
      isDineIn: true,
      // Baris kedua diberi catatan supaya baris bercatatan ikut terlihat —
      // itulah baris yang paling sering meluber di kertas 58 mm.
      catatan: n === 1 ? "tanpa gula" : null,
      qtyRefund: 0,
    })),
    branch_nama: opts.branchNama,
    kasir: opts.kasir ?? "Contoh Kasir",
  };
}

function contohBaris(
  n: number,
  nama: string,
  qty: number,
  satuan: string,
  harga: number,
  supplierId: string | null,
) {
  const waktu = new Date().toISOString();
  return {
    id: `contoh-${n}`,
    bahan: nama,
    isi: 1,
    satuan,
    qty,
    total_harga: harga,
    is_batch: false,
    catatan: null,
    waktu,
    prod_date: waktu.slice(0, 10),
    faktur_id: "contoh",
    no_faktur: null,
    status: "menunggu" as const,
    supplier: supplierId ? "Contoh Supplier" : null,
    tempat: null,
    supplier_id: supplierId,
    // Dokumen belanja mengelompokkan per `supplier_bahan` (supplier UTAMA
    // bahan — "beli di mana"), BUKAN per `supplier_id` faktur. Contoh yang
    // hanya mengisi `supplier_id` tetap tergambar sebagai satu kelompok
    // "tanpa supplier"; terlihat saat mengukurnya di browser.
    supplier_bahan: supplierId ? "Contoh Supplier" : null,
    supplier_bahan_telepon: supplierId ? "08xx-xxxx-xxxx" : null,
    supplier_bahan_alamat: supplierId ? "Jl. Contoh No. 1" : null,
    storage_location_id: null,
    dibuat_oleh: "Contoh Pengguna",
    diubah_oleh: null,
    updated_at: null,
    worker_id: null,
    dikerjakan_oleh: null,
    qty_dipesan: qty,
    alasan_tolak: null,
    dana_cair: 0,
  };
}

export function contohFakturBelanja(opts: { cabang?: string | null } = {}) {
  const waktu = new Date().toISOString();
  // Dua bersupplier + satu tanpa supplier: dokumen belanja sungguhan
  // MENGELOMPOKKAN per supplier, dan kelompok "bebas beli di mana" digambar
  // berbeda. Contoh yang cuma memakai satu bentuk tak menguji yang satunya —
  // padahal keduanya biasa muncul di dokumen yang sama.
  const rows = [
    contohBaris(0, "Contoh Beras", 25, "kg", 350_000, "contoh-supplier"),
    contohBaris(1, "Contoh Minyak Goreng", 12, "liter", 216_000, "contoh-supplier"),
    contohBaris(2, "Contoh Gula Pasir", 10, "kg", 145_000, null),
  ];
  return {
    key: "contoh",
    fakturId: "contoh",
    waktu,
    prodDate: waktu.slice(0, 10),
    supplier: "Contoh Supplier",
    supplierId: null,
    noFaktur: null,
    nomor: "PB-CONTOH",
    status: "menunggu" as const,
    catatan: "CETAK UJI — bukan dokumen sungguhan",
    dibuatOleh: "Contoh Pengguna",
    diubahOleh: null,
    diterimaOleh: null,
    diterimaPada: null,
    updatedAt: null,
    workerId: null,
    dikerjakanOleh: null,
    cabang: opts.cabang ?? null,
    tujuanCabang: null,
    dariPermintaan: false,
    permintaanNomor: null,
    kiriman: false,
    untukCabang: null,
    divisi: [] as ("kitchen" | "bar")[],
    rows,
    totalHarga: rows.reduce((t, r) => t + (r.total_harga ?? 0), 0),
    danaCair: 0,
  };
}
