import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jelajah, namaProperti, petaInduk, rantaiPenuh, uraikan, type Simpul } from "./util/ast";
import { situsLomba, SRC, type SitusLomba } from "./util/lomba";

/**
 * PERIKSA-DULU-BARU-TULIS WAJIB PUNYA PENAHAN.
 *
 * `src/lib/kunci.ts` sudah menulis aturannya lengkap dengan jawaban-jawaban
 * sahnya, dan `modules/pengajuan/routes.ts:337` menamai jawaban keempat
 * ("idiomnya sudah baku di basis kode ini"). Yang belum ada: sapuan atas
 * SELURUH populasi. Dua puluh satu berkas uji menyebut kunci/balapan, tapi
 * masing-masing menguji SATU pintu — dan bug di repo ini tak pernah ditemukan
 * dengan membaca satu pintu.
 *
 * Sapuan 2026-08-27: 58 fungsi di 32 berkas MEMBACA lalu MENULIS tabel yang
 * sama. KUNCI 21 - BENTROK 12 - KLAIM 16 - KLAIM_BUTA 5 - TELANJANG 4.
 *
 * TEMUAN yang diperbaiki putaran ini: `backfillKodeBahan` & `backfillKodeMenu`
 * mengisi kode unik-per-perusahaan tanpa kunci apa pun, sementara saudaranya
 * `backfillEmployeeCode` memegang advisory lock DAN kolomnya berindeks unik.
 * TERUKUR pada basis data seed (232 bahan, 0 kode ganda): dua backfill yang
 * jalan bersamaan menghasilkan 2 kode ganda; sesudah kuncinya dipasang, 0 —
 * dan backfill kedua jadi no-op (232 + 230 menjadi 232 + 0).
 */
type Kelas = "sah" | "utang";

interface Alasan {
  kelas: Kelas;
  teks: string;
}

/** Utang yang diakui, dalam SITUS. Wajib TURUN begitu terbayar. */
const MAKS_UTANG = 2;

/** kunci: `berkas` -> nama fungsi -> alasan. */
const daftar: Record<string, Record<string, Alasan>> = {
  "modules/auth/routes.ts": {
    "POST /reset-password": {
      kelas: "sah",
      teks:
        "BARU TERLIHAT sesudah pemindai bisa menembus `db.transaction`. Dua " +
        "pemakaian tautan reset yang sama secara bersamaan: keduanya menyetel " +
        "password (penulis terakhir menang) dan keduanya mematikan SELURUH " +
        "tautan reset akun itu. Kedua permintaan datang dari pemegang tautan " +
        "yang sama, jadi tak ada yang bisa didapat seseorang yang belum bisa " +
        "ia lakukan sendirian — dan di setiap urutan, tautannya berakhir mati.",
    },
    "POST /verify-email": {
      kelas: "sah",
      teks:
        "BARU TERLIHAT sesudah pemindai menembus transaksi. `emailVerifiedAt` " +
        "ditulis `user.emailVerifiedAt ?? new Date()` — idempoten, verifikasi " +
        "pertama yang bertahan — dan seluruh tautan verifikasi akun itu " +
        "dimatikan sekaligus. Dua permintaan bersamaan berakhir di keadaan " +
        "yang persis sama dengan satu permintaan; tak ada invarian yang bisa " +
        "dilanggar salah satu urutannya.",
    },
  },
  "modules/produksi/routes.ts": {
    catatRealisasiDana: {
      kelas: "sah",
      teks:
        "TUDUHAN DICABUT. Baca-hitung-sisip atas `faktur_dana` memang tak " +
        "punya penahan sendiri, tapi KEDUA pemanggilnya (:1153 & :1342) " +
        "berjalan sesudah klaim tahap faktur: UPDATE productions WHERE " +
        "status = <yang dibaca> AND qty = <yang dibaca>, lalu returning() dan " +
        "409 `status_berubah`. Permintaan kedua kalah di situ dan tak pernah " +
        "sampai ke fungsi ini. Batas pemindai yang berlingkup satu fungsi.",
    },
  },
  "modules/penyimpanan/autoFile.ts": {
    autoFileRakCabang: {
      kelas: "sah",
      teks:
        "Klaim idempoten: UPDATE productions WHERE id = ? AND " +
        "storage_location_id IS NULL. Yang kalah tak menulis apa pun, dan tak " +
        "ada yang perlu dikabarkan — ini pengarsipan otomatis di latar, bukan " +
        "jawaban atas permintaan seseorang.",
    },
  },
  "modules/kebersihan/routes.ts": {
    "PATCH /area/:id": {
      kelas: "sah",
      teks:
        "Mengubah NAMA area kebersihan. Penulis terakhir menang, dan itu arti " +
        "yang benar untuk sebuah nama: tak ada invarian yang bisa dilanggar " +
        "oleh dua orang yang mengetik nama berbeda.",
    },
    "PATCH /:id/catatan": {
      kelas: "sah",
      teks:
        "Catatan bebas owner pada satu laporan kebersihan. Sama seperti nama " +
        "area: penulis terakhir menang, dan tak ada hitungan yang bergantung " +
        "padanya.",
    },
  },
  "modules/admin-tenants/routes.ts": {
    // Kunci daftar berubah `transaction` → `jalankan` begitu callback transaksi
    // berhenti dinilai sebagai situs tersendiri: yang tertuduh kini fungsi
    // yang MENULISKAN transaksinya, dan itu memang nama yang benar untuknya.
    jalankan: {
      kelas: "utang",
      teks:
        "UTANG. Pembuatan penyewa (companies + users) oleh super admin. " +
        "Peluangnya kecil — satu orang, satu formulir — tapi kecil bukan " +
        "ditahan, dan itu justru pembedaan yang vena ini ada untuk menjaga.",
    },
  },
  "modules/auth/superadmin.ts": {
    pastikanSuperAdmin: {
      kelas: "utang",
      teks:
        "UTANG, dan tetangganya sudah menunjukkan jawabannya: " +
        "`backfillEmployeeCode` di berkas sebelah memegang advisory lock " +
        "supaya dua instance yang boot bersamaan tak menulis ganda. Fungsi " +
        "ini berjalan di boot yang sama dan tidak.",
    },
  },
};

const semua = situsLomba();
const tertuduh = semua.filter((x) => x.kelas === "KLAIM_BUTA" || x.kelas === "TELANJANG");
const cari = (x: SitusLomba): Alasan | undefined => daftar[x.berkas]?.[x.nama];

describe("periksa-dulu-baru-tulis wajib punya penahan", () => {
  it("PREMIS: populasinya benar-benar tersapu", () => {
    expect(semua.length).toBeGreaterThanOrEqual(45);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThanOrEqual(25);
  });

  it("PREMIS: idiom sah TERBACA sebagai aman", () => {
    // Nol di salah satu kelas ini bukan temuan melainkan kebutaan: idiomnya
    // dipakai puluhan kali, dan pemindai yang tak melihatnya akan menyuruh
    // memperbaiki kode yang justru jadi contoh di komentar repo ini.
    for (const k of ["KUNCI", "BENTROK", "KLAIM"] as const) {
      expect(semua.filter((x) => x.kelas === k).length, `kelas ${k}`).toBeGreaterThanOrEqual(10);
    }
  });

  it("PREMIS: pengisi kode massal memegang kuncinya", () => {
    // Temuan putaran ini, dipaku supaya tak lepas lagi.
    const backfill = semua.filter((x) => /backfill/i.test(x.nama));
    expect(backfill.length).toBeGreaterThanOrEqual(2);
    for (const b of backfill) {
      expect(b.kelas, `${b.berkas} -> ${b.nama} tak memegang kunci`).toBe("KUNCI");
    }
  });

  /* ── PENAHAN DI DALAM TRANSAKSI — kebutaan yang dibayar putaran ini ─────── */

  /**
   * `db.transaction(cb)` bukan fungsi lain dari sudut pandang balapan.
   *
   * Generasi pertama pemindai ini menghitung panggilan hanya bila pembungkus
   * TERDEKATNYA adalah fungsi yang sedang dinilai — jadi setiap penjaga yang
   * hidup di dalam sebuah transaksi tak terlihat sama sekali. Terukur saat
   * kebutaan itu dicabut: dari 73 callback transaksi di `src`, 31 memuat
   * `.update(` langsung di dalamnya dan **17** memegang klaim yang DIPERIKSA.
   *
   * Harganya sudah masuk ledger sebagai tuduhan yang kalimatnya keliru:
   * `tibaBeliPerlengkapan` didaftarkan `utang` dengan alasan *"hasilnya tak
   * pernah dilihat"*, padahal `if (dikunci.length === 0) throw SUDAH` sudah ada
   * lima minggu sebelum utang itu ditulis. Yang tak terlihat transaksinya.
   */
  const satu = (kode: string) => situsLomba({ "x.ts": kode })[0];

  it("PREMIS: klaim yang diperiksa DI DALAM transaksi terbaca KLAIM", () => {
    expect(
      satu(`async function f() {
         const [ada] = await db.select().from(t).where(eq(t.id, id));
         return db.transaction(async (tx) => {
           const kena = await tx.update(t).set({ s: 1 }).where(and(eq(t.id, id), eq(t.s, 0))).returning();
           if (kena.length === 0) throw new Error("kalah");
           return kena;
         });
       }`).kelas,
    ).toBe("KLAIM");
  });

  it("PREMIS: klaim TANPA pemeriksaan di dalam transaksi tetap KLAIM_BUTA", () => {
    expect(
      satu(`async function f() {
         const [ada] = await db.select().from(t).where(eq(t.id, id));
         return db.transaction(async (tx) => {
           await tx.update(t).set({ s: 1 }).where(and(eq(t.id, id), eq(t.s, 0)));
         });
       }`).kelas,
    ).toBe("KLAIM_BUTA");
  });

  it("PREMIS: kunci di dalam transaksi terbaca KUNCI", () => {
    expect(
      satu(`async function f() {
         return db.transaction(async (tx) => {
           await kunciAntrean(tx, "a", id);
           const [ada] = await tx.select().from(t).where(eq(t.id, id));
           await tx.update(t).set({ s: 1 }).where(eq(t.id, id));
         });
       }`).kelas,
    ).toBe("KUNCI");
  });

  it("PASANGAN: callback yang BUKAN transaksi tetap tak ikut dihitung", () => {
    // `.map(...)`/`Promise.all` benar-benar menjalankan badannya di konteks
    // lain; hanya `db.transaction(cb)` yang menjalankan `cb` tepat sekali di
    // alur fungsi yang menuliskannya. Menembus keduanya akan menggabungkan
    // balapan yang tak berhubungan jadi satu situs.
    expect(
      situsLomba({
        "x.ts": `async function f() {
           const baris = await db.select().from(t);
           await Promise.all(baris.map(async (b) => { await db.update(t).set({ s: 1 }).where(eq(t.id, b.id)); }));
         }`,
      }),
    ).toEqual([]);
  });

  it("PASANGAN: callback transaksi tak dihitung DUA KALI", () => {
    // Sesudah ia jadi milik fungsi induknya, ia tak boleh juga berdiri sebagai
    // situs tersendiri — satu balapan yang sama akan muncul dua kali dan angka
    // populasinya berhenti berarti.
    const s = situsLomba({
      "x.ts": `async function f() {
         return db.transaction(async (tx) => {
           const [ada] = await tx.select().from(t).where(eq(t.id, id));
           await tx.update(t).set({ s: 1 }).where(eq(t.id, id));
         });
       }`,
    });
    expect(s.length).toBe(1);
  });

  /**
   * PENANDA SUSULAN & PENUTUPAN SHIFT — dua sisi dari satu invarian, dipaku
   * di sini supaya tak ada yang bisa mencabut salah satunya diam-diam.
   *
   * Penjualan yang mendarat di sebuah shift entah TERHITUNG oleh rekap
   * penutupannya, entah menyalakan `ada_transaksi_susulan`. Yang menahannya:
   * `createSale` mengunci baris shift tujuan `FOR UPDATE` lalu menulis
   * penandanya di dalam transaksi yang sama, dan `POST /shift/tutup` memegang
   * kunci baris itu dari SEBELUM rekap sampai SESUDAH penutupan.
   *
   * Terukur sebelum keduanya ada: 11 dari 20 penutupan yang berpapasan dengan
   * satu penjualan sinkron mendarat di celah — rekapnya melewatkan penjualan
   * itu DAN penandanya tetap `false`. Cabut salah satu kunci dan uji ini merah.
   *
   * BATAS yang diakui: uji ini hanya melihat KELAS situsnya, jadi ia
   * membuktikan kuncinya ADA — bukan bahwa ia dipegang cukup lama. Yang
   * menilai itu bagian §280 verify-api, dan itu alasan lapis dinamisnya ada.
   */
  it("penanda susulan & penutupan shift sama-sama DI BAWAH KUNCI", () => {
    const kunciDi = (berkas: string, nama: string) => {
      const s = semua.find((x) => x.berkas === berkas && x.nama === nama);
      expect(s, `situs ${berkas} -> ${nama} hilang dari sapuan`).toBeDefined();
      expect(s!.kelas, `${berkas} -> ${nama} tak memegang kunci`).toBe("KUNCI");
    };
    kunciDi("modules/penjualan/service.ts", "createSale");
    kunciDi("modules/shift/routes.ts", "POST /tutup");
  });

  /**
   * KUNCINYA DIPAKU DI TEMPATNYA, sebab kelas situs saja tak cukup di sini.
   *
   * `createSale` sudah berkelas KUNCI karena `branches` dikunci `FOR UPDATE`
   * di baris pertamanya. Kunci baris SHIFT bisa dicabut tanpa menurunkan kelas
   * itu sedikit pun — pemindai berlingkup fungsi, dan satu kunci sudah cukup
   * membuat seluruh fungsi terbaca aman.
   *
   * Dan lapis dinamisnya pun tak bisa menggantikannya: TERUKUR, dengan kunci
   * `/shift/tutup` terpasang tapi kunci `createSale` dicabut, pelanggarannya
   * turun dari 11/20 jadi 1/20 — jendelanya menyempit ke beberapa milidetik
   * dan §280 (8 putaran) cuma menangkapnya sesekali. Jadi yang menjaga kunci
   * ITU adalah uji ini, dan itu sebabnya ia ditulis struktural, bukan
   * mengandalkan peluang.
   */
  it("tiap pencarian shift di createSale MENGAMBIL kuncinya", () => {
    const rel = "modules/penjualan/service.ts";
    const isi = readFileSync(`${SRC}/${rel}`, "utf8");
    const akar = uraikan(rel, isi);
    const induk = petaInduk(akar);
    const rantai: string[] = [];
    jelajah(akar, (n) => {
      if (n.type !== "CallExpression") return;
      if (namaProperti(n.callee as Simpul) !== "from") return;
      const arg = (n.arguments as Simpul[] | undefined)?.[0] as
        | { type?: string; name?: string }
        | undefined;
      if (arg?.type !== "Identifier" || arg.name !== "shifts") return;
      const r = rantaiPenuh(n, induk);
      rantai.push(isi.slice(r.start as number, r.end as number));
    });
    // PREMIS: nol pencarian akan membuat "semuanya berkunci" benar secara hampa.
    expect(rantai.length, "tak satu pun `.from(shifts)` terbaca di createSale").toBeGreaterThanOrEqual(2);
    const telanjang = rantai
      .filter((t) => !/\.for\(/.test(t))
      .map((t) => t.replace(/\s+/g, " ").slice(0, 120));
    expect(
      telanjang,
      "Pencarian shift tanpa kunci di `createSale`:\n" +
        telanjang.join("\n") +
        "\n\nShift yang dicari lalu dipakai TANPA dipegang bisa ditutup di sela " +
        "pencarian dan penyimpanan — komentar di berkas itu sendiri yang " +
        "menuliskannya, dan cabang `shiftId` dari pemanggil pernah melewatinya.",
    ).toEqual([]);
  });

  /**
   * Sisi kedua invarian yang sama: penutupan shift menghitung rekapnya DI
   * DALAM transaksi yang memegang kunci baris itu. Dijalankan lewat `db`,
   * hitungannya di luar kunci — dan penjualan yang commit di antaranya tak
   * terhitung oleh siapa pun sekaligus tak menyalakan penandanya.
   */
  it("penutupan shift memegang kunci barisnya SEBELUM rekap dihitung", () => {
    const rel = "modules/shift/routes.ts";
    const isi = readFileSync(`${SRC}/${rel}`, "utf8");
    const akar = uraikan(rel, isi);
    const induk = petaInduk(akar);
    const badan: string[] = [];
    jelajah(akar, (n) => {
      // Properti `closedAt: new Date()` — satu-satunya penulisan PENUTUPAN.
      const kunci = (n as { key?: { name?: string } }).key?.name;
      if (!/^(Property|ObjectProperty)$/.test(n.type) || kunci !== "closedAt") return;
      const nilai = (n as { value?: { type?: string } }).value;
      if (nilai?.type !== "NewExpression") return;
      // Naik sampai callback `.transaction(...)` yang membungkusnya.
      let k: Simpul | undefined = induk.get(n);
      while (k) {
        if (/Function(Expression|Declaration)$|ArrowFunctionExpression/.test(k.type)) {
          const atas = induk.get(k);
          if (
            atas?.type === "CallExpression" &&
            (atas.arguments as Simpul[] | undefined)?.[0] === k &&
            namaProperti(atas.callee as Simpul) === "transaction"
          ) {
            badan.push(isi.slice(k.start as number, k.end as number));
            return;
          }
        }
        k = induk.get(k);
      }
      badan.push("(DI LUAR TRANSAKSI)");
    });
    expect(badan.length, "penulisan `closedAt: new Date()` tak ditemukan").toBe(1);
    expect(badan[0], "penutupan shift tak berjalan di dalam db.transaction").not.toBe(
      "(DI LUAR TRANSAKSI)",
    );
    expect(/\.for\("update"\)/.test(badan[0]), "kunci baris shift tak diambil").toBe(true);
    expect(
      /rekapWindow\(\s*tx\b/.test(badan[0]),
      "rekap penutupan dihitung di LUAR transaksi yang memegang kuncinya",
    ).toBe(true);
  });

  it("tiap periksa-lalu-tulis tanpa penahan sudah diadjudikasi", () => {
    const liar = tertuduh
      .filter((x) => cari(x) === undefined)
      .map((x) => `${x.berkas}:${x.baris} [${x.nama}] ${x.kelas} tabel=${x.tabel.join(",")}`);
    expect(
      liar,
      "Periksa-dulu-baru-tulis tanpa penahan:\n" +
        liar.join("\n") +
        "\n\nPilih SATU: (a) FOR UPDATE bila ada baris untuk dipegang; " +
        "(b) indeks unik + penanganan bentrok bila aturannya kesamaan kolom; " +
        "(c) kunciAntrean bila keduanya tak bisa (lihat src/lib/kunci.ts); " +
        "(d) UPDATE bersyarat yang hasilnya DIPERIKSA atau dibaca ulang; atau " +
        "(e) daftarkan dengan KELAS-nya — sah bila penulis-terakhir-menang " +
        "memang arti yang benar di situ, utang bila tidak.",
    ).toEqual([]);
  });

  it("daftarnya ditagih dua arah — tak ada entri kuburan", () => {
    const nyata = new Set(tertuduh.map((x) => `${x.berkas} ${x.nama}`));
    const salah: string[] = [];
    for (const [berkas, per] of Object.entries(daftar)) {
      for (const [nama, a] of Object.entries(per)) {
        if (!nyata.has(`${berkas} ${nama}`)) {
          salah.push(`${berkas} -> ${nama}: sudah tak tertuduh — hapus entrinya`);
        }
        if (a.teks.trim().length < 60) salah.push(`${berkas} -> ${nama}: alasannya terlalu pendek`);
      }
    }
    expect(salah, salah.join("\n")).toEqual([]);
  });

  it("UTANG-nya dihitung, dan tak boleh tumbuh diam-diam", () => {
    const utang = tertuduh.filter((x) => cari(x)?.kelas === "utang");
    expect(
      utang.length,
      `Utang balapan naik jadi ${utang.length} (batas ${MAKS_UTANG}):\n` +
        utang.map((x) => `  ${x.berkas}:${x.baris} [${x.nama}]`).join("\n"),
    ).toBeLessThanOrEqual(MAKS_UTANG);
    expect(MAKS_UTANG - utang.length, "turunkan batasnya").toBeLessThanOrEqual(1);
  });

  // ---- PREMIS & PASANGAN pemindainya -------------------------------------

  it("PREMIS: pemindainya BISA menuduh", () => {
    const s = situsLomba({
      "uji/telanjang.ts":
        "async function f(){ const [a] = await db.select().from(t).where(w); " +
        "if (!a) throw new Error('x'); await db.insert(t).values(v); }\n",
    });
    expect(s.length).toBe(1);
    expect(s[0].kelas).toBe("TELANJANG");
    expect(s[0].tabel).toEqual(["t"]);
  });

  it("PASANGAN: baca tabel A lalu tulis tabel B bukan balapan", () => {
    // "Muat induknya, 404 kalau tak ada, lalu tulis anaknya" — penulisannya
    // atomik, dan induk yang terhapus bersamaan hanya membuatnya gagal FK.
    const s = situsLomba({
      "uji/lain.ts":
        "async function f(){ const [a] = await db.select().from(induk); " +
        "if (!a) throw new Error('x'); await db.insert(anak).values(v); }\n",
    });
    expect(s).toEqual([]);
  });

  it("PASANGAN: keempat penahan diterima", () => {
    const s = situsLomba({
      "uji/kunci.ts":
        "async function f(){ await tx.execute(sql`SELECT 1 FROM t FOR UPDATE`); " +
        "const [a] = await tx.select().from(t); await tx.insert(t).values(v); }\n",
      "uji/antrean.ts":
        "async function f(){ await kunciAntrean(tx, 'x'); " +
        "const [a] = await tx.select().from(t); await tx.insert(t).values(v); }\n",
      "uji/bentrok.ts":
        "async function f(){ const [a] = await db.select().from(t); " +
        "await db.insert(t).values(v).onConflictDoNothing(); }\n",
      "uji/klaim.ts":
        "async function f(c){ const [a] = await db.select().from(t); " +
        "const hit = await db.update(t).set(s).where(w).returning({ id: t.id }); " +
        "if (hit.length === 0) throw new Error('kalah'); return c.json(hit); }\n",
    });
    expect(s.length).toBe(4);
    expect(s.map((x) => x.kelas).sort()).toEqual(["BENTROK", "KLAIM", "KUNCI", "KUNCI"]);
  });

  it("PASANGAN: klaim yang hasilnya tak dilihat TETAP tertuduh", () => {
    const s = situsLomba({
      "uji/buta.ts":
        "async function f(c){ const [a] = await db.select().from(t); " +
        "await db.update(t).set(s).where(w); return c.json({ ok: true }); }\n",
    });
    expect(s[0].kelas).toBe("KLAIM_BUTA");
  });

  it("PASANGAN: klaim yang dibaca ULANG sesudahnya diterima", () => {
    // Idiom POST /shift/kunci-hitungan: yang kalah melaporkan nominal yang
    // BENAR-BENAR tersimpan, bukan yang ia kirim.
    const s = situsLomba({
      "uji/baca-ulang.ts":
        "async function f(c){ const [a] = await db.select().from(t); " +
        "await db.update(t).set(s).where(w); " +
        "const [after] = await db.select().from(t); return c.json(after); }\n",
    });
    expect(s[0].kelas).toBe("KLAIM");
  });
});
