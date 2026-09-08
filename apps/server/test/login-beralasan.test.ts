import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PESAN_LOGIN, SEBAB_LOGIN } from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * LOGIN MENYEBUT ALASAN PENOLAKANNYA — dan penjaga ini menjaga HARGA-nya.
 *
 * Sampai 2026-09-03 keempat penolakan `POST /login` dijawab satu kalimat yang
 * sama, "Email atau password salah": email tak terdaftar, akun terhapus, akun
 * dinonaktifkan, password salah. Kalimat itu menutup ENUMERASI AKUN — orang
 * luar tak bisa menempelkan daftar alamat lalu memanen mana yang punya akun.
 *
 * Pemilik repo meminta alasannya disebutkan. Biayanya disampaikan lebih dulu
 * (enumerasi terbuka; yang tersisa cuma `batasLogin`), dan ia memilih tetap.
 * Uji ini BUKAN untuk menawar keputusan itu — ia memakunya, lengkap dengan
 * batas-batasnya, supaya yang berikutnya membaca kode ini tahu bahwa ini
 * pilihan, bukan kelalaian:
 *
 *  1. keempat kalimatnya hidup di SATU rumah (`PESAN_LOGIN` di shared) —
 *     server melemparnya, web membandingkannya untuk memunculkan tautan
 *     "Daftar"; kalimat yang diketik ulang di layar akan bergeser sendiri dan
 *     tautannya berhenti muncul tanpa satu uji pun merah;
 *  2. keempatnya tetap 401 — yang berubah kalimatnya, bukan kontraknya;
 *  3. alasannya TERTULIS di sumber, supaya tak ada yang "memperbaikinya"
 *     balik tanpa tahu apa yang sedang ia batalkan — dan sebaliknya, tak ada
 *     yang menyangka enumerasi ini kecelakaan;
 *  4. dan yang paling penting: `/lupa-password` TIDAK ikut berubah. Pintu itu
 *     tak berpassword sama sekali; membocorkan keterdaftaran di sana berarti
 *     memberikannya cuma-cuma, tanpa batas laju per akun yang menahan.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const bacaMentah = (p: string) => readFileSync(AKAR + p, "utf8");
const baca = (p: string) => butaKomentar(bacaMentah(p));

const AUTH = "apps/server/src/modules/auth/routes.ts";
const LOGIN_PAGE = "apps/web/src/pages/LoginPage.tsx";
const SIGNUP_PAGE = "apps/web/src/pages/SignupPage.tsx";
const RUMAH = "packages/shared/src/constants.ts";

/** Semua sumber produksi (bukan uji, bukan skrip gerbang) yang mungkin mengetik ulang kalimatnya. */
function semuaBerkas(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaBerkas(p + "/"));
    else if (nama.endsWith(".ts") || nama.endsWith(".tsx")) hasil.push(p);
  }
  return hasil;
}
const SUMBER = ["apps/server/src/", "apps/web/src/", "packages/shared/src/"]
  .flatMap((r) => semuaBerkas(AKAR + r))
  .filter((p) => !p.includes("/test/"));

/**
 * KALIMAT YANG SAMA, KLAIM YANG BEDA — diadili satu per satu.
 *
 * Sapuan di bawah melarang salinan kalimat `PESAN_LOGIN` di luar rumahnya,
 * sebab salinan adalah layar yang berhenti cocok saat kalimatnya diperbaiki.
 * Yang terdaftar di sini bukan salinan: ia kebetulan berbunyi sama sambil
 * mengatakan hal lain, dan MENGIKATNYA ke konstanta login justru salah.
 */
const DIADILI: { berkas: string; kalimat: string; alasan: string }[] = [
  {
    berkas: "apps/server/src/middleware/auth.ts",
    kalimat: PESAN_LOGIN.passwordSalah,
    alasan:
      "verifikasiPassword() — konfirmasi aksi merusak (hapus/edit transaksi) untuk sesi " +
      "yang SUDAH masuk. Bunyinya kebetulan sama; pintunya bukan pintu login, dan jalan " +
      "keluarnya bukan /lupa-password. Mengikatnya ke PESAN_LOGIN berarti kalimat yang " +
      "kelak ditambahi 'lupa password?' ikut muncul di modal hapus transaksi.",
  },
];

describe("POST /login menyebut alasan penolakannya", () => {
  it("tiap pengadilan punya alasan yang bisa diperiksa, dan berkasnya masih ada", () => {
    for (const d of DIADILI) {
      expect(d.alasan.length, d.berkas).toBeGreaterThan(80);
      expect(SUMBER.map((p) => p.slice(AKAR.length))).toContain(d.berkas);
      expect(butaKomentar(bacaMentah(d.berkas)), d.berkas).toContain(d.kalimat);
    }
  });

  const auth = baca(AUTH);
  const rumah = baca(RUMAH);

  it("keempat kalimatnya ada, berbeda satu sama lain, dan tinggal di shared", () => {
    const kalimat = [
      PESAN_LOGIN.takTerdaftar,
      PESAN_LOGIN.terhapus,
      PESAN_LOGIN.nonaktif,
      PESAN_LOGIN.passwordSalah,
    ];
    for (const k of kalimat) expect(k.trim().length).toBeGreaterThan(3);
    expect(new Set(kalimat).size).toBe(4);
    expect(rumah).toMatch(/export const PESAN_LOGIN/);
    // Kalimatnya benar-benar tertulis di rumah itu, bukan dirakit dari potongan
    // — kalau tidak, sapuan "tak ada salinan lain" di bawah jadi hampa.
    for (const k of kalimat) expect(rumah).toContain(k);
  });

  it("kalimat yang butuh tindakan MENYEBUT tindakannya", () => {
    // Ini alasan permintaan pemiliknya: "sebutkan alasan tidak terdaftarnya".
    // Alasan tanpa jalan keluar cuma memindahkan kebingungan.
    expect(PESAN_LOGIN.takTerdaftar).toMatch(/daftar/i);
    expect(PESAN_LOGIN.nonaktif).toMatch(/hubungi/i);
  });

  it("empat cabang, keempatnya 401 ber-sebab, dan tak satu pun mengetik kalimatnya sendiri", () => {
    const i = auth.indexOf('.post("/login"');
    expect(i).toBeGreaterThan(0);
    const j = auth.indexOf('.post(\n    "/guest"', i);
    expect(j).toBeGreaterThan(i);
    const handler = auth.slice(i, j);
    const empat = handler.match(
      /new LoginDitolak\(PESAN_LOGIN\.([a-zA-Z]+), SEBAB_LOGIN\.([a-zA-Z]+)\)/g,
    );
    expect(empat).toHaveLength(4);
    // Kalimat dan kode WAJIB sepasang: `PESAN_LOGIN.x` bertemu `SEBAB_LOGIN.x`.
    // Tanpa ini, kalimat "akun dinonaktifkan" bisa terkirim ber-kode
    // `password_salah` dan klien bercabang ke jalan yang salah — persis
    // kegagalan yang `sebab` ada untuk mencegahnya.
    for (const medan of ["takTerdaftar", "terhapus", "nonaktif", "passwordSalah"]) {
      expect(handler).toContain(`new LoginDitolak(PESAN_LOGIN.${medan}, SEBAB_LOGIN.${medan})`);
    }
    // Semuanya 401: yang berubah kalimatnya, bukan kontraknya. (403-nya milik
    // "belum diverifikasi", yang dicek SESUDAH password benar.)
    expect(auth).toMatch(/class LoginDitolak extends HTTPException/);
    expect(auth.slice(auth.indexOf("class LoginDitolak"), auth.indexOf("class LoginDitolak") + 400))
      .toContain("super(401,");
    expect(auth).toContain('from "@kakarut/shared"');
  });

  it("keempat kodenya ada, berbeda, dan berpasangan satu-satu dengan kalimatnya", () => {
    const kode = Object.values(SEBAB_LOGIN);
    expect(new Set(kode).size).toBe(4);
    expect(Object.keys(SEBAB_LOGIN)).toEqual(Object.keys(PESAN_LOGIN));
    // Kodenya untuk MESIN: huruf kecil, tanpa spasi — kalau ia mulai terbaca
    // seperti kalimat, orang berikutnya akan menampilkannya ke pemakai.
    for (const k of kode) expect(k).toMatch(/^[a-z_]+$/);
  });

  it("kalimat lama yang menggabungkan email & password sudah tak ada di sumber", () => {
    for (const p of SUMBER) {
      expect(butaKomentar(readFileSync(p, "utf8")), p).not.toContain("Email atau password salah");
    }
  });

  it("tak ada salinan kalimatnya di luar rumahnya", () => {
    // Salinan kedua = layar yang berhenti cocok saat kalimatnya diperbaiki.
    const kalimat = Object.values(PESAN_LOGIN);
    for (const p of SUMBER) {
      if (p.endsWith(RUMAH.slice(RUMAH.lastIndexOf("/")))) continue;
      const rel = p.slice(AKAR.length);
      const isi = butaKomentar(readFileSync(p, "utf8"));
      for (const k of kalimat) {
        if (DIADILI.some((d) => d.berkas === rel && d.kalimat === k)) continue;
        expect(isi, `${rel} menyalin "${k}"`).not.toContain(k);
      }
    }
  });

  it("alasan & harganya TERTULIS di sumber, bukan cuma di riwayat git", () => {
    const mentah = bacaMentah(AUTH);
    const i = mentah.indexOf('.post("/login"');
    const potong = mentah.slice(i, i + 3000);
    expect(potong).toMatch(/ENUMERASI/);
    expect(potong).toMatch(/batasLogin/);
    expect(potong).toMatch(/lupa-password/);
  });
});

describe("layar masuk memakai kalimat itu, tak mengendusnya", () => {
  const login = baca(LOGIN_PAGE);
  const daftar = baca(SIGNUP_PAGE);

  it("tautan 'Daftar' muncul karena KODE sebab, bukan karena kalimatnya", () => {
    expect(login).toContain("SEBAB_LOGIN.takTerdaftar");
    expect(login).toContain('from "@kakarut/shared"');
    // Layar ini TIDAK boleh menyentuh kalimatnya sama sekali untuk bercabang:
    // kalimat yang bergeser sedikit di server akan membuat tautannya berhenti
    // muncul tanpa satu uji pun merah.
    expect(login).not.toContain("PESAN_LOGIN");
    // `includes("...")` atas kalimat yang diketik ulang adalah cara paling
    // sunyi kehilangan tautan ini — bentuk itu sudah ada sekali di berkas
    // yang sama (`belum diverifikasi`), dan tak boleh bertambah.
    expect(login.match(/\.includes\(/g) ?? []).toHaveLength(1);
  });

  it("tautannya MEMBAWA emailnya, dan layar daftar benar-benar membacanya", () => {
    expect(login).toContain("/daftar?email=${encodeURIComponent(email)}");
    // Tautan yang berjanji "email ini" lalu membuka formulir kosong berbohong.
    expect(daftar).toContain("useSearchParams");
    expect(daftar).toMatch(/get\("email"\)/);
  });
});

describe("layar masuk PONSEL bercabang pada kode yang sama — bila repo itu ada", () => {
  /*
   * Ponsel tak bisa mengimpor `@kakarut/shared`, jadi `email_tak_dikenal` di
   * sana adalah SALINAN literal — dan salinan yang menyimpang tak berbunyi:
   * tombolnya cuma tak pernah muncul lagi. Yang mengikatnya ke sumber ada dua
   * lapis: fikstur `status-kontrak-server.txt` (sumber `konst:SEBAB_LOGIN`,
   * ditagih `status_cermin_server_test.dart` di ponsel) dan lengan ini, yang
   * membaca berkasnya langsung bila repo ponsel ter-checkout di sebelah.
   * Di CI repo ini repo ponsel tak ada → lewati, bukan merah.
   */
  const akar = new URL("../../../../kakarut-mobile/", import.meta.url);
  const bacaPonsel = (p: string): string | null => {
    try {
      return readFileSync(fileURLToPath(new URL(p, akar)), "utf8");
    } catch {
      return null;
    }
  };

  it("tombol 'Daftar' ponsel muncul karena KODE yang sama, membawa emailnya, dan tak menyalin kalimatnya", () => {
    const login = bacaPonsel("lib/features/auth/login_page.dart");
    const daftar = bacaPonsel("lib/features/auth/register_page.dart");
    if (login == null || daftar == null) return;
    const loginButa = butaKomentar(login);
    // Kodenya persis nilai `SEBAB_LOGIN.takTerdaftar` — bukan tebakan ejaan.
    expect(loginButa).toContain(`== '${SEBAB_LOGIN.takTerdaftar}'`);
    expect(loginButa).toContain("RegisterPage(emailAwal:");
    // Kalimatnya milik server; ponsel tak boleh mengendusnya untuk bercabang.
    expect(loginButa).not.toContain(PESAN_LOGIN.takTerdaftar);
    expect(loginButa).not.toMatch(/contains\(\s*['"][^'"]*terdaftar/);
    // Layar daftar benar-benar membaca alamat yang dibawa.
    expect(butaKomentar(daftar)).toContain("widget.emailAwal");
  });

  it("fikstur status ponsel memuat kode itu — jalur yang menagihnya di CI ponsel", () => {
    const fikstur = bacaPonsel("test/fikstur/status-kontrak-server.txt");
    if (fikstur == null) return;
    for (const v of Object.values(SEBAB_LOGIN)) {
      expect(fikstur.split("\n"), `konst:SEBAB_LOGIN|${v} hilang dari fikstur ponsel — regenerasi`).toContain(
        `konst:SEBAB_LOGIN|${v}`,
      );
    }
  });
});

describe("/lupa-password TIDAK ikut bicara", () => {
  const auth = baca(AUTH);
  const i = auth.indexOf('"/forgot-password"');
  const j = auth.indexOf('"/reset-password"', i);
  const handler = auth.slice(i, j);

  it("jangkarnya ada dan potongannya benar-benar berisi", () => {
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(handler).toContain("catatTakDicoba");
  });

  it("keempat keadaannya berakhir pada SATU balasan yang sama", () => {
    // Tiga lengan mencatat diam-diam, satu mengirim — dan semuanya jatuh ke
    // `return c.json({ ok: true` yang sama. Tak ada pesan, tak ada status
    // berbeda, jadi tak ada yang bisa dipanen dari luar.
    expect(handler).not.toContain("PESAN_LOGIN");
    expect(handler).not.toContain("HTTPException");
    expect(handler.match(/return c\.json\(/g) ?? []).toHaveLength(1);
    expect(handler).toContain("{ ok: true");
    expect(handler).not.toMatch(/message:/);
  });
});
