/**
 * SAPUAN: konsep yang dihitung di lebih dari satu tempat.
 *
 * KENAPA UJI INI ADA.
 *
 * Sepanjang satu sesi audit, lima bug stok berturut-turut ternyata SATU cacat
 * dengan lima pintu: aturan "berapa perlengkapan yang ada di rak"
 * (`saldo − dalam_jalan`) disalin di lima tempat, dan kelimanya salah dengan
 * cara identik — saldo CK jatuh minus, barang hilang dari pembukuan.
 *
 * Yang menemukan pintu keempat dan kelima BUKAN membaca modul satu per satu —
 * dua ronde penuh dengan cara itu menghasilkan nol. Yang menemukannya sapuan
 * mekanis: cari pasangan konsep yang diaritmetikakan di lebih dari satu berkas.
 * Sapuan itu bahkan menangkap dua salinan yang TERTINGGAL di layar oleh
 * perubahan yang justru memusatkan sisi servernya.
 *
 * Jadi uji ini memasang sapuan itu sebagai gerbang. Ia TIDAK menuntut nol
 * duplikat — sebagian memang sah, dan uji yang merah sejak hari pertama cuma
 * mengajari orang mengabaikannya. Yang dijaga: tak ada duplikat BARU yang
 * masuk diam-diam.
 *
 * KALAU UJI INI MERAH, ada dua jalan yang benar dan satu yang salah:
 *   ✔ beri konsep itu SATU RUMAH (fungsi bersama) lalu semua pemakainya lewat
 *     sana — inilah yang seharusnya terjadi pada `saldo − dalam_jalan`;
 *   ✔ atau tambahkan ke DASAR di bawah DENGAN ALASAN yang bisa dibaca orang
 *     lain, kalau kemiripannya memang kebetulan;
 *   ✘ JANGAN menambahkannya ke dasar tanpa alasan. Entri tanpa alasan membuat
 *     daftar ini jadi tempat sampah, dan gerbangnya berhenti menjaga apa pun.
 *
 * BATASNYA, supaya tak ada yang mengira ini lebih dari yang sebenarnya:
 * detektornya kasar. Ia hanya melihat `a.x − b.y` / `a.x + b.y` di TypeScript,
 * jadi ia melewatkan aturan yang ditulis sebagai SQL, sebagai pemanggilan
 * fungsi, atau di repo mobile (Dart). Ia menangkap satu BENTUK duplikasi, yang
 * kebetulan bentuk yang lima kali menyakiti basis kode ini.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const AKAR = ["../src", "../../web/src", "../../../packages/shared/src"];

/** Duplikat yang SUDAH ditimbang. Kunci = pasangan konsep; nilai = alasannya. */
const DASAR: Record<string, { berkas: number; alasan: string }> = {
  // ── Kebetulan sintaksis: detektornya kasar, ini bukan aturan bisnis ────────
  "innerHeight - top": {
    berkas: 2,
    alasan: "matematika viewport DOM (tinggi layar − posisi elemen), bukan aturan bisnis",
  },
  "length + length": {
    berkas: 2,
    alasan: "menjumlah panjang dua larik untuk hitungan tampilan",
  },
  "qty - qty": {
    berkas: 2,
    alasan:
      "dua hal BERBEDA yang bentuknya kebetulan sama: sisa qty di produksi, " +
      "dan pembanding pengurut (b.qty − a.qty) di laporan",
  },
  "saldo - saldo": {
    berkas: 2,
    alasan:
      "pembanding pengurut daftar stok yang sama persis di dua beranda. " +
      "Duplikasi TAMPILAN, bukan aturan angka — salah menyalinnya paling jauh " +
      "membuat urutan daftar berbeda",
  },

  // ── Sengaja terpisah, dan alasannya tertulis di kodenya ───────────────────
  "saldo - get": {
    berkas: 2,
    alasan:
      "`qtyDiJalan` vs `qtyDalamJalan` — dua PERTANYAAN berbeda yang sengaja " +
      "dipisah: 'berapa yang sudah tidak ada di rak' (untuk opname fisik) vs " +
      "'berapa yang sudah dijanjikan keluar' (untuk perencanaan). Lihat catatan " +
      "panjang di atas `qtyDiJalan` di modules/stok/service.ts",
  },
  "saldo - dalam_jalan": {
    berkas: 2,
    alasan:
      "DUA DOMAIN berbeda dengan DTO berbeda: perlengkapan sudah punya rumah " +
      "bersama (`saldoDiRak` di packages/shared/perlengkapan-rak.ts, dipakai " +
      "kedua layarnya), dan bahan baku punya `tersediaDari` di TransferStokPage " +
      "yang berdiri sendiri. Menyatukan keduanya akan memaksa satu tipe untuk " +
      "dua konsep yang kebetulan searitmetika",
  },

  // ── UTANG YANG DIAKUI: duplikasi nyata, belum dibereskan ──────────────────
  // Dibiarkan di sini SUPAYA TERLIHAT, bukan supaya dilupakan. Ditemukan justru
  // saat menulis daftar ini — menuntut alasan untuk tiap entri memaksa
  // memeriksanya satu per satu, dan yang ini tak punya alasan yang baik.
  //
  // Sebelumnya ada dua. `stok_minimum - saldo` sudah LUNAS: aturannya kini
  // tinggal di `kekuranganKeMinimum` (@kakarut/shared), dan uji "DASAR tidak
  // menyimpan entri yang sudah tak berlaku" di bawahlah yang memaksa entrinya
  // dihapus dari sini — persis kerja yang diharapkan darinya.
  "subtotal - diskon": {
    berkas: 2,
    alasan:
      "UTANG: 'nilai bersih sebelum pajak' — dasar perhitungan PB1 — dihitung " +
      "terpisah di modules/penjualan/service.ts (saat penjualan dibuat) dan " +
      "packages/shared/refund.ts (saat diprorata). Rumus PB1-nya memang SENGAJA " +
      "berbeda — refund menurunkannya dari PB1 ASAL, bukan dari tarif hari ini, " +
      "sebab tarifnya bisa sudah berubah — jadi yang kembar cuma `net`-nya. " +
      "Kekekalan uangnya sudah diukur: 100.000 kombinasi bertahap, nol " +
      "pelanggaran, dan kini dijaga `refund-uang-kekal.test.ts`. Yang tersisa " +
      "risiko ke depan: begitu ada jenis potongan baru (diskon per baris, biaya " +
      "layanan), yang menambahkannya di satu tempat tak akan diingatkan tentang " +
      "yang lain",
  },
};

const POLA = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*([-+])\s*\(?\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g;

function berkasSumber(dir: string): string[] {
  const keluar: string[] = [];
  const jelajah = (d: string) => {
    for (const nama of readdirSync(d)) {
      const p = join(d, nama);
      if (statSync(p).isDirectory()) {
        if (nama !== "node_modules" && nama !== "test") jelajah(p);
      } else if (/\.tsx?$/.test(nama) && !nama.endsWith(".d.ts") && !nama.includes(".test.")) {
        keluar.push(p);
      }
    }
  };
  jelajah(dir);
  return keluar;
}

function sapu(): Map<string, Set<string>> {
  const peta = new Map<string, Set<string>>();
  for (const rel of AKAR) {
    const akar = fileURLToPath(new URL(rel, import.meta.url));
    for (const f of berkasSumber(akar)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(POLA)) {
        const kunci = `${m[2]} ${m[3]} ${m[5]}`;
        (peta.get(kunci) ?? peta.set(kunci, new Set()).get(kunci)!).add(f);
      }
    }
  }
  return peta;
}

const HASIL = sapu();
const TERSEBAR = [...HASIL.entries()].filter(([, f]) => f.size >= 2);

describe("konsep yang dihitung di banyak tempat", () => {
  it("tak ada pasangan konsep BARU yang tersebar tanpa alasan tertulis", () => {
    const baru = TERSEBAR.filter(([k]) => !(k in DASAR)).map(
      ([k, f]) => `«${k}» di ${f.size} berkas:\n${[...f].map((x) => `      ${x}`).join("\n")}`,
    );
    expect(
      baru,
      baru.length === 0
        ? ""
        : `Konsep berikut kini dihitung di lebih dari satu berkas:\n\n${baru.join("\n\n")}\n\n` +
          "Beri ia SATU RUMAH (fungsi bersama) lalu arahkan semua pemakainya ke sana, " +
          "ATAU tambahkan ke DASAR di berkas ini DENGAN ALASAN yang bisa dibaca orang lain. " +
          "Entri tanpa alasan membuat daftar itu jadi tempat sampah.",
    ).toEqual([]);
  });

  it("duplikat yang sudah diakui tidak MENYEBAR lebih jauh", () => {
    const meluas = TERSEBAR.filter(([k, f]) => k in DASAR && f.size > DASAR[k].berkas).map(
      ([k, f]) => `«${k}»: ${DASAR[k].berkas} → ${f.size} berkas\n${[...f].map((x) => `      ${x}`).join("\n")}`,
    );
    expect(
      meluas,
      meluas.length === 0
        ? ""
        : `Duplikat yang sudah diakui kini tersalin ke berkas BARU:\n\n${meluas.join("\n\n")}\n\n` +
          "Salinan ketiga adalah tanda bahwa konsepnya memang butuh rumah — bukan alasan " +
          "menaikkan angka di DASAR.",
    ).toEqual([]);
  });

  it("DASAR tidak menyimpan entri yang sudah tak berlaku", () => {
    // Tanpa pemeriksaan ini, daftar dasarnya membusuk: konsep yang SUDAH
    // dibereskan tetap tercatat sebagai "boleh tersebar", dan salinan barunya
    // kelak lolos diam-diam dengan izin yang sudah kedaluwarsa.
    const basi = Object.keys(DASAR).filter(
      (k) => !TERSEBAR.some(([nama]) => nama === k),
    );
    expect(
      basi,
      basi.length === 0 ? "" : `Entri DASAR ini sudah tak ditemukan lagi — hapus: ${basi.join(", ")}`,
    ).toEqual([]);
  });

  it("setiap entri DASAR punya alasan yang benar-benar ditulis", () => {
    const kosong = Object.entries(DASAR)
      .filter(([, v]) => v.alasan.trim().length < 40)
      .map(([k]) => k);
    expect(kosong, `Entri DASAR tanpa alasan yang memadai: ${kosong.join(", ")}`).toEqual([]);
  });
});
