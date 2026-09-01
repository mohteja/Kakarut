import { describe, expect, it } from "vitest";
import { situsBalasan, tabelRahasia } from "./util/bentuk-balasan";

/**
 * BENTUK BALASAN DISEBUT PENULISNYA, BUKAN DITENTUKAN TABELNYA.
 *
 * Enam putaran menutup satu keluarga di sisi KELUARAN. Yang belum pernah
 * ditanyakan: apa yang MASUK ke balasan tanpa ada yang memilihnya?
 *
 * Sapuan 2026-08-27: **298 situs `c.json`** — `DISEBUT` 220 (objek literal /
 * hasil pembantu), `KOLOM` 72 (dari `select({ … })` berkolom eksplisit),
 * **`BARIS_PENUH` 6**, `RAHASIA` 0.
 *
 * Dua aturan dijaga:
 *
 * A. Balasan tak boleh dibentuk oleh `select()`/`returning()` TELANJANG.
 *    Kolom yang ditambahkan besok akan ikut terkirim ke semua klien tanpa
 *    satu baris kode pun berubah, dan tanpa satu orang pun memutuskannya.
 *
 * B. Tabel ber-kolom rahasia tak boleh dikirim utuh, titik. `users`,
 *    `smtp_settings`, `invitations`, dan dua tabel token. Satu `c.json(user)`
 *    di rute baru mengirim hash bcrypt seluruh akun.
 *
 * Aturan B **tidak dilanggar sekali pun hari ini**, dan itu ditelusuri bukan
 * dianggap: delapan kandidat bermuara di `buatSesi` (`auth/session.ts`) yang
 * merakit payload kolom demi kolom, dan `smtpDto` yang mengirim
 * `has_password: Boolean(row?.password)` — penandanya, bukan rahasianya.
 * Nol itulah yang dipaku di sini.
 */
const MAKS_UTANG = 0;

/**
 * `berkas:nama-fungsi` → alasan, untuk `BARIS_PENUH` yang sengaja dibiarkan.
 *
 * KOSONG hari ini, dan bentuk kuncinya sengaja ditulis SEBELUM entri
 * pertamanya lahir: komentar lama di sini menuliskan `berkas:baris`, dan itu
 * mengundang entri berikutnya dikunci pada nomor yang bergeser. Repo ini sudah
 * membayar pembusukan kunci bernomor baris EMPAT kali (`pelaku.test.ts`,
 * `util/urutan.ts` putaran 27, `util/mutasi-web.ts`, lalu `query-punya-rumah`
 * di tengah rilis 2026-09-01), dan `kunci-daftar-tak-bergeser.test.ts` kini
 * menegakkannya secara mekanis.
 */
const DIPILAH = new Map<string, string>();

const semua = situsBalasan();
const penuh = semua.filter((x) => x.kelas === "BARIS_PENUH");
const rahasia = semua.filter((x) => x.kelas === "RAHASIA");

describe("bentuk balasan: yang dikirim harus dipilih penulisnya", () => {
  it("PREMIS: populasinya benar-benar tersapu", () => {
    expect(semua.length).toBeGreaterThanOrEqual(200);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThanOrEqual(25);
    // Nol di salah satu kelas aman bukan temuan melainkan kebutaan.
    expect(semua.filter((x) => x.kelas === "DISEBUT").length).toBeGreaterThanOrEqual(150);
    expect(semua.filter((x) => x.kelas === "KOLOM").length).toBeGreaterThanOrEqual(50);
  });

  it("PREMIS: daftar tabel rahasia DIBACA dari skema, bukan diketik", () => {
    const t = tabelRahasia();
    // Daftar yang diketik adalah cara kolom rahasia BERIKUTNYA lahir tanpa
    // dijaga — kesalahan yang persis sama sudah dibayar dua putaran
    // berturut-turut (gerbang menuduh `potongLarik` lalu `kunciBackfillKode`
    // karena regexnya hafal nama lama).
    expect(t.size).toBeGreaterThanOrEqual(4);
    for (const nama of ["users", "smtpSettings", "invitations"]) {
      expect(t, `${nama} harus terdeteksi ber-kolom rahasia`).toContain(nama);
    }
    // …dan tabel biasa TIDAK boleh ikut tertandai.
    expect(t).not.toContain("sales");
    expect(t).not.toContain("companies");
  });

  it("ATURAN B: tak ada baris dari tabel rahasia yang dikirim utuh", () => {
    const daftar = rahasia.map((x) => `${x.berkas}:${x.baris}  ${x.nama} ← ${x.tabel}`);
    expect(
      daftar,
      "Baris dari tabel ber-kolom RAHASIA dikirim utuh ke klien:\n" +
        daftar.join("\n") +
        "\n\nRakit DTO-nya di tempat: sebut kolom yang memang dikirim, seperti " +
        "`buatSesi` (auth/session.ts) dan `smtpDto` (admin-system/routes.ts). " +
        "Tidak ada pengecualian yang sah untuk aturan ini.",
    ).toEqual([]);
  });

  it("ATURAN A: bentuk balasan tak ditentukan tabelnya", () => {
    const liar = penuh
      .map((x) => `${x.berkas}:${x.baris}  ${x.nama} ← ${x.tabel}`)
      .filter((k) => !DIPILAH.has(k.split("  ")[0]));
    expect(
      liar,
      "Balasan yang bentuknya mengikuti tabel:\n" +
        liar.join("\n") +
        "\n\nSebut kolomnya: `.select(KOLOM_…)` / `.returning(KOLOM_…)` dari " +
        "`src/db/kolom-publik.ts`, atau rakit DTO-nya. Daftar kolom itu dibuat " +
        "dari yang HARI INI sudah terkirim, jadi memasangnya tidak mengubah " +
        "apa pun yang dilihat klien — dan itulah buktinya ia benar.",
    ).toEqual([]);
    expect(penuh.length).toBeLessThanOrEqual(MAKS_UTANG);
  });

  it("anti-kuburan: tiap entri DIPILAH masih punya situsnya", () => {
    const nyata = new Set(penuh.map((x) => `${x.berkas}:${x.baris}`));
    const basi = [...DIPILAH.keys()].filter((k) => !nyata.has(k));
    expect(basi, `sudah tak tertuduh — hapus:\n${basi.join("\n")}`).toEqual([]);
  });

  // ---- PREMIS & PASANGAN pemindainya -------------------------------------

  it("PREMIS: pemindainya BISA menuduh — dan membedakan RAHASIA", () => {
    const skema =
      'export const users = pgTable("users", { id: uuid("id"), passwordHash: text("h") });\n' +
      'export const satuan = pgTable("satuan", { id: uuid("id"), nama: text("n") });\n';
    const s = situsBalasan(
      {
        "uji/rahasia.ts":
          "async function f(c){ const [user] = await db.select().from(users); return c.json(user); }\n",
        "uji/biasa.ts":
          "async function f(c){ const [row] = await db.select().from(satuan); return c.json(row); }\n",
      },
      skema,
    );
    expect(s.map((x) => x.kelas).sort()).toEqual(["BARIS_PENUH", "RAHASIA"]);
  });

  it("PREMIS: `returning()` telanjang sama luasnya dengan `select()` telanjang", () => {
    // Nyaris terlewat: generasi pertama hanya mengenal `select()` dan
    // melaporkan 2 situs, sementara sapuan teks melaporkan 3. Ketidakcocokan
    // itu yang menemukannya.
    const skema = 'export const satuan = pgTable("satuan", { id: uuid("id") });\n';
    const s = situsBalasan(
      {
        "uji/ret.ts":
          "async function f(c){ const [row] = await db.update(satuan).set(v).where(w).returning(); return c.json(row); }\n",
      },
      skema,
    );
    expect(s[0].kelas).toBe("BARIS_PENUH");
    expect(s[0].tabel).toBe("satuan");
  });

  it("PASANGAN: `select({ … })` berkolom eksplisit tidak dituduh", () => {
    const skema = 'export const users = pgTable("users", { id: uuid("id"), passwordHash: text("h") });\n';
    const s = situsBalasan(
      {
        "uji/kolom.ts":
          "async function f(c){ const [u] = await db.select({ id: users.id }).from(users); return c.json(u); }\n",
      },
      skema,
    );
    expect(s[0].kelas).toBe("KOLOM");
  });

  it("PASANGAN: DTO yang dirakit di tempat tidak dituduh", () => {
    // Bentuk `buatSesi`/`smtpDto`: barisnya dibaca utuh, tapi yang DIKIRIM
    // dirakit kolom demi kolom. Gerbang yang menuduh dua contoh terbaik di
    // repo ini adalah gerbang yang salah.
    const skema = 'export const users = pgTable("users", { id: uuid("id"), passwordHash: text("h") });\n';
    const s = situsBalasan(
      {
        "uji/dto.ts":
          "async function f(c){ const [u] = await db.select().from(users); " +
          "return c.json({ id: u.id, nama: u.nama, has_password: Boolean(u.passwordHash) }); }\n",
      },
      skema,
    );
    expect(s[0].kelas).toBe("DISEBUT");
  });

  it("PASANGAN: `buatSesi` & `smtpDto` yang SUNGGUHAN tetap hijau", () => {
    const auth = semua.filter((x) => x.berkas === "modules/auth/routes.ts");
    const smtp = semua.filter((x) => x.berkas === "modules/admin-system/routes.ts");
    expect(auth.length).toBeGreaterThanOrEqual(3);
    expect(smtp.length).toBeGreaterThanOrEqual(3);
    expect(auth.filter((x) => x.kelas === "RAHASIA" || x.kelas === "BARIS_PENUH")).toEqual([]);
    expect(smtp.filter((x) => x.kelas === "RAHASIA" || x.kelas === "BARIS_PENUH")).toEqual([]);
  });
});
