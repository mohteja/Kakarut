/**
 * Penyimpanan lokal yang BOLEH GAGAL — dan tetap menyisakan aplikasi yang bisa
 * dipakai sampai shift itu selesai.
 *
 * `localStorage` bukan API yang selalu berhasil. Dua kegagalan yang nyata di
 * perangkat POS:
 *
 *  1. **Aksesnya sendiri melempar.** Safari dengan "Block All Cookies" membuat
 *     `window.localStorage` melempar `SecurityError` pada SENTUHAN PERTAMA —
 *     bukan pada `setItem`, melainkan saat propertinya dibaca. iPad kasir yang
 *     dipakai bergantian adalah persis perangkat yang setelan privasinya
 *     tersentuh orang.
 *  2. **`setItem` melempar `QuotaExceededError`** saat kuota origin penuh.
 *
 * Repo ini SUDAH menganggap bahaya itu nyata: `loadAuth`, `loadPrinterSettings`,
 * dan pilihan tampilan kasir semuanya dibungkus `try`/`catch`. Yang ganjil,
 * penjagaan itu berhenti di sisi BACA. Sisi tulis dibiarkan telanjang — dan
 * justru sisi baca yang terjaga itulah yang mengantar pemakainya sampai ke
 * sisi tulis yang tidak terjaga: sesi gagal dibaca → null → layar login →
 * login berhasil di server → penulisan sesi melempar → tak ada sesi yang
 * terpasang.
 *
 * Bahayanya berlipat karena `api()` mengambil tokennya dari `loadAuth()`,
 * artinya PENYIMPANAN adalah sumber kebenaran token — bukan state React. Jadi
 * membungkus `try`/`catch` saja tidak cukup: menelan galat penulisan hanya
 * mengubah "login melempar galat aneh" jadi "login berputar-putar tanpa
 * pernah masuk". Yang dibutuhkan adalah CADANGAN DI MEMORI, supaya sesi tetap
 * hidup selama tab ini terbuka meski tak satu pun byte-nya sempat mendarat.
 *
 * ATURAN WEWENANG (urutannya penting, dan tiap cabang punya alasannya):
 *
 *  - Kunci yang penulisannya PERNAH GAGAL → memori yang berwenang. Tulisan
 *    kita tak mendarat, jadi apa pun yang tersisa di penyimpanan adalah nilai
 *    BASI — bukan nilai yang lebih baru.
 *  - Penyimpanan tak terbaca sama sekali → memori.
 *  - Selain itu → PENYIMPANAN yang berwenang, termasuk saat isinya kosong.
 *    Ini yang menjaga logout-antar-tab tetap bekerja: tab lain menghapus kunci
 *    sesi, tab ini membaca kosong, dan memori TIDAK boleh menghidupkannya lagi.
 *
 * Penulisan/penghapusan yang berhasil mencabut kembali penanda gagalnya, jadi
 * wewenang penyimpanan pulih sendiri begitu ia sehat lagi — penandanya tidak
 * menempel selamanya.
 *
 * Sengaja TANPA `lib.dom`: `globalThis` diakses lewat tipe minimal di bawah,
 * supaya modul ini bisa diuji sungguhan (bukan cuma dibaca sebagai teks) dari
 * paket server yang tsconfig-nya tidak memuat DOM.
 */

type PenyimpananMinimal = {
  getItem(kunci: string): string | null;
  setItem(kunci: string, nilai: string): void;
  removeItem(kunci: string): void;
};

/**
 * Membaca `globalThis.localStorage` pun dibungkus: pada Safari yang memblokir
 * seluruh cookie, GETTER-nya yang melempar, bukan metodenya.
 */
function ambilPenyimpanan(): PenyimpananMinimal | null {
  try {
    const g = globalThis as { localStorage?: PenyimpananMinimal | null };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Salinan bayangan dari setiap nilai yang pernah kita tulis lewat modul ini. */
const memori = new Map<string, string>();
/** Kunci yang tulisan/penghapusannya tidak mendarat di penyimpanan. */
const gagalMenulis = new Set<string>();

let sudahMemperingatkan = false;
function peringatkanSekali(): void {
  if (sudahMemperingatkan) return;
  sudahMemperingatkan = true;
  // Sekali saja: kalau penyimpanan diblokir, SETIAP tulisan akan gagal dan
  // konsol yang banjir justru menyembunyikan galat lain yang perlu dibaca.
  console.warn(
    "[simpanan] localStorage tidak bisa ditulis — sesi & setelan hanya bertahan selama tab ini terbuka.",
  );
}

export function bacaLokal(kunci: string): string | null {
  if (gagalMenulis.has(kunci)) return memori.get(kunci) ?? null;
  const p = ambilPenyimpanan();
  if (!p) return memori.get(kunci) ?? null;
  try {
    return p.getItem(kunci);
  } catch {
    return memori.get(kunci) ?? null;
  }
}

export function tulisLokal(kunci: string, nilai: string): void {
  memori.set(kunci, nilai);
  const p = ambilPenyimpanan();
  if (!p) {
    gagalMenulis.add(kunci);
    peringatkanSekali();
    return;
  }
  try {
    p.setItem(kunci, nilai);
    gagalMenulis.delete(kunci);
  } catch {
    gagalMenulis.add(kunci);
    peringatkanSekali();
  }
}

export function hapusLokal(kunci: string): void {
  // Memori dikosongkan LEBIH DULU. Kalau penghapusan di penyimpanan gagal,
  // kunci ini masuk `gagalMenulis` dan memori (yang sudah kosong) jadi
  // berwenang — sehingga logout tetap benar-benar melepas sesi, bukan
  // dihidupkan lagi oleh cadangannya sendiri.
  memori.delete(kunci);
  const p = ambilPenyimpanan();
  if (!p) {
    gagalMenulis.add(kunci);
    return;
  }
  try {
    p.removeItem(kunci);
    gagalMenulis.delete(kunci);
  } catch {
    gagalMenulis.add(kunci);
    peringatkanSekali();
  }
}

/** Hanya untuk pengujian — mengembalikan modul ke keadaan awal. */
export function __resetSimpanan(): void {
  memori.clear();
  gagalMenulis.clear();
  sudahMemperingatkan = false;
}
