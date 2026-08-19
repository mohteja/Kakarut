import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { periksaCadangan, type KeadaanCadangan } from "@kakarut/shared";

/**
 * PERINGATAN CADANGAN BASI.
 *
 * Panel super admin sudah memerah sejak lama saat cadangan basi. Yang tak ada
 * adalah arah sebaliknya: kartu merah cuma bekerja pada orang yang MEMBUKA
 * halamannya, dan halaman pencadangan adalah halaman yang dibuka orang ketika
 * ia sudah butuh cadangan — yaitu tepat saat kabarnya sudah terlambat.
 *
 * Yang dijaga di sini bukan bunyi emailnya, melainkan KAPAN sistem memutuskan
 * keadaan disebut gawat. Salah di sisi ini punya dua bentuk yang sama-sama
 * mahal:
 *
 *   terlalu longgar → diam saat cadangan memang mati;
 *   terlalu ketat   → berbunyi tiap deploy, lalu penerimanya berhenti membaca
 *                     email peringatan sebelum yang sungguhan datang.
 */

const JAM = 3_600_000;
const SEKARANG = Date.parse("2026-08-19T10:00:00.000Z");

function keadaan(p: Partial<KeadaanCadangan> = {}): KeadaanCadangan {
  return {
    aktif: true,
    terakhir_sukses: new Date(SEKARANG - 2 * JAM).toISOString(),
    sejak: new Date(SEKARANG - 365 * 24 * JAM).toISOString(),
    ambang_hari: 2,
    ...p,
  };
}

describe("periksaCadangan: kapan disebut gawat", () => {
  it("cadangan segar → tenang", () => {
    const h = periksaCadangan(keadaan(), SEKARANG);
    expect(h.gawat).toBe(false);
    expect(h.umur_jam).toBe(2);
    expect(h.belum_pernah).toBe(false);
  });

  it("lewat ambang → gawat, dengan umur yang benar", () => {
    const h = periksaCadangan(
      keadaan({ terakhir_sukses: new Date(SEKARANG - 73 * JAM).toISOString() }),
      SEKARANG,
    );
    expect(h.gawat).toBe(true);
    expect(h.umur_jam).toBe(73);
  });

  it("tepat DI ambang sudah gawat, sejam sebelumnya belum", () => {
    // Batasnya inklusif. Kalau eksklusif, jadwal harian yang meleset konsisten
    // beberapa menit bisa menggantung persis di angka ambang tanpa pernah
    // melewatinya.
    expect(periksaCadangan(
      keadaan({ terakhir_sukses: new Date(SEKARANG - 48 * JAM).toISOString() }),
      SEKARANG,
    ).gawat).toBe(true);
    expect(periksaCadangan(
      keadaan({ terakhir_sukses: new Date(SEKARANG - 47 * JAM).toISOString() }),
      SEKARANG,
    ).gawat).toBe(false);
  });

  it("ambang mengikuti setelan, bukan angka tetap", () => {
    const tuaTujuhHari = keadaan({ terakhir_sukses: new Date(SEKARANG - 7 * 24 * JAM).toISOString() });
    expect(periksaCadangan({ ...tuaTujuhHari, ambang_hari: 14 }, SEKARANG).gawat).toBe(false);
    expect(periksaCadangan({ ...tuaTujuhHari, ambang_hari: 7 }, SEKARANG).gawat).toBe(true);
  });

  it("penjadwal sengaja dimatikan → tak pernah gawat", () => {
    // BACKUP_ENABLED=false adalah keputusan sadar (mis. cadangan diurus di
    // lapisan lain). Memarahi orang atas pilihannya sendiri tiap hari membuat
    // seluruh saluran peringatan ini diabaikan.
    const h = periksaCadangan(
      keadaan({ aktif: false, terakhir_sukses: new Date(SEKARANG - 30 * 24 * JAM).toISOString() }),
      SEKARANG,
    );
    expect(h.gawat).toBe(false);
    expect(h.umur_jam).toBe(30 * 24); // umurnya tetap dilaporkan apa adanya
  });

  it("ambang 0 mematikan peringatan", () => {
    expect(periksaCadangan(
      keadaan({ ambang_hari: 0, terakhir_sukses: new Date(SEKARANG - 99 * 24 * JAM).toISOString() }),
      SEKARANG,
    ).gawat).toBe(false);
  });

  describe("belum pernah ada cadangan sukses", () => {
    it("sistem sudah lama berdiri → gawat", () => {
      // Keadaan paling berbahaya dari semuanya: tak ada satu pun salinan, dan
      // tak ada satu pun baris riwayat yang memberi petunjuk sejak kapan.
      const h = periksaCadangan(
        keadaan({ terakhir_sukses: null, sejak: new Date(SEKARANG - 5 * 24 * JAM).toISOString() }),
        SEKARANG,
      );
      expect(h.gawat).toBe(true);
      expect(h.umur_jam).toBeNull();
      expect(h.belum_pernah).toBe(true);
    });

    it("instalasi yang baru berdiri → belum gawat", () => {
      // Jadwal pertama baru jatuh malam nanti. Memerah sebelum itu berarti tiap
      // instalasi baru dimulai dengan alarm palsu.
      const h = periksaCadangan(
        keadaan({ terakhir_sukses: null, sejak: new Date(SEKARANG - 3 * JAM).toISOString() }),
        SEKARANG,
      );
      expect(h.gawat).toBe(false);
      expect(h.belum_pernah).toBe(true);
    });

    it("belum ada tenant sama sekali → tak ada yang bisa hilang", () => {
      const h = periksaCadangan(keadaan({ terakhir_sukses: null, sejak: null }), SEKARANG);
      expect(h.gawat).toBe(false);
    });
  });

  it("waktu sukses yang tak terbaca dianggap belum pernah, bukan dianggap segar", () => {
    // Arah kegagalannya dipilih: nilai rusak harus MEMBUNYIKAN alarm, bukan
    // mendiamkannya. `Date.parse` mengembalikan NaN, dan NaN dalam perbandingan
    // apa pun selalu false — jadi tanpa penjagaan eksplisit, data rusak justru
    // menghasilkan "tidak gawat".
    const h = periksaCadangan(keadaan({ terakhir_sukses: "bukan-tanggal" }), SEKARANG);
    expect(h.belum_pernah).toBe(true);
    expect(h.gawat).toBe(true); // karena `sejak` setahun lalu
  });

  it("jam server yang mundur tak menghasilkan umur negatif", () => {
    const h = periksaCadangan(
      keadaan({ terakhir_sukses: new Date(SEKARANG + 5 * JAM).toISOString() }),
      SEKARANG,
    );
    expect(h.umur_jam).toBe(0);
    expect(h.gawat).toBe(false);
  });
});

const AKAR = new URL("../src/", import.meta.url);
const baca = (p: string, dari = AKAR) => readFileSync(fileURLToPath(new URL(p, dari)), "utf8");

describe("peringatan cadangan: terpasang & tak dihitung dua kali", () => {
  it("penjaganya dinyalakan saat boot", () => {
    // Fungsi yang benar tapi tak pernah dipanggil adalah bentuk kegagalan yang
    // paling sulit terlihat: seluruh ujinya hijau, dan tak ada yang berbunyi.
    //
    // Dijangkarkan ke AWAL BARIS. Versi pertama uji ini memakai `toContain`
    // biasa, dan saat kubuktikan merah ternyata ia tetap hijau terhadap
    // `// jadwalkanPeringatanCadangan();` — persis bentuk kecelakaan yang
    // paling mungkin terjadi (dimatikan sebentar saat menelusuri sesuatu, lalu
    // lupa dihidupkan lagi).
    expect(baca("index.ts")).toMatch(/^jadwalkanPeringatanCadangan\(\);/m);
  });

  it("panel memakai keputusan SERVER, bukan ambang tulisan tangan", () => {
    const hal = baca("../../web/src/pages/superadmin/BackupPage.tsx", AKAR);
    expect(hal).toContain("data.peringatan");
    // Angka jam yang ditulis di halaman akan bergeser dari `BACKUP_ALERT_DAYS`
    // begitu salah satunya diubah, dan "panel hijau tapi email berbunyi" tak
    // mungkin ditebak penyebabnya oleh yang melihatnya.
    expect(hal).not.toMatch(/\d+\s*\*\s*3_?600_?000/);
  });

  it("penerimanya super admin yang masih aktif — bukan yang sudah dihapus", () => {
    const src = baca("lib/backup-peringatan.ts");
    const i = src.indexOf("penerimaPeringatan");
    expect(i).toBeGreaterThan(0);
    const blok = src.slice(i, i + 600);
    expect(blok).toContain("isSuperAdmin");
    expect(blok).toContain("isActive");
    expect(blok).toContain("isNull(users.deletedAt)");
  });

  it("klaim kirim dilakukan ATOMIK di satu perintah", () => {
    // "SELECT lalu INSERT" membuat dua instance yang memeriksa pada detik yang
    // sama sama-sama melihat 'belum dikirim' lalu sama-sama mengirim.
    const src = baca("lib/backup-peringatan.ts");
    const i = src.indexOf("async function klaimKirim");
    expect(i).toBeGreaterThan(0);
    const blok = src.slice(i, i + 800);
    expect(blok).toContain("ON CONFLICT");
    expect(blok).toContain("RETURNING");
  });
});
