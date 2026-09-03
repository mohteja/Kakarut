import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nilaiProxy } from "../src/lib/pemeriksaan-setelan";
import { amatiProxy, pengamatanProxy, resetPengamatanProxy } from "../src/lib/pengamatan-proxy";

/**
 * PEMERIKSAAN SETELAN.
 *
 * Semua yang diperiksa punya bentuk sama: setelannya SAH menurut skema env,
 * servernya menyala tanpa keluhan, dan yang salah baru ketahuan berbulan-bulan
 * kemudian — saat berkas dicari dan tak ada, atau saat akun yang tak pernah
 * diganti passwordnya dipakai orang lain.
 *
 * Yang paling banyak dijaga di sini justru arah SEBALIKNYA: pemeriksa yang
 * terlalu mudah menuduh. Panel yang menyala merah pada penyebaran yang
 * baik-baik saja akan diabaikan, dan sesudah itu ia tak lagi menjaga apa pun —
 * termasuk saat temuannya benar.
 */

describe("nilaiProxy: setelan proxy versus lalu lintas nyata", () => {
  const amatan = (total: number, denganXff: number, rantai = 1) => ({
    total,
    dengan_xff: denganXff,
    rantai_terpanjang: rantai,
  });

  it("sampel kecil belum bercerita apa pun", () => {
    // Server yang baru menyala cuma melihat beberapa permintaan pertama.
    // Menuduh dari situ berarti tiap deploy melahirkan temuan palsu.
    expect(nilaiProxy(0, amatan(49, 49))).toBeNull();
    expect(nilaiProxy(1, amatan(49, 0))).toBeNull();
    expect(nilaiProxy(0, amatan(50, 50))).not.toBeNull();
  });

  it("hops=0 padahal ADA proxy → semua orang berbagi satu ember rate-limit", () => {
    const t = nilaiProxy(0, amatan(100, 100));
    expect(t?.kode).toBe("proxy_hops_terlalu_rendah");
    expect(t?.rincian).toContain("100 dari 100");
  });

  it("hops>0 padahal TAK ADA proxy → alamat klien bisa dipalsukan", () => {
    // Persis lubang yang ditutup PR #174, kembali lewat setelan: XFF kiriman
    // klien sudah cukup panjang untuk memenuhi `hops`, jadi ia dipercaya.
    const t = nilaiProxy(1, amatan(100, 0));
    expect(t?.kode).toBe("proxy_hops_terlalu_tinggi");
  });

  /**
   * KEADAAN PRODUCTION 2026-09-02, dan ketiga tuduhan lama BUTA padanya.
   *
   * Aplikasi berdiri di belakang CDN + reverse proxy (rantai 2 entri)
   * sementara `TRUST_PROXY_HOPS` masih bawaan 1. `hops` bukan 0, XFF-nya ada,
   * rantainya tidak lebih pendek — tak satu pun cabang lama memenuhi syarat.
   * Yang tercatat di panel Log Galat: SELURUH alamat milik satu CDN, bukan
   * satu pun pengunjung.
   */
  it("hops LEBIH RENDAH daripada rantai → alamat yang tercatat adalah proxy, bukan pengunjung", () => {
    const t = nilaiProxy(1, amatan(500, 500, 2));
    expect(t?.kode).toBe("proxy_hops_terlalu_rendah_dari_rantai");
    // Rinciannya wajib menyebut angka yang benar, bukan cuma "salah setel":
    // yang membaca panel ini harus tahu harus menyetel ke berapa.
    expect(t?.rincian).toContain("Setel ke 2");
    // Dan menyebut akibat yang paling mahal — jatah yang ditanggung bersama —
    // bukan cuma soal log yang keliru.
    expect(t?.rincian).toMatch(/pembatas laju|jatah/i);
  });

  it("rantai 3 → menyuruh setel ke 3, bukan angka tetap", () => {
    expect(nilaiProxy(1, amatan(500, 500, 3))?.rincian).toContain("Setel ke 3");
    expect(nilaiProxy(2, amatan(500, 500, 3))?.kode).toBe("proxy_hops_terlalu_rendah_dari_rantai");
  });

  it("hops lebih panjang daripada rantai yang benar-benar datang", () => {
    const t = nilaiProxy(2, amatan(100, 100, 1));
    expect(t?.kode).toBe("proxy_hops_lebih_panjang_dari_rantai");
    expect(t?.rincian).toContain("Setel ke 1");
  });

  describe("DIAM saat setelannya memang benar", () => {
    it("hops=1 di belakang satu proxy", () => {
      expect(nilaiProxy(1, amatan(500, 500, 1))).toBeNull();
    });
    it("hops=0 tanpa proxy", () => {
      expect(nilaiProxy(0, amatan(500, 0, 0))).toBeNull();
    });
    it("hops=2 di belakang CDN + proxy", () => {
      expect(nilaiProxy(2, amatan(500, 500, 2))).toBeNull();
    });
    // PASANGAN untuk tuduhan baru: begitu pemilik menyetelnya ke panjang
    // rantai yang benar, panelnya WAJIB diam lagi. Tuduhan yang tak bisa
    // dipadamkan dengan memperbaiki sebabnya adalah tuduhan yang akan
    // diabaikan.
    it("hops=1 di belakang satu proxy — rantai 1, bukan 2", () => {
      expect(nilaiProxy(1, amatan(500, 500, 1))).toBeNull();
    });
    it("campuran yang ambigu → tak menuduh", () => {
      // Separuh lewat proxy, separuh langsung (mis. pemantau internal). Tak
      // ada kesimpulan yang bisa dipertanggungjawabkan, jadi diam.
      expect(nilaiProxy(1, amatan(200, 100))).toBeNull();
      expect(nilaiProxy(0, amatan(200, 100))).toBeNull();
    });
  });

  it("ambangnya 90% / 10%, bukan 'ada satu saja'", () => {
    // Sedikit permintaan tanpa XFF itu normal (pemantau, probe). Yang menandai
    // salah setelan adalah MAYORITAS yang telak.
    expect(nilaiProxy(0, amatan(100, 90))?.kode).toBe("proxy_hops_terlalu_rendah");
    expect(nilaiProxy(0, amatan(100, 89))).toBeNull();
    expect(nilaiProxy(1, amatan(100, 10))?.kode).toBe("proxy_hops_terlalu_tinggi");
    expect(nilaiProxy(1, amatan(100, 11))).toBeNull();
  });
});

describe("amatiProxy: mencacah bentuk lalu lintas", () => {
  beforeEach(() => resetPengamatanProxy());

  it("menghitung total dan yang membawa XFF", () => {
    amatiProxy(undefined);
    amatiProxy(null);
    amatiProxy("");
    amatiProxy("1.2.3.4");
    expect(pengamatanProxy()).toEqual({ total: 4, dengan_xff: 1, rantai_terpanjang: 1 });
  });

  it("panjang rantai dihitung per-entri, bukan per-koma", () => {
    // "a, b," punya dua koma tapi dua alamat. Salah hitung di sini membuat
    // temuan "hops lebih panjang dari rantai" menyarankan angka yang keliru.
    amatiProxy("1.2.3.4, 5.6.7.8,");
    expect(pengamatanProxy().rantai_terpanjang).toBe(2);
  });

  it("menyimpan rantai TERPANJANG, bukan yang terakhir", () => {
    amatiProxy("1.1.1.1, 2.2.2.2, 3.3.3.3");
    amatiProxy("9.9.9.9");
    expect(pengamatanProxy().rantai_terpanjang).toBe(3);
  });
});

const AKAR = new URL("../src/", import.meta.url);
const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, AKAR)), "utf8");

describe("pemeriksaan setelan: terpasang di tempat yang benar", () => {
  it("dijalankan saat boot", () => {
    expect(baca("index.ts")).toMatch(/^jadwalkanPemeriksaanSetelan\(\);/m);
  });

  it("juga dipulangkan GET /admin/sistem — log boot dibaca sekali saja", () => {
    // Setengah mekanismenya ada di log, setengahnya di panel. Yang di log
    // dibaca oleh orang yang sedang menunggu deploy selesai, lalu tak pernah
    // lagi; yang di panel bisa ditanya kapan pun.
    expect(baca("modules/admin-system/routes.ts")).toContain("pemeriksaan: await periksaSetelan()");
    expect(
      readFileSync(
        fileURLToPath(new URL("../../web/src/pages/superadmin/SistemPage.tsx", AKAR)),
        "utf8",
      ),
    ).toContain("sistem.pemeriksaan");
  });

  it("health check TIDAK ikut dicacah — dan pencocokannya memakai jalur PENUH", () => {
    /*
     * Health check kontainer memukul server LANGSUNG tanpa lewat proxy. Saat
     * outlet tutup ia bisa jadi satu-satunya lalu lintas yang ada — cukup untuk
     * membuat pengamatan menyimpulkan "tak ada proxy" pada penyebaran yang
     * proxy-nya baik-baik saja.
     *
     * Versi pertama membandingkan `c.req.path !== "/health"`. Middleware-nya
     * terpasang pada sub-app yang di-mount di `/api`, dan `c.req.path`
     * memulangkan jalur PENUH — jadi pengecualiannya tak pernah cocok. Terbukti
     * saat 60 permintaan health check tetap terhitung dan melahirkan temuan
     * palsu.
     */
    const pola = baca("app.ts").match(/if \(!(.+?)\.test\(c\.req\.path\)\) amatiProxy/);
    expect(pola, "pengecualian health check harus berupa regex atas c.req.path").toBeTruthy();
    const re = new RegExp(pola![1].slice(1, -1));
    expect(re.test("/api/health")).toBe(true);
    expect(re.test("/health")).toBe(true);
    expect(re.test("/api/penjualan")).toBe(false);
    expect(re.test("/api/health-check-palsu")).toBe(false);
  });
});
