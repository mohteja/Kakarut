import { describe, expect, it } from "vitest";
import { petaUnik, situsUrut, kunciSql } from "./util/urutan";

/**
 * DAFTAR YANG DIPOTONG WAJIB PUNYA PEMUTUS SERI.
 *
 * `ORDER BY x` pada baris yang nilai `x`-nya SAMA tidak menentukan urutan
 * apa pun — Postgres bebas memulangkannya dalam urutan mana saja, dan urutan
 * itu boleh berbeda antar-query. Dipadu `LIMIT`/`OFFSET`, akibatnya bukan
 * sekadar tampilan yang goyah:
 *
 *   - dua baris yang seri bisa sama-sama muncul di halaman 1 DAN halaman 2;
 *   - sementara baris ketiga TAK MUNCUL DI HALAMAN MANA PUN.
 *
 * Baris yang hilang itu tak meninggalkan gejala. Yang membacanya cuma melihat
 * daftar yang "sepertinya kurang", dan tak ada cara menebak dari mana.
 *
 * SERINYA BUKAN KEBETULAN. Dua sumber yang sudah ada di repo ini:
 *
 *   1. Aksi massal menulis SATU timestamp ke banyak baris sekaligus.
 *      "Selesaikan semua" di papan pesanan memakai satu `new Date()` untuk
 *      seluruh baris kartu — jadi tiap pemakaian melahirkan sekelompok baris
 *      berwaktu identik. Terukur di data uji: ada kelompok seri.
 *   2. `now()` di Postgres STABIL PER TRANSAKSI, jadi seluruh baris yang lahir
 *      dalam satu transaksi berbagi `created_at` yang persis sama.
 *
 * Konvensinya sudah tertulis di `app.ts` (catatan ETag): setiap query daftar
 * memakai ORDER BY dengan pemutus seri.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * KOMENTAR DI ATAS ADALAH MILIK GENERASI PERTAMA UJI INI, DAN DIPERTAHANKAN
 * UTUH — ia sudah menuliskan aturannya DAN sumber serinya dengan benar.
 *
 * Yang meleset alat ukurnya. Pemindai teksnya hanya melihat `.orderBy(` yang
 * dalam 500 KARAKTER berikutnya memuat `.offset(`, lalu menghitung KOMA
 * sebagai pengganti keunikan. Tiga akibatnya terukur saat berkas ini ditulis
 * ulang:
 *
 *   · dari 52 pengurutan yang memotong, ia menjaga 2 — dan ambang premisnya
 *     sendiri (`>= 2`) adalah persis seluruh populasi yang dilihatnya, jadi
 *     kebutaannya tak bisa ketahuan dari dalam;
 *   · seluruh `ORDER BY` di dalam templat `sql` — 11 buah, enam di antaranya
 *     di jalur FIFO & baseline saldo — tak pernah masuk populasinya;
 *   · `GET /produksi` LULUS dengan dua kunci yang KEDUANYA agregat dan tak
 *     satu pun unik, sebab komanya ada satu. Terukur lewat HTTP pada 60 faktur
 *     berwaktu identik: `per_page=5`, seluruh halaman ditelusuri sampai habis,
 *     dan yang terkumpul **56 faktur berbeda dari `total: 60`** — EMPAT tak
 *     muncul di halaman mana pun, sementara yang lain muncul dua kali.
 *
 * Sekarang keunikan DIBACA DARI SKEMA (`primaryKey`, `unique`, `uniqueIndex`
 * non-parsial) dan kunci GRUP dihitung unik menurut konstruksi. Batas-batas
 * yang diakui ditulis di kepala `util/urutan.ts` — hijau di sini berarti
 * "total dalam batas itu", bukan "tak mungkin seri".
 */
describe("daftar yang dipotong: ORDER BY wajib berpemutus seri", () => {
  const semua = situsUrut();

  /* ── CAKUPAN: nol di salah satu angka ini berarti pemindainya buta ──────── */

  it("membaca keunikan dari SKEMA, bukan dari daftar yang diketik", () => {
    const unik = petaUnik();
    // 59 pgTable saat ditulis; ambangnya di bawah itu supaya tabel yang
    // dihapus tak memerahkan gerbang, tapi cukup tinggi untuk menangkap
    // skema yang gagal terurai (yang akan memulangkan nol).
    expect(unik.tupel.size).toBeGreaterThanOrEqual(50);
    expect(unik.kolomDb.has("id")).toBe(true);
    // kolom unik yang BUKAN `id` — bukti pembacanya tak sekadar menebak
    expect(unik.kolomDb.has("slug")).toBe(true);
    expect(unik.kolomDb.has("token_hash")).toBe(true);
    // tupel gabungan dari `uniqueIndex(...).on(a, b)`
    const cabang = unik.tupel.get("branches") ?? [];
    expect(cabang.some((t) => t.length === 2)).toBe(true);
  });

  it("menyapu KEDUA bentuk pengurutan, bukan satu", () => {
    const drizzle = semua.filter((s) => s.bentuk === "drizzle");
    const mentah = semua.filter((s) => s.bentuk === "sql");
    // 41 + 11 saat ditulis. Yang dijaga di sini bukan angkanya melainkan
    // bahwa KEDUA populasi tak pernah kosong — pemindai lama melaporkan nol
    // untuk yang kedua, dan nol itu terbaca sebagai "bersih".
    expect(drizzle.length).toBeGreaterThanOrEqual(35);
    expect(mentah.length).toBeGreaterThanOrEqual(8);
  });

  it("melihat pintu yang benar-benar BERHALAMAN", () => {
    // `.offset()` adalah bentuk paling mahal dari seri: bukan cuma urutan yang
    // goyah, melainkan baris yang hilang dari SEMUA halaman.
    expect(semua.filter((s) => s.berOffset).length).toBeGreaterThanOrEqual(2);
  });

  /* ── ATURANNYA ─────────────────────────────────────────────────────────── */

  it("tak ada pengurutan memotong yang urutannya tak menentukan", () => {
    const pelanggar = semua
      .filter((s) => s.kelas === "SERI")
      .map((s) => `${s.berkas}:${s.baris} [${s.kunciUrut.join(" | ")}]`);
    expect(
      pelanggar,
      "tambahkan kunci terakhir yang UNIK (`desc(tabel.id)`, atau kunci GRUP-nya " +
        "untuk kueri beragregat) — tanpa itu baris yang serinya bisa muncul dua " +
        "kali di halaman berbeda sementara baris lain tak muncul sama sekali",
    ).toEqual([]);
  });

  /* ── PREMIS: detektornya bisa menuduh, dua arah ─────────────────────────── */

  /**
   * Premisnya dibuktikan di FIKSTUR, bukan di pohon sungguhan.
   *
   * Pelajaran putaran 27: premis yang bersandar pada "kebetulan masih ada
   * contohnya di repo" diam-diam berhenti membuktikan apa pun begitu contoh
   * terakhirnya diperbaiki. Sesudah putaran ini tak ada satu pun pengurutan
   * SERI yang tersisa di `src/` — jadi contohnya HARUS disuntik.
   */
  const SKEMA_UJI = `
    export const barang = pgTable("barang", {
      id: uuid("id").primaryKey().defaultRandom(),
      kode: text("kode").notNull().unique(),
      waktu: timestamp("waktu").notNull(),
      nama: text("nama").notNull(),
    }, (t) => [uniqueIndex("barang_co_nama_uq").on(t.companyId, t.nama)]);
    export const separuh = pgTable("separuh", {
      id: uuid("id").primaryKey(),
      sidik: text("sidik"),
    }, (t) => [uniqueIndex("separuh_sidik_uq").on(t.sidik).where(sql\`x\`)]);
  `;
  const kelas = (kode: string): string | undefined =>
    situsUrut({ "x.ts": kode }, SKEMA_UJI)[0]?.kelas;

  it("MERAH: kunci tunggal tak unik yang memotong", () => {
    expect(kelas(`db.select().from(barang).orderBy(desc(barang.waktu)).limit(10)`)).toBe("SERI");
    expect(kelas(`db.select().from(barang).orderBy(desc(barang.waktu)).limit(2).offset(o)`)).toBe(
      "SERI",
    );
    expect(kelas("db.execute(sql`SELECT * FROM barang b ORDER BY b.waktu DESC LIMIT 5`)")).toBe(
      "SERI",
    );
  });

  it("DUA ARAH: kunci grup berupa EKSPRESI yang dialiaskan ke medan select", () => {
    /*
     * Bentuk yang lahir 2026-09-04 di `GET /perlengkapan/beli`. Kunci grupnya
     * `coalesce(faktur_id, id)` — tak punya tabel untuk disematkan, jadi ia
     * dirakit ke sebuah konstanta yang dipakai dua kali: sebagai medan select
     * ber-`.as(…)`, dan sebagai argumen `.groupBy(…)`.
     *
     * Tanpa pemetaan medannya, kunci grup terbaca `kunciFaktur` — nama
     * telanjang yang takkan pernah cocok dengan `sub.kunci` di ORDER BY luar,
     * dan situs yang pemutus serinya JUSTRU kunci grupnya sendiri divonis
     * SERI. Vonis begitu mahal: ia menyuruh orang menambah pemutus seri kedua
     * pada kunci yang sudah unik.
     */
    const sub = `
      const kunciFaktur = sql\`coalesce(x, y)\`;
      const sub = db.select({ kunci: kunciFaktur.as("k"), waktu: sql\`max(t)\`.as("w") })
        .from(barang).groupBy(kunciFaktur).as("sub");
    `;
    // HIJAU: kunci grupnya ikut diurutkan lewat medannya.
    expect(
      kelas(`${sub} db.select().from(sub).orderBy(desc(sub.waktu), asc(sub.kunci)).limit(3).offset(o)`),
    ).toBe("TOTAL");
    // MERAH: pemutus serinya DICABUT — pembebasannya tak boleh menular ke
    // pengurutan yang memang tak menentukan.
    expect(
      kelas(`${sub} db.select().from(sub).orderBy(desc(sub.waktu)).limit(3).offset(o)`),
    ).toBe("SERI");
    // MERAH JUGA: medan lain yang kebetulan ada, bukan kunci grupnya.
    expect(
      kelas(`${sub} db.select().from(sub).orderBy(desc(sub.waktu), asc(sub.lain)).limit(3).offset(o)`),
    ).toBe("SERI");
  });

  it("HIJAU: kunci terakhir yang unik menurut skema", () => {
    expect(kelas(`db.select().from(barang).orderBy(desc(barang.waktu), desc(barang.id)).limit(10)`)).toBe(
      "TOTAL",
    );
    // unik lewat `.unique()`, bukan lewat `id`
    expect(kelas(`db.select().from(barang).orderBy(desc(barang.waktu), asc(barang.kode)).limit(10)`)).toBe(
      "TOTAL",
    );
    // tupel gabungan `uniqueIndex(companyId, nama)` — dua kunci, dua-duanya perlu
    expect(
      kelas(`db.select().from(barang).orderBy(asc(barang.companyId), asc(barang.nama)).limit(10)`),
    ).toBe("TOTAL");
    expect(kelas(`db.select().from(barang).orderBy(asc(barang.nama)).limit(10)`)).toBe("SERI");
  });

  it("PASANGAN: pengurutan yang TIDAK memotong tak ikut dituduh", () => {
    // Seri pada daftar yang dipulangkan UTUH cuma soal tampilan; menuduhnya
    // akan membuat gerbang ini ditutup orang alih-alih dipatuhi.
    expect(situsUrut({ "x.ts": `db.select().from(barang).orderBy(desc(barang.waktu))` }, SKEMA_UJI)).toEqual(
      [],
    );
  });

  it("PASANGAN: kunci GRUP dihitung unik — kueri beragregat tak dituduh", () => {
    expect(kelas(`db.select().from(barang).groupBy(kunci).orderBy(desc(agg), kunci).limit(5)`)).toBe(
      "TOTAL",
    );
    expect(kelas(`db.select().from(barang).groupBy(kunci).orderBy(desc(agg)).limit(5)`)).toBe("SERI");
    expect(
      kelas("db.execute(sql`SELECT k FROM barang GROUP BY k ORDER BY MAX(waktu) DESC, k LIMIT 5`)"),
    ).toBe("TOTAL");
  });

  it("kunci grup dicocokkan UTUH, bukan sebagai substring", () => {
    // Generasi pertama `grupTerpakai` memakai `includes`, dan membebaskan
    // kueri ini: kunci grup `k` "hadir" di dalam `MAX(waktu)` karena kata
    // `waktu` memuat huruf k. Satu huruf membatalkan seluruh aturan.
    expect(
      kelas("db.execute(sql`SELECT k FROM barang GROUP BY k ORDER BY MAX(waktu) DESC LIMIT 5`)"),
    ).toBe("SERI");
  });

  it("agregat atas kolom unik BUKAN kolom unik", () => {
    // `MAX(id)` mengurut maksimumnya, bukan `id`-nya. Menyamakan keduanya
    // adalah pembebasan palsu, dan bentuk ini ada di repo (`MAX(waktu)`).
    expect(kelas("db.select().from(barang).orderBy(desc(sql`max(${barang.id})`)).limit(3)")).toBe(
      "SERI",
    );
  });

  it("indeks unik PARSIAL tidak menjadikan pengurutan total", () => {
    // `uniqueIndex(...).where(...)` hanya menjamin keunikan bagi baris yang
    // lolos predikatnya — baris di luar itu tetap bisa seri.
    expect(kelas(`db.select().from(separuh).orderBy(asc(separuh.sidik)).limit(3)`)).toBe("SERI");
  });

  it("komentar SQL tak bisa membingungkan pembacanya", () => {
    // Komentar yang menyebut LIMIT/ORDER BY pernah terbaca sebagai klausa
    // sungguhan — pemindai yang bisa dibingungkan komentar bisa dibungkam
    // dengan komentar. Di sini komentarnya menyebut keduanya, DAN kuerinya
    // memang melanggar; yang dijaga: vonisnya datang dari SQL, bukan teks.
    expect(
      kelas(
        "db.execute(sql`SELECT * FROM barang b\n" +
          "  -- ORDER BY b.id: LIMIT dijelaskan di sini, bukan dijalankan\n" +
          "  ORDER BY b.waktu DESC LIMIT 5`)",
      ),
    ).toBe("SERI");
  });

  it("alias kolom unik dikenali (deret UNION menyebut alias, bukan kolomnya)", () => {
    expect(
      kelas(
        "db.execute(sql`SELECT * FROM (SELECT b.waktu, b.id AS ev_id FROM barang b) e " +
          "ORDER BY e.waktu ASC, e.ev_id ASC LIMIT 5`)",
      ),
    ).toBe("TOTAL");
  });

  it("pemecah kunci SQL menghormati kurung", () => {
    // `split(",")` yang polos memecah `COALESCE(a, b)` jadi dua kunci palsu,
    // dan kunci grup yang terpecah tak pernah cocok lagi.
    expect(kunciSql("SELECT 1 ORDER BY COALESCE(a, b) DESC, c ASC LIMIT 3")).toEqual([
      "COALESCE(a, b) DESC",
      "c ASC",
    ]);
  });
});
