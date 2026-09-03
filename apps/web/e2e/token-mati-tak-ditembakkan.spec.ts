/**
 * TOKEN YANG SUDAH MATI TIDAK MELAHIRKAN SATU PERMINTAAN PUN — DIHITUNG DI
 * PERAMBAN, BUKAN DIBACA DARI KODE.
 *
 * Yang tak bisa dijawab uji statis justru inti fiturnya: BERAPA permintaan yang
 * benar-benar berangkat. Terukur di panel Log Galat production 2026-09-02:
 * 1.744 penolakan 401 dalam 7 hari, ~14 per sesi yang mati, karena seluruh
 * kueri yang terpasang berangkat serentak membawa token yang sama.
 *
 * `/api/health` DIKECUALIKAN dari hitungan, dan itu bukan kelonggaran: ia
 * ditembak `ServerStatusOverlay`/`UpdatePrompt` TANPA header `Authorization`,
 * jadi ia tak pernah melahirkan 401 dan tak pernah muncul di log galat. Yang
 * dijaga di sini permintaan yang MEMBAWA sesi.
 *
 * PREMIS DIBUKTIKAN LEBIH DULU, dan di sini premisnya menentukan segalanya:
 * asersi "nol permintaan" lolos dengan sempurna pada layar yang memang tak
 * pernah meminta apa pun. Jadi sesi yang HIDUP diukur lebih dulu di layar yang
 * SAMA — kalau ia tak menembakkan apa-apa, ujinya berhenti sebelum menuduh.
 *
 * MASUK LEWAT SESI, bukan layar login: `/auth/login` dibatasi 10 per 5 menit
 * per (IP + email) dan suite ini duduk di langit-langit itu. `sesiApi`
 * menyimpan sesinya per proses (`workers: 1`), jadi spec ini tak menambah satu
 * login pun.
 */
import { expect, test } from "@playwright/test";
import { BASE, KASIR_EMAIL, KASIR_PASS, sesiApi } from "./util";

/**
 * Token yang sama persis, hanya `exp`-nya dimundurkan. Tanda tangannya jadi
 * tak sah — dan itu TIDAK relevan: yang diuji adalah bahwa permintaannya tak
 * pernah dikirim, jadi tak ada yang pernah memverifikasinya. Klien memang tak
 * pernah memeriksa tanda tangan (lihat `lib/umurToken.ts`).
 */
function tokenKedaluwarsa(token: string): string {
  const [kepala, muatan, tanda] = token.split(".");
  const isi = JSON.parse(Buffer.from(muatan, "base64url").toString("utf8")) as {
    exp?: number;
  };
  isi.exp = Math.floor(Date.now() / 1000) - 3 * 3600;
  return `${kepala}.${Buffer.from(JSON.stringify(isi), "utf8").toString("base64url")}.${tanda}`;
}

const bersesi = (url: string) => url.includes("/api/") && !url.includes("/api/health");

test("sesi yang mati: nol permintaan ber-sesi, dan layar login mengatakan sebabnya", async ({
  page,
  request,
  browser,
}) => {
  const sesi = await sesiApi(request, KASIR_EMAIL, KASIR_PASS);

  // ── PREMIS: layar yang sama, sesi yang HIDUP, memang menembakkan permintaan.
  const dariSesiHidup: string[] = [];
  page.on("request", (r) => {
    if (bersesi(r.url())) dariSesiHidup.push(r.url());
  });
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k as string, v as string),
    ["kakarut.auth", JSON.stringify(sesi)] as const,
  );
  await page.goto("/kasir");
  await expect(page, "premis: sesi hidup tidak dipantulkan ke login").not.toHaveURL(/\/login/);
  await page.waitForTimeout(2500);
  expect(
    dariSesiHidup.length,
    "premis: layar kasir dengan sesi hidup tak menembakkan apa pun — asersi 'nol' di bawah akan lolos secara hampa",
  ).toBeGreaterThan(0);

  // ── INTI: sesi yang MATI, layar yang sama, nol permintaan.
  // Konteks baru: `addInitScript` di atas menanam sesi hidup pada SETIAP
  // navigasi halaman itu, jadi menimpanya di sana tak akan bertahan.
  const konteks = await browser.newContext({ baseURL: BASE });
  const halaman = await konteks.newPage();

  // DITANAM SEKALI, lewat `evaluate`, BUKAN `addInitScript` — dan bedanya
  // menentukan. Init script berjalan pada tiap navigasi, jadi ia menanam ulang
  // sesi mati itu tepat setelah aplikasi membuangnya; layar login memantulkan
  // pengunjung yang "punya sesi" kembali ke /kasir, dan ujinya berputar antara
  // dua halaman tanpa pernah menguji apa pun. Terlihat saat bukti merah
  // dijalankan — versi pertama berkas ini memakai init script.
  await halaman.goto("/login");
  await halaman.evaluate(
    ([k, v]) => window.localStorage.setItem(k as string, v as string),
    ["kakarut.auth", JSON.stringify({ ...sesi, token: tokenKedaluwarsa(sesi.token) })] as const,
  );

  // Hitung MULAI DARI SINI: pemuatan /login di atas tak membawa sesi apa pun.
  const dariSesiMati: string[] = [];
  halaman.on("request", (r) => {
    if (bersesi(r.url())) dariSesiMati.push(r.url());
  });
  await halaman.goto("/kasir");

  // Sebabnya tetap diucapkan — sesi yang mati diam-diam adalah temuan yang
  // sudah dibayar putaran sebelumnya (`?sesi=berakhir`).
  await halaman.waitForURL(/sesi=berakhir/, { timeout: 15_000 });

  // Beri kesempatan kueri susulan berangkat sebelum dihitung: kalau gerbangnya
  // dicabut, inilah jendela tempat keempat belas permintaan itu muncul.
  await halaman.waitForTimeout(2500);
  expect(
    dariSesiMati,
    "token yang sudah mati masih ditembakkan ke server (tiap satu = satu baris di log galat)",
  ).toEqual([]);

  await konteks.close();
});
