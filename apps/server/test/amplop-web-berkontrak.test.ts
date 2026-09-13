import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * UJUNG SATUNYA LAGI DARI KAWAT YANG SAMA.
 *
 * `amplop-berkontrak.test.ts` menghitung amplop yang SERVER kirim tanpa punya
 * nama di kontrak. Berkas ini menghitung kebalikannya: tempat WEB menuliskan
 * sendiri bentuk balasan di situs pengambilannya — `api<{ … }>("/rute")` —
 * alih-alih menyebut tipe kontrak.
 *
 * Keduanya kelas yang sama dilihat dari dua ujung, dan yang di sini lebih
 * berbahaya justru karena ia HIJAU di typecheck: sebuah tipe struktural yang
 * ditulis tangan tak pernah salah menurut kompilator, ia hanya membuat
 * kompilator bersaksi untuk dunia yang lebih sempit daripada yang sebenarnya
 * dikirim. Medan yang tak disebut bukan cuma tak terpakai — ia MUSTAHIL
 * dipakai, sebab menyentuhnya jadi galat tipe.
 *
 * Diukur 2026-09-11 atas seluruh `apps/web/src` (145 berkas):
 *
 *   225 situs `api<T>(…)` bertipe (definisi `api()` sendiri tak dihitung)
 *    46 di antaranya T-nya STRUKTURAL (ditulis tangan di tempat)  ← vena ini
 *
 * Angka 46 itu dihitung DUA KALI dengan alat yang berbeda — sapuan Python
 * sekali pakai dan pemindai di berkas ini — dan keduanya juga sepakat pada 40
 * sesudah vena ini membayar enam. Dua instrumen yang cocok bukan jaminan
 * benar, tapi dua yang TAK cocok selalu berarti salah satu salah, dan sesi
 * ini sudah empat kali menemukan instrumen sekali-pakainya yang keliru.
 *
 * Tiga di antaranya diukur lewat HTTP terhadap DB gerbang, dan ketiganya
 * bentuk yang kontraknya SUDAH ADA:
 *
 *   · `/auth/me` — server mengirim `SesiDto`: `user`, `branch`, dan `company`
 *     bermedan SEMBILAN. `KasirPage` mengetik `{ company: { tiga medan } }`,
 *     jadi enam medan `company` plus `user` dan `branch` tak ada baginya.
 *     Dibuktikan dengan kompilator: menambahkan `pb1Conf?.blokir_jual_minus`
 *     memulangkan `TS2339 Property 'blokir_jual_minus' does not exist` —
 *     medan yang server kirim PERSIS untuk layar itu.
 *   · `/cabang` — 14 medan (`CabangDto`, lahir sehari sebelumnya). Diketik
 *     `{ id, nama }[]`.
 *   · `/transfer-stok` — `{ rows, rows_terpotong }`. Diketik `{ rows }`, jadi
 *     penanda pemotongan yang server kirim sejak putaran 23 tak pernah ada
 *     bagi layar Transfer Stok. Daftarnya berlangit-langit 50; faktur ke-51
 *     hilang tanpa satu kalimat pun. Itu bukan kerapian — itu kelas
 *     `SupplierKartu.rows_terpotong`, yang halamannya SUDAH merender
 *     spanduknya.
 *
 * RATCHET, bukan larangan. Tipe struktural sekali-pakai kadang memang benar
 * (`{ url }` balasan unggah, pengakuan `{ ok }`), dan menamai keempat puluh
 * enam sekaligus akan jadi commit yang tak bisa ditinjau siapa pun. Yang
 * dijaga: angkanya hanya boleh MENYUSUT.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const WEB = "apps/web/src";

/**
 * UTANG YANG DIIZINKAN — hanya boleh turun.
 *
 * 46 saat diukur. Vena "amplop yang tak bernama, di kedua ujung kawat"
 * (2026-09-11) membayar enam: `KasirPage` ×3 (`/company` → `CompanyRow`,
 * `/cabang` → `CabangDto[]`, `/auth/me` → `SesiDto`), `MenuListPage` ×1
 * (`/company`), `TransferStokPage` ×2 (`TransferStokSaldo`,
 * `TransferStokDaftar`) → 40.
 *
 * Vena "lencana yang menghitung halaman" (2026-09-12) membayar tujuh → **33**.
 * Keempat puluh itu lebih dulu DIPILAH — 21 BACA, 19 TULIS — dan tiap yang
 * BACA diketuk lewat HTTP terhadap DB gerbang untuk membandingkan kunci
 * teratas yang dideklarasikan dengan yang benar-benar dikirim:
 *
 *   · 4 situs MENYEMPITKAN amplop: `/produksi` & `/pembelian` mengirim ENAM
 *     kunci (`rows, total, page, per_page, total_pengeluaran, ringkas`),
 *     keempatnya mengetik SATU. `StokMasukPage` sudah menamainya, dan
 *     `TambahStokPage` sudah memakainya untuk rute yang sama.
 *   · 3 situs menyempitkan ELEMEN larik pada rute yang bentuknya sudah bernama
 *     DAN sudah dipakai di tempat lain untuk URL yang sama (`/stok` ×2 →
 *     `StokRowDto[]`, `/pengajuan?status=menunggu` → `PengajuanRow[]`).
 *   · 9 situs amplopnya SETIA (`{ rows }` memang satu-satunya kunci) — tak
 *     bernama, tapi tak menyembunyikan apa pun. Dibiarkan.
 *   · 19 TULIS adalah pengakuan `{ok, …}` — kelas yang sengaja di luar
 *     hitungan di ujung server, dan alasannya sama di sini.
 */
const MAKS_TULIS_TANGAN = 33;

/**
 * Rute DAFTAR pengadaan — `/produksi` dan `/pembelian` telanjang atau
 * ber-query, BUKAN sub-jalurnya. Amplop keduanya berenam kunci; sub-jalurnya
 * (`/produksi/faktur/:id`, `/produksi/log/:id`) mengirim `{ rows }` saja.
 */
const RUTE_DAFTAR = /^\/(produksi|pembelian)(\?|$)/;

/** Berkas sumber web, rekursif. */
function berkasWeb(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = `${dir}/${nama}`;
    if (statSync(p).isDirectory()) keluar.push(...berkasWeb(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) keluar.push(p);
  }
  return keluar.sort();
}

/**
 * Argumen tipe mulai dari `<` di posisi `awal`, dengan kurung berimbang —
 * `<`, `{`, `(`, `[` semuanya dihitung, supaya `{ ok: true } & Partial<X>`
 * terbaca utuh alih-alih terpotong di `>` pertama.
 */
function argumenTipe(src: string, awal: number): { teks: string; akhir: number } | null {
  let d = 0;
  for (let i = awal; i < src.length; i += 1) {
    const c = src[i];
    if (c === "<" || c === "{" || c === "(" || c === "[") d += 1;
    else if (c === ">" || c === "}" || c === ")" || c === "]") {
      d -= 1;
      if (d === 0) return { teks: src.slice(awal + 1, i), akhir: i };
      if (d < 0) return null;
    }
  }
  return null;
}

/**
 * T STRUKTURAL = ditulis di tempat, bukan disebut namanya. `X[]`, `Pick<X,…>`,
 * `X | null`, dan union nama semuanya SEBUTAN — yang dituduh hanya yang
 * membuka dengan `{`, termasuk `{…}[]` dan `{…} & Y`.
 */
export function strukturalDiTempat(t: string): boolean {
  const rapi = t.trim().replace(/\[\]$/, "").trim();
  return rapi.startsWith("{") || rapi.startsWith("Array<{") || rapi.startsWith("Readonly<{");
}

/** Situs `api<T>(` yang T-nya ditulis tangan, sebagai `berkas:baris [T]`. */
export function situsTulisTangan(sumber: Record<string, string>): string[] {
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(/\bapi\s*</g)) {
      const awal = buta.indexOf("<", m.index!);
      const arg = argumenTipe(buta, awal);
      if (!arg) continue;
      // Hanya PEMANGGILAN — `api<T = unknown>(` di definisinya sendiri bukan
      // situs pengambilan, dan tanpa syarat ini `lib/api.ts` menuduh dirinya.
      if (buta[arg.akhir + 1] !== "(") continue;
      if (/=/.test(arg.teks)) continue;
      if (!strukturalDiTempat(arg.teks)) continue;
      const baris = buta.slice(0, m.index!).split("\n").length;
      keluar.push(`${berkas}:${baris} [${arg.teks.trim().replace(/\s+/g, " ")}]`);
    }
  }
  return keluar.sort();
}

/**
 * Situs yang ditulis tangan BESERTA rutenya.
 *
 * Ratchet angka menjawab "berapa banyak"; ia tak bisa menjawab "rute MANA yang
 * sudah dibayar". Pengunci setingkat BERKAS pernah dicoba di sini dan salah:
 * `Layout.tsx` memuat sembilan situs, dan yang dibayar cuma dua di antaranya —
 * penguncinya ikut menagih tujuh yang lain. Yang benar setingkat RUTE.
 *
 * Jalurnya dipetik dari literal pertama argumen panggilan (`"…"`, `'…'`, atau
 * awalan statis sebuah template) — cukup untuk mengenali rutenya, dan tak
 * berpura-pura menyelesaikan `${…}` yang cuma hidup saat program berjalan.
 */
export function situsTulisTanganBerjalur(
  sumber: Record<string, string>,
): { situs: string; jalur: string }[] {
  const keluar: { situs: string; jalur: string }[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(/\bapi\s*</g)) {
      const awal = buta.indexOf("<", m.index!);
      const arg = argumenTipe(buta, awal);
      if (!arg || buta[arg.akhir + 1] !== "(" || /=/.test(arg.teks)) continue;
      if (!strukturalDiTempat(arg.teks)) continue;
      const badan = argumenTipe(buta, arg.akhir + 1);
      const lit = badan ? /^\s*[`"']([^`"'$]*)/.exec(badan.teks) : null;
      const baris = buta.slice(0, m.index!).split("\n").length;
      keluar.push({ situs: `${berkas}:${baris}`, jalur: lit ? lit[1] : "" });
    }
  }
  return keluar.sort((a, b) => a.situs.localeCompare(b.situs));
}

/** Semua situs `api<T>(` bertipe — pembagi untuk PREMIS. */
function situsBertipe(sumber: Record<string, string>): number {
  let n = 0;
  for (const mentah of Object.values(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(/\bapi\s*</g)) {
      const awal = buta.indexOf("<", m.index!);
      const arg = argumenTipe(buta, awal);
      if (!arg || buta[arg.akhir + 1] !== "(" || /=/.test(arg.teks)) continue;
      n += 1;
    }
  }
  return n;
}

describe("web mengetik ulang bentuk balasan di situs pengambilannya", () => {
  const sumber: Record<string, string> = {};
  for (const f of berkasWeb(AKAR + WEB)) sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
  const tulisTangan = situsTulisTangan(sumber);
  const berjalur = situsTulisTanganBerjalur(sumber);
  const bertipe = situsBertipe(sumber);

  it("PREMIS: sapuannya melihat populasi yang diukur, bukan sisa-sisanya", () => {
    // Sapuan yang kehilangan bahannya lulus tanpa memeriksa apa pun — dan
    // ratchet yang bahannya menyusut justru terlihat MEMBAIK.
    expect(Object.keys(sumber).length, "berkas web tersapu terlalu sedikit").toBeGreaterThan(130);
    expect(bertipe, "situs `api<T>(` terbaca terlalu sedikit").toBeGreaterThan(200);
    expect(tulisTangan.length, "tak satu pun terbaca — pemindainya mati").toBeGreaterThan(20);
  });

  it("INTI: bentuk balasan yang ditulis tangan di web hanya boleh MENYUSUT", () => {
    expect(
      tulisTangan.length,
      `bentuk balasan yang diketik ulang di web BERTAMBAH ` +
        `(${tulisTangan.length} > ${MAKS_TULIS_TANGAN}). Tipe struktural di situs ` +
        "`api<…>()` selalu hijau di typecheck, dan justru itu bahayanya: ia " +
        "membuat kompilator bersaksi untuk balasan yang lebih sempit daripada " +
        "yang server kirim, sehingga medan yang tak disebut jadi MUSTAHIL " +
        "dibaca. Sebut tipe kontraknya, atau turunkan MAKS_TULIS_TANGAN bila " +
        "kau baru saja membayarnya:\n" + tulisTangan.join("\n"),
    ).toBeLessThanOrEqual(MAKS_TULIS_TANGAN);
  });

  it("INTI: rute yang sudah dibayar TIDAK diketik ulang", () => {
    /*
     * Dipaku pada BERKAS + BENTUKNYA, bukan pada angka saja: MAKS yang
     * diturunkan enam tetap benar bila enam situs lain yang dibayar dan
     * keenam ini lahir kembali. Yang dijaga di sini bahwa rute-rute yang
     * bentuknya SUDAH bernama tak diketik ulang lagi.
     */
    const dibayar = [
      "apps/web/src/pages/kasir/KasirPage.tsx",
      "apps/web/src/pages/menu/MenuListPage.tsx",
      "apps/web/src/pages/stok/TransferStokPage.tsx",
      "apps/web/src/pages/stok/StokAwalPage.tsx",
    ];
    expect(tulisTangan.filter((s) => dibayar.some((d) => s.startsWith(`${d}:`)))).toEqual([
      // Pengakuan `{ok, …}` — kelas yang SENGAJA di luar hitungan di ujung
      // server, dan alasannya sama di sini: ia jawaban "berhasil", bukan
      // bentuk data.
      expect.stringContaining("StokAwalPage.tsx"),
      expect.stringContaining("TransferStokPage.tsx"),
    ]);
    /*
     * `/produksi` & `/pembelian` DIKUNCI SETINGKAT RUTE, dan itu satu-satunya
     * tingkat yang benar di sini: amplopnya berenam kunci, dan yang kelima —
     * `ringkas` — adalah angka lencana yang dihitung atas SELURUH populasi.
     * Situs yang mengetik amplopnya sendiri membuat `ringkas` MUSTAHIL dibaca,
     * dan satu-satunya jalan yang tersisa adalah menghitung dari halaman.
     */
    expect(
      berjalur.filter((s) => RUTE_DAFTAR.test(s.jalur)).map((s) => s.situs),
      "amplop /produksi atau /pembelian diketik tangan lagi — `ringkas` hilang dari pandangan",
    ).toEqual([]);
  });

  it("PASANGAN: pemindainya menuduh yang ditulis tangan, dan MELEWATI yang bernama", () => {
    const k = (t: string) => situsTulisTangan({ "u.tsx": t });
    expect(k('api<{ hantu_karangan: string }>("/x")')).toEqual([
      "u.tsx:1 [{ hantu_karangan: string }]",
    ]);
    // …juga bentuk larik dan perpotongan, dua ejaan yang mudah terlewat
    expect(k('api<{ a: string }[]>("/x")').length).toBe(1);
    expect(k('api<{ ok: true } & Partial<Sesi>>("/x")').length).toBe(1);
    // SEBUTAN nama tidak dituduh — termasuk yang berhias
    for (const t of ["SesiDto", "CabangDto[]", "Pick<CompanyRow, 'nama'>", "Shift | null"]) {
      expect(k(`api<${t}>("/x")`), `${t} tertuduh padahal ia sebutan`).toEqual([]);
    }
    // definisi `api<T = unknown>(` bukan situs pengambilan
    expect(k("export async function api<T = unknown>(jalur: string) {}")).toEqual([]);
    // …dan komentar tidak dibaca
    expect(k('// api<{ di_komentar: string }>("/x")')).toEqual([]);
  });

  it("PASANGAN: pemindai berjalur memetik rutenya, dan BISA menuduh /produksi", () => {
    const j = (t: string) => situsTulisTanganBerjalur({ "u.tsx": t });
    expect(j('api<{ rows: X[] }>("/produksi?per_page=1")')).toEqual([
      { situs: "u.tsx:1", jalur: "/produksi?per_page=1" },
    ]);
    // awalan statis sebuah template cukup — `${…}` tak dipura-purakan terselesaikan
    expect(j("api<{ rows: X[] }>(`/pembelian${qs}`)")).toEqual([
      { situs: "u.tsx:1", jalur: "/pembelian" },
    ]);
    // …dan yang BERNAMA tetap tak tertuduh, berapa pun rutenya
    expect(j('api<StokMasukPage>("/produksi?per_page=1")')).toEqual([]);
    // saringan rutenya sendiri: `/produksi-lain` bukan `/produksi`
    /*
     * SARINGAN RUTENYA IKUT DIUJI, dan versi pertamanya SALAH: `\b` sesudah
     * `produksi` juga cocok pada `/produksi-lain`, sebab `-` bukan aksara kata.
     * Lengan inilah yang menangkapnya. `(\?|$)` menyempitkannya ke rute DAFTAR
     * saja — `/produksi/faktur/:id` mengirim `{ rows }` dan satu kunci itu
     * memang boleh diketik tangan, sama seperti sembilan amplop setia lainnya.
     */
    const saring = (x: { jalur: string }[]) => x.filter((s) => RUTE_DAFTAR.test(s.jalur));
    expect(saring(j('api<{ a: 1 }>("/produksi-lain")'))).toEqual([]);
    expect(saring(j('api<{ a: 1 }>("/produksi/faktur/x")'))).toEqual([]);
    expect(saring(j('api<{ a: 1 }>("/produksi")')).length).toBe(1);
    expect(saring(j('api<{ a: 1 }>("/pembelian?per_page=200")')).length).toBe(1);
  });
});
