import { expect, test, type Page } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

/**
 * LAPORAN DI BROWSER MENAMPILKAN ANGKA YANG SAMA DENGAN SERVERNYA.
 *
 * §286 `verify-api.sh` membandingkan kelima rute /laporan/* dengan angka yang
 * dihitung tangan. Spec ini menjaga langkah terakhirnya: kartu dan tabel di
 * layar menampilkan PERSIS angka balasan API untuk periode & cabang yang sama
 * — bukan angka yang dirakit ulang di klien. Pemetaan cakupan 2026-09-02
 * menemukan empat halaman laporan tak pernah disentuh satu uji pun, dan
 * pembacaan pertamanya menemukan satu rakitan yang salah: "sebelum refund,
 * omzetnya {omzet + total_refund}" (omzet kotor + nominal refund bersih).
 *
 * Datanya milik seed + verify-api yang berjalan sebelum suite ini di gerbang;
 * yang dijaga di sini kesetaraan layar ↔ API, bukan nilai mutlaknya.
 */

type Laporan = {
  omzet: number;
  jumlah_transaksi: number;
  total_diskon: number;
  total_refund: number;
  jumlah_refund: number;
  omzet_sebelum_refund: number;
  total_hpp: number;
  estimasi_profit: number;
  pb1_terkumpul: number;
  per_jam: { jam: number; jumlah: number; omzet: number }[];
};

/** Angka dari teks "Rp 48.000" / "1.284" → 48000 / 1284 (tanda minus dihormati). */
function angka(teks: string): number {
  const m = teks.replace(/\s/g, "").match(/-?[\d.]+/);
  if (!m) throw new Error(`tak ada angka di "${teks}"`);
  return Number(m[0].replace(/\./g, "").replace(/^-/, "-"));
}

/**
 * Label StatCard: div kapital kecil (`uppercase`) yang teksnya PERSIS `label`.
 * `getByText("Omzet")` saja mengenai 4 elemen (kartu, judul tabel, kaki tabel).
 */
function labelKartu(page: Page, label: string) {
  return page.locator("div.uppercase", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
}

/** Nilai StatCard: div tepat sesudah labelnya. */
async function nilaiKartu(page: Page, label: string): Promise<number> {
  return angka(await labelKartu(page, label).locator("xpath=following-sibling::div[1]").innerText());
}

const HARI = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

test.describe("laporan di browser = balasan API", () => {
  test("kartu penjualan, grafik per jam, dan keterangan refund memakai angka server", async ({
    page,
    request,
  }) => {
    // Sesi lewat API (tersimpan per email di util) — bukan lewat layar login:
    // `POST /auth/login` dibatasi 10 per 5 menit per (IP+email), dan pada jalan
    // pertama spec ini jatahnya habis lalu menyamar jadi "masih di /login".
    const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
    const r = await request.get(`${BASE}/api/laporan?dari=${HARI}&sampai=${HARI}&branch_id=all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.ok()).toBeTruthy();
    const lap = (await r.json()) as Laporan;
    expect(lap.jumlah_transaksi, "PREMIS: hari ini ada transaksi (verify-api berjalan sebelum suite ini)").toBeGreaterThan(0);

    await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
    await page.goto("/laporan");
    await expect(labelKartu(page, "Omzet")).toBeVisible();

    expect(await nilaiKartu(page, "Omzet")).toBe(Math.round(lap.omzet));
    expect(await nilaiKartu(page, "Transaksi")).toBe(lap.jumlah_transaksi);
    expect(await nilaiKartu(page, "Diskon Diberikan")).toBe(Math.round(lap.total_diskon));
    expect(await nilaiKartu(page, "HPP Terpakai")).toBe(Math.round(lap.total_hpp));
    expect(await nilaiKartu(page, "Estimasi Profit")).toBe(Math.round(lap.estimasi_profit));
    expect(await nilaiKartu(page, "PB1 Terkumpul")).toBe(Math.round(lap.pb1_terkumpul));

    // Kaki tabel per-jam: Σ batang = kartu (server menjamin; layar cuma mencetak).
    // Tabel per-jam terlipat di <details>; "Transaksi per Jam" ada dua (judul
    // dan ringkasan lipatannya), jadi yang dibuka adalah ringkasan <details>-nya.
    const lipatan = page.locator("details", { hasText: /Total/ }).first();
    await lipatan.locator("summary").click();
    const kaki = lipatan.locator("tfoot tr").last();
    const selKaki = await kaki.locator("td").allInnerTexts();
    expect(angka(selKaki[1])).toBe(lap.per_jam.reduce((a, d) => a + d.jumlah, 0));
    expect(angka(selKaki[2])).toBe(Math.round(lap.per_jam.reduce((a, d) => a + d.omzet, 0)));

    // Keterangan refund — angka "sebelum refund" milik server, bukan rakitan
    // omzet + total_refund (yang salah karena satuannya berbeda).
    if (lap.total_refund > 0) {
      const ket = page.getByText(/sebelum refund, omzetnya/);
      await expect(ket).toBeVisible();
      const teks = await ket.innerText();
      const m = teks.match(/sebelum refund, omzetnya\s*Rp\s*([\d.]+)/);
      expect(m, `kalimat refund memuat angkanya: ${teks}`).toBeTruthy();
      expect(Number(m![1].replace(/\./g, ""))).toBe(Math.round(lap.omzet_sebelum_refund));
    }
  });

  test("tab Menu Terlaris, Pembelian, dan Lama Pesanan menampilkan angka server", async ({
    page,
    request,
  }) => {
    const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
    const h = { Authorization: `Bearer ${token}` };
    const q = `dari=${HARI}&sampai=${HARI}&branch_id=all`;
    const laris = (await (await request.get(`${BASE}/api/laporan/menu-laris?${q}`, { headers: h })).json()) as {
      total_qty: number;
      items: { nama: string; qty: number }[];
    };
    const beli = (await (await request.get(`${BASE}/api/laporan/pembelian?${q}`, { headers: h })).json()) as {
      total_pengeluaran: number;
      jumlah_faktur: number;
      jumlah_item: number;
    };
    const durasi = (await (await request.get(`${BASE}/api/laporan/durasi-pesanan?${q}`, { headers: h })).json()) as {
      jumlah: number;
      riwayat: unknown[];
    };

    await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
    await page.goto("/laporan/menu-laris");
    await expect(page.getByText("Total porsi")).toBeVisible();
    if (laris.items.length > 0) {
      // Baris teratas = item pertama balasan, dengan porsinya.
      const teratas = page.getByText(laris.items[0].nama, { exact: true }).first();
      await expect(teratas).toBeVisible();
      await expect(page.getByText(`${new Intl.NumberFormat("id-ID").format(laris.items[0].qty)} porsi`).first()).toBeVisible();
    }

    await page.goto("/laporan/pembelian");
    await expect(labelKartu(page, "Total Pengeluaran")).toBeVisible();
    expect(await nilaiKartu(page, "Total Pengeluaran")).toBe(Math.round(beli.total_pengeluaran));
    expect(await nilaiKartu(page, "Jumlah Faktur")).toBe(beli.jumlah_faktur);
    expect(await nilaiKartu(page, "Jumlah Baris Bahan")).toBe(beli.jumlah_item);

    await page.goto("/laporan/durasi-pesanan");
    await expect(page.getByText("Per menu")).toBeVisible();
    // "menampilkan N dari M" — N = panjang riwayat yang dikirim, M = jumlah.
    if (durasi.jumlah > 0) {
      await expect(page.getByText(String(durasi.riwayat.length), { exact: true }).first()).toBeVisible();
    }
  });
});
