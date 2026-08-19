import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { penandaSajian, ringkasPesanan, sajianBedaDariNota } from "@kakarut/shared";
import type { PesananItemRow, PesananRow } from "@kakarut/shared";

/**
 * Penjaga BADGE penyajian pada Papan Pesanan.
 *
 * Sebuah baris yang `sajian_takeaway`-nya SAMA dengan `is_dine_in`-nya berarti
 * nota dan piring bercerita beda, dan pada penjualan yang sudah dibayar bedanya
 * sudah jadi angka: kemasannya masuk HPP dan keluar dari stok. Itu layak
 * dikatakan di kartu.
 *
 * TIGA cacat berbeda pernah hidup di baris yang sama, dan berkas ini menjaga
 * ketiganya sekaligus:
 *
 * 1. DIAM SAAT SEBAGIAN. Dasarnya `p.sajian_takeaway` — turunan
 *    `items.every(…)`, alias "SEMUA baris bawa pulang". Pesanan dine-in yang
 *    cuma sebagian dibungkus tetap beragregat false, `false === true` tak
 *    pernah cocok, dan papan diam. Yang menyembunyikannya: arah sebaliknya
 *    KEBETULAN benar, karena agregatnya juga jatuh ke false.
 *
 * 2. MENUDUH KASIR. Perbaikan pertama membandingkan tiap baris dengan
 *    `is_dine_in` KARTU. Padahal kasir boleh menandai satu porsi dibungkus di
 *    meja yang makan di tempat, dan baris itu memang lahir `is_dine_in` false
 *    pada penjualan ber-`is_dine_in` true — langsung tertuduh tanpa ada yang
 *    mengubahnya.
 *
 * 3. MENGARANG WAKTU. Badge-nya dulu berbunyi "diubah setelah transaksi", dan
 *    datanya tak pernah bisa membuktikan kata "setelah". `penandaSajian`
 *    MEWARISI tanda 🥡 dapur dari baris open bill, jadi sebuah baris bisa LAHIR
 *    dengan `sajian_takeaway === is_dine_in` — justru lewat alur yang paling
 *    sering dipakai: dapur menandai bungkus selagi bill masih terbuka, kasir
 *    menagihnya tanpa `dine_in_override`. Papan menuduh pesanan yang tak pernah
 *    disentuh sesudah dibayar, dan tuduhan yang salah sesering itu ikut
 *    menenggelamkan tuduhan yang benar.
 *
 * Ketiganya lolos pembacaan sekilas karena benar di SEBAGIAN kasus. Karena itu
 * tabel di bawah menguji dua arah pembalikan, pesanan campur yang sah, DAN
 * baris yang lahir sudah berbeda.
 */
/**
 * Baris utuh — SENGAJA tanpa `as PesananItemRow`.
 *
 * Versi pertama berkas ini memakai cast itu untuk memangkas kolom yang
 * dianggap tak relevan, dan castnya menyembunyikan bahwa namanya `nama` (bukan
 * `menu_nama`) sekaligus melewatkan `is_dine_in` — justru kolom yang jadi INTI
 * aturan di bawah. Tanpa cast, tsc yang memastikan barisnya nyata.
 */
function baris(p: {
  id: string;
  isDineIn: boolean;
  sajianTakeaway: boolean;
}): PesananItemRow {
  return {
    id: p.id,
    nama: "Nasi Goreng",
    qty: 1,
    qty_refund: 0,
    catatan: null,
    is_dine_in: p.isDineIn,
    status: "dikerjakan",
    sajian_takeaway: p.sajianTakeaway,
    status_oleh: null,
    status_pada: null,
    masuk_pada: "2026-01-01T10:00:00.000Z",
    durasi_detik: null,
  };
}

/**
 * `saleDineIn` = `sales.is_dine_in`, fakta pembukuan SELURUH transaksi;
 * `baris[].isDineIn` = penanda tiap baris, yang boleh berbeda karena kasir
 * bisa membungkus satu porsi di meja yang makan di tempat.
 *
 * `saleDineIn` sengaja tetap disertakan meski `sajianBedaDariNota` tak
 * memakainya: tanpa itu, menanam ulang cacat "bandingkan dengan penanda KARTU"
 * hanya menghasilkan `=== undefined` yang selalu false — merah karena alasan
 * yang salah, dan kasus campur-dari-kasir justru lolos.
 */
function kartu(p: {
  dibayar: boolean;
  saleDineIn: boolean;
  baris: { isDineIn: boolean; sajianTakeaway: boolean }[];
}): Pick<PesananRow, "dibayar" | "is_dine_in" | "items"> {
  return {
    dibayar: p.dibayar,
    is_dine_in: p.saleDineIn,
    items: p.baris.map((b, i) => baris({ id: `i${i}`, ...b })),
  };
}

/** Baris apa adanya dari kasir, tanpa tanda dapur: lihat `penandaSajian`. */
const asli = (isDineIn: boolean) => ({
  isDineIn,
  sajianTakeaway: penandaSajian({ dineIn: isDineIn }),
});
/** Baris yang `sajian_takeaway`-nya SAMA dengan `is_dine_in`-nya. */
const beda = (isDineIn: boolean) => ({ isDineIn, sajianTakeaway: isDineIn });

/**
 * Aturan kelahiran penandanya — inilah yang membuat cacat #3 mungkin, jadi ia
 * diuji langsung, bukan diandaikan.
 */
describe("penandaSajian: dari mana `sajian_takeaway` sebuah baris lahir", () => {
  it("tanpa warisan bill: kebalikan `is_dine_in` baris itu", () => {
    expect(penandaSajian({ dineIn: true })).toBe(false);
    expect(penandaSajian({ dineIn: false })).toBe(true);
    // `null`/`undefined` = baris ini bukan dari open bill sama sekali.
    expect(penandaSajian({ warisTakeaway: null, dineIn: true })).toBe(false);
  });

  it("bill tanpa tanda dapur: tak mengubah apa pun", () => {
    expect(penandaSajian({ warisTakeaway: false, dineIn: true })).toBe(false);
    expect(penandaSajian({ warisTakeaway: false, dineIn: false })).toBe(true);
  });

  it("INTI: tanda 🥡 dapur menang atas `is_dine_in` baris", () => {
    // Dapur menandai bungkus selagi bill terbuka; kasir menagih tanpa
    // `dine_in_override`, jadi barisnya dibukukan dine-in. Tanpa OR ini,
    // penandanya hilang tepat di titik pembayaran dan dusnya tak pernah masuk
    // HPP maupun stok.
    expect(penandaSajian({ warisTakeaway: true, dineIn: true })).toBe(true);
  });

  it("dan karena itu sebuah baris BISA lahir 'beda dari nota'", () => {
    // Inilah yang mematikan badge lama: kesamaan `sajian_takeaway ===
    // is_dine_in` bukan jejak siapa pun. Barisnya dirakit persis seperti
    // `createSale` merakitnya, lalu diadu dengan predikat kartunya.
    const dineIn = true;
    const lahirBegini = kartu({
      dibayar: true,
      saleDineIn: true,
      baris: [
        {
          isDineIn: dineIn,
          sajianTakeaway: penandaSajian({ warisTakeaway: true, dineIn }),
        },
      ],
    });
    // Predikatnya memang menyala — dan itu benar: notanya dine-in, piringnya
    // dus. Yang salah dulu adalah kartu menyebutnya "diubah setelah transaksi",
    // padahal tak ada yang menyentuhnya sesudah kasir menerima uang.
    expect(sajianBedaDariNota(lahirBegini)).toBe(true);
  });
});

describe("papan pesanan: penyajian beda dari nota", () => {
  it("dine-in utuh: sama dengan notanya", () => {
    expect(
      sajianBedaDariNota(
        kartu({
          dibayar: true,
          saleDineIn: true,
          baris: [asli(true), asli(true)],
        }),
      ),
    ).toBe(false);
  });

  it("bawa pulang utuh: sama dengan notanya", () => {
    expect(
      sajianBedaDariNota(
        kartu({
          dibayar: true,
          saleDineIn: false,
          baris: [asli(false), asli(false)],
        }),
      ),
    ).toBe(false);
  });

  /**
   * Pesanan CAMPUR yang ditetapkan KASIR. Satu orang di meja minta porsinya
   * dibungkus (`dine_in_override`), sisanya makan di tempat. Tiap baris tetap
   * cocok dengan pembukuan BARISNYA sendiri — tak ada yang berbeda.
   * Membandingkan baris dengan penanda KARTU justru menyalakannya.
   */
  it("campur dari kasir (dine_in_override): tetap cocok per baris", () => {
    expect(
      sajianBedaDariNota(
        kartu({
          dibayar: true,
          saleDineIn: true,
          baris: [asli(true), asli(false)],
        }),
      ),
    ).toBe(false);
  });

  it("dine-in, SEMUA baris dibungkus: beda", () => {
    expect(
      sajianBedaDariNota(
        kartu({
          dibayar: true,
          saleDineIn: true,
          baris: [beda(true), beda(true)],
        }),
      ),
    ).toBe(true);
  });

  /** Cacat aslinya: agregat kartu tinggal false, jadi papan diam. */
  it("dine-in, SEBAGIAN dibungkus: TETAP beda", () => {
    const p = kartu({
      dibayar: true,
      saleDineIn: true,
      baris: [beda(true), asli(true)],
    });
    // Agregat kartu memang false — dan justru itu sebabnya ia tak boleh dipakai.
    expect(ringkasPesanan(p.items).sajian_takeaway).toBe(false);
    expect(sajianBedaDariNota(p)).toBe(true);
  });

  it("bawa pulang, SEMUA dikembalikan ke piring: beda", () => {
    expect(
      sajianBedaDariNota(
        kartu({
          dibayar: true,
          saleDineIn: false,
          baris: [beda(false), beda(false)],
        }),
      ),
    ).toBe(true);
  });

  it("bawa pulang, SEBAGIAN dikembalikan ke piring: beda", () => {
    expect(
      sajianBedaDariNota(
        kartu({
          dibayar: true,
          saleDineIn: false,
          baris: [beda(false), asli(false)],
        }),
      ),
    ).toBe(true);
  });

  it("belum dibayar: diam — bedanya belum jadi angka", () => {
    // Bill terbuka boleh ditandai bebas dan tombol 🥡-nya masih di layar;
    // penandanya baru masuk HPP & stok saat dibayar.
    expect(
      sajianBedaDariNota(
        kartu({ dibayar: false, saleDineIn: true, baris: [beda(true)] }),
      ),
    ).toBe(false);
    expect(
      sajianBedaDariNota(
        kartu({ dibayar: false, saleDineIn: false, baris: [beda(false)] }),
      ),
    ).toBe(false);
  });

  it("kartu tanpa baris: tak ada yang bisa berbeda", () => {
    // Rumus lama (lewat agregat kartu) memberi `false === false` → true untuk
    // penjualan bawa pulang tanpa baris: beda pada pesanan tanpa sajian.
    expect(
      sajianBedaDariNota(kartu({ dibayar: true, saleDineIn: false, baris: [] })),
    ).toBe(false);
  });
});

/**
 * Cacat #3 hidup di TEKS, jadi teksnyalah yang dijaga. Predikat di atas boleh
 * menyala pada baris yang lahir berbeda — yang tak boleh adalah kartunya
 * mengaku tahu KAPAN bedanya muncul.
 */
describe("badge-nya tidak mengarang waktu", () => {
  const HAL = readFileSync(
    fileURLToPath(new URL("../../web/src/pages/pesanan/PesananPage.tsx", import.meta.url)),
    "utf8",
  );

  it("papan memakai predikatnya", () => {
    expect(HAL).toContain("sajianBedaDariNota(p)");
  });

  it("tak ada lagi klaim 'setelah transaksi' di layar", () => {
    expect(HAL).not.toContain("diubah setelah transaksi");
  });

  it("yang dikatakan adalah bedanya, bukan riwayatnya", () => {
    expect(HAL).toContain("penyajian beda dari nota");
  });
});

/**
 * Kontrak untuk tim mobile, DUA ARAH.
 *
 * Kalimat pisah-porsi di `API-CONTRACT.md` menyatakan hal yang berlawanan dengan
 * kodenya sejak hari ia ditulis — `git` menunjukkan pewarisannya sudah ada lebih
 * dulu — dan tak ada apa pun yang menangkapnya sampai penandanya mulai
 * memindahkan uang. Dokumen yang berbohong ke tim Flutter melahirkan bug
 * sungguhan di sisi mereka, jadi kedua arah klaimnya dijaga di sini.
 */
describe("kontrak mobile cocok dengan kodenya", () => {
  const bacaAkar = (rel: string) =>
    readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
  const KONTRAK = bacaAkar("docs/API-CONTRACT.md");

  it("klaim lama yang salah sudah hilang", () => {
    expect(KONTRAK).not.toContain("tetap lahir per baris dari");
  });

  it("pewarisannya dinyatakan, lengkap dengan akibat biayanya", () => {
    expect(KONTRAK).toContain("penanda_baris_bill || !is_dine_in");
    expect(KONTRAK).toContain("basis biaya");
  });

  it("dan klien diberi tahu bahwa sebuah baris bisa LAHIR berbeda", () => {
    // Persis simpulan yang mematikan badge "diubah setelah transaksi".
    expect(KONTRAK).toContain("**lahir** dengan `sajian_takeaway == is_dine_in`");
  });

  it("kontras `pisah_dari` yang dijanjikan kontrak masih benar di kodenya", () => {
    // Kontrak menjanjikan dua aturan BERLAWANAN: diwarisi saat membayar (id
    // sama), tidak diwarisi saat memecah baris bill. Kalau suatu saat
    // `pisah_dari` ikut mewarisi penandanya, kalimat kontras itu jadi bohong —
    // dan uji inilah yang memaksa dokumennya ditinjau ulang.
    const src = bacaAkar("apps/server/src/modules/open-bill/routes.ts");
    const i = src.indexOf("const asal = it.pisah_dari");
    expect(i, "blok pisah_dari tak ditemukan").toBeGreaterThan(0);
    const blok = src.slice(i, i + 900);
    expect(blok).toContain("pesananStatus: asal.pesananStatus");
    expect(blok).not.toContain("sajianTakeaway: asal.");
  });
});
