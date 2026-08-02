import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Penjaga SEMAI-SEKALI: isian yang sedang diketik tak boleh ditimpa penyegaran.
 *
 * React Query menyegarkan ulang query yang BASI begitu jendela kembali fokus
 * atau jaringan tersambung lagi — keduanya menyala secara bawaan. Cek sendiri
 * di `query-core`: `shouldFetchOn` mengembalikan `true` bila nilainya `undefined`
 * dan query-nya basi, dan `staleTime` bawaan aplikasi ini 10 detik.
 *
 * Efek yang menyemai state lokal dari hasil query karena itu MENEMBAK ULANG.
 * Bila ia menyemai tanpa syarat, apa pun yang sedang diketik atau dicentang
 * kembali ke nilai server — diam-diam. Tak ada galat, tombol Simpan tetap
 * hidup, dan yang tersimpan adalah data LAMA. Berpindah aplikasi sebentar saja
 * (hal paling biasa di ponsel kasir) sudah cukup untuk memicunya.
 *
 * Repo ini sudah menemukan bahayanya berkali-kali dan menuliskannya di tempat
 * masing-masing — `LihatMenuPage` ("jangan timpa saat sedang diedit"),
 * `TransferStokPage` ("sengaja tidak menimpa pilihan yang SAH"), `MejaPage`
 * ("seretan yang belum disimpan tidak terhapus"). Tetap saja lima efek lolos
 * tanpa penjagaan sama sekali. Catatan bukan penjaga.
 *
 * YANG DIPATOK: setiap efek yang (a) memanggil setter dan (b) bergantung pada
 * hasil query harus terdaftar di bawah, berikut TANDA mekanismenya. Tanda itu
 * dicari di dalam tubuh efeknya — jadi menghapus penjagaan dari efek yang sudah
 * benar pun langsung merah, bukan cuma menambah efek baru.
 *
 * YANG TIDAK DIPATOK: bahwa mekanismenya benar. `dimuat.current` bisa saja tak
 * pernah di-set. Daftar ini memaksa keputusan sadar, bukan menggantikannya.
 */
const akar = fileURLToPath(new URL("../../web/src/", import.meta.url));

function semuaBerkas(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaBerkas(p + "/"));
    else if (nama.endsWith(".tsx") || nama.endsWith(".ts")) hasil.push(p);
  }
  return hasil;
}

type Jenis =
  /** menyemai state yang bisa diedit → WAJIB punya tanda semai-sekali */
  | "semai"
  /** kunci one-shot-nya ada di larik dependensi (skalar, bukan objek query) */
  | "kunci-dep"
  /** tidak menyemai isian: mendamaikan pilihan yang jadi tak sah, atau turunan */
  | "rekonsiliasi";

interface Entri {
  berkas: string;
  deps: string;
  jenis: Jenis;
  /** teks yang wajib ada di tubuh efek (hanya untuk jenis "semai") */
  tanda?: string;
  catatan: string;
}

const DIIZINKAN: Entri[] = [
  // ── menyemai isian yang bisa diedit ──────────────────────────────────────
  {
    berkas: "pages/resep/ResepPage.tsx",
    deps: "resepServer, selectedId",
    jenis: "semai",
    tanda: "resepTersemai.current === selectedId",
    catatan: "draft takaran resep — semai sekali per selectedId",
  },
  {
    berkas: "pages/resep/ResepPage.tsx",
    deps: "langkahServer, selectedId",
    jenis: "semai",
    tanda: "langkahTersemai.current === selectedId",
    catatan: "draft langkah masak — semai ulang juga melepas foto (_id baru)",
  },
  {
    berkas: "pages/resep/ResepPage.tsx",
    deps: "dipilih",
    jenis: "semai",
    tanda: "aturTersemai.current === (dipilih?.id ?? null)",
    catatan: "isi/overhead/stok minimum; `dipilih` dicari ulang dari daftar bahan",
  },
  {
    berkas: "pages/pengaturan/KaryawanPage.tsx",
    deps: "data, selected",
    jenis: "semai",
    tanda: "selected === null",
    catatan: "centang tempat SO; dua modal saudaranya menyemai lewat useState",
  },
  {
    berkas: "pages/pengaturan/PerusahaanPage.tsx",
    deps: "company",
    jenis: "semai",
    tanda: "tersemai.current) return",
    catatan: "nama/alamat/PB1; kartu Mode di atasnya meng-invalidate ['company']",
  },
  {
    berkas: "pages/menu/MenuFormPage.tsx",
    deps: "id, menuEdit",
    jenis: "semai",
    tanda: "dimuat.current || !menuEdit",
    catatan: "form menu saat mode ubah",
  },
  {
    berkas: "pages/bahan/SupplierBahanModal.tsx",
    deps: "terpasang, siap",
    jenis: "semai",
    tanda: "!siap",
    catatan: "pilihan supplier + supplier utama",
  },
  {
    berkas: "pages/bahan/UbahBahanBakuPage.tsx",
    deps: "bahan, ids, rows",
    jenis: "semai",
    tanda: "rows === null",
    catatan: "grid ubah bahan baku",
  },
  {
    berkas: "pages/superadmin/SmtpPage.tsx",
    deps: "data, form, auth",
    jenis: "semai",
    tanda: "form === null",
    catatan: "form SMTP",
  },
  {
    berkas: "pages/pengaturan/MejaPage.tsx",
    deps: "meja",
    jenis: "semai",
    tanda: "if (editingRef.current)",
    catatan: "posisi meja: saat mode edit, seretan yang belum disimpan digabung",
  },
  {
    berkas: "pages/menu/LihatMenuPage.tsx",
    deps: "menus, kategori, kategoriPending",
    jenis: "semai",
    tanda: "dirtyRef.current) return",
    catatan: "urutan menu — jangan timpa saat sedang diseret",
  },
  {
    berkas: "pages/stok/StokAwalPage.tsx",
    deps: "tersimpan",
    jenis: "semai",
    tanda: "terisiAwal.current || !tersimpan",
    catatan: "saldo pembuka + tanggalnya",
  },
  {
    berkas: "pages/bahan/DetailBahanPage.tsx",
    deps: "detail, branchSel",
    jenis: "semai",
    tanda: "branchSel) return",
    catatan: "cabang terpilih — pilihan yang sudah ada tak ditimpa",
  },
  {
    berkas: "pages/produksi/RekomendasiBeliPage.tsx",
    deps: "data, targetInited",
    jenis: "semai",
    tanda: "!targetInited",
    catatan: "target penjualan default dari server",
  },

  // ── kunci one-shot ada di larik dependensi (skalar, bukan objek query) ────
  {
    berkas: "pages/kebersihan/RekapKebersihanPage.tsx",
    deps: "detail?.id",
    jenis: "kunci-dep",
    catatan: "catatan owner; sekali per laporan, supaya bisa DIKOSONGKAN",
  },
  {
    berkas: "pages/profil/ProfilPage.tsx",
    deps: "profil?.employee_code",
    jenis: "kunci-dep",
    catatan: "gambar QR diturunkan dari kode, bukan isian",
  },

  // ── bukan penyemaian isian ───────────────────────────────────────────────
  {
    berkas: "pages/kasir/KasirPage.tsx",
    deps: "mejaId, mejaAktif",
    jenis: "rekonsiliasi",
    catatan: "lepaskan meja terpilih bila dinonaktifkan/dihapus dari master",
  },
  {
    berkas: "pages/produksi/PenerimaanPage.tsx",
    deps: "data, page, halamanAkhir",
    jenis: "rekonsiliasi",
    catatan: "jepit nomor halaman ke halaman terakhir yang ada",
  },
  {
    berkas: "pages/produksi/TambahStokPage.tsx",
    deps: "page, totalPages",
    jenis: "rekonsiliasi",
    catatan: "idem",
  },
  {
    berkas: "context/BranchContext.tsx",
    deps: "cabang, branchId, isKasir, isAdmin",
    jenis: "rekonsiliasi",
    catatan: "buang pilihan cabang sisa akun/perusahaan lain",
  },
  {
    berkas: "context/BranchContext.tsx",
    deps: "cabang, dataBranchId, dataCkBranchId",
    jenis: "rekonsiliasi",
    catatan: "idem untuk kedua pilihan cabang data",
  },
];

/** Nama yang terikat ke hasil `useQuery`, termasuk turunannya. */
function namaQuery(s: string): Set<string> {
  const nama = new Set<string>();
  for (const m of s.matchAll(/const\s*\{([^}]*)\}\s*=\s*useQuery/g)) {
    const dm = /\bdata\s*:\s*(\w+)/.exec(m[1]);
    if (dm) nama.add(dm[1]);
    else if (/\bdata\b/.test(m[1])) nama.add("data");
  }
  // Turunan: `const dipilih = produksi.find(…)` — objeknya berganti identitas
  // tiap daftar asalnya disegarkan, jadi ia sama berbahayanya dengan aslinya.
  for (let putaran = 0; putaran < 3; putaran++) {
    for (const m of s.matchAll(/const (\w+) = ([^;\n]*(?:\n[^;\n]*){0,3}?);/g)) {
      if ([...nama].some((n) => new RegExp(`\\b${n}\\b`).test(m[2]))) nama.add(m[1]);
    }
  }
  return nama;
}

interface Temuan {
  berkas: string;
  baris: number;
  deps: string;
  tubuh: string;
}

function efekBerbasisQuery(isi: string, rel: string): Temuan[] {
  const nama = namaQuery(isi);
  const hasil: Temuan[] = [];
  if (nama.size === 0) return hasil;
  for (const m of isi.matchAll(/useEffect\(/g)) {
    const i = isi.indexOf("{", m.index + 10);
    if (i < 0) continue;
    let d = 0;
    let j = i;
    for (; j < isi.length; j++) {
      if (isi[j] === "{") d++;
      else if (isi[j] === "}" && --d === 0) break;
    }
    const tubuh = isi.slice(i, j);
    if (!/\bset[A-Z]\w*\(/.test(tubuh)) continue;
    const dm = /\}\s*,\s*\[([^\]]*)\]/.exec(isi.slice(j, j + 300));
    if (!dm) continue;
    const deps = dm[1].trim().replace(/\s+/g, " ");
    // Cocokkan nama UTUH: `data` tak boleh cocok dengan `dataBranchId`.
    if (![...nama].some((n) => new RegExp(`\\b${n}\\b`).test(deps))) continue;
    hasil.push({ berkas: rel, baris: isi.slice(0, m.index).split("\n").length, deps, tubuh });
  }
  return hasil;
}

const BERKAS = semuaBerkas(akar);
const TEMUAN = BERKAS.flatMap((p) => efekBerbasisQuery(readFileSync(p, "utf8"), p.slice(akar.length)));

describe("efek yang menyemai dari query: harus semai-sekali", () => {
  it("pemindainya menemukan sesuatu (penjaga ini tak boleh kosong)", () => {
    expect(TEMUAN.length).toBeGreaterThanOrEqual(15);
  });

  it("tak ada efek berbasis query di luar daftar yang sudah ditimbang", () => {
    const asing = TEMUAN.filter(
      (t) => !DIIZINKAN.some((e) => e.berkas === t.berkas && e.deps === t.deps),
    ).map((t) => `${t.berkas}:${t.baris} — deps=[${t.deps}]`);
    expect(asing, "efek baru: pastikan ia menyemai SEKALI lalu daftarkan di sini").toEqual([]);
  });

  it("tiap efek penyemai masih memakai tanda semai-sekali-nya", () => {
    const hilang: string[] = [];
    for (const e of DIIZINKAN) {
      if (e.jenis !== "semai") continue;
      const t = TEMUAN.find((x) => x.berkas === e.berkas && x.deps === e.deps);
      if (!t) {
        hilang.push(`${e.berkas} deps=[${e.deps}] — efeknya tak ditemukan lagi`);
        continue;
      }
      if (!t.tubuh.includes(e.tanda!)) {
        hilang.push(`${e.berkas}:${t.baris} — tanda "${e.tanda}" hilang (${e.catatan})`);
      }
    }
    expect(hilang).toEqual([]);
  });

  it("entri jenis kunci-dep memang berkunci skalar, bukan objek query", () => {
    // `[detail?.id]` aman; `[detail]` tidak — objeknya berganti tiap refetch.
    const salah = DIIZINKAN.filter(
      (e) => e.jenis === "kunci-dep" && !/[?.]/.test(e.deps),
    ).map((e) => `${e.berkas} deps=[${e.deps}]`);
    expect(salah).toEqual([]);
  });
});
