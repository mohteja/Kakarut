import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jelajah, uraikan, type Simpul } from "./ast";

/**
 * TIPE NILAI DI KAWAT DIADU DENGAN TIPE DI KONTRAK.
 *
 * Sembilan putaran memaku KUNCI balasan dua arah — `selisih296` di verify-api,
 * `medanInterface` di suite statis, fikstur ponsel. Tak satu pun dari semuanya
 * pernah menanyakan TIPE NILAINYA. `qty: "15000"` alih-alih `15000` lolos
 * setiap penjaga yang ada: kuncinya benar, jumlahnya benar, namanya benar.
 *
 * Dan itu bukan kekhawatiran teoretis. Baris `db.execute(sql\`…\`)` memulangkan
 * `Record<string, unknown>` — tak ada tipe sama sekali — jadi `satisfies` di
 * rutenya tak menjamin apa pun tentang isinya. Yang menjaga bahwa `numeric`
 * jadi `number` cuma SATU BARIS di `db/client.ts`:
 *
 *     pg.types.setTypeParser(1700, (v: string) => parseFloat(v));
 *
 * OID 20 (`int8`/`bigint`) TIDAK terdaftar, dan itu terukur: `count(*)` dari
 * SQL mentah memulangkan `"235"` — sebuah STRING. Repo ini lolos hari ini
 * karena tiap situsnya menulis `Number(...)` atau `::int` dengan tangan.
 * "Dengan tangan" persis keadaan yang gerbang ada untuk menggantikan.
 *
 * CARA KERJANYA — tanpa perlu peta rute→tipe, yang memang belum ada:
 * tiap objek di balasan disidik dari HIMPUNAN KUNCI-nya; bila sidik itu cocok
 * PERSIS satu (atau beberapa) interface di `types.ts`, tiap medannya diadu
 * dengan tipe yang dideklarasikan di sana. Objek yang tak cocok sidik mana pun
 * DILEWATI, dan itu batas yang disebut, bukan disembunyikan: ia justru
 * populasi vena "amplop tanpa kontrak".
 *
 * Kontraknya dibaca dari POHON SINTAKS (`./ast`), bukan regex — ledger ini
 * mencatat harga pengurai yang dikira-kira di lima tempat berbeda.
 */
const TIPE = fileURLToPath(new URL("../../../../packages/shared/src/types.ts", import.meta.url));

export interface Medan {
  nama: string;
  opsional: boolean;
  /** teks anotasi tipenya, apa adanya dari sumber */
  tipe: string;
}

/** interface di `types.ts` → medannya. */
export function kontrakTipe(sumber?: string): Map<string, Medan[]> {
  const isi = sumber ?? readFileSync(TIPE, "utf8");
  const akar = uraikan(TIPE, isi);
  const out = new Map<string, Medan[]>();
  jelajah(akar, (n) => {
    if (n.type !== "TSInterfaceDeclaration" || n.id?.type !== "Identifier") return;
    const medan: Medan[] = [];
    for (const m of (n.body?.body ?? []) as Simpul[]) {
      if (m.type !== "TSPropertySignature" || m.key?.type !== "Identifier") continue;
      const t = m.typeAnnotation?.typeAnnotation as Simpul | undefined;
      medan.push({
        nama: m.key.name as string,
        opsional: Boolean(m.optional),
        tipe: t ? isi.slice(t.start, t.end).replace(/\s+/g, " ") : "",
      });
    }
    if (medan.length) out.set(n.id.name as string, medan);
  });
  return out;
}

/**
 * Apakah nilai JSON `v` sah bagi anotasi tipe `t`?
 *
 * `undefined` = TAK BISA DINILAI (nama tipe lain — union bernama, interface
 * bersarang). Itu dipulangkan apa adanya alih-alih ditebak: penjaga yang
 * menebak akan menuduh kode yang benar, dan tuduhan palsu mengajari orang
 * mengabaikannya.
 */
export function sah(t: string, v: unknown): boolean | undefined {
  const bag = t.split("|").map((x) => x.trim()).filter(Boolean);
  if (bag.length === 0) return undefined;
  let adaYangTakTerbaca = false;
  for (const b of bag) {
    if (b === "null") {
      if (v === null) return true;
    } else if (b === "undefined") {
      if (v === undefined) return true;
    } else if (b === "string" || /^["'].*["']$/.test(b)) {
      if (typeof v === "string") return true;
    } else if (b === "number") {
      if (typeof v === "number") return true;
    } else if (b === "boolean" || b === "true" || b === "false") {
      if (typeof v === "boolean") return true;
    } else if (b.endsWith("[]") || b.startsWith("Array<")) {
      if (Array.isArray(v)) return true;
    } else if (b.startsWith("Record<") || b === "object") {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return true;
    } else {
      adaYangTakTerbaca = true;
    }
  }
  return adaYangTakTerbaca ? undefined : false;
}

export interface Selisih {
  rute: string;
  iface: string;
  medan: string;
  tipe: string;
  nilai: string;
}

/** sidik kunci → interface yang berbentuk sama. */
export function petaSidik(kontrak: Map<string, Medan[]>): Map<string, string[]> {
  const sidik = new Map<string, string[]>();
  for (const [nm, md] of kontrak) {
    const k = md.map((m) => m.nama).sort().join(",");
    sidik.set(k, [...(sidik.get(k) ?? []), nm]);
  }
  return sidik;
}

/**
 * STEMPEL WAKTU YANG BUKAN ISO-8601 — kelas yang lolos SELURUH penjaga lain.
 *
 * `waktu` bertipe `string` di kontrak dan `string` di kawat, jadi pembanding
 * tipe di atas diam; kuncinya benar, jadi `selisih296` diam; fikstur ponsel
 * cuma tahu NAMA kunci. Yang membedakannya cuma ISI-nya.
 *
 * Yang dituduh SEMPIT dan disengaja: teks yang benar-benar terurai jadi
 * tanggal DAN berbentuk khas `Date.prototype.toString`/`toLocale*` — "GMT",
 * "Thu Sep 10 2026", "9/10/2026". Teks biasa yang kebetulan `Date.parse`
 * terima (mis. "5") TIDAK dituduh; penjaga yang menebak menuduh kode yang
 * benar.
 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const BENTUK_DATE_TOSTRING =
  /(GMT|UTC[+-]|^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4}|^\d{1,2}\/\d{1,2}\/\d{4})/;

export function stempelBukanIso(nilai: unknown): boolean {
  if (typeof nilai !== "string" || nilai.length < 8) return false;
  if (ISO_8601.test(nilai)) return false;
  return BENTUK_DATE_TOSTRING.test(nilai) && Number.isFinite(Date.parse(nilai));
}

export interface Stempel {
  rute: string;
  jalur: string;
  nilai: string;
}

/** Telusuri SELURUH nilai (bukan cuma objek yang tersidik) mencari stempel salah bentuk. */
export function sapuStempel(
  rute: string,
  v: unknown,
  keluar: Stempel[] = [],
  jalur = "",
  dalam = 0,
): Stempel[] {
  if (dalam > 8 || v === null) return keluar;
  if (Array.isArray(v)) {
    v.slice(0, 60).forEach((x, i) => sapuStempel(rute, x, keluar, `${jalur}[]`, dalam + 1));
    return keluar;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      sapuStempel(rute, x, keluar, jalur ? `${jalur}.${k}` : k, dalam + 1);
    }
    return keluar;
  }
  if (stempelBukanIso(v)) keluar.push({ rute, jalur, nilai: String(v) });
  return keluar;
}

export interface Hasil {
  selisih: Selisih[];
  /** interface → berapa objek yang tersidik jadi dia */
  cocok: Map<string, number>;
}

/**
 * Telusuri seluruh balasan; adu tiap objek yang tersidik.
 *
 * Sidik yang cocok BEBERAPA interface (tiga di repo ini, mis.
 * `CustomerDetail` vs `ShiftDetail`) dinilai PERMISIF: sah bila sah menurut
 * salah satunya. Menuduh atas tebakan mana yang dimaksud adalah cara penjaga
 * ini melahirkan tuduhan palsu di hari pertamanya.
 */
export function adu(
  rute: string,
  balasan: unknown,
  kontrak: Map<string, Medan[]>,
  sidik: Map<string, string[]>,
  hasil: Hasil = { selisih: [], cocok: new Map() },
  dalam = 0,
): Hasil {
  if (dalam > 8 || balasan === null || typeof balasan !== "object") return hasil;
  if (Array.isArray(balasan)) {
    for (const x of balasan.slice(0, 60)) adu(rute, x, kontrak, sidik, hasil, dalam + 1);
    return hasil;
  }
  const o = balasan as Record<string, unknown>;
  const nama = sidik.get(Object.keys(o).sort().join(","));
  if (nama) {
    hasil.cocok.set(nama[0], (hasil.cocok.get(nama[0]) ?? 0) + 1);
    for (const m of kontrak.get(nama[0]) as Medan[]) {
      const putusan = nama.map((nm) => {
        const md = (kontrak.get(nm) as Medan[]).find((x) => x.nama === m.nama);
        return md ? sah(md.tipe, o[m.nama]) : undefined;
      });
      if (putusan.some((p) => p !== false)) continue;
      hasil.selisih.push({
        rute,
        iface: nama.join("|"),
        medan: m.nama,
        tipe: m.tipe,
        nilai: `${typeof o[m.nama]} ${JSON.stringify(o[m.nama])?.slice(0, 50)}`,
      });
    }
  }
  for (const x of Object.values(o)) adu(rute, x, kontrak, sidik, hasil, dalam + 1);
  return hasil;
}

/**
 * RUTE YANG DISAPU — daftarnya di sini, bukan di bash, supaya bisa ditinjau
 * dan dijaga uji. Tiap entri `peran jalur`; peran memilih tokennya.
 */
export const RUTE: { peran: "owner" | "sa" | "kasir"; jalur: string }[] = [
  ...[
    "/absensi/status", "/absensi", "/absensi/rekap", "/auth/me", "/bahan",
    "/bahan/resep-ringkas", "/cabang", "/company", "/member-cari", "/customer",
    "/kategori", "/kategori-bahan", "/kebersihan/area", "/kebersihan/rekap",
    "/kebersihan/ringkas", "/kebersihan", "/laporan", "/laporan/pembelian",
    "/laporan/menu-laris", "/laporan/durasi-pesanan", "/laporan/bep?biaya_tetap=10000000",
    "/meja", "/meja/status", "/menu/panduan-markup", "/menu", "/menu/ketersediaan",
    "/menu/analisis-harga", "/onboarding/status", "/penerimaan", "/penerimaan/riwayat",
    "/penerimaan/anomali", "/pengajuan", "/penjualan", "/penyimpanan", "/perlengkapan",
    "/perlengkapan/belanja", "/perlengkapan/master", "/perlengkapan/opname/riwayat",
    "/perlengkapan/kiriman", "/perlengkapan/beli", "/pesanan", "/produksi", "/pembelian",
    "/profil", "/profil/aktivitas", "/rekomendasi/beli", "/rekomendasi/permintaan",
    "/sampah", "/satuan", "/shift/pantau", "/shift", "/shift/selisih",
    "/shift/selisih/ringkas", "/stok", "/stok/nilai", "/stok/exp", "/stok/awal",
    "/stok/penyesuaian", "/stok/opname/riwayat", "/stok/opname", "/supplier",
    "/transfer-stok/saldo", "/transfer-stok", "/karyawan", "/karyawan/undangan",
  ].map((jalur) => ({ peran: "owner" as const, jalur })),
  ...["/admin/error-log", "/admin/sistem", "/admin/sistem/backup", "/admin/sistem/smtp", "/admin/tenants"].map(
    (jalur) => ({ peran: "sa" as const, jalur }),
  ),
  ...["/open-bill", "/shift/aktif"].map((jalur) => ({ peran: "kasir" as const, jalur })),
];

/**
 * RUTE DETAIL (`:id`) — 38 dari 110 GET, dan sampai 2026-09-11 tak satu pun
 * pernah tersapu. Justru di sanalah bentuk terkaya tinggal: `OpenBillDetail`,
 * `SupplierKartu`, `RiwayatHargaDto`, `CustomerDetail`, `ShiftDetail`.
 *
 * IDNYA DIAMBIL DARI KAWAT, bukan dari fikstur. Itu syaratnya, bukan
 * kenyamanan: fikstur di dalam alat ukur adalah cara alat ukur mulai punya
 * pendapat sendiri tentang data yang benar. Tiap entri menyebut rute DAFTAR
 * yang memuat idnya dan jalan petiknya; `[]` berarti "baris PERTAMA yang
 * medannya berisi", sebab baris [0] `/produksi` ber-`faktur_id` null dan
 * versi pertama sapuan ini melaporkan "id tak ditemukan" untuk data yang
 * jelas ada.
 */
export interface RuteDetail {
  jalur: string;
  peran: "owner" | "sa" | "kasir";
  /** rute daftar tempat idnya dipetik, dan jalannya (mis. `rows[].faktur_id`) */
  dari: string;
  sel: string;
  /** nilai tetap untuk parameter kedua (mis. `:jenis` pada /pesanan) */
  tetap?: Record<string, string>;
}

/**
 * GET yang SENGAJA di luar sapuan, dengan alasannya. Daftar ini dibaca uji
 * cakupan: rute baru tak bisa lolos hanya karena tak ditulis di mana pun.
 */
export const KECUALI: Record<string, string> = {
  "/admin/sistem/backup/:id/unduh":
    "aliran BERKAS cadangan (octet-stream), bukan JSON — tak ada bentuk untuk diadu",
};

export const DETAIL: RuteDetail[] = [
  { jalur: "/admin/error-log/:sidik", peran: "sa", dari: "/admin/error-log", sel: "rows[].sidik" },
  { jalur: "/admin/tenants/:id", peran: "sa", dari: "/admin/tenants", sel: "[].id" },
  { jalur: "/bahan/:id/detail", peran: "owner", dari: "/bahan", sel: "[].id" },
  { jalur: "/bahan/:id/langkah", peran: "owner", dari: "/bahan", sel: "[].id" },
  { jalur: "/bahan/:id/pembelian", peran: "owner", dari: "/bahan", sel: "[].id" },
  { jalur: "/bahan/:id/resep", peran: "owner", dari: "/bahan", sel: "[].id" },
  { jalur: "/bahan/:id/riwayat-resep", peran: "owner", dari: "/bahan", sel: "[].id" },
  { jalur: "/bahan/:id/supplier", peran: "owner", dari: "/bahan", sel: "[].id" },
  { jalur: "/customer/:id", peran: "owner", dari: "/customer", sel: "items[].id" },
  { jalur: "/kebersihan/:id", peran: "owner", dari: "/kebersihan", sel: "[].id" },
  { jalur: "/karyawan/:userId/aktivitas", peran: "owner", dari: "/karyawan", sel: "[].user_id" },
  { jalur: "/karyawan/:userId/tempat", peran: "owner", dari: "/karyawan", sel: "[].user_id" },
  { jalur: "/meja/:id/log", peran: "owner", dari: "/meja", sel: "[].id" },
  { jalur: "/menu/:id", peran: "owner", dari: "/menu", sel: "[].id" },
  { jalur: "/menu/:id/riwayat-harga", peran: "owner", dari: "/menu", sel: "[].id" },
  { jalur: "/open-bill/:id", peran: "kasir", dari: "/open-bill", sel: "[].id" },
  { jalur: "/open-bill/:id/bon", peran: "kasir", dari: "/open-bill", sel: "[].id" },
  { jalur: "/open-bill/:id/slip", peran: "kasir", dari: "/open-bill", sel: "[].id" },
  { jalur: "/pembelian/dana/:fakturId", peran: "owner", dari: "/pembelian", sel: "rows[].faktur_id" },
  { jalur: "/pembelian/faktur/:fakturId", peran: "owner", dari: "/pembelian", sel: "rows[].faktur_id" },
  { jalur: "/pembelian/log/:fakturId", peran: "owner", dari: "/pembelian", sel: "rows[].faktur_id" },
  { jalur: "/penjualan/:id", peran: "owner", dari: "/penjualan", sel: "[].id" },
  { jalur: "/penjualan/:id/slip", peran: "owner", dari: "/penjualan", sel: "[].id" },
  { jalur: "/penyimpanan/:id/bahan", peran: "owner", dari: "/penyimpanan", sel: "[].id" },
  { jalur: "/perlengkapan/:id/kartu", peran: "owner", dari: "/perlengkapan", sel: "[].id" },
  { jalur: "/perlengkapan/:id/pembelian", peran: "owner", dari: "/perlengkapan", sel: "[].id" },
  { jalur: "/perlengkapan/:id/supplier", peran: "owner", dari: "/perlengkapan", sel: "[].id" },
  { jalur: "/perlengkapan/opname/sesi/:sessionId", peran: "owner", dari: "/perlengkapan/opname/riwayat", sel: "[].session_id" },
  { jalur: "/pesanan/:jenis/:id/log", peran: "owner", dari: "/pesanan", sel: "[].id", tetap: { jenis: "penjualan" } },
  { jalur: "/produksi/dana/:fakturId", peran: "owner", dari: "/produksi", sel: "rows[].faktur_id" },
  { jalur: "/produksi/faktur/:fakturId", peran: "owner", dari: "/produksi", sel: "rows[].faktur_id" },
  { jalur: "/produksi/log/:fakturId", peran: "owner", dari: "/produksi", sel: "rows[].faktur_id" },
  { jalur: "/shift/:id", peran: "owner", dari: "/shift", sel: "[].id" },
  { jalur: "/stok/fifo/:ingredientId", peran: "owner", dari: "/stok", sel: "[].ingredient_id" },
  { jalur: "/stok/kartu/:ingredientId", peran: "owner", dari: "/stok", sel: "[].ingredient_id" },
  { jalur: "/stok/opname/sesi/:sessionId", peran: "owner", dari: "/stok/opname/riwayat", sel: "[].session_id" },
  { jalur: "/supplier/:id/kartu", peran: "owner", dari: "/supplier", sel: "[].id" },
];

/**
 * Petik nilai teks pertama pada jalan `sel` (`rows[].faktur_id`, `[].id`, …).
 * `[]` memindai SELURUH lariknya sampai menemukan yang berisi.
 */
export function petik(v: unknown, sel: string): string | null {
  const seg = sel.split(".");
  const jalan = (cur: unknown, i: number): string | null => {
    if (cur === null || cur === undefined) return null;
    if (i >= seg.length) return typeof cur === "string" ? cur : null;
    const s = seg[i];
    if (s.endsWith("[]")) {
      const nm = s.slice(0, -2);
      const arr = nm ? (cur as Record<string, unknown>)[nm] : cur;
      if (!Array.isArray(arr)) return null;
      for (const x of arr) {
        const h = jalan(x, i + 1);
        if (h) return h;
      }
      return null;
    }
    return jalan((cur as Record<string, unknown>)[s], i + 1);
  };
  return jalan(v, 0);
}

async function utama(): Promise<void> {
  const arg = (n: string): string | undefined => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const kontrak = kontrakTipe();
  const sidik = petaSidik(kontrak);

  if (process.argv.includes("--uji-diri")) {
    // PASANGAN dari kawat: contoh yang SENGAJA salah tipe harus tertuduh, dan
    // yang benar harus lolos. Tanpa ini, "0 selisih" tak membedakan penjaga
    // yang bekerja dari penjaga yang mati.
    const benar = { tanggal: "2026-09-11", items: [{ ingredient_id: "x", qty: 1, tanggal: "2026-09-11" }] };
    const salah = { tanggal: "2026-09-11", items: [{ ingredient_id: "x", qty: "1", tanggal: "2026-09-11" }] };
    const a = adu("uji", benar, kontrak, sidik).selisih.length;
    const b = adu("uji", salah, kontrak, sidik).selisih.length;
    // …dan pemindai stempelnya: ISO lolos, keluaran `Date.toString` tertuduh.
    const c = sapuStempel("uji", { waktu: "2026-09-10T14:37:32.000Z" }).length;
    const d = sapuStempel("uji", {
      waktu: "Thu Sep 10 2026 14:37:32 GMT+0000 (Coordinated Universal Time)",
    }).length;
    process.stdout.write(`${a} ${b} ${c} ${d}\n`);
    process.exit(0);
  }

  const basis = arg("--basis") ?? "http://127.0.0.1:3000/api";
  const token: Record<string, string | undefined> = {
    owner: arg("--owner"),
    sa: arg("--sa"),
    kasir: arg("--kasir"),
  };
  const hasil: Hasil = { selisih: [], cocok: new Map() };
  const stempel: Stempel[] = [];
  let terambil = 0;
  const gagal: string[] = [];
  for (const r of RUTE) {
    const t = token[r.peran];
    if (!t) continue;
    const res = await fetch(basis + r.jalur, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      gagal.push(`${r.jalur} → ${res.status}`);
      continue;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      gagal.push(`${r.jalur} → bukan JSON`);
      continue;
    }
    terambil += 1;
    adu(r.jalur, body, kontrak, sidik, hasil);
    sapuStempel(r.jalur, body, stempel);
  }
  // ── rute detail: idnya dipetik dari daftar yang baru saja diambil ──
  const daftarCache = new Map<string, unknown>();
  let detailAmbil = 0;
  const detailKosong: string[] = [];
  for (const d of DETAIL) {
    const t = token[d.peran];
    if (!t) continue;
    const kunciCache = `${d.peran}${d.dari}`;
    if (!daftarCache.has(kunciCache)) {
      const r = await fetch(basis + d.dari, { headers: { Authorization: `Bearer ${t}` } });
      daftarCache.set(kunciCache, r.ok ? await r.json().catch(() => null) : null);
    }
    const id = petik(daftarCache.get(kunciCache), d.sel);
    if (!id) {
      // DB gerbang tak punya barisnya — dilaporkan, bukan dilewati diam-diam.
      detailKosong.push(`${d.jalur} (daftar ${d.dari} kosong)`);
      continue;
    }
    let jalur = d.jalur;
    for (const [nm, nilai] of Object.entries(d.tetap ?? {})) jalur = jalur.replace(`:${nm}`, nilai);
    jalur = jalur.replace(/:[A-Za-z]+/, id);
    const res = await fetch(basis + jalur, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      gagal.push(`${jalur} → ${res.status}`);
      continue;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      gagal.push(`${jalur} → bukan JSON`);
      continue;
    }
    detailAmbil += 1;
    adu(d.jalur, body, kontrak, sidik, hasil);
    sapuStempel(d.jalur, body, stempel);
  }

  for (const s of hasil.selisih) {
    process.stdout.write(`${s.iface}.${s.medan}: kontrak \`${s.tipe}\` · kawat ${s.nilai}  (${s.rute})\n`);
  }
  const unikStempel = new Map<string, Stempel>();
  for (const t of stempel) unikStempel.set(`${t.rute} ${t.jalur}`, t);
  for (const t of unikStempel.values()) {
    process.stdout.write(`STEMPEL ${t.rute} · ${t.jalur} = ${JSON.stringify(t.nilai)}\n`);
  }
  const objek = [...hasil.cocok.values()].reduce((a, b) => a + b, 0);
  process.stderr.write(
    `rute terambil ${terambil}/${RUTE.length} · detail ${detailAmbil}/${DETAIL.length} (kosong ${detailKosong.length})` +
      ` · interface tersidik ${hasil.cocok.size} · objek ${objek} · selisih ${hasil.selisih.length}` +
      ` · stempel salah bentuk ${unikStempel.size}\n`,
  );
  if (detailKosong.length) process.stderr.write(`  detail tanpa data: ${detailKosong.join(", ")}\n`);
  if (gagal.length) process.stderr.write(`  tak terambil: ${gagal.join(", ")}\n`);
  if (process.argv.includes("--ringkas")) {
    process.stdout.write(
      `RINGKAS ${terambil} ${RUTE.length} ${hasil.cocok.size} ${objek} ${hasil.selisih.length}` +
        ` ${unikStempel.size} ${detailAmbil} ${DETAIL.length} ${detailKosong.length}\n`,
    );
  }
  process.exit(hasil.selisih.length === 0 && unikStempel.size === 0 ? 0 : 1);
}

/*
 * Jalan HANYA bila berkas ini yang dijalankan langsung.
 *
 * Versi pertama memeriksa `process.argv.some(a => a.includes("adu-tipe-kawat"))`
 * — dan `test/adu-tipe-kawat.test.ts` MENGANDUNG teks itu, jadi mengimpornya
 * dari uji akan menjalankan sapuan penuh (dan `process.exit`) di tengah
 * vitest. Yang diperiksa sekarang berkas ENTRI-nya, bukan sembarang argumen.
 */
const entri = process.argv[1] ?? "";
if (/adu-tipe-kawat\.ts$/.test(entri)) void utama();
