import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga IDEMPOTENSI OPNAME — kiriman ulang tak boleh melahirkan sesi kembar.
 *
 * Repo ini menjaga kelas kegagalan yang sama di tiga jalur lain (penjualan,
 * refund, /sync) lewat satu ledger `(company_id, client_ref)`, dan komentarnya
 * di rute refund menyebut sebabnya terukur: "Chromium mengulang sendiri POST
 * yang soketnya ditutup pada koneksi keep-alive yang dipakai ulang" — jadi
 * duplikasi bisa terjadi tanpa siapa pun menekan dua kali.
 *
 * Opname tidak ikut dijaga. Jaringan yang putus SESUDAH server menyimpan tapi
 * SEBELUM balasannya sampai membuat lembar konfirmasi tetap terbuka dengan
 * tombol Simpan hidup lagi; yang menekan ulang tak punya cara tahu hitungannya
 * sudah tercatat, dan sesi kedua lahir dengan angka yang sama persis.
 *
 * Nilai stoknya memang tak ikut salah — opname adalah baseline MUTLAK, bukan
 * selisih, jadi dua baseline identik mendarat di angka yang sama. Yang rusak
 * jejaknya: Riwayat Opname memuat dua sesi kembar dan owner harus meng-ACC dua
 * kali untuk satu penghitungan. Di layar yang justru dipakai memeriksa
 * kejujuran stok, riwayat kembar itu sendiri jadi pertanyaan.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const RUTE = baca("../src/modules/stok/routes.ts");
const HELPER = baca("../src/modules/sync/idempoten.ts");
const HAL = baca("../../web/src/pages/stok/OpnamePage.tsx");

/** Potongan rute `POST /opname` saja. */
const iRute = RUTE.indexOf('.post("/opname", requireRole(');
const OPNAME = RUTE.slice(iRute, RUTE.indexOf('.get("/opname"', iRute));

describe("server: memakai ledger yang sama dengan jalur lain", () => {
  it("badan permintaan menerima `client_ref` & `device_id`", () => {
    expect(RUTE).toContain("client_ref: clientRefField,");
    expect(RUTE).toContain("device_id: deviceIdField,");
  });

  it("helpernya diimpor dari modul sync, bukan disalin ulang", () => {
    expect(RUTE).toContain('} from "../sync/idempoten";');
    expect(RUTE).toContain("denganKlaimIdempoten,");
  });

  /*
   * Dulu jalur ini memakai SELECT-lalu-eksekusi-lalu-INSERT. Itu jalur cepat,
   * BUKAN penjaga: dua opname ber-`client_ref` sama yang datang bersamaan
   * sama-sama melihat ledger kosong, sama-sama menulis sesi, lalu yang kedua
   * kalah di unique index dan hasilnya dibuang diam-diam. Ledger rapi satu
   * baris; sesi opnamenya dua, dan stok tercatat dua kali.
   */
  it("mengklaim ATOMIK sebelum eksekusi, bukan sekadar memeriksa ledger", () => {
    expect(OPNAME).toContain("const { data } = await denganKlaimIdempoten(");
    expect(OPNAME).toContain('tipe: "opname",');
    expect(RUTE).not.toContain("cariHasilIdempoten");
    expect(RUTE).not.toContain("catatHasilIdempoten");
  });

  it("diklaim PALING AWAL — sebelum cabang di-resolve & sebelum penjaga petugas", () => {
    // Yang dijaga SELURUH badan handler, bukan cuma penulisannya: percobaan
    // kedua tak boleh menjalani lagi pemeriksaan yang bisa saja kini menolak
    // (mis. petugas rak berubah sesudah sesi pertama tersimpan).
    const iIdem = OPNAME.indexOf("const { data } = await denganKlaimIdempoten(");
    const iCabang = OPNAME.indexOf("const branchId = body.branch_id");
    const iPetugas = OPNAME.indexOf("bukan petugas opname tempat");
    expect(iIdem, "klaim idempotensi tak ditemukan").toBeGreaterThan(0);
    expect(iCabang).toBeGreaterThan(iIdem);
    expect(iPetugas).toBeGreaterThan(iIdem);
  });

  it("hasil yang diputar ulang dipulangkan 201, sama dengan jalur normalnya", () => {
    expect(OPNAME).toContain("return c.json(data, 201);");
  });

  it("yang diklaim PERSIS yang dipulangkan — bukan disusun ulang", () => {
    expect(OPNAME).toContain(
      "const hasil = { ok: true, jumlah: rows.length, session_id: sessionId, nomor, ringkasan };",
    );
    expect(OPNAME).toContain("        return hasil;");
  });

  it("tanpa `client_ref` perilakunya tak berubah — klien lama aman", () => {
    // Dijamin helper-nya, bukan gerbang `if` di tiap pemanggil.
    expect(HELPER).toContain("if (!clientRef) return { data: await jalankan(), baru: true };");
  });
});

describe("web: kuncinya mengikat satu sesi penghitungan", () => {
  it("dibuat sekali lalu dipakai ulang (`??=`), bukan tiap kiriman", () => {
    expect(HAL).toContain("client_ref: (refSesi.current ??= uuidV4()),");
  });

  it("dibuang saat sesinya benar-benar selesai", () => {
    const i = HAL.indexOf('setLangkah("lokasi");');
    expect(HAL.slice(i, i + 120)).toContain("refSesi.current = null;");
  });

  it("dan saat petugas memulai hitungan BARU di lokasi lain", () => {
    // Kalau tidak, penghitungan berikutnya akan dianggap ulangan dari yang
    // sebelumnya dan server memulangkan hasil lama — hitungan barunya hilang.
    const i = HAL.indexOf("function bukaBucket(b: string) {");
    expect(HAL.slice(i, i + 260)).toContain("refSesi.current = null;");
  });

  it("sebabnya ditulis, termasuk kenapa nilainya tetap aman", () => {
    expect(HAL).toContain("baseline MUTLAK, bukan");
    expect(HAL).toContain("Riwayat Opname memuat dua sesi kembar");
  });
});

/**
 * Batas cakupannya ikut dipatok: `POST /stok/awal` memakai badan yang MEWARISI
 * `OpnameBody`, jadi menambahkan kunci di sana tanpa berpikir akan membuat
 * skemanya MENERIMA field yang rutenya abaikan — klien mengira dilindungi
 * padahal tidak.
 *
 * Dan ia memang tak membutuhkannya: penulisannya hapus-lalu-sisip atas
 * `(company, branch, session_id IS NULL, ingredient_id)`, jadi kiriman ganda
 * mendarat di baris yang sama persis. Bedanya dengan `/stok/opname` tegas —
 * yang itu MENAMBAH sesi, yang ini MENGGANTI baris.
 */
describe("stok awal TIDAK ikut mewarisi kuncinya", () => {
  it("field idempotensinya di-omit dari `StokAwalBody`", () => {
    expect(RUTE).toContain(
      "const StokAwalBody = OpnameBody.omit({ client_ref: true, device_id: true }).extend({",
    );
  });

  it("dan rutenya memang tak menyentuh `client_ref`", () => {
    const i = RUTE.indexOf('.post("/awal", requireRole(');
    const blok = RUTE.slice(i, RUTE.indexOf('.get("/penyesuaian"', i));
    expect(i).toBeGreaterThan(0);
    expect(blok).not.toContain("client_ref");
    expect(blok).not.toContain("cariHasilIdempoten");
  });

  it("premis: penulisannya memang mengganti, bukan menambah", () => {
    const i = RUTE.indexOf('.post("/awal", requireRole(');
    const blok = RUTE.slice(i, RUTE.indexOf('.get("/penyesuaian"', i));
    expect(blok).toContain("await tx.delete(stockOpnames).where(");
    expect(blok).toContain("isNull(stockOpnames.sessionId),");
  });

  it("alasannya ditulis, supaya tak 'dirapikan' jadi seragam nanti", () => {
    expect(RUTE).toContain("SENGAJA TIDAK diwarisi");
    expect(RUTE).toContain("idempoten SECARA KONSTRUKSI");
  });
});

describe("premis: ledger itu memang bersama, dan sudah dipakai jalur lain", () => {
  it("penjualan memakainya", () => {
    const jual = baca("../src/modules/penjualan/routes.ts");
    // Penjualan DAN refund kini mengambil KLAIM lewat helper bersama, bukan
    // sekadar membaca ledger lalu mencatatnya belakangan. Dua pemakaian:
    // `POST /` dan `POST /:id/refund`.
    expect(jual.split("denganKlaimIdempoten(").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("dan kuncinya unik per `(company_id, client_ref)`", () => {
    const idem = baca("../src/modules/sync/idempoten.ts");
    expect(idem).toContain("eq(syncCommands.companyId, companyId), eq(syncCommands.clientRef, clientRef)");
    expect(idem).toContain(".onConflictDoNothing();");
  });
});
