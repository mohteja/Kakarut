import { describe, expect, it } from "vitest";
import { situsLomba, type SitusLomba } from "./util/lomba";

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
const MAKS_UTANG = 5;

/** kunci: `berkas` -> nama fungsi -> alasan. */
const daftar: Record<string, Record<string, Alasan>> = {
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
  "modules/absensi/routes.ts": {
    catatAbsen: {
      kelas: "utang",
      teks:
        "UTANG. Cap absen berikutnya (masuk/keluar) ditentukan dari cap " +
        "TERAKHIR yang dibaca, lalu disisipkan — dan `attendances` tak punya " +
        "indeks unik apa pun (hanya dua indeks biasa). Ketukan ganda bisa " +
        "menyisipkan dua cap masuk berurutan. Bukan uang, tapi rekap absen " +
        "yang dipakai menghitung kehadiran ikut salah.",
    },
  },
  "modules/perlengkapan/service.ts": {
    tibaBeliPerlengkapan: {
      kelas: "utang",
      teks:
        "UTANG. Klaimnya ADA — WHERE id = ? AND status IN (menunggu, " +
        "diproses) — tapi hasilnya tak pernah dilihat, jadi yang kalah " +
        "balapan tetap dibalas sukses. Bentuk yang paling sulit dilihat mata: " +
        "kodenya TERLIHAT menjaga dirinya.",
    },
  },
  "modules/sync/routes.ts": {
    execPenjualan: {
      kelas: "utang",
      teks:
        "UTANG. Shift tujuan penjualan susulan dipilih dari bacaan, lalu " +
        "ditulis. Jalur ini memang sudah dijaga `client_ref` di tingkat " +
        "antrean, tapi penahan itu ada di LUAR fungsi ini dan tak terbaca dari " +
        "sini — dicatat sebagai utang alih-alih dibebaskan dengan alasan yang " +
        "tak bisa kutunjuk.",
    },
  },
  "modules/admin-tenants/routes.ts": {
    transaction: {
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
