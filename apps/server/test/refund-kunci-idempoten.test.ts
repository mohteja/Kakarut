import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga KUNCI IDEMPOTENSI REFUND — kunci harus mengikat ISI-nya, bukan umur
 * panelnya.
 *
 * Server memutar ulang hasil PERTAMA untuk `client_ref` yang sama, dengan
 * **200 OK**, apa pun `items` yang dibawa permintaan kedua. Itu benar untuk
 * apa yang dimaksudkannya — mengulang kiriman yang sama tak boleh
 * mengembalikan uang dua kali — tapi berbahaya begitu isinya berubah:
 *
 *   1. Kasir memilih Nasi Goreng ×1, menekan Kembalikan. Server MENYIMPAN-nya,
 *      lalu jaringan putus sebelum balasannya sampai → mutasi gagal, panel
 *      tetap terbuka, dan angkanya masih memajang "sisa 1". Panel memang belum
 *      bisa menyegarkan diri: tak ada yang tahu ia berhasil.
 *   2. Kasir menyimpulkan tak ada yang tersimpan, menambah Es Teh ×1, menekan
 *      lagi.
 *   3. Kunci yang sama diputar ulang → 200 OK berisi hasil langkah 1. Es Teh
 *      TIDAK PERNAH dikembalikan, tapi `onSuccess` jalan, panel menutup, dan
 *      layar terlihat berhasil. Uang Es Teh sudah telanjur diserahkan.
 *
 * Semua langkahnya adalah perilaku yang dirancang; yang keliru cuma cakupan
 * kuncinya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const PANEL = baca("../../web/src/pages/kasir/RefundPanel.tsx");
const RUTE = baca("../src/modules/penjualan/routes.ts");

describe("premis: server memang memutar ulang hasil pertama, tanpa melihat items", () => {
  it("client_ref yang sama → hasil tersimpan dipulangkan 200", () => {
    expect(RUTE).toContain("const ada = await cariHasilIdempoten(auth.company_id!, body.client_ref);");
    expect(RUTE).toContain("if (ada) return c.json(ada.hasilJson, 200);");
  });

  it("dan pemeriksaannya MENDAHULUI segalanya — items tak pernah dilihat", () => {
    const iRefund = RUTE.indexOf('"/:id/refund"');
    const iIdem = RUTE.indexOf("if (body.client_ref) {", iRefund);
    const iPakai = RUTE.indexOf("refundSajian(tx, {", iRefund);
    expect(iIdem).toBeGreaterThan(iRefund);
    expect(iPakai).toBeGreaterThan(iIdem);
  });

  it("premis kedua: server MEMANG menolak porsi yang melebihi sisa", () => {
    // Itulah yang membuat penyetelan ulang kunci aman: kalau percobaan pertama
    // ternyata berhasil, kiriman kedua ditolak dengan pesan yang menyebut
    // sisanya — bukan sukses palsu.
    const refund = baca("../src/modules/penjualan/refund.ts");
    expect(refund).toContain("const sisa = qtyDitagih(b) - sudah;");
    expect(refund).toContain("hanya bisa dikembalikan ${sisa} porsi lagi");
  });
});

describe("panel: mengubah porsi mencabut kuncinya", () => {
  it("`ubah` menyetel ulang `refKejadian`", () => {
    expect(PANEL).toMatch(/if \(next === \(p\[id\] \?\? 0\)\) return p;\s*\n\s*refKejadian\.current = null;/);
  });

  it("hanya saat nilainya BENAR-BENAR berubah", () => {
    // Menekan "−" pada nol, atau "+" saat sudah mentok, bukan perubahan apa
    // pun. Mencabut kunci di situ akan mengubah percobaan ulang yang sah
    // menjadi refund kedua.
    expect(PANEL).toContain("if (next === (p[id] ?? 0)) return p;");
  });

  it("kuncinya dideklarasikan SEBELUM dipakai `ubah`", () => {
    const iRef = PANEL.indexOf("const refKejadian = useRef<string | null>(null);");
    const iUbah = PANEL.indexOf("function ubah(id: string, delta: number, maks: number)");
    expect(iRef).toBeGreaterThan(0);
    expect(iUbah).toBeGreaterThan(iRef);
  });

  it("dan tetap dipakai ulang saat kiriman yang SAMA diulang", () => {
    // `??=`, bukan penugasan biasa: percobaan ulang atas pilihan yang tak
    // berubah wajib membawa kunci yang sama.
    expect(PANEL).toContain("refKejadian.current ??= uuidV4();");
  });

  it("`alasan` SENGAJA tidak ikut mencabut kunci", () => {
    // Ia catatan, bukan uang. Kalau ikut, membenahi ejaan alasan di antara dua
    // percobaan akan mengirim refund yang sama dua kali.
    const iAlasan = PANEL.indexOf("onChange={(e) => setAlasan(e.target.value)}");
    expect(iAlasan).toBeGreaterThan(0);
    expect(PANEL.slice(iAlasan, iAlasan + 120)).not.toContain("refKejadian");
  });

  it("dan sebabnya ditulis, bukan disimpan di kepala", () => {
    expect(PANEL).toContain("mengikat ISI refundnya, bukan umur panel ini");
    expect(PANEL).toContain("TIDAK PERNAH dikembalikan");
  });
});

describe("sifat yang sudah benar dan jangan sampai hilang", () => {
  it("kunci tetap dikirim ke server", () => {
    expect(PANEL).toContain("client_ref: refKejadian.current,");
  });

  it("pratinjau memakai aritmetika server, dan qtyRefund itu KUMULATIF", () => {
    // Kalau pilihan kali ini tak ditambahkan ke yang sudah pernah
    // dikembalikan, angka yang dilihat kasir sebelum menekan tombol akan
    // berbeda dari yang benar-benar terjadi.
    expect(PANEL).toContain("qtyRefund: it.qtyRefund + (pilih[it.id] ?? 0),");
  });

  it("baris yang sudah habis direfund tak bisa dipilih lagi", () => {
    expect(PANEL).toContain("data.items.filter((it) => qtyDitagih(it) > 0)");
  });
});
