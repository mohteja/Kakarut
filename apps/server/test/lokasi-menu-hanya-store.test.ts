import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { berkasKode } from "./util/rute";

/**
 * ATURAN "CABANG MANA YANG BOLEH PUNYA MENU" DITULIS DI SATU TEMPAT SAJA.
 *
 * Central Kitchen tidak berjualan. Hanya cabang `store` yang punya kasir/POS,
 * jadi hanya store yang bisa jadi lokasi tampil sebuah menu. Server sudah
 * menegakkannya dan menolak selainnya dengan 400 (`modules/menu/routes.ts`),
 * dan `scripts/verify-api.sh` §52 memakunya lewat HTTP sungguhan.
 *
 * Yang TIDAK dijaga siapa pun adalah sisi web-nya, dan di situlah ia hanyut.
 * Commit `b3237cc` (17 Juli 2026, "menu store-only") mengubah FORMULIR menu
 * dari `tipe !== "kantor"` menjadi `tipe === "store"` — dan melewatkan halaman
 * DAFTARNYA. `MenuListPage` karena itu terus menawarkan "🏭 Central Kitchen"
 * di pemilih "Tampil di lokasi" selama dua tahun. Tak ada yang merah: waktu itu
 * `apps/web/e2e/` tak punya spek menu sama sekali, dan `apps/server/test/` tak
 * punya penjaga lokasi menu.
 *
 * Gejalanya bukan sekadar opsi berlebih. Karena tak satu pun menu BISA
 * berlokasi CK, memilih Central Kitchen hanya menyisakan menu ber-`branch_ids`
 * KOSONG — yaitu "tanpa pembatasan lokasi" — lalu menyajikannya di bawah judul
 * "Menu & HPP (13 dari 40)" seolah tiga belas menu itu dijual di dapur pusat.
 * Angka yang benar-benar ada, menjawab pertanyaan yang tak pernah diajukan.
 *
 * Maka uji ini tidak melarang satu ejaan tertentu ("jangan `!== "kantor"`") —
 * pelarangan begitu selalu bisa dilangkahi dengan ejaan lain. Ia melarang
 * halaman menu MENULIS ATURANNYA SENDIRI, dalam bentuk apa pun: tak ada berkas
 * di `apps/web/src/pages/menu/` yang boleh menyebut literal tipe cabang. Satu
 * -satunya rumah aturan itu `bolehJadiLokasiMenu`/`opsiLokasiMenu` di
 * `BranchContext.tsx`, dan isi rumah itu ikut dipaku di bawah.
 *
 * Pengecualian didaftarkan dengan ALASAN, bukan dibungkam: lihat `DIADILI`.
 */

const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const DIR_MENU = join(WEB, "pages/menu");
const BRANCH_CONTEXT = join(WEB, "context/BranchContext.tsx");
const RUTE_MENU = fileURLToPath(new URL("../src/modules/menu/routes.ts", import.meta.url));

/** Ketiga literal tipe cabang — `branchTipeEnum` di `db/schema.ts`. */
const LITERAL_TIPE = /"(?:store|central_kitchen|kantor)"/g;

/**
 * Penyebutan literal tipe cabang di halaman menu yang SUDAH diadili dan
 * dinyatakan sah. Kuncinya nama berkas, isinya baris kodenya apa adanya
 * (tanpa spasi tepi) beserta alasannya. Baris yang tak terdaftar = merah.
 *
 * Menambah entri di sini adalah keputusan sadar yang meninggalkan jejak —
 * itulah gunanya. Menghapus penjaga ini bukan.
 */
const DIADILI: Record<string, { baris: string; alasan: string }[]> = {
  "LihatMenuPage.tsx": [
    {
      baris: 'const q = divisi === "kantor" ? "" : branchQuery;',
      alasan:
        "Ini DIVISI kerja yang dipilih di sidebar, bukan penyaring lokasi menu. " +
        "Kantor = pusat, jadi katalognya penuh (menu terbatas lokasi tidak boleh " +
        "hilang dari pandangan manajemen). Tak ada daftar cabang yang disaring di " +
        "sini, jadi ia tak bisa menawarkan Central Kitchen kepada siapa pun.",
    },
  ],
};

function barisBerliteral(kode: string): string[] {
  const buta = butaKomentar(kode);
  const hasil: string[] = [];
  for (const [i, baris] of buta.split("\n").entries()) {
    if (baris.match(LITERAL_TIPE)) hasil.push(kode.split("\n")[i].trim());
  }
  return hasil;
}

describe("lokasi menu hanya cabang store", () => {
  it("tak ada halaman menu yang menulis sendiri aturan tipe cabang", () => {
    const berkas = berkasKode(DIR_MENU, /\.tsx?$/);
    // PREMIS: kalau sapuannya tak menemukan berkas apa pun, uji ini hijau
    // secara hampa — dan itu justru saat ia paling dibutuhkan.
    expect(berkas.length, "PREMIS: pages/menu harus berisi berkas").toBeGreaterThan(3);

    const liar: string[] = [];
    for (const p of berkas) {
      const nama = basename(p);
      const sah = new Set((DIADILI[nama] ?? []).map((d) => d.baris));
      for (const baris of barisBerliteral(readFileSync(p, "utf8"))) {
        if (!sah.has(baris)) liar.push(`${nama}: ${baris}`);
      }
    }
    expect(
      liar,
      "Halaman menu menyebut literal tipe cabang sendiri. Pakai " +
        "`opsiLokasiMenu(cabang)` (daftar pilihan) atau `bolehJadiLokasiMenu(b)` " +
        "(jalur simpan) dari BranchContext — atau daftarkan di DIADILI dengan alasan.",
    ).toEqual([]);
  });

  it("tiap entri DIADILI masih benar-benar ada — kuburan tak boleh menumpuk", () => {
    for (const [nama, entri] of Object.entries(DIADILI)) {
      const kode = readFileSync(join(DIR_MENU, nama), "utf8");
      for (const d of entri) {
        expect(
          barisBerliteral(kode),
          `entri DIADILI ${nama} sudah tak cocok dengan kodenya — perbarui atau buang`,
        ).toContain(d.baris);
        expect(d.alasan.length, `alasan ${nama} terlalu pendek`).toBeGreaterThan(60);
      }
    }
  });

  it("rumah aturannya berbunyi store, dan dua-duanya diekspor", () => {
    const kode = butaKomentar(readFileSync(BRANCH_CONTEXT, "utf8"));
    // Jantungnya. Melebarkan helper ini melebarkan SELURUH pemakainya sekaligus,
    // jadi di sinilah nilainya dipaku, bukan di tiap layar.
    expect(kode).toContain(
      'export const bolehJadiLokasiMenu = (b?: Pick<Cabang, "tipe"> | null) => b?.tipe === "store"',
    );
    // Daftar PILIHAN wajib ikut membuang cabang nonaktif; jalur SIMPAN tidak
    // boleh (lihat komentarnya di BranchContext) — dua fungsi, dua tugas.
    expect(kode).toContain("export const opsiLokasiMenu = (cabang: Cabang[]) =>");
    expect(kode).toContain("cabang.filter((b) => b.is_active && bolehJadiLokasiMenu(b))");
  });

  it("halaman daftar & formulir benar-benar memakai rumah itu", () => {
    const daftar = butaKomentar(readFileSync(join(DIR_MENU, "MenuListPage.tsx"), "utf8"));
    expect(daftar).toContain("const lokasiOpsi = opsiLokasiMenu(cabang);");

    const formulir = butaKomentar(readFileSync(join(DIR_MENU, "MenuFormPage.tsx"), "utf8"));
    // Jalur simpan: `bolehJadiLokasiMenu`, TANPA is_active. Menyaring cabang
    // nonaktif di sini akan menghapus pembatasan lokasi menu itu — diam-diam
    // melebarkannya ke semua cabang, persis kebalikan dari yang diminta.
    expect(formulir).toContain("cabang.some((b) => b.id === bid && bolehJadiLokasiMenu(b))");
    expect(formulir).toContain("opsiLokasiMenu(cabang)");
  });

  it("sisi server masih menolak lokasi non-store", () => {
    // Dua sisi satu aturan. Bila pesan ini berubah, verify-api §52 ikut merah —
    // uji ini yang menjelaskan KENAPA keduanya harus bergerak bersama.
    const kode = butaKomentar(readFileSync(RUTE_MENU, "utf8"));
    expect(kode).toContain('const bukanStore = rows.filter((r) => r.tipe !== "store")');
    expect(kode).toContain("Hanya cabang store (kasir/POS) yang bisa jadi lokasi menu");
  });
});
