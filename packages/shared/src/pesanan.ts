import type { PesananItemRow, PesananRow, PesananStatus } from "./types";

/**
 * Status KARTU diturunkan dari baris-barisnya, tidak pernah disimpan.
 *
 * `batal` hanya bila SEMUA baris batal — satu porsi yang masih dimasak membuat
 * pesanan ini belum batal. `selesai` bila tak ada lagi yang `dikerjakan`, jadi
 * pesanan yang separuh batal separuh matang tetap lepas dari kolom dapur.
 */
export function turunkanStatusPesanan(
  items: { status: PesananStatus }[],
): PesananStatus {
  if (items.length === 0) return "dikerjakan";
  if (items.every((i) => i.status === "batal")) return "batal";
  if (items.every((i) => i.status !== "dikerjakan")) return "selesai";
  return "dikerjakan";
}

/**
 * Penanda penyajian sebuah baris penjualan SAAT DIBUAT.
 *
 * Dua sumber, dan yang menang adalah sinyal EKSPLISIT mana pun yang ada:
 * penanda 🥡 yang sudah ditekan dapur pada baris open bill asalnya, atau baris
 * yang memang dibukukan bukan dine-in. Karena itu OR, bukan salah satunya saja:
 * tanpa mewarisi tanda dapur, penanda pada bill yang belum dibayar hilang tepat
 * di titik pembayaran — dus yang sudah diambil dari rak tak pernah masuk HPP
 * maupun `sale_consumptions`.
 *
 * AKIBAT YANG MUDAH TERLEWAT, dan sudah pernah melahirkan bug: sebuah baris
 * BISA lahir dengan `sajian_takeaway === is_dine_in`. Dapur menandai 🥡 pada
 * bill di meja dine-in, kasir menagihnya tanpa `dine_in_override` → baris lahir
 * `is_dine_in: true` **dan** `sajian_takeaway: true`. Kesamaan itu karena itu
 * BUKAN bukti ada yang membaliknya sesudah transaksi ditutup — lihat
 * `sajianBedaDariNota`.
 */
export function penandaSajian(p: {
  /** `sajian_takeaway` baris open bill asalnya — hanya ada bila baris ini dari bill. */
  warisTakeaway?: boolean | null;
  /** `is_dine_in` baris ini: fakta pembukuan, bukan cara penyajiannya. */
  dineIn: boolean;
}): boolean {
  return (p.warisTakeaway ?? false) || !p.dineIn;
}

/**
 * Apakah ADA baris yang penyajiannya berbeda dari pembukuan barisnya sendiri?
 *
 * `is_dine_in` adalah fakta pembukuan (di mana pesanan ini dimakan — dasar
 * pemisahan omzet dan label meja pada nota). `sajian_takeaway` adalah cara ia
 * benar-benar disajikan, dan sejak tombol 🥡 memindahkan uang, ia juga BASIS
 * BIAYA. Baris yang keduanya SAMA berarti nota dan piring bercerita beda:
 * dine-in yang dibungkus, atau bawa pulang yang berakhir di piring.
 *
 * Dibatasi ke pesanan yang SUDAH DIBAYAR bukan karena bedanya baru muncul di
 * sana, tapi karena di sanalah bedanya sudah jadi angka — kemasannya sudah
 * masuk HPP dan sudah keluar dari stok.
 *
 * TIGA HAL yang gampang salah, dan ketiganya pernah salah di sini:
 *
 * 1. Jangan pakai `sajian_takeaway` KARTU. Itu `items.every(…)` — "semua baris
 *    bawa pulang" — jadi pesanan dine-in yang cuma SEBAGIAN dibungkus tetap
 *    beragregat false, `false === true` tak pernah cocok, dan kartunya diam
 *    meski uang sudah berpindah. Arah sebaliknya kebetulan tertangkap, dan
 *    ketimpangan itulah yang membuatnya terbaca benar sekilas.
 *
 * 2. Jangan bandingkan baris dengan `is_dine_in` KARTU. Kasir boleh menandai
 *    satu porsi dibungkus di meja yang makan di tempat (`dine_in_override`),
 *    dan baris itu memang lahir `is_dine_in` false di penjualan yang
 *    `is_dine_in`-nya true. Membandingkannya dengan penanda kartu menuduhnya
 *    berubah padahal kasir sendiri yang menetapkannya sebelum uang diterima.
 *
 * 3. JANGAN MENYEBUTNYA "DIUBAH SETELAH TRANSAKSI". Itu nama lama fungsi ini
 *    dan bunyi lama badge-nya, dan datanya tak pernah bisa membuktikannya:
 *    `penandaSajian` MEWARISI tanda 🥡 dapur dari baris open bill, jadi baris
 *    dine-in bisa LAHIR `sajian_takeaway: true` — persis alur yang paling
 *    sering dipakai. Papan lalu menuduh "diubah setelah transaksi" pada pesanan
 *    yang tak pernah disentuh sesudah dibayar, dan tuduhan yang salah sesering
 *    itu ikut menenggelamkan tuduhan yang benar.
 */
export function sajianBedaDariNota(
  p: Pick<PesananRow, "dibayar" | "items">,
): boolean {
  return (
    p.dibayar && p.items.some((it) => it.sajian_takeaway === it.is_dine_in)
  );
}

/**
 * Lama pengerjaan SATU baris, dalam detik — `null` bila belum ada hasilnya.
 *
 * `null`, bukan 0, untuk tiga keadaan yang berbeda tapi sama-sama "tak ada
 * angkanya": baris masih dikerjakan, baris dibatalkan (tak ada pekerjaan yang
 * rampung), dan baris yang statusnya `selesai` tapi tak berwaktu (data dari
 * sebelum fitur ini ada). Nol berarti "keluar seketika" dan akan menarik turun
 * setiap rata-rata yang menyentuhnya.
 *
 * Dijepit di bawah pada 0: jam server yang pernah mundur tak boleh melahirkan
 * durasi negatif di laporan.
 */
export function durasiPesananDetik(b: {
  status: PesananStatus;
  masuk_pada: string;
  status_pada: string | null;
}): number | null {
  if (b.status !== "selesai" || !b.status_pada) return null;
  const mulai = Date.parse(b.masuk_pada);
  const selesai = Date.parse(b.status_pada);
  if (!Number.isFinite(mulai) || !Number.isFinite(selesai)) return null;
  return Math.max(0, Math.round((selesai - mulai) / 1000));
}

/** Bagian `PesananRow` yang seluruhnya turunan `items`. */
export type RingkasanPesanan = Pick<
  PesananRow,
  | "status"
  | "sajian_takeaway"
  | "item_selesai"
  | "item_batal"
  | "status_oleh"
  | "status_pada"
  | "durasi_detik"
>;

/**
 * Ringkasan kartu dari baris-barisnya.
 *
 * DIPAKAI DUA SISI: server saat menyusun `GET /api/pesanan`, dan web saat
 * memperbarui kartu secara optimistis sebelum jawaban server datang. Kalau
 * keduanya punya salinan sendiri, papan akan menampilkan kolom/badge yang
 * berbeda dari yang akan dikirim server — dan bedanya baru terlihat 15 detik
 * kemudian saat polling menimpanya. Satu implementasi, satu perilaku.
 */
export function ringkasPesanan(items: PesananItemRow[]): RingkasanPesanan {
  // "Terakhir disentuh" = perubahan baris paling baru pada kartu ini.
  let statusOleh: string | null = null;
  let statusPada: string | null = null;
  for (const it of items) {
    if (it.status_pada && (!statusPada || it.status_pada > statusPada)) {
      statusPada = it.status_pada;
      statusOleh = it.status_oleh;
    }
  }
  return {
    status: turunkanStatusPesanan(items),
    // Kartu "bawa pulang" hanya bila SELURUH barisnya begitu — satu piring yang
    // tetap di tempat sudah cukup membuat pesanan ini bukan pesanan bawa pulang.
    sajian_takeaway: items.length > 0 && items.every((i) => i.sajian_takeaway),
    item_selesai: items.filter((i) => i.status === "selesai").length,
    item_batal: items.filter((i) => i.status === "batal").length,
    status_oleh: statusOleh,
    status_pada: statusPada,
    durasi_detik: durasiKartu(items),
  };
}

/**
 * Lama SELURUH kartu rampung, dalam detik — `null` selama belum rampung.
 *
 * Diukur dari baris paling AWAL masuk sampai baris paling AKHIR selesai, jadi
 * ia menjawab "berapa lama tamu menunggu sampai semuanya keluar". Bukan jumlah
 * durasi tiap baris: dapur mengerjakan beberapa sajian sekaligus, dan
 * menjumlahkannya melaporkan penantian yang tak pernah terjadi.
 *
 * Baris `batal` diabaikan sepenuhnya — ia tak menahan kartu jadi rampung, dan
 * tak ikut menentukan kapan mulai atau selesai. Kartu yang SELURUH barisnya
 * batal bernilai `null`: tak ada yang pernah dikerjakan.
 */
function durasiKartu(items: PesananItemRow[]): number | null {
  const hidup = items.filter((i) => i.status !== "batal");
  if (hidup.length === 0) return null;
  if (!hidup.every((i) => i.status === "selesai" && i.status_pada)) return null;
  let mulai = Infinity;
  let selesai = -Infinity;
  for (const i of hidup) {
    const m = Date.parse(i.masuk_pada);
    const s = Date.parse(i.status_pada!);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    if (m < mulai) mulai = m;
    if (s > selesai) selesai = s;
  }
  return Math.max(0, Math.round((selesai - mulai) / 1000));
}

/**
 * Kunci urut papan: **yang terakhir diubah selalu di atas**.
 *
 * Bukan waktu pesanan masuk. Dapur menandai sajian sepanjang shift, dan kartu
 * yang baru disentuh adalah kartu yang sedang dikerjakan orang — itu yang harus
 * ada di depan mata, bukan yang kebetulan masuk paling akhir. Kartu yang belum
 * pernah disentuh jatuh ke waktu masuknya, jadi pesanan baru tetap muncul di
 * atas dan tak ada yang tenggelam.
 */
export function kunciUrutPesanan(
  p: Pick<PesananRow, "waktu" | "status_pada">,
): string {
  return p.status_pada && p.status_pada > p.waktu ? p.status_pada : p.waktu;
}

/** Urutkan papan di tempat baru (tidak mengubah array masukan). */
export function urutkanPesanan<
  T extends Pick<PesananRow, "waktu" | "status_pada">,
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    kunciUrutPesanan(b).localeCompare(kunciUrutPesanan(a)),
  );
}

/**
 * Apakah menu ini BIASANYA melewati targetnya.
 *
 * Dasarnya MEDIAN, bukan rata-rata, dan itu keputusan yang menentukan berguna
 * atau tidaknya seluruh bendera ini. Satu sajian yang lupa ditandai sampai
 * tutup toko menarik rata-rata naik berjam-jam; bendera berbasis rata-rata
 * akan menyala untuk menu yang sebenarnya baik-baik saja, dan bendera yang
 * sering salah dimatikan orang — lalu tak menjaga apa pun saat benar.
 *
 * Pembandingnya `>` dan bukan `>=`: sajian yang selesai TEPAT pada targetnya
 * memenuhi targetnya. Bendera yang menyala di angka yang persis dijanjikan
 * membuat target mana pun mustahil dipenuhi.
 *
 * Target null/0 = belum ditetapkan → tak pernah menyala. Menuduh terlambat
 * terhadap angka yang tak pernah dipilih siapa-siapa cuma melatih orang
 * mengabaikan laporannya.
 */
export function lewatTargetDurasi(medianDetik: number, targetDetik: number | null): boolean {
  if (targetDetik == null || targetDetik <= 0) return false;
  return medianDetik > targetDetik;
}
