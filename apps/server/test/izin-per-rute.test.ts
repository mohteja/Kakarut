import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { seimbang, semuaRute, SRV, type Rute } from "./util/rute";

/**
 * SIAPA YANG EFEKTIF BISA MASUK TIAP PINTU — dan apakah itu disengaja.
 *
 * Pertanyaan paling dasar tentang sebuah pintu, dan ledger ini tak pernah
 * menjawabnya sekali pun: pengurungan tenant, pemilihan cabang, langit-langit
 * daftar, presisi angka — semuanya sudah disapu; matriks IZIN belum.
 *
 * Jawabannya tak bisa dibaca dari satu baris. Ia disusun dari TIGA sumber:
 *   1. penjaga prefiks di `app.ts` (`.use("/laporan/*", requireRole(…))`);
 *   2. `requireRole(…)` di rantai rutenya sendiri;
 *   3. ALIAS tingkat modul (`const bolehAturMeja = requireRole(…)`) — dan
 *      inilah yang membuat versi pertama pemindai ini menuduh EMPAT pintu meja
 *      secara palsu.
 *
 * Terukur lewat HTTP dengan token peran `bar` sungguhan (2026-08-25), dan
 * pengukurannya membantah pembacaan statis dua arah:
 *
 *   POST /meja · PATCH /meja/:id · PUT /meja/tata-letak · DELETE /meja/:id
 *     → 403 (dijaga alias `bolehAturMeja`, tak terlihat pemindai versi 1)
 *   POST /penyimpanan → **201**, dan barisnya ADA di `storage_locations`
 *   POST /supplier    → **201**, dan barisnya ADA di `suppliers`
 *
 * Dua yang terakhir temuannya, dan bentuknya tanda tangan repo ini: di kedua
 * modul, MENGUBAH master data sudah `requireRole("owner","admin")`
 * (`PATCH /:id`, `PUT /:id/petugas`), sementara MEMBUATnya terbuka untuk
 * keenam peran. Aturannya sudah ditulis di pintu sebelah.
 *
 * SESUDAH: `bar` → 403, `owner` → 201 (pasangan).
 */
const PERAN = ["owner", "admin", "cashier", "tim", "kitchen", "bar"] as const;
type Peran = (typeof PERAN)[number];

/**
 * Penjaga prefiks di `app.ts`, dibaca dengan kurung SEIMBANG.
 *
 * Versi pertama memakai `\.use\(\s*"([^"]+)"\s*,\s*([^)]*)\)` — dan `[^)]*`
 * berhenti di `)` PERTAMA, jadi `requireRole("owner", "admin")` tak pernah
 * terbaca: 3 dari 15 penjaga terlihat, dan `/laporan/*` tercatat terbuka untuk
 * keenam peran. Uji PREMIS di bawah memaku jumlahnya supaya kebutaan itu tak
 * bisa kembali diam-diam.
 */
export function penjagaPrefiks(app: string): { prefiks: string; peran: Set<string> }[] {
  const out: { prefiks: string; peran: Set<string> }[] = [];
  for (const m of app.matchAll(/\.use\(\s*"([^"]+)"/g)) {
    const jalur = m[1].replace(/\/\*$/, "");
    const mw = seimbang(app, app.indexOf("(", m.index!), "(", ")");
    let peran: Set<string> | null = null;
    const rr = mw.match(/requireRole\(([^)]*)\)/);
    if (rr) peran = new Set([...rr[1].matchAll(/"(\w+)"/g)].map((x) => x[1]));
    else if (mw.includes("izinkanProduksi"))
      peran = new Set(["owner", "admin", "tim", "kitchen", "bar"]);
    else if (mw.includes("izinkanManajemenAtauKaryawanCk"))
      peran = new Set(["owner", "admin", "tim"]);
    else if (mw.includes("requireSuperAdmin")) peran = new Set(["super"]);
    if (peran) out.push({ prefiks: jalur, peran });
  }
  return out;
}

/** Alias tingkat modul: `const bolehAturMeja = requireRole("owner","admin","cashier")`. */
export function aliasPeran(src: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const a of src.matchAll(/const (\w+)\s*=\s*requireRole\(([^)]*)\)/g)) {
    m.set(a[1], new Set([...a[2].matchAll(/"(\w+)"/g)].map((x) => x[1])));
  }
  return m;
}

const cacheAlias = new Map<string, Map<string, Set<string>>>();
function aliasBerkas(berkas: string): Map<string, Set<string>> {
  let m = cacheAlias.get(berkas);
  if (!m) {
    m = aliasPeran(butaKomentar(readFileSync(berkas, "utf8")));
    cacheAlias.set(berkas, m);
  }
  return m;
}

export function peranEfektif(
  r: Rute,
  guards: { prefiks: string; peran: Set<string> }[],
  alias: Map<string, Set<string>>,
): string[] {
  let peran = new Set<string>(PERAN);
  for (const g of guards) {
    if (r.jalur === g.prefiks || r.jalur.startsWith(`${g.prefiks}/`)) {
      if (g.peran.has("super")) return ["super"];
      peran = new Set([...peran].filter((x) => g.peran.has(x)));
    }
  }
  for (const rr of r.isi.matchAll(/requireRole\(([^)]*)\)/g)) {
    const set = new Set([...rr[1].matchAll(/"(\w+)"/g)].map((x) => x[1]));
    peran = new Set([...peran].filter((x) => set.has(x)));
  }
  for (const [nama, set] of alias) {
    if (new RegExp(`\\b${nama}\\b`).test(r.isi)) {
      peran = new Set([...peran].filter((x) => set.has(x)));
    }
  }
  return [...peran].sort();
}

/**
 * Prefiks yang pintu TULIS-nya memang terbuka untuk keenam peran — beserta
 * alasan yang bisa diperiksa. Ini bukan daftar "belum sempat": tiap baris
 * sudah ditembak dengan token peran `bar` dan diadjudikasi.
 */
const TERBUKA_SENGAJA = new Map<string, string>([
  ["/auth", "pra-otentikasi: login, daftar, reset & verifikasi email"],
  ["/onboarding", "menerima/menolak undangan & membuat perusahaan sendiri"],
  ["/absensi", "absen milik sendiri — penjaga prefiksnya memang keenam peran"],
  ["/profil", "kata sandi & profil milik sendiri"],
  ["/pesanan", "dapur/bar menandai sajian — penjaga prefiksnya keenam peran"],
  ["/kebersihan", "ceklis kebersihan dikerjakan semua peran (penjaga prefiks)"],
  ["/pengajuan", "pengajuan cuti/izin milik sendiri (penjaga prefiks)"],
  ["/transfer-stok", "kiriman antar-cabang, terikat cabang pemakainya"],
  ["/sync", "antrean offline ponsel — dipakai semua peran"],
  ["/upload", "foto bukti untuk tugas masing-masing peran"],
  ["/print", "mencetak dari perangkat peran mana pun"],
  ["/menu", "HANYA `PUT /menu/urutan`; handler-nya menulis sendiri bahwa rute ini boleh diakses semua peran termasuk kasir"],
  ["/stok", "opname & waste: rute-nya ber-`requireRole` keenam peran secara EKSPLISIT"],
  ["/perlengkapan", "pakai/opname/minta/terima perlengkapan — operasional harian tiap peran, terikat cabang"],
  ["/penerimaan", "menerima kiriman di cabang — operasional, terikat cabang penerima"],
]);

describe("matriks izin per rute", () => {
  const app = butaKomentar(readFileSync(join(SRV, "app.ts"), "utf8"));
  const guards = penjagaPrefiks(app);
  const rute = semuaRute();
  const matriks = rute.map((r) => ({
    ...r,
    peran: peranEfektif(r, guards, aliasBerkas(r.berkas)),
  }));
  const terbukaSemua = matriks.filter((m) => m.peran.length === PERAN.length);
  const tulisTerbuka = terbukaSemua.filter((m) => m.metode !== "GET");

  it("PREMIS: ketiga sumber penjaga benar-benar terbaca", () => {
    // Pemindai yang buta sebagian melaporkan angka, dan angkanya salah:
    // versi pertama melihat 3 dari 15 penjaga prefiks dan menyatakan
    // `/laporan/*` terbuka untuk keenam peran.
    expect(rute.length, "daftar rute kosong").toBeGreaterThan(250);
    expect(guards.length, "penjaga prefiks tak terbaca").toBeGreaterThanOrEqual(15);
    expect(
      guards.filter((g) => g.peran.size < PERAN.length).length,
      "tak satu pun penjaga yang MEMBATASI terbaca",
    ).toBeGreaterThanOrEqual(8);
    expect(terbukaSemua.length, "tak ada rute terbuka — pemindainya rusak").toBeGreaterThan(0);
  });

  it("DETEKTOR TERBUKI: ketiga bentuk penjaga diklasifikasi benar", () => {
    const g = penjagaPrefiks('x.use("/laporan/*", requireRole("owner", "admin"));');
    expect(g).toHaveLength(1);
    expect([...g[0].peran].sort()).toEqual(["admin", "owner"]);
    expect([...aliasPeran('const boleh = requireRole("owner", "cashier");').get("boleh")!].sort()).toEqual(
      ["cashier", "owner"],
    );
    const rutePalsu: Rute = {
      metode: "POST",
      jalur: "/palsu",
      res: false,
      isi: '"/", boleh, async (c) => {}',
      berkas: "x.ts",
    };
    expect(peranEfektif(rutePalsu, [], aliasPeran('const boleh = requireRole("owner");'))).toEqual([
      "owner",
    ]);
    // tanpa penjaga apa pun → keenam peran
    expect(
      peranEfektif({ ...rutePalsu, isi: '"/", async (c) => {}' }, [], new Map()),
    ).toHaveLength(PERAN.length);
  });

  it("tiap pintu TULIS yang terbuka untuk semua peran sudah diadjudikasi", () => {
    const asing = tulisTerbuka.filter(
      (m) => !TERBUKA_SENGAJA.has(`/${m.jalur.split("/")[1] ?? ""}`),
    );
    expect(
      asing.map((m) => `${m.metode} ${m.jalur}`),
      "pintu TULIS baru terbuka untuk keenam peran. Pasang `requireRole` " +
        "seperti pintu sebelahnya, ATAU daftarkan prefiksnya di TERBUKA_SENGAJA " +
        "beserta alasan yang bisa diperiksa — dan tembak dulu dengan token peran " +
        "terlemah sebelum menyebutnya sengaja",
    ).toEqual([]);
  });

  it("MEMBUAT master data terkunci sama seperti MENGUBAHnya", () => {
    // Temuan putaran ini, dipaku sebagai perilaku: `POST /penyimpanan` dan
    // `POST /supplier` sempat terbuka untuk keenam peran sementara `PATCH /:id`
    // di berkas yang sama sudah owner/admin. Terukur: token `bar` → 201 dan
    // barisnya benar-benar ada; sesudah diperbaiki → 403, owner tetap 201.
    const buat = (jalur: string) =>
      matriks.find((m) => m.metode === "POST" && m.jalur === jalur)?.peran;
    // KASIR sengaja tetap boleh membuat penyimpanan — §191 verify-api sudah
    // memaku kontraknya berpasangan ("cabang SENDIRI tetap boleh", "cabang
    // lain 403"), dan pengetatan pertamaku ke owner/admin saja MEMATAHKANNYA.
    // Yang ditutup: `tim`, `kitchen`, `bar`.
    expect(buat("/penyimpanan"), "/penyimpanan kembali terbuka").toEqual([
      "admin",
      "cashier",
      "owner",
    ]);
    expect(buat("/supplier"), "/supplier kembali terbuka").toEqual(["admin", "owner"]);
  });

  it("daftar pengecualiannya masih ADA — bukan kuburan prefiks basi", () => {
    const prefiksTerbuka = new Set(tulisTerbuka.map((m) => `/${m.jalur.split("/")[1] ?? ""}`));
    for (const p of TERBUKA_SENGAJA.keys()) expect(prefiksTerbuka, p).toContain(p);
  });

  it("pintu manajemen tetap terkunci — pasangan anti-hijau-palsu", () => {
    // Kalau gerbang ini kelak dilonggarkan sampai semuanya lolos, baris ini
    // yang menahannya: pintu yang memang harus terkunci wajib tetap terkunci.
    const kunci = (metode: string, jalur: string) =>
      matriks.find((m) => m.metode === metode && m.jalur === jalur)?.peran ?? [];
    expect(kunci("GET", "/laporan")).toEqual(["admin", "owner"]);
    expect(kunci("GET", "/customer")).toEqual(["admin", "owner"]);
    expect(kunci("PATCH", "/supplier/:id")).toEqual(["admin", "owner"]);
    expect(kunci("PATCH", "/penyimpanan/:id")).toEqual(["admin", "owner"]);
  });
});
