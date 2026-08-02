import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Penjaga WARNA MEJA YANG STATUSNYA TAK DIKETAHUI.
 *
 * `GET /meja/status` menjawab satu baris untuk SETIAP meja dine-in cabang —
 * `okupansi.ts` LEFT JOIN dari tabel `meja`, tanpa penyaring yang bisa
 * menjatuhkan meja dari hasilnya. Konsekuensinya tegas: status yang hilang di
 * klien TIDAK PERNAH berarti "meja ini kosong". Ia cuma bisa berarti bacaannya
 * gagal atau belum tiba.
 *
 * Dulu `kelasStatus` menjawab hijau untuk `!s` — disatukan dengan cabang
 * "kosong". Hijau di halaman Meja punya arti yang dicetak di legendanya
 * sendiri: "siap ditempati". Jadi satu permintaan gagal mengubah SELURUH denah
 * jadi hijau: setiap meja tampak bebas, termasuk yang bill-nya belum dibayar,
 * dan tak ada satu pun tanda di layar bahwa ada yang salah.
 *
 * Uji ini dijaga di sisi sumber (bukan render) karena yang ingin dikunci adalah
 * keputusannya, bukan kelas Tailwind-nya: `!s` harus punya cabangnya sendiri,
 * dan cabang itu tak boleh hijau.
 */
const src = readFileSync(
  new URL("../../web/src/pages/pengaturan/MejaStatusPanel.tsx", import.meta.url),
  "utf8",
);

/** Isi badan fungsi `kelasStatus`. */
function badanKelasStatus(): string {
  const mulai = src.indexOf("export function kelasStatus");
  expect(mulai).toBeGreaterThan(-1);
  const buka = src.indexOf("{", mulai);
  let dalam = 0;
  for (let i = buka; i < src.length; i++) {
    if (src[i] === "{") dalam++;
    else if (src[i] === "}" && --dalam === 0) return src.slice(buka, i + 1);
  }
  throw new Error("badan kelasStatus tak ketemu");
}

/**
 * Nilai yang sungguh-sungguh dikembalikan cabang `!s`.
 *
 * Bila cabangnya mengembalikan konstanta bernama, definisinya dilacak di berkas
 * yang sama. Tanpa ini, penjaga cuma memeriksa ejaan di satu baris — dan warna
 * yang disembunyikan di balik nama lolos begitu saja.
 */
function nilaiCabangTakDiketahui(): string {
  const badan = badanKelasStatus();
  const m = /if\s*\(\s*!s\s*\)\s*return\s+([^;]+);/.exec(badan);
  expect(m, "cabang `if (!s) return …` tak ketemu").not.toBeNull();
  const ekspr = m![1].trim();
  if (/^["'`]/.test(ekspr)) return ekspr; // literal langsung
  const def = new RegExp(
    `(?:const|let)\\s+${ekspr}\\s*(?::[^=]+)?=\\s*(["'\`][^"'\`]*["'\`])`,
  ).exec(src);
  expect(def, `definisi konstanta ${ekspr} tak ketemu di berkas ini`).not.toBeNull();
  return def![1];
}

describe("kelasStatus: status tak diketahui ≠ kosong", () => {
  it("`!s` punya cabang sendiri, tidak digabung dengan kosong", () => {
    const badan = badanKelasStatus();
    // Bentuk yang dilarang: `if (!s || s.status === "kosong") return <hijau>`
    expect(badan).not.toMatch(/if\s*\(\s*!s\s*\|\|/);
    expect(badan).toMatch(/if\s*\(\s*!s\s*\)\s*return/);
  });

  it("cabang `!s` TIDAK menjawab hijau — konstantanya ikut ditelusuri", () => {
    // Versi pertama uji ini cuma membaca BARISNYA. Cabang `!s` mengembalikan
    // konstanta bernama, jadi warnanya tak pernah muncul di baris itu — dan
    // menghijaukan konstantanya memulihkan bug aslinya UTUH (denah hijau semua
    // saat status tak diketahui) tanpa penjaga ini berkedip. Saya buktikan
    // sendiri: konstantanya diganti ke kelas hijau, keempat uji tetap lulus.
    //
    // Yang dijaga karena itu nilai yang BENAR-BENAR dikembalikan, bukan teks
    // yang kebetulan tertulis di baris yang sama.
    expect(nilaiCabangTakDiketahui()).not.toContain("green");
  });

  it("hanya status `kosong` yang berhak hijau", () => {
    const badan = badanKelasStatus();
    const barisHijau = badan.split("\n").filter((b) => b.includes("green"));
    expect(barisHijau).toHaveLength(1);
    expect(barisHijau[0]).toContain('"kosong"');
  });

  it("halaman Meja membaca error okupansi, tidak cuma datanya", () => {
    // Denah abu-abu tanpa penjelasan masih menyisakan pertanyaan "kenapa"; yang
    // menjawabnya cuma pesan galat, dan itu butuh `error` ikut dibaca.
    const meja = readFileSync(
      new URL("../../web/src/pages/pengaturan/MejaPage.tsx", import.meta.url),
      "utf8",
    );
    expect(meja).toMatch(/error:\s*\w+\s*\}\s*=\s*useMejaStatus/);
  });
});
