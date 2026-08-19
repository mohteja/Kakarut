import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SATU KODE, TIGA ARTI — dan hanya SATU di antaranya boleh dilanjutkan.
 *
 * `POST /produksi/tahap/:fakturId` menolak dengan 409 untuk tiga hal yang sama
 * sekali berbeda:
 *
 *   - bahan baku kurang     → PERINGATAN; `paksa: true` sah dan memang jalannya;
 *   - faktur berubah        → CAS kalah; yang benar MUAT ULANG, dan `paksa`
 *                             tak akan menolong karena servernya tetap CAS;
 *   - kiriman beralamat     → wajib lewat Penerimaan di cabang tujuan; tak ada
 *                             jalan dari layar ini sama sekali.
 *
 * Web dulu memperlakukan SEMUA 409 sebagai "bahan kurang", lengkap dengan
 * tombol "Tetap Proses". Pada konflik status, petugas ditawari tombol yang tak
 * mungkin berhasil sementara instruksi sebenarnya terkubur di teks pesan — dan
 * setiap tekanan mengirim `paksa: true` yang melewati pemeriksaan bahan baku,
 * satu-satunya penjaga yang memang boleh dilewati.
 *
 * Dicocokkan lewat `sebab`, bukan teks pesan: teks bahasa Indonesia boleh
 * berubah kapan saja, `sebab` kontraknya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const RUTE = baca("../src/modules/produksi/routes.ts");
const APP = baca("../src/app.ts");
/**
 * DUA layar web memanggil `/tahap`, dan keduanya dulu salah dengan cara yang
 * sama. Menambal satu saja meninggalkan bug yang identik di layar sebelahnya —
 * itu persis yang terjadi pada percobaan pertama perbaikan ini.
 */
const WEB_HALAMAN = [
  "../../web/src/pages/produksi/TahapPage.tsx",
  "../../web/src/pages/produksi/TambahStokPage.tsx",
] as const;
const WEB = baca(WEB_HALAMAN[0]);

describe("server: 409 /tahap membawa sebab terstruktur", () => {
  it("ketiga sebabnya terdefinisi sebagai tipe, bukan string lepas", () => {
    // Union pada konstruktor membuat sebab baru yang salah ketik tertangkap
    // typecheck, bukan diam-diam mendarat di klien sebagai nilai asing.
    expect(RUTE).toContain(
      'readonly sebab: "bahan_kurang" | "status_berubah" | "wajib_penerimaan"',
    );
  });

  it("bahan kurang → `bahan_kurang` (satu-satunya yang boleh dilanjut)", () => {
    const n = RUTE.split('new TahapDitolak("bahan_kurang"').length - 1;
    // Dua jalur: maju-sebagian dan faktur-utuh. Keduanya, bukan salah satu.
    expect(n).toBe(2);
  });

  it("CAS kalah → `status_berubah`, bukan disamakan dengan bahan kurang", () => {
    // Tanpa indentasi di dalam polanya: yang dijaga BANYAKNYA jalur yang
    // memakai sebab ini, bukan seberapa dalam barisnya menjorok.
    const n = RUTE.match(/new TahapDitolak\(\s*"status_berubah"/g)?.length ?? 0;
    expect(n).toBe(2);
  });

  it("kiriman beralamat → `wajib_penerimaan`", () => {
    expect(RUTE).toMatch(/new TahapDitolak\(\s*"wajib_penerimaan"/);
  });

  it("tak ada lagi 409 telanjang tanpa sebab di jalur /tahap", () => {
    // Penjaga arah sebaliknya: menambah `HTTPException(409` baru di berkas ini
    // tanpa sebab akan membuat klien kembali menebak. Sisa yang boleh ada hanya
    // milik rute LAIN (mis. /konfirmasi), jadi angkanya dikunci — naik berarti
    // ada yang lupa memakai TahapDitolak.
    const n = RUTE.split("new HTTPException(409").length - 1;
    expect(n, "409 tanpa sebab bertambah — pakai TahapDitolak").toBeLessThanOrEqual(3);
  });

  it("`sebab` benar-benar sampai ke badan respons", () => {
    // Tanpa penerusan di app.onError, properti itu mati di server dan seluruh
    // uji di atas jadi teater.
    expect(APP).toContain("(err as { sebab?: string }).sebab");
  });
});

describe("web: hanya `bahan_kurang` yang menawarkan Tetap Proses", () => {
  it.each(WEB_HALAMAN)("%s mencocokkan sebab, bukan 409 telanjang", (rel) => {
    const isi = baca(rel);
    expect(isi).toContain('=== "bahan_kurang"');
    // Bentuk lama: 409 apa pun dianggap bahan kurang.
    expect(isi).not.toMatch(
      /status === 409\s*\n?\s*\?\s*\w+\.error\.message/,
    );
  });

  it("kedua halaman memakai `data?.sebab`, bukan mencocokkan teks pesan", () => {
    for (const rel of WEB_HALAMAN) {
      expect(baca(rel), rel).toContain("data?.sebab");
    }
  });

  it("`paksa` hanya dikirim untuk bahan kurang", () => {
    // `paksa` melewati pemeriksaan bahan baku. Mengirimkannya pada konflik
    // status berarti menekan tombol yang melewati penjaga yang salah.
    expect(WEB).toContain("simpan.mutate({ paksa: !!bahanKurang })");
  });

  it("sebab lain jatuh ke penampil galat biasa", () => {
    expect(WEB).toContain("<ErrorText error={simpan.error} />");
  });
});
