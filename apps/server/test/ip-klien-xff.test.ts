import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "../src/middleware/auth";
import { ipKlien } from "../src/middleware/rateLimit";
import { env } from "../src/config/env";

/**
 * SATU HEADER MEMATIKAN SELURUH PEMBATAS LAJU PRA-AUTENTIKASI.
 *
 * `X-Forwarded-For` tumbuh dari KIRI ke KANAN: tiap proxy MENAMBAHKAN alamat
 * rekan bicaranya di belakang rantai dan tak menyentuh yang sudah ada. Maka
 * entri paling kiri adalah yang dikirim klien sendiri — siapa pun bebas
 * mengisinya apa saja — sedangkan yang benar-benar DIAMATI proxy tepercaya kita
 * ada di kanan.
 *
 * `ipKlien` dulu memulangkan entri paling kiri, dan tujuh pembatas laju
 * memakainya sebagai kunci: login, daftar, tamu, lupa password, reset password,
 * verifikasi email, kirim ulang verifikasi. Mengganti header itu tiap permintaan
 * karena itu memberi ember baru tiap kali — embernya tak pernah penuh.
 *
 * Terukur terhadap server sungguhan, masukan identik pada kedua sisi
 * (`X-Forwarded-For: <karangan-berputar>, 10.0.0.5`, meniru Traefik yang
 * menambahkan IP asli di kanan):
 *
 *   kode lama : 14 percobaan login gagal → 14× 401, tak pernah 429,
 *               dan 14 EMBER TERPISAH lahir di tabel rate_limits;
 *   kode baru : 429 sejak percobaan ke-11, satu ember `login:10.0.0.5:<email>`.
 *
 * Artinya perlindungan tebak-password bukan sekadar melemah — ia mati total,
 * dan tak meninggalkan gejala apa pun: yang menyerang tetap dibalas 401 biasa.
 *
 * Uji ini menguji fungsinya langsung, bukan menyisir teksnya, sehingga bentuk
 * penulisan boleh berubah asal perilakunya tetap.
 */

/** Context tiruan: hanya `header()` yang dibaca `ipKlien`. */
function ctx(h: Record<string, string>): Context<AppEnv> {
  return {
    req: { header: (n: string) => h[n.toLowerCase()] },
  } as unknown as Context<AppEnv>;
}

/** Jalankan dengan `TRUST_PROXY_HOPS` tertentu, lalu kembalikan seperti semula. */
function denganHop<T>(n: number, f: () => T): T {
  const asli = env.TRUST_PROXY_HOPS;
  (env as { TRUST_PROXY_HOPS: number }).TRUST_PROXY_HOPS = n;
  try {
    return f();
  } finally {
    (env as { TRUST_PROXY_HOPS: number }).TRUST_PROXY_HOPS = asli;
  }
}

describe("ipKlien: X-Forwarded-For dibaca dari KANAN", () => {
  it("bawaannya 1 hop — cocok dengan penyebaran yang dikirim repo ini", () => {
    // Kalau bawaannya kelak jadi 0 tanpa disengaja, seluruh pengguna di belakang
    // Traefik jatuh ke SATU ember (alamat kontainer proxy) dan saling
    // menghabiskan jatah login. Kalau jadi 2 tanpa ada CDN, entri karangan
    // penyerang yang terpakai lagi.
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });

  it("1 hop: entri karangan di kiri DIABAIKAN, yang ditambahkan proxy dipakai", () => {
    const ip = denganHop(1, () =>
      ipKlien(ctx({ "x-forwarded-for": "198.51.100.7, 10.0.0.5" })),
    );
    expect(ip).toBe("10.0.0.5");
  });

  it("memutar entri kiri TIDAK menggeser kuncinya — inti kerusakannya", () => {
    // Persis bentuk serangannya: tiap permintaan membawa karangan berbeda.
    const hasil = denganHop(1, () =>
      [1, 2, 3, 4, 5].map((i) =>
        ipKlien(ctx({ "x-forwarded-for": `198.51.100.${i}, 10.0.0.5` })),
      ),
    );
    expect(new Set(hasil).size).toBe(1);
    expect(hasil[0]).toBe("10.0.0.5");
  });

  it("rantai panjang karangan pun tak menolong penyerang", () => {
    // Menumpuk entri tak menggeser posisi yang dibaca: ia dihitung dari KANAN.
    const ip = denganHop(1, () =>
      ipKlien(ctx({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 10.0.0.5" })),
    );
    expect(ip).toBe("10.0.0.5");
  });

  it("2 hop (CDN di depan Traefik): dibaca dua langkah dari kanan", () => {
    const ip = denganHop(2, () =>
      ipKlien(ctx({ "x-forwarded-for": "198.51.100.7, 203.0.113.9, 10.0.0.5" })),
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("0 hop (tanpa proxy): XFF diabaikan SEPENUHNYA", () => {
    // Termasuk `x-real-ip`, yang sama-sama dikirim klien bila tak ada yang
    // menimpanya. Tanpa proxy, satu-satunya sumber yang sah adalah alamat
    // koneksi — di lingkungan uji tanpa server Node ia jatuh ke "unknown".
    const ip = denganHop(0, () =>
      ipKlien(ctx({ "x-forwarded-for": "198.51.100.7", "x-real-ip": "198.51.100.8" })),
    );
    expect(ip).not.toBe("198.51.100.7");
    expect(ip).not.toBe("198.51.100.8");
  });

  it("rantai lebih PENDEK dari yang dijanjikan → XFF tak dipakai", () => {
    // Permintaan yang tak melewati proxy sebanyak yang dijanjikan berarti ia
    // masuk lewat jalan lain. Menebak dari sisa rantai sama saja mempercayai
    // entri yang justru dikendalikan pengirimnya.
    const ip = denganHop(2, () => ipKlien(ctx({ "x-forwarded-for": "198.51.100.7" })));
    expect(ip).not.toBe("198.51.100.7");
  });

  it("tanpa XFF: `x-real-ip` dipakai saat memang ada proxy di depan", () => {
    const ip = denganHop(1, () => ipKlien(ctx({ "x-real-ip": "10.0.0.9" })));
    expect(ip).toBe("10.0.0.9");
  });

  it("spasi & entri kosong dalam rantai tak menggeser posisi baca", () => {
    const ip = denganHop(1, () =>
      ipKlien(ctx({ "x-forwarded-for": " 198.51.100.7 ,, 10.0.0.5 ," })),
    );
    expect(ip).toBe("10.0.0.5");
  });
});
