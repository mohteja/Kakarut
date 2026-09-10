import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DETAIL,
  KECUALI,
  RUTE,
  adu,
  aduRekaman,
  kontrakTipe,
  petaSidik,
  petik,
  sah,
} from "./util/adu-tipe-kawat";
import { semuaRute } from "./util/rute";

/**
 * PENJAGA ATAS PENJAGA: `adu-tipe-kawat` harus DIPANGGIL, dan tak boleh rabun.
 *
 * Alatnya sendiri hidup di kawat — ia butuh server yang berjalan, jadi
 * rumahnya verify-api §309, bukan berkas ini. Yang dijaga DI SINI adalah tiga
 * hal yang tak bisa dilihat dari satu jalan verify-api mana pun:
 *
 *   1. **verify-api benar-benar memanggilnya.** Suite Playwright di repo ini
 *      pernah membusuk bertahun-tahun persis karena tak ada yang
 *      menjalankannya; `ci-menjalankan-semua-suite` lahir dari situ. Alat yang
 *      tak dipanggil bukan jaring pengaman, cuma berkas.
 *   2. **Daftar rutenya tak boleh tertinggal dari rutenya.** Sapuan yang
 *      menyusut LULUS tanpa memeriksa apa pun — bentuk kegagalan yang sudah
 *      menggigit repo ini berkali-kali. Karena itu yang dipaku bukan "≥ sekian"
 *      melainkan SAMA PERSIS dengan daftar GET tanpa parameter.
 *   3. **Penilainya tak boleh MENEBAK.** `sah()` memulangkan `undefined` untuk
 *      anotasi yang tak bisa dinilai dari JSON saja (union bernama, interface
 *      bersarang) — dan `adu` memperlakukannya sebagai LOLOS. Penjaga yang
 *      menebak akan menuduh kode yang benar, dan tuduhan palsu mengajari orang
 *      mengabaikannya.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));

describe("verify-api memanggil pembanding tipe kawat", () => {
  const vapi = readFileSync(AKAR + "scripts/verify-api.sh", "utf8");

  it("§309 ada, dan memanggil berkas alatnya dengan jalur yang benar", () => {
    expect(vapi).toContain("apps/server/test/util/adu-tipe-kawat.ts");
    expect(vapi).toContain("§309");
    // PASANGAN-nya ikut dipanggil: tanpa `--uji-diri`, "0 selisih" tak
    // membedakan penjaga yang bekerja dari penjaga yang mati.
    expect(vapi).toContain("--uji-diri");
  });

  it("ketiga peran dioper — kalau satu hilang, rutenya diam-diam dilewati", () => {
    /*
     * `RUTE` melewati entri yang tokennya tak diberikan, TANPA menggagalkan
     * apa pun. Itu benar untuk sebuah alat (ia bisa dijalankan dengan satu
     * peran saja), tapi salah untuk gerbangnya — dan lengan "terambil ==
     * daftarnya" di §309 baru bisa merah kalau ketiganya memang dioper.
     */
    for (const bendera of ["--owner", "--sa", "--kasir"]) {
      expect(vapi, `${bendera} tak dioper §309`).toContain(bendera);
    }
    // Token kasir HARUS yang diterbitkan ulang: `$KASIR` MATI sejak §105
    // (ganti password menaikkan token_version), dan kematiannya menyamar jadi
    // gerbang peran yang bocor — pelajaran §303.
    expect(vapi).toMatch(/--kasir "\$REISS105"/);
  });
});

describe("rekaman balasan (`ADU_TIPE=`) — jalur yang menjangkau rute TULIS", () => {
  const vapi = readFileSync(AKAR + "scripts/verify-api.sh", "utf8");
  const app = readFileSync(AKAR + "apps/server/src/app.ts", "utf8");
  const ci = readFileSync(AKAR + ".github/workflows/ci.yml", "utf8");

  it("middleware perekamnya ada, MATI secara bawaan, dan berbatas dua arah", () => {
    /*
     * Alat ukur yang tak berbatas berhenti jadi alat ukur: rekaman tanpa
     * langit-langit menumbuhkan berkas ratusan MB pada jalan verify-api, dan
     * badan raksasa membuat pembandingnya jadi jalur yang paling lambat.
     * Keduanya dipaku — dan "mati secara bawaan" dipaku juga, sebab jalur ini
     * TIDAK boleh hidup di produksi.
     */
    expect(app).toContain("const aduBerkas = process.env.ADU_TIPE;");
    expect(app).toContain("if (aduBerkas) {");
    expect(app).toMatch(/const MAKS_REKAM_PER_RUTE = \d+;/);
    expect(app).toMatch(/const MAKS_BADAN_BYTE = /);
    // Badan balasan aliran SEKALI PAKAI — alat ukur yang mengonsumsi yang
    // diukurnya bukan alat ukur.
    expect(app).toContain("c.res.clone()");
    // Hanya JSON: aliran berkas & HTML tak punya bentuk untuk diadu.
    expect(app).toContain('tipe.includes("application/json")');
  });

  it("§311 ada di verify-api dan membaca rekamannya", () => {
    expect(vapi).toContain("§311");
    expect(vapi).toContain("--berkas");
    expect(vapi).toContain('REKAM311="${ADU_TIPE:-/tmp/adu-tipe.jsonl}"');
    // Rekaman yang HILANG harus MERAH, bukan dilewati — seksi yang melewati
    // dirinya sendiri adalah seksi yang berhenti bisa menuduh.
    expect(vapi).toContain("rekaman balasan TIDAK ADA");
  });

  it("CI benar-benar menyalakannya — di server DAN di verify-api", () => {
    // Tanpa jangkar ini, `ADU_TIPE=` bisa dicabut dari ci.yml dan §311 diam
    // seketika: rekamannya kosong, dan seksinya cuma melapor "tidak ada".
    // Kelas yang sama dengan suite Playwright yang membusuk bertahun-tahun.
    expect(ci, "ADU_TIPE tak dinyalakan saat server diboot").toMatch(/ADU_TIPE=\S+\s*\\?\s*\n?\s*npm run start/);
    expect(ci, "ADU_TIPE tak dioper ke verify-api").toContain("ADU_TIPE=/tmp/adu-tipe.jsonl bash scripts/verify-api.sh");
  });

  it("pembacanya melewati badan galat & yang dilewati, dan menuduh yang salah tipe", () => {
    const kontrak = kontrakTipe();
    const sidik = petaSidik(kontrak);
    const baris = (o: unknown) => JSON.stringify(o);
    const isi = [
      // badan galat 4xx: bentuknya `{error}`, dipaku dari sisi lain
      baris({ metode: "GET", pola: "/api/x", status: 404, badan: '{"error":"tak ada"}' }),
      // rekaman yang dilewati karena badannya raksasa
      baris({ metode: "GET", pola: "/api/y", status: 200, lewat: "terlalu besar" }),
      // yang benar
      baris({
        metode: "GET",
        pola: "/api/stok/awal",
        status: 200,
        badan: '{"tanggal":"2026-09-11","items":[{"ingredient_id":"a","qty":1,"tanggal":"2026-09-11"}]}',
      }),
      // yang SALAH tipe
      baris({
        metode: "POST",
        pola: "/api/stok/awal",
        status: 200,
        badan: '{"tanggal":"2026-09-11","items":[{"ingredient_id":"a","qty":"1","tanggal":"2026-09-11"}]}',
      }),
    ].join("\n");
    const r = aduRekaman(isi, kontrak, sidik);
    expect(r.baris).toBe(4);
    expect(r.lewat).toBe(1);
    expect(r.pola.has("GET /api/stok/awal")).toBe(true);
    expect(r.pola.has("GET /api/x"), "badan galat tak boleh ikut dihitung").toBe(false);
    expect(r.hasil.selisih.map((s) => `${s.rute} ${s.iface}.${s.medan}`)).toEqual([
      "POST /api/stok/awal StokAwalItem.qty",
    ]);
  });

  it("…dan menuduh stempel salah bentuk dari rekaman juga", () => {
    const kontrak = kontrakTipe();
    const sidik = petaSidik(kontrak);
    const isi = JSON.stringify({
      metode: "POST",
      pola: "/api/z",
      status: 201,
      badan: '{"waktu":"Thu Sep 10 2026 14:37:32 GMT+0000 (Coordinated Universal Time)"}',
    });
    const r = aduRekaman(isi, kontrak, sidik);
    expect(r.stempel.map((t) => t.jalur)).toEqual(["waktu"]);
  });
});

describe("daftar rute pembanding == SELURUH GET, sama persis", () => {
  /*
   * Sampai 2026-09-11 uji ini cuma menagih GET TANPA PARAMETER (72), dan
   * **38 rute detail** (`:id`) tak pernah tersapu siapa pun — justru di
   * sanalah bentuk terkaya tinggal (`OpenBillDetail`, `SupplierKartu`,
   * `CustomerDetail`, `ShiftDetail`). Sekarang ketiga daftar itu — `RUTE`,
   * `DETAIL`, `KECUALI` — harus MENUTUP seluruh GET, dua arah.
   */
  const jalurGet = semuaRute().filter((r) => r.metode === "GET").map((r) => r.jalur);
  const tanpaParam = new Set(RUTE.map((r) => r.jalur.split("?")[0]));
  const berparam = new Set(DETAIL.map((r) => r.jalur));
  const kecuali = new Set(Object.keys(KECUALI));
  const tercakup = new Set([...tanpaParam, ...berparam, ...kecuali]);

  it("PREMIS: ketiganya berisi, dan rute berparameter memang ada", () => {
    expect(jalurGet.length).toBeGreaterThan(100);
    expect(tanpaParam.size).toBeGreaterThan(60);
    expect(berparam.size).toBeGreaterThan(30);
    expect(jalurGet.filter((j) => j.includes(":")).length).toBeGreaterThan(30);
  });

  it("INTI: tak ada GET yang luput dari sapuan", () => {
    const luput = jalurGet.filter((j) => !tercakup.has(j)).sort();
    expect(
      luput,
      "rute GET baru tak masuk `RUTE`/`DETAIL` di `adu-tipe-kawat.ts` — balasannya " +
        "tak pernah diadu dengan kontraknya. Tambahkan barisnya (dengan peran " +
        "yang benar; untuk `:id`, sebut rute daftar tempat idnya dipetik), atau " +
        "catat di `KECUALI` DENGAN alasan:\n" + luput.join("\n"),
    ).toEqual([]);
  });

  it("INTI: tak ada entri daftar yang rutenya sudah tak ada", () => {
    const ada = new Set(jalurGet);
    const basi = [...tercakup].filter((j) => !ada.has(j)).sort();
    expect(basi, `entri basi di RUTE/DETAIL/KECUALI:\n${basi.join("\n")}`).toEqual([]);
  });

  it("tiap pengecualian punya ALASAN, bukan cuma jalur", () => {
    // Daftar pengecualian tanpa alasan pelan-pelan jadi tong sampah — dan
    // rute yang masuk ke sana diam-diam berhenti dijaga.
    for (const [jalur, alasan] of Object.entries(KECUALI)) {
      expect(alasan.length, `${jalur} tercatat tanpa alasan yang memadai`).toBeGreaterThan(30);
    }
  });

  it("tiap rute detail menyebut rute daftar yang BENAR-BENAR disapu", () => {
    /*
     * Id dipetik dari kawat, bukan fikstur — jadi rute daftarnya harus ikut
     * diambil pada jalan yang sama. Kalau ia sendiri tak ada di `RUTE`,
     * pemetikannya bergantung pada permintaan yang tak pernah diuji.
     */
    const yatim = DETAIL.filter((d) => !tanpaParam.has(d.dari)).map((d) => `${d.jalur} ← ${d.dari}`);
    expect(yatim, `rute daftar sumber id tak ada di \`RUTE\`:\n${yatim.join("\n")}`).toEqual([]);
  });

  it("PASANGAN: `petik` menemukan baris pertama yang BERISI, bukan baris [0]", () => {
    // Baris [0] `/produksi` ber-`faktur_id` null; versi pertama pemetik ini
    // melaporkan "id tak ditemukan" untuk data yang jelas ada.
    expect(petik({ rows: [{ id: null }, { id: "b2" }] }, "rows[].id")).toBe("b2");
    expect(petik([{ id: "a1" }], "[].id")).toBe("a1");
    expect(petik({ items: [] }, "items[].id")).toBeNull();
    expect(petik({ rows: [{ id: 7 }] }, "rows[].id")).toBeNull();
  });
});

describe("penilai tipe: menuduh yang salah, dan TIDAK menebak", () => {
  const kontrak = kontrakTipe();
  const sidik = petaSidik(kontrak);

  it("PREMIS: kontraknya terbaca dari pohon sintaks, bukan tipis", () => {
    expect(kontrak.size).toBeGreaterThan(150);
    expect(sidik.size).toBeGreaterThan(150);
    // satu medan yang bentuknya diketahui, dibaca apa adanya dari sumber
    const item = kontrak.get("StokAwalItem");
    expect(item?.map((m) => `${m.nama}:${m.tipe}`)).toEqual([
      "ingredient_id:string",
      "qty:number",
      "tanggal:string",
    ]);
  });

  it("skalar dinilai benar, di kedua arah", () => {
    expect(sah("number", 1)).toBe(true);
    expect(sah("number", "1")).toBe(false);
    expect(sah("string", "x")).toBe(true);
    expect(sah("string", 1)).toBe(false);
    expect(sah("boolean", false)).toBe(true);
    expect(sah("boolean", 0)).toBe(false);
    expect(sah("string | null", null)).toBe(true);
    expect(sah("string | null", 1)).toBe(false);
    expect(sah("number[]", [1])).toBe(true);
    expect(sah("number[]", 1)).toBe(false);
  });

  it("anotasi yang TAK BISA dinilai dari JSON memulangkan undefined, bukan false", () => {
    // Union bernama & interface bersarang: nilainya string/objek yang sah,
    // tapi SAH-nya tak bisa diputuskan tanpa mengurai tipe itu juga. Menebak
    // `false` di sini akan menuduh seluruh balasan berenum.
    expect(sah("KonfirmasiStatus", "menunggu")).toBeUndefined();
    expect(sah("CompanyDto", { id: "x" })).toBeUndefined();
    // …dan campuran: satu cabang terbaca, satu tidak → tetap tak menuduh
    expect(sah("KonfirmasiStatus | null", "apa pun")).toBeUndefined();
    expect(sah("KonfirmasiStatus | null", null)).toBe(true);
  });

  it("INTI: objek yang tersidik diadu, yang tak tersidik dilewati", () => {
    const benar = { tanggal: "2026-09-11", items: [{ ingredient_id: "x", qty: 1, tanggal: "2026-09-11" }] };
    expect(adu("uji", benar, kontrak, sidik).selisih).toEqual([]);
    const salah = { tanggal: "2026-09-11", items: [{ ingredient_id: "x", qty: "1", tanggal: "2026-09-11" }] };
    const h = adu("uji", salah, kontrak, sidik);
    expect(h.selisih.map((s) => `${s.iface}.${s.medan}`)).toEqual(["StokAwalItem.qty"]);
    expect(h.cocok.get("StokAwalTersimpan")).toBe(1);
    // bentuk yang tak cocok sidik mana pun: DILEWATI, bukan dituduh
    expect(adu("uji", { kunci_karangan: 1, lain_lagi: "x" }, kontrak, sidik).selisih).toEqual([]);
  });

  it("sidik yang cocok BEBERAPA interface dinilai permisif", () => {
    /*
     * Tiga sidik di repo ini dipakai dua interface (mis. `CustomerDetail` vs
     * `ShiftDetail`, keduanya `{transaksi, transaksi_terpotong}`). Menuduh atas
     * tebakan mana yang dimaksud adalah cara penjaga ini melahirkan tuduhan
     * palsu di hari pertamanya — jadi yang sah menurut SALAH SATU-nya lolos.
     */
    const tabrakan = [...petaSidik(kontrak).values()].filter((v) => v.length > 1);
    expect(tabrakan.length, "tak ada tabrakan sidik — asersi berikutnya hampa").toBeGreaterThan(0);
    const contoh = { transaksi: [], transaksi_terpotong: true };
    expect(adu("uji", contoh, kontrak, sidik).selisih).toEqual([]);
  });
});
