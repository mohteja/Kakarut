import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Penjaga PEMBUAT-BARIS YANG MEMINDAHKAN STOK HARUS PUNYA KUNCI IDEMPOTENSI.
 *
 * Repo ini sudah menjawab kelas ini dua kali — `POST /penjualan` dan
 * `POST /stok/opname` — dengan ledger BERSAMA `(company_id, client_ref)` di
 * `sync/idempoten.ts`. Sapuan seluruh web menemukan 23 mutasi yang menulis
 * stok/uang; 22 tanpa kunci, tapi hampir semuanya transisi status yang memang
 * idempoten (server menolak 409 begitu statusnya sudah berubah).
 *
 * Satu yang bukan: `POST /transfer-stok`. Ia MEMBUAT faktur baru sekaligus
 * memindahkan stok keluar dari Central Kitchen.
 *
 * Masalahnya bukan klik ganda — tombolnya sudah dimatikan selama pending.
 * Masalahnya jaringan yang putus SESUDAH server menulis tapi SEBELUM
 * balasannya sampai, dan itu tak selalu butuh manusia: `lib/idempoten.ts`
 * mencatat pengukuran di Chromium bahwa browser MENGULANG SENDIRI POST saat
 * server menutup koneksi keep-alive yang sedang dipakai ulang.
 *
 * Akibat penggandaan di sini bukan sekadar faktur kembar: stok keluar dari CK
 * DUA KALI untuk satu pengiriman, dan cabang menerima dua kiriman yang sama.
 */
const SRV = readFileSync(
  fileURLToPath(new URL("../src/modules/transfer/routes.ts", import.meta.url)),
  "utf8",
);
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const HAL = readFileSync(join(WEB, "pages/stok/TransferStokPage.tsx"), "utf8");

describe("server: POST /transfer-stok ikut ledger idempotensi", () => {
  it("menerima client_ref & device_id dari ledger bersama", () => {
    expect(SRV).toContain("  client_ref: clientRefField,");
    expect(SRV).toContain("  device_id: deviceIdField,");
    expect(SRV).toContain('from "../sync/idempoten";');
  });

  it("diperiksa PALING AWAL — sebelum apa pun ditulis", () => {
    const iCek = SRV.indexOf("const ada = await cariHasilIdempoten(auth.company_id!, body.client_ref);");
    const iTulis = SRV.indexOf("const asal = await pastikanCabangStok(");
    expect(iCek).toBeGreaterThan(0);
    expect(iTulis).toBeGreaterThan(iCek);
  });

  it("kiriman ulang memulangkan hasil yang SAMA, bukan menjalani ulang", () => {
    expect(SRV).toContain("if (ada) return c.json(ada.hasilJson, 201);");
  });

  it("dicatat SESUDAH transaksinya sukses", () => {
    // Kalau dicatat lebih dulu lalu penulisannya gagal, kiriman ulang akan
    // mengira sudah selesai — dan stoknya tak pernah benar-benar pindah.
    const iTx = SRV.indexOf("      return { nomor };");
    const iCatat = SRV.indexOf("await catatHasilIdempoten({");
    expect(iTx).toBeGreaterThan(0);
    expect(iCatat).toBeGreaterThan(iTx);
    expect(SRV).toContain('tipe: "transfer_stok",');
  });

  it("yang dicatat = yang dibalas (bukan objek yang dirakit dua kali)", () => {
    expect(SRV).toContain("hasilJson: keluaran,");
    expect(SRV).toContain("return c.json(keluaran, 201);");
  });

  it("opsional — klien lama tak berubah perilakunya", () => {
    expect(SRV).toContain("if (body.client_ref) {");
  });
});

describe("web: kuncinya mengikat ISI, bukan umur komponen", () => {
  it("dikirim dari ref, dibuat sekali per pengiriman", () => {
    expect(HAL).toContain("client_ref: (refKirim.current ??= uuidV4()),");
    expect(HAL).toContain("const refKirim = useRef<string | null>(null);");
  });

  it("dicabut saat kirimannya SUKSES", () => {
    // Tanpa ini, pengiriman berikutnya dengan bahan & qty yang kebetulan sama
    // akan dianggap ulangan — dan diam-diam tak terjadi.
    const iSukses = HAL.indexOf("    onSuccess: () => {");
    const iCabut = HAL.indexOf("      refKirim.current = null;");
    expect(iSukses).toBeGreaterThan(0);
    expect(iCabut).toBeGreaterThan(iSukses);
  });

  it("sebabnya ditulis — bukan sekadar pengaman klik ganda", () => {
    expect(HAL).toContain("Bukan pengaman dari klik ganda");
    expect(HAL).toContain("stok keluar dari");
  });
});

describe("premis: ledger bersama itu memang generik", () => {
  const LEDGER = readFileSync(
    fileURLToPath(new URL("../src/modules/sync/idempoten.ts", import.meta.url)),
    "utf8",
  );

  it("kuncinya (company_id, client_ref), bukan per-tabel", () => {
    expect(LEDGER).toContain("kunci `(company_id, client_ref)`");
  });

  it("hanya hasil SUKSES yang dianggap HIT", () => {
    expect(LEDGER).toContain('return ada && ada.status === "ok"');
  });
});

describe("sapuan: pembuat-baris pemindah-stok lain memang tak ada lagi", () => {
  /**
   * Yang dicari: `useMutation` POST ke endpoint pemindah stok yang MEMBUAT
   * baris baru (bukan transisi status pada baris yang sudah ada).
   *
   * Transisi status sengaja TIDAK dituntut berkunci: `terima`, `tolak`,
   * `batal`, `acc` semuanya dijaga status di server — kiriman ulang menemukan
   * statusnya sudah berubah dan ditolak 409, jadi tak ada yang tergandakan.
   */
  const PEMBUAT = [
    { berkas: "pages/stok/TransferStokPage.tsx", mutasi: "kirim" },
    { berkas: "pages/stok/OpnamePage.tsx", mutasi: "simpan" },
    { berkas: "pages/kasir/RefundPanel.tsx", mutasi: "kirim" },
    // Ditambahkan setelah sapuan "rantai dua panggilan": halaman ini menerbitkan
    // faktur produksi + beli, lalu memanggil endpoint KEDUA yang menaut ke
    // `rencana_id`-nya. Yang kedua gagal = yang pertama sudah terlanjur, dan
    // tekan-lagi menerbitkan satu set faktur lagi. Lihat
    // `rencana-faktur-idempoten.test.ts`.
    { berkas: "pages/stok/TambahStokDariMenuPage.tsx", mutasi: "buat" },
  ];

  for (const { berkas, mutasi } of PEMBUAT) {
    it(`${berkas}:${mutasi} berkunci`, () => {
      const isi = readFileSync(join(WEB, berkas), "utf8");
      const i = isi.indexOf(`const ${mutasi} = useMutation(`);
      expect(i, `mutasi ${mutasi} tak ditemukan lagi di ${berkas}`).toBeGreaterThan(0);
      expect(isi.slice(i, i + 1400)).toContain("client_ref");
    });
  }

  it("dan checkout kasir tetap berkunci (jalur uang)", () => {
    const berkasTsx = (dir: string): string[] => {
      const out: string[] = [];
      for (const nama of readdirSync(dir)) {
        const p = join(dir, nama);
        if (statSync(p).isDirectory()) out.push(...berkasTsx(p));
        else if (nama.endsWith(".tsx")) out.push(p);
      }
      return out;
    };
    const adaCheckout = berkasTsx(WEB).some((f) => {
      const s = readFileSync(f, "utf8");
      return s.includes('api<SaleDto>("/penjualan"') || s.includes('"/penjualan", {');
    });
    expect(adaCheckout, "jalur checkout tak ditemukan — sapuan perlu diperbarui").toBe(true);
  });
});
