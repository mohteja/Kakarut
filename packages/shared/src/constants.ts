/** Ambang "Menipis": saldo / (stok awal + produksi) < 15% */
export const STOK_MENIPIS_THRESHOLD = 0.15;

/** Tarif PB1 (pajak restoran) default dalam persen */
export const DEFAULT_PB1_RATE = 10;

/**
 * Sesudah berapa HARI sebuah selisih kas yang menunggu keputusan dianggap
 * TERLAMBAT diputuskan.
 *
 * Tiga hari: cukup longgar untuk melewati akhir pekan atau pemilik yang sedang
 * di luar, tapi masih jauh dari "sudah dua minggu dan tak ada yang tahu" —
 * keadaan yang melahirkan angka ini (26 selisih menunggu, yang tertua 12 hari,
 * tanpa satu pun tanda di luar halaman Operasional Cabang).
 *
 * Ditaruh di `shared` supaya server (yang menghitung `terlambat` di
 * `GET /shift/selisih/ringkas`) dan web (yang menulis kalimatnya) tak bisa
 * berbeda pendapat soal kapan sesuatu terlambat.
 */
export const SELISIH_TERLAMBAT_HARI = 3;

/**
 * Apakah sebuah selisih kas yang menunggu sudah TERLAMBAT diputuskan.
 *
 * Fungsi, bukan perbandingan yang ditulis ulang di tiap pemakai: server
 * menghitung `terlambat` di `GET /shift/selisih/ringkas`, web menulis
 * kalimatnya di kartu Beranda, dan dua tempat yang menurunkan "terlambat"
 * sendiri-sendiri adalah dua tempat yang akan berselisih pendapat soal shift
 * yang sama.
 *
 * `sekarangMs` disuntikkan, bukan diambil dari `Date.now()` di dalam, supaya
 * ambangnya bisa diuji tanpa menunggu tiga hari.
 *
 * `null` (shift tanpa waktu tutup) = BUKAN terlambat: ia bahkan belum masuk
 * antrean putusan.
 */
export function selisihTerlambat(ditutupPada: string | null, sekarangMs: number): boolean {
  if (!ditutupPada) return false;
  const t = Date.parse(ditutupPada);
  if (!Number.isFinite(t)) return false;
  return sekarangMs - t > SELISIH_TERLAMBAT_HARI * 24 * 60 * 60 * 1000;
}

/**
 * ALASAN PENOLAKAN MASUK — satu rumah, sebab dua pihak mengucapkannya.
 *
 * Server melemparnya sebagai pesan HTTPException; web MEMBANDINGKANNYA untuk
 * tahu kapan menawarkan tautan "Daftar". Kalimat yang diketik ulang di layar
 * adalah kalimat yang akan bergeser sendiri — dan yang bergeser diam-diam
 * bukan tulisannya, melainkan tautannya: ia berhenti muncul, tanpa satu uji
 * pun berubah warna. `LoginPage` sudah punya satu contoh cara itu gagal
 * (`msg.toLowerCase().includes("belum diverifikasi")`, mengendus kalimat yang
 * tinggal di berkas lain).
 *
 * KEEMPATNYA 401. Yang membedakannya kalimatnya, bukan kontraknya.
 */
export const PESAN_LOGIN = {
  /**
   * Tak ada baris `users` untuk alamat ini. Dua sebab nyata di sistem ini, dan
   * keduanya berujung pada tindakan yang SAMA (daftar): (1) diundang tapi
   * belum pernah mendaftar — `POST /karyawan/undang` hanya menulis baris
   * `invitations`, akunnya baru lahir saat orangnya mendaftar sendiri;
   * (2) akun yang menghapus dirinya sendiri — `POST /onboarding/hapus-akun`
   * mengganti nama emailnya jadi `deleted:<id>:<email>`, jadi alamat aslinya
   * memang bebas dipakai ulang.
   *
   * SENGAJA TIDAK menyebut undangannya. "Anda punya undangan dari PT X" akan
   * membocorkan siapa bekerja di mana kepada siapa pun yang bisa mengetik
   * alamat email — satu tingkat lebih jauh dari yang diminta pemilik, dan
   * bocorannya milik orang lain, bukan miliknya.
   */
  takTerdaftar: "Email tidak terdaftar — periksa ejaannya, atau daftar dulu",
  /**
   * Tombstone `users.deletedAt` — DAN ia praktis tak pernah terbaca, sengaja
   * disebut supaya tak ada yang mengira cabangnya menganggur karena lupa.
   * Satu-satunya jalan yang menuliskannya (`POST /onboarding/hapus-akun`) ikut
   * mengganti nama emailnya jadi `deleted:<id>:<email>`, jadi alamat aslinya
   * jatuh ke `takTerdaftar` — dan itu jawaban yang BENAR: alamatnya memang
   * bebas dipakai ulang. Terukur pada DB gerbang 2026-09-03: 2 baris
   * tombstone, KEDUANYA sudah berganti nama. Cabangnya tetap ada sebagai
   * jaring untuk tombstone yang lahir dari jalan lain (tangan, migrasi).
   */
  terhapus: "Akun ini sudah dihapus",
  /**
   * `users.is_active = false` — dimatikan owner/admin lewat PATCH karyawan,
   * dan BISA dinyalakan lagi olehnya. Karena itu kalimatnya menyebut ke siapa
   * harus mengadu: orang yang membacanya tak bisa memperbaikinya sendiri, dan
   * dulu ia menerima "password salah" lalu mereset passwordnya berulang kali
   * tanpa hasil — sebab passwordnya memang tak pernah salah.
   */
  nonaktif: "Akun ini dinonaktifkan — hubungi pemilik atau admin usaha Anda",
  /** Baris ada, akun hidup, bcrypt tak cocok. Jalan keluarnya /lupa-password. */
  passwordSalah: "Password salah",
} as const;

/**
 * Panduan markup per jenis kategori (persen) — hanya panduan saat membuat
 * menu baru; menu yang sudah ada memakai `mult` tersimpan.
 */
export const PANDUAN_MARKUP: { kategori: string; persen: string; keterangan: string }[] = [
  { kategori: "Food set", persen: "100", keterangan: "Paket makanan (HPP × 2)" },
  { kategori: "Menu baru (food)", persen: "100", keterangan: "HPP × 2" },
  { kategori: "Minuman segar", persen: "150–175", keterangan: "HPP × 2.5–2.75" },
  { kategori: "Teh", persen: "150", keterangan: "HPP × 2.5" },
  { kategori: "Frozen / dessert", persen: "100–150", keterangan: "HPP × 2–2.5" },
  { kategori: "Yamin satuan", persen: "200", keterangan: "HPP × 3" },
  { kategori: "Side dish", persen: "250–350", keterangan: "HPP × 3.5–4.5" },
  { kategori: "Oseng", persen: "0", keterangan: "Tanpa markup" },
  { kategori: "Paket yamin", persen: "0", keterangan: "Rumus khusus (topping tanpa markup)" },
];

export type StokStatus = "habis" | "menipis" | "aman";
export type UserRole = "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar";

/**
 * SIAPA BOLEH MELIHAT ANGKA BIAYA — HPP menu, harga beli bahan, biaya resep.
 *
 * Aturannya sudah ditulis TIGA KALI di layar, dengan nama, sebelum ada di
 * sini: `isManajemen` (`App.tsx`, `Layout.tsx`), `bolehUbah` (`ResepPage`,
 * yang bahkan tak MENGAMBIL datanya lewat `enabled: bolehUbah`), dan
 * `lihatHarga` (`resep_page.dart`). Yang tak pernah ada: penjaganya di pintu.
 *
 * Terukur 2026-08-26 dengan token peran `bar` dan `cashier` sungguhan, DB
 * segar — keduanya membaca angka yang SAMA PERSIS dengan owner:
 *
 *   GET /menu           hpp 5662,03 · hpp_dine_in 4732,03 · harga_saran
 *                       10820,01 · food_cost_persen 51,47 ·
 *                       komponen[].harga_per_unit 357,14
 *   GET /bahan          harga_beli 35.000 · harga_per_unit 777,78
 *   GET /penjualan/:id  totalHpp 5662,0314 · items[].hppSatuan
 *
 * Ini rumahnya sekarang, dan `biaya-hanya-manajemen.test.ts` memaku ketiga
 * definisi klien tetap sepakat dengannya — supaya tak lahir aturan keempat
 * yang menyimpang diam-diam, kelas yang sudah sekali menggigit repo ini pada
 * rumus PB1.
 *
 * BUKAN kebijakan tentang siapa boleh MENGUBAH harga (itu `requireRole` di
 * pintunya masing-masing), melainkan siapa boleh MELIHAT biayanya.
 */
export function bolehLihatBiaya(role: UserRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
export type MenuTipe = "regular" | "paket";
/**
 * Kategori bahan = teks bebas dari master `ingredient_categories` (bisa
 * ditambah owner). "baso"/"minuman"/"lain" hanya nilai bawaan.
 */
export type BahanKategori = string;
/** jalur pengadaan bahan baku: diproduksi sendiri vs dibeli jadi */
export type JenisPengadaan = "produksi" | "beli";
/**
 * Lokasi produksi bahan jalur "produksi": diproduksi di Central Kitchen (lalu
 * dikirim ke cabang) atau langsung di cabang store (kitchen ATAU bar toko,
 * sesuai `divisi_produksi` — hasil masuk stok cabang itu). Hanya bermakna
 * untuk pengadaan "produksi".
 */
export type ProduksiDi = "ck" | "cabang";
/**
 * Divisi pelaksana resep saat produksi_di="cabang": role kitchen hanya boleh
 * memproduksi resep divisi "kitchen", role bar hanya divisi "bar". Diabaikan
 * saat produksi_di="ck".
 */
export type DivisiProduksi = "kitchen" | "bar";

/* ===== Pengajuan cuti & libur karyawan ===== */

/**
 * Dua jalur ketidakhadiran yang DISENGAJA. Dipisah karena artinya beda di
 * rekap: `cuti` = jatah/keperluan pribadi (dihitung tersendiri untuk melihat
 * pemakaian jatah), `libur` = hari tidak bekerja yang memang disepakati
 * (mingguan/tukar jadwal/tanggal merah). Keduanya sama-sama BUKAN alpa.
 */
export type PengajuanJenis = "cuti" | "libur";

export type PengajuanKategori =
  | "tahunan"
  | "sakit"
  | "izin"
  | "melahirkan"
  | "penting"
  | "mingguan"
  | "tukar_jadwal"
  | "tanggal_merah";

export type PengajuanStatus = "menunggu" | "disetujui" | "ditolak";

/**
 * SUMBER TUNGGAL kategori pengajuan — dipakai bersama oleh dropdown di web,
 * validasi zod di server, dan penurunan `jenis` dari `kategori`. Klien TIDAK
 * pernah mengirim `jenis`: server selalu menurunkannya dari sini, sehingga
 * mustahil ada baris "libur" berkategori "melahirkan".
 */
export const KATEGORI_PENGAJUAN: {
  kode: PengajuanKategori;
  jenis: PengajuanJenis;
  label: string;
  emoji: string;
}[] = [
  { kode: "tahunan", jenis: "cuti", label: "Cuti Tahunan", emoji: "🌴" },
  { kode: "sakit", jenis: "cuti", label: "Sakit", emoji: "🤒" },
  { kode: "izin", jenis: "cuti", label: "Izin", emoji: "📝" },
  { kode: "melahirkan", jenis: "cuti", label: "Melahirkan", emoji: "🍼" },
  { kode: "penting", jenis: "cuti", label: "Keperluan Penting", emoji: "🙏" },
  { kode: "mingguan", jenis: "libur", label: "Libur Mingguan", emoji: "🗓" },
  { kode: "tukar_jadwal", jenis: "libur", label: "Tukar Jadwal", emoji: "🔁" },
  { kode: "tanggal_merah", jenis: "libur", label: "Tanggal Merah", emoji: "🎉" },
];

/** Semua kode kategori — untuk `z.enum()` di server. */
export const KODE_KATEGORI_PENGAJUAN = KATEGORI_PENGAJUAN.map((k) => k.kode) as [
  PengajuanKategori,
  ...PengajuanKategori[],
];

/** Turunkan jenis (cuti/libur) dari kategori. Kategori tak dikenal → "cuti". */
export function jenisKategori(kode: PengajuanKategori): PengajuanJenis {
  return KATEGORI_PENGAJUAN.find((k) => k.kode === kode)?.jenis ?? "cuti";
}

/** Label tampilan kategori, mis. "🤒 Sakit". */
export function labelKategoriPengajuan(kode: PengajuanKategori): string {
  const k = KATEGORI_PENGAJUAN.find((x) => x.kode === kode);
  return k ? `${k.emoji} ${k.label}` : kode;
}

/* ===== Laporan kebersihan harian ===== */

/**
 * Sesi pembersihan dalam sehari. Toko dibersihkan beberapa kali, jadi laporan
 * dipisah per sesi — satu karyawan boleh punya tiga laporan sehari, tapi hanya
 * satu per sesi.
 */
export type KebersihanSesi = "pagi" | "siang" | "malam";

/**
 * SUMBER TUNGGAL sesi kebersihan — dipakai bersama oleh kartu sesi di web,
 * validasi zod di server, dan label rekap.
 */
export const SESI_KEBERSIHAN: {
  kode: KebersihanSesi;
  label: string;
  emoji: string;
}[] = [
  { kode: "pagi", label: "Pagi", emoji: "🌅" },
  { kode: "siang", label: "Siang", emoji: "☀️" },
  { kode: "malam", label: "Malam", emoji: "🌙" },
];

/** Semua kode sesi — untuk `z.enum()` di server. */
export const KODE_SESI_KEBERSIHAN = SESI_KEBERSIHAN.map((s) => s.kode) as [
  KebersihanSesi,
  ...KebersihanSesi[],
];

/** Label tampilan sesi, mis. "🌅 Pagi". */
export function labelSesiKebersihan(kode: KebersihanSesi): string {
  const s = SESI_KEBERSIHAN.find((x) => x.kode === kode);
  return s ? `${s.emoji} ${s.label}` : kode;
}
