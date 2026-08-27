import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { situsBendera, type Situs } from "./util/bendera-hapus";
import { SRC, berkasTs } from "./util/sql-mentah";

/**
 * BARIS YANG SUDAH DINYATAKAN TIDAK BERLAKU — dan pintu yang lupa menyaringnya.
 *
 * Basis data ini punya bendera untuk itu, dan sampai vena ini tak satu pun
 * punya rumah: `isNull(sales.deletedAt)` ditulis ulang 23 kali,
 * `productions.deletedAt` 26 kali, `memberships.archivedAt` 22 kali. Delapan
 * puluhan salinan aturan yang sama, tanpa gerbang.
 *
 * EMPAT PINTU LUPA, dan keempatnya menugaskan PEKERJAAN — terukur lewat HTTP
 * sebelum dituduh:
 *
 *   POST /produksi/faktur      worker = karyawan yang sudah keluar → 201
 *   PATCH /produksi/faktur/:k  worker = karyawan yang sudah keluar → 200
 *   POST /rekomendasi/menu/faktur                                  → 201
 *   PUT  /penyimpanan/:id/petugas                                  → 200
 *
 * Yang terakhir paling telanjang: balasannya sendiri memuat `"aktif": false`
 * tepat di sebelah penugasan yang baru saja diterimanya. Layarnya tahu;
 * pintunya tidak.
 *
 * Yang rusak BUKAN aksesnya — orang itu sudah tak bisa login, `session.ts`
 * menyaringnya. Yang rusak PEMBUKUANNYA: dokumen yang lahir sesudah ia
 * berhenti menyebut namanya, dan tak ada satu pun galat yang muncul.
 */

/**
 * Situs TELANJANG yang sengaja dibiarkan, dengan alasan yang bisa diperiksa.
 *
 * Kunci berkas + JUMLAH, bukan nomor baris: nomor baris bergeser tiap kali
 * ada yang menyunting berkasnya, dan daftar yang basi tiap commit akan
 * dilonggarkan orang, bukan dipatuhi. Jumlahnya tetap meratchet — situs
 * telanjang BARU di berkas yang sama menaikkan hitungannya dan menagih
 * keputusan.
 */
const DIPILAH_TANGAN = new Map<string, { situs: number; alasan: string }>([
  [
    "modules/absensi/routes.ts",
    {
      situs: 1,
      alasan:
        "leftJoin memberships untuk memajang CABANG pemilik absen. Menyaringnya akan " +
        "MENGHILANGKAN riwayat absen karyawan yang sudah keluar — riwayat yang membuang " +
        "barisnya sendiri lebih buruk daripada riwayat tanpa nama cabang",
    },
  ],
  [
    "modules/admin-tenants/routes.ts",
    {
      situs: 1,
      alasan:
        "panel SUPER ADMIN: daftar anggota satu tenant untuk keperluan platform. Yang " +
        "diarsipkan tetap anggota tenant itu secara pembukuan, dan panelnya bukan pintu penugasan",
    },
  ],
  [
    "modules/dokumen/nomor.ts",
    {
      situs: 2,
      alasan:
        "backfill penomoran dokumen saat boot: faktur yang sudah dibuang tetap butuh nomornya " +
        "supaya nomor tak pernah dipakai ulang. Menyaring di sini justru melahirkan nomor kembar",
    },
  ],
  [
    "modules/pengajuan/routes.ts",
    {
      situs: 2,
      alasan:
        "leftJoin memberships untuk memajang peran & cabang pengaju. Sama seperti absensi: " +
        "pengajuan cuti karyawan yang kemudian keluar tetap harus terbaca di riwayat",
    },
  ],
  [
    "modules/penjualan/refund.ts",
    {
      situs: 1,
      alasan:
        "membaca sale_items lewat saleId yang induknya SUDAH diperiksa sebaris di atas " +
        "(refund.ts:75 memuat isNull(sales.deletedAt)) — satu hop, bukan pintu kedua",
    },
  ],
  [
    "modules/penjualan/rekalkulasi.ts",
    {
      situs: 1,
      alasan:
        "sale_items lewat saleId yang induknya diperiksa di rekalkulasi.ts:135 " +
        "(isNull(sales.deletedAt) + FOR UPDATE) — satu hop di dalam transaksi yang sama",
    },
  ],
  [
    "modules/penjualan/routes.ts",
    {
      situs: 3,
      alasan:
        "dua bacaan sale_items lewat sale yang sudah dipilih kueri ber-isNull di atasnya, " +
        "dan satu pra-cek kepemilikan cabang di dalam pembungkus idempotensi yang penjaga " +
        "sebenarnya ada di refund.ts",
    },
  ],
  [
    "modules/penjualan/service.ts",
    {
      situs: 1,
      alasan:
        "MAX(RIGHT(nomor,4)) untuk nomor nota berikutnya — WAJIB ikut menghitung nota yang " +
        "sudah dibuang, kalau tidak nomornya dipakai ulang dan dua nota berbeda bernomor sama",
    },
  ],
  [
    "modules/penyimpanan/autoFile.ts",
    {
      situs: 1,
      alasan:
        "menata rak untuk daftar id baris yang DIKIRIM pemanggilnya; pemanggilnya sudah " +
        "memilih baris itu dari kueri berbendera — satu hop lewat argumen",
    },
  ],
  [
    "modules/pesanan/routes.ts",
    {
      situs: 7,
      alasan:
        "papan pesanan: seluruhnya lewat pastikanKartu() yang memuat isNull(sales.deletedAt) " +
        "— kartu yang sudah dibuang dibalas 404 sebelum barisnya dibaca. EMPAT di antaranya " +
        "baru terlihat sejak pemindainya memakai pohon sintaks: jendela teks lamanya menelan " +
        "`tx.insert(pesananLogs)` di pernyataan SEBELUMNYA lalu melabelinya MENULIS. Keempatnya " +
        "SELECT `.from(saleItems).where(eq(saleItems.saleId, id))` atas SATU id yang sudah " +
        "diresolusi pintunya, di dalam transaksi yang sama — tak ada agregat lintas penjualan " +
        "yang bisa kemasukan baris terbuang",
    },
  ],
  [
    "modules/produksi/routes.ts",
    {
      situs: 3,
      alasan:
        "tiga pembantu tahap menerima `conds` sebagai PARAMETER; pemanggilnya (baris 1639 & " +
        "1667 dst.) merakit conds dengan isNull(productions.deletedAt) di dalamnya",
    },
  ],
  [
    "modules/profil/routes.ts",
    {
      situs: 1,
      alasan:
        "profil MILIK SENDIRI (kode karyawan + cabang). Yang sudah diarsipkan tak bisa login " +
        "sama sekali — session.ts menyaringnya — jadi kueri ini tak pernah dicapai olehnya",
    },
  ],
  [
    "modules/users/routes.ts",
    {
      situs: 2,
      alasan:
        "GET /:userId/tempat (layar manajemen: penugasan karyawan yang sudah keluar justru " +
        "yang perlu dilihat untuk dibersihkan) dan PATCH /:userId — pintu yang MENGARSIPKAN " +
        "dan MEMULIHKAN, jadi ia wajib melihat baris yang sudah diarsipkan",
    },
  ],
  [
    "modules/users/service.ts",
    {
      situs: 2,
      alasan:
        "kode karyawan: himpunan kode terpakai & backfill-nya harus mencakup yang diarsipkan, " +
        "kalau tidak kode bekas orang yang keluar dibagikan ulang dan QR absen lama menunjuk " +
        "orang yang salah",
    },
  ],
  [
    "seed/guest.ts",
    {
      situs: 1,
      alasan: "seed akun tamu — memeriksa apakah baris membership-nya sudah ada, bukan pintu HTTP",
    },
  ],
]);

function telanjang(): Situs[] {
  return situsBendera().filter((x) => x.kelas === "TELANJANG");
}

describe("bendera 'tidak berlaku lagi': tiap pintu menyaring atau terdaftar", () => {
  const semua = situsBendera();

  it("populasinya benar-benar tersapu (bukan nol karena pemindainya patah)", () => {
    const per: Record<string, number> = {};
    for (const x of semua) per[x.induk] = (per[x.induk] ?? 0) + 1;
    expect(semua.length).toBeGreaterThanOrEqual(110);
    expect(per.sales ?? 0).toBeGreaterThanOrEqual(40);
    expect(per.productions ?? 0).toBeGreaterThanOrEqual(45);
    expect(per.memberships ?? 0).toBeGreaterThanOrEqual(25);
    // Dua cara membaca kode, keduanya benar-benar terpakai.
    expect(semua.filter((x) => x.bentuk === "sql").length).toBeGreaterThanOrEqual(10);
    expect(semua.filter((x) => x.bentuk === "drizzle").length).toBeGreaterThanOrEqual(80);
  });

  it("tak ada berkas telanjang yang tak terdaftar, dan jumlahnya cocok", () => {
    const per = new Map<string, number>();
    for (const x of telanjang()) per.set(x.berkas, (per.get(x.berkas) ?? 0) + 1);
    const salah: string[] = [];
    for (const [berkas, n] of per) {
      const d = DIPILAH_TANGAN.get(berkas);
      if (!d) salah.push(`${berkas}: ${n} situs TELANJANG, tak terdaftar`);
      else if (d.situs !== n) salah.push(`${berkas}: terdaftar ${d.situs}, sekarang ${n}`);
    }
    expect(
      salah,
      `baris yang sudah dibuang/diarsipkan ikut terbaca — saring, atau daftarkan beralasan:\n${salah.join("\n")}`,
    ).toEqual([]);
  });

  it("anti-kuburan: tiap entri daftar masih punya situsnya", () => {
    const per = new Set(telanjang().map((x) => x.berkas));
    const basi = [...DIPILAH_TANGAN.keys()].filter((k) => !per.has(k));
    expect(basi, `entri daftar sudah tak punya situs — hapus:\n${basi.join("\n")}`).toEqual([]);
  });

  it("tiap entri daftar menyebut ALASAN, bukan sekadar didiamkan", () => {
    for (const [k, v] of DIPILAH_TANGAN) {
      expect(v.alasan.length, `${k} tanpa alasan`).toBeGreaterThan(60);
    }
  });

  it("BUKTI MERAH: saringan dicabut dari laporan → gerbang menuduh berkas & barisnya", () => {
    const f = "modules/laporan/routes.ts";
    const asli = readFileSync(join(SRC, f), "utf8");
    // Berkas UTUH: tak satu pun tuduhan.
    expect(situsBendera([{ nama: f, isi: asli }]).filter((x) => x.kelas === "TELANJANG")).toEqual(
      [],
    );

    const dilucuti = asli.replace(/\n\s*isNull\(sales\.deletedAt\),/g, "");
    expect(dilucuti, "pencabutan tak mengubah apa pun — buktinya tak jadi merah").not.toBe(asli);

    const tertuduh = situsBendera([{ nama: f, isi: dilucuti }]).filter(
      (x) => x.kelas === "TELANJANG",
    );
    expect(tertuduh.length).toBeGreaterThanOrEqual(8);
    expect(tertuduh.every((x) => x.baris > 0)).toBe(true);
    // Anaknya ikut tertuduh, bukan cuma induknya — di sanalah uang & stoknya.
    //
    // Dipaku pada RANTAINYA, bukan pada medan `tabel`: sejak pemindainya
    // memakai pohon sintaks, satu rantai dinamai oleh `.from(...)`-nya (di sini
    // `sales`) sementara `saleItems`/`saleConsumptions` masuk lewat `innerJoin`.
    // Yang harus benar adalah kueri anaknya IKUT tertuduh — bukan label mana
    // yang kebetulan tercatat.
    const rantai = tertuduh.map((x) => x.potongan).join("\n");
    expect(rantai).toContain("saleItems");
    expect(rantai).toContain("saleConsumptions");
  });

  it("BUKTI MERAH kelas PEMBANTU: saringan dicabut dari kondisiFaktur → tetap tertuduh", () => {
    const f = "modules/penerimaan/routes.ts";
    const asli = readFileSync(join(SRC, f), "utf8");
    expect(situsBendera([{ nama: f, isi: asli }]).filter((x) => x.kelas === "TELANJANG")).toEqual(
      [],
    );

    const dilucuti = asli.replace(/\n\s*isNull\(productions\.deletedAt\),/g, "");
    expect(dilucuti).not.toBe(asli);
    const tertuduh = situsBendera([{ nama: f, isi: dilucuti }]).filter(
      (x) => x.kelas === "TELANJANG",
    );
    // Penelusuran pembantu bernama TIDAK boleh jadi pemaaf buta: begitu
    // `kondisiFaktur()` kehilangan saringannya, pemakainya ikut merah.
    expect(tertuduh.length).toBeGreaterThan(0);
  });

  it("'anggota aktif' punya SATU rumah: pesannya tak ditulis ulang di modul mana pun", () => {
    const PESAN = "Karyawan bukan anggota perusahaan";
    const salinan: string[] = [];
    for (const p of berkasTs(SRC)) {
      const rel = p.slice(SRC.length + 1);
      if (rel === "middleware/auth.ts") continue;
      if (readFileSync(p, "utf8").includes(PESAN)) salinan.push(rel);
    }
    expect(
      salinan,
      `aturan "pelaksana harus anggota" ditulis ulang — pakai pastikanAnggotaAktif():\n${salinan.join("\n")}`,
    ).toEqual([]);
  });

  it("pintu penugasan memakai pembantu itu, bukan kuerinya sendiri", () => {
    for (const f of ["modules/produksi/routes.ts", "modules/rekomendasi/rencana.ts"]) {
      const s = readFileSync(join(SRC, f), "utf8");
      expect(s, `${f} tak lagi lewat pintu bersama`).toContain("pastikanAnggotaAktif(");
    }
    const auth = readFileSync(join(SRC, "middleware/auth.ts"), "utf8");
    expect(auth).toContain("sudah diarsipkan (keluar)");
    // Dua sebab, dua kalimat — layar yang menjawab keduanya dengan satu kalimat
    // tak bisa ditindaklanjuti.
    expect(auth).toContain("Karyawan bukan anggota perusahaan");
  });
});
