import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/acuan-status-mobile";

/**
 * ASAL-USUL FIKSTUR KONTRAK STATUS.
 *
 * Uji cermin `status_cermin_server_test.dart` di `mohteja/kakarut-mobile`
 * memeriksa bahwa tiap `status == '…'` di ponsel benar-benar ada di kontrak
 * server. Ia membacanya dari `test/fikstur/status-kontrak-server.txt`, yang
 * DIHASILKAN oleh `npm run acuan:status-mobile` di repo ini.
 *
 * Yang dijaga DI SINI adalah pembangkitnya — karena fikstur yang menyusut diam-
 * diam membuat uji di sana hijau tanpa menyatakan apa pun. Fikstur tipis tidak
 * menuduh siapa pun; ia hanya berhenti bisa menuduh.
 *
 * Tiga sumbernya perlu, dan itu TERUKUR bukan dugaan: sapuan pertama vena ini
 * hanya memungut `pgEnum` (78 nilai) dan langsung menuduh DUA BELAS literal
 * Dart yang semuanya sah — `"persen"`/`"nominal"` (tipe diskon), `"open_bill"`
 * (jenis pesanan), `"sedang_diproses"` (sebab galat) memang tak pernah jadi
 * enum Postgres.
 */
const AKAR = fileURLToPath(new URL("..", import.meta.url));

function jalankanPembangkit(): string {
  return execFileSync("npx", ["tsx", "src/scripts/acuan-status-mobile.ts"], {
    cwd: AKAR,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

describe("acuan:status-mobile — pembangkit fikstur kontrak status", () => {
  const keluaran = jalankanPembangkit();
  const baris = keluaran.split("\n").filter((l) => l.trim().length > 0);
  const sumber = new Set(baris.map((l) => l.split(":")[0].split("|")[0]));
  const nilai = new Set(baris.map((l) => l.split("|").pop()!));

  it("premis: pembangkitnya benar-benar mengeluarkan sesuatu", () => {
    expect(baris.length, "fikstur kosong = uji cermin di mobile jadi hampa").toBeGreaterThan(200);
  });

  it("KEEMPAT sumbernya terwakili, bukan hanya pgEnum", () => {
    // Kalau salah satu berhenti terbaca, fikstur menyusut dan uji di mobile
    // mulai menuduh kode yang benar — persis yang terjadi pada sapuan pertama.
    for (const s of ["enum", "zod", "kode", "union", "konst"]) {
      expect(sumber.has(s), `sumber "${s}" tak ada lagi di keluaran`).toBe(true);
    }
  });

  it("nilai yang mustahil hilang memang ada", () => {
    // Satu dari tiap sumber — jadi kegagalan satu jalur tak bisa menyamar
    // sebagai keluaran yang masih tampak wajar.
    expect(nilai.has("dikonfirmasi")).toBe(true); // pgEnum konfirmasi_status
    expect(nilai.has("bill_sudah_dibayar")).toBe(true); // union SebabPenjualanGagal
    expect(nilai.has("sedang_diproses")).toBe(true); // sebab: di rute
    expect(nilai.has("tunai")).toBe(true); // pgEnum metode_bayar
    expect(nilai.has("email_tak_dikenal")).toBe(true); // konst:SEBAB_LOGIN
  });

  it("sumber `konst` memungut KODE-nya saja, bukan kalimat di objek sebelahnya", () => {
    // `SEBAB_LOGIN` dan `PESAN_LOGIN` bertetangga di berkas yang sama dan
    // berbentuk sama persis (`as const`); yang membedakannya isinya. Kalimat
    // manusia yang ikut terpungut akan membuat fikstur status memuat prosa —
    // dan pemindai ponsel mulai "membenarkan" perbandingan terhadap kalimat.
    expect(baris).toContain("konst:SEBAB_LOGIN|email_tak_dikenal");
    expect(baris).toContain("konst:SEBAB_LOGIN|password_salah");
    expect(baris.filter((l) => l.startsWith("konst:PESAN_LOGIN|"))).toEqual([]);
  });

  it("pengupas komentarnya benar-benar mengupas — dan asersi ini BISA gagal", () => {
    /*
     * Versi pertama uji ini mencoba membuktikan pengupas itu perlu dengan
     * menghitung nilai `supply_beli_status`, dan tetap HIJAU saat pengupasnya
     * dicabut: komentar di sana mengutip `"diproses"`, yang kebetulan juga
     * nilai yang sah, jadi `Set` melipatnya. Nol beda pada keluaran — asersinya
     * tak bisa gagal, dan hijaunya tak berarti apa-apa.
     *
     * Yang diuji sekarang sifat pengupasnya langsung, dengan masukan yang
     * memang memancingnya: komentar yang mengutip nilai yang TIDAK ada di
     * lariknya. Tanpa pengupas, `"hantu"` ikut terbaca sebagai nilai enum.
     */
    const contoh = `pgEnum("uji", [\n  "a",\n  // catatan yang mengutip "hantu"\n  "b",\n]);`;
    const ambil = (t: string) => {
      const m = /pgEnum\(\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/.exec(t);
      return [...m![2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };
    expect(ambil(contoh)).toEqual(["a", "hantu", "b"]);
    expect(ambil(butaKomentar(contoh))).toEqual(["a", "b"]);
    // …dan posisi barisnya tak bergeser, supaya nomor baris tetap benar
    expect(butaKomentar(contoh).split("\n").length).toBe(contoh.split("\n").length);
  });

  it("fikstur yang TERSIMPAN di repo mobile masih cocok — bila repo itu ada", () => {
    /*
     * Di CI repo ini, `kakarut-mobile` tidak di-checkout, jadi uji ini melewati
     * dirinya sendiri alih-alih merah. Itu disebut apa adanya: yang menjaga
     * kesegaran fikstur di sana adalah CI repo SANA. Di mesin yang punya
     * keduanya (tempat perubahan ini ditulis), ia menangkap fikstur basi
     * sebelum ter-commit.
     */
    const p = new URL("../../../../kakarut-mobile/test/fikstur/status-kontrak-server.txt", import.meta.url);
    let tersimpan: string;
    try {
      tersimpan = readFileSync(fileURLToPath(p), "utf8");
    } catch {
      return; // repo mobile tak ada di sini — bukan kegagalan
    }
    expect(
      tersimpan.trim(),
      "fikstur di repo mobile sudah basi — jalankan `npm run --silent " +
        "acuan:status-mobile -w @kakarut/server > " +
        "../kakarut-mobile/test/fikstur/status-kontrak-server.txt`",
    ).toBe(keluaran.trim());
  });
});
