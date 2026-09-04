import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jelajah, namaProperti, petaInduk, uraikan, type Simpul } from "./util/ast";
import { biayaBatch, kalimatResep } from "../src/modules/bahan/jejak";

/**
 * PENJAGA GARIS WAKTU BAHAN — tiap tulisan harga meninggalkan jejak.
 *
 * Riwayat yang BOLONG lebih buruk daripada tak ada riwayat. Layar Resep kini
 * menyodorkan daftar "inilah yang pernah terjadi pada resep ini", dan orang
 * memakainya untuk memutuskan apakah mencentang persetujuan harga. Satu pintu
 * tulis yang lupa mencatat tidak membuat layar itu kosong atau merah — ia
 * membuatnya BERBOHONG dengan percaya diri: perubahan yang lewat pintu itu
 * tak pernah muncul, dan yang membaca menyimpulkan harganya memang tak pernah
 * bergerak lewat jalan itu.
 *
 * SEMBILAN situs tulis, dua berkas, dan tak satu pun punya gejala kalau
 * jejaknya hilang. Karena itu penjagaan di sini STRUKTURAL, bukan contoh.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const baca = (rel: string) => readFileSync(`${SRC}/${rel}`, "utf8");

/** Kedua berkas yang menulis `ingredients` — daftar, bukan tebakan. */
const BERKAS_TULIS = ["modules/bahan/routes.ts", "modules/produksi/routes.ts"] as const;

interface SitusIngredient {
  berkas: string;
  baris: number;
  op: "update" | "insert";
  /** teks fungsi PEMBUNGKUS TERLUAR — lihat "batas yang diakui" di bawah */
  pembungkus: string;
}

const FUNGSI = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

/**
 * Semua `.update(ingredients)` / `.insert(ingredients)`, dengan teks fungsi
 * pembungkus TERLUAR-nya.
 *
 * TERLUAR, bukan terdekat, dan itu keputusan yang diukur bukan disukai:
 * `POST /bahan/bulk` menyisipkan barisnya di dalam `db.transaction(async (tx)
 * => …)` sementara pencatatannya berjalan SESUDAH transaksi itu ditutup —
 * bentuk yang benar (jejaknya tak boleh menahan koneksi transaksi lebih lama
 * dari perlu), dan fungsi terdekat akan menuduhnya.
 *
 * BATAS YANG DIAKUI: jendela sebesar handler berarti dua tulisan di satu
 * handler yang hanya SATU dicatat tetap lolos. Yang menutup celah itu bukan
 * penjaga ini melainkan §293 `verify-api.sh`, yang menghitung baris jejak
 * yang benar-benar lahir dari tiap pintu lewat HTTP sungguhan.
 */
function situsIngredient(): SitusIngredient[] {
  const keluar: SitusIngredient[] = [];
  for (const rel of BERKAS_TULIS) {
    const isi = baca(rel);
    const pohon = uraikan(rel, isi);
    const induk = petaInduk(pohon);
    jelajah(pohon, (n) => {
      if (n.type !== "CallExpression") return;
      const nama = namaProperti(n.callee as Simpul);
      if (nama !== "update" && nama !== "insert") return;
      const arg = (n.arguments as Simpul[])?.[0];
      if (!arg || arg.type !== "Identifier" || arg.name !== "ingredients") return;
      let luar: Simpul | undefined;
      let k: Simpul | undefined = n;
      while (k) {
        if (FUNGSI.has(k.type)) luar = k;
        k = induk.get(k);
      }
      keluar.push({
        berkas: rel,
        baris: isi.slice(0, n.start).split("\n").length,
        op: nama,
        pembungkus: luar ? isi.slice(luar.start, luar.end) : isi,
      });
    });
  }
  return keluar;
}

/** Tulisan itu menyentuh harga atau takaran? Termasuk bentuk singkat `{ hargaBeli }`. */
function menyentuhHarga(teks: string): boolean {
  return /\bhargaBeli\b/.test(teks) || /\bisi\s*[:,]/.test(teks);
}

describe("premis: sapuannya benar-benar menemukan situsnya", () => {
  const situs = situsIngredient();

  it("menemukan kesembilan situs tulis `ingredients` di dua berkas", () => {
    // Angka ini SENGAJA keras. Situs kesepuluh yang lahir tanpa memperbarui
    // baris ini memerahkan uji — dan itu satu-satunya momen seseorang pasti
    // membaca komentar di atas.
    const berharga = situs.filter((s) => menyentuhHarga(s.pembungkus));
    expect(situs.length).toBeGreaterThanOrEqual(11);
    expect(berharga.length).toBeGreaterThanOrEqual(9);
  });

  it("pemindainya BISA menuduh: pembungkus tanpa pencatat terdeteksi", () => {
    // Membuktikan detektornya punya gigi, dengan teks palsu — bukan dengan
    // merusak berkas sungguhan. Tanpa uji ini, "semua hijau" juga hijau untuk
    // pemindai yang tak pernah memeriksa apa pun.
    const palsu = `async (c) => {
      await db.update(ingredients).set({ hargaBeli: 1, updatedAt: new Date() });
    }`;
    expect(menyentuhHarga(palsu)).toBe(true);
    expect(palsu.includes("catatHargaBahan(")).toBe(false);
  });
});

describe("tiap pintu yang menggeser harga/isi bahan menulis jejak", () => {
  for (const s of situsIngredient()) {
    if (!menyentuhHarga(s.pembungkus)) continue;
    it(`${s.berkas}:${s.baris} (${s.op}) memanggil catatHargaBahan`, () => {
      expect(s.pembungkus).toContain("catatHargaBahan(");
    });
  }
});

describe("penulisnya satu pintu, dan tak ada yang menulis tabelnya langsung", () => {
  it("hanya `jejak.ts` yang menyisipkan ke ingredientLogs", () => {
    // Menyisip langsung melewati DUA hal sekaligus: penyaring "benar-benar
    // bergerak" (yang menahan tiap simpan formulir jadi baris riwayat) dan
    // penyebaran ke resep pemakai. Keduanya tak bergejala saat dilewati.
    const penulis: string[] = [];
    for (const rel of [...BERKAS_TULIS, "modules/bahan/jejak.ts"]) {
      if (/insert\(ingredientLogs\)/.test(baca(rel))) penulis.push(rel);
    }
    expect(penulis).toEqual(["modules/bahan/jejak.ts"]);
  });

  it("`catatHargaBahan` mengambil harga baru dari argumennya, bukan dari baris DB", () => {
    // Inti sifat "tak bergantung urutan panggil". Versi yang membaca harga
    // baru dari DB bekerja di lima situs dan mencatat "Rp 0 → Rp 0" di situs
    // yang memanggilnya SEBELUM UPDATE — tanpa satu pun galat.
    const jejak = baca("modules/bahan/jejak.ts");
    expect(jejak).toContain("u ? hargaPerUnit(u.hargaBaru, u.isiBaru)");
  });
});

describe("resep lama dibaca SEBELUM dihapus", () => {
  it("`kompLama` diambil di atas `delete(ingredientComponents)`", () => {
    // `ingredient_components` ditulis hapus-lalu-sisip. Membacanya sesudah
    // penghapusan memulangkan larik kosong, dan jejaknya akan berkata setiap
    // bahan "baru ditambahkan" pada tiap simpan — riwayat yang selalu penuh
    // dan tak pernah benar.
    const isi = baca("modules/bahan/routes.ts");
    const baca_ = isi.indexOf("const kompLama = await tx");
    const hapus = isi.indexOf(
      "await tx.delete(ingredientComponents).where(eq(ingredientComponents.ingredientId, id))",
    );
    expect(baca_).toBeGreaterThan(0);
    expect(hapus).toBeGreaterThan(0);
    expect(baca_).toBeLessThan(hapus);
  });

  it("keadaan induk dibaca DI DALAM transaksi ber-`for(\"update\")`", () => {
    const isi = baca("modules/bahan/routes.ts");
    const i = isi.indexOf("hargaBeli: ingredients.hargaBeli,\n          })");
    expect(i).toBeGreaterThan(0);
    // Irisan sengaja longgar: `butaKomentar` tak dipakai di sini, jadi
    // komentar panjang di antara kedua penanda ikut terhitung.
    expect(isi.slice(i, i + 400)).toContain('.for("update")');
  });
});

describe("rutenya owner/admin dan mengaku saat dipotong", () => {
  const isi = baca("modules/bahan/routes.ts");
  it("GET /:id/riwayat-resep dipagari requireRole owner+admin", () => {
    const i = isi.indexOf('.get("/:id/riwayat-resep"');
    expect(i).toBeGreaterThan(0);
    expect(isi.slice(i, i + 120)).toContain('requireRole("owner", "admin")');
  });
  it("mengambil satu baris lebih dari batas supaya bisa mengaku dipotong", () => {
    expect(isi).toContain("limit(BATAS_RIWAYAT_JEJAK + 1)");
    expect(isi).toContain("const terpotong = rows.length > BATAS_RIWAYAT_JEJAK");
  });
  it("mengurut dengan pemutus seri — satu simpan menulis dua baris sedetik", () => {
    const i = isi.indexOf('.get("/:id/riwayat-resep"');
    expect(isi.slice(i, i + 3000)).toContain(
      "orderBy(desc(ingredientLogs.createdAt), desc(ingredientLogs.id))",
    );
  });
});

describe("panel web memeriksa GAGAL sebelum KOSONG", () => {
  const panel = readFileSync(
    fileURLToPath(new URL("../../web/src/pages/resep/RiwayatResepPanel.tsx", import.meta.url)),
    "utf8",
  );
  it("cabang `gagalMuat` mendahului cabang daftar kosong", () => {
    const g = panel.indexOf("{gagalMuat ? (");
    const k = panel.indexOf("Belum ada perubahan tercatat");
    expect(g).toBeGreaterThan(0);
    expect(k).toBeGreaterThan(g);
  });
  it("panel dirender di luar cabang `sedangUbah` halaman Resep", () => {
    // Permintaan pemiliknya eksplisit: riwayat harus ada di mode BACA juga.
    const resep = readFileSync(
      fileURLToPath(new URL("../../web/src/pages/resep/ResepPage.tsx", import.meta.url)),
      "utf8",
    );
    const i = resep.indexOf("<RiwayatResepPanel");
    expect(i).toBeGreaterThan(0);
    expect(resep.slice(i, i + 120)).toContain("bolehLihat={bolehUbah}");
    expect(resep.slice(i, i + 120)).not.toContain("sedangUbah");
  });
});

describe("kalimatResep: tabel kebenaran", () => {
  const k = (inputId: string, qty: number) => ({ inputId, qty, nama: inputId, satuan: "gr" });
  const diam = { isiLama: 90, isiBaru: 90, overheadLama: 1, overheadBaru: 1 };

  it("TIDAK ADA yang berubah → null (bukan baris riwayat kosong)", () => {
    // Yang dijaga: layar Resep menyimpan SELURUH formulir tiap kali tombol
    // Simpan ditekan. Tanpa `null`, mengganti satu foto menulis "Resep
    // diubah", dan setahun kemudian perubahan takaran yang sungguhan
    // tenggelam di antara ratusan baris kosong.
    expect(kalimatResep([k("a", 200)], [k("a", 200)], diam)).toBeNull();
  });

  it("takaran yang pulang sebagai 200.00000000000003 tetap dianggap sama", () => {
    // `numeric(12,4)` yang dibaca kembali sebagai float. Perbandingan `!==`
    // akan menulis "a 200 → 200" pada tiap simpan.
    expect(kalimatResep([k("a", 200)], [k("a", 200.00000000000003)], diam)).toBeNull();
  });

  it("bahan ditambah, dihapus, dan takaran diubah — ketiganya tersebut", () => {
    const s = kalimatResep([k("a", 200), k("b", 5)], [k("a", 250), k("c", 9)], diam)!;
    expect(s).toContain("a 200 → 250 gr");
    expect(s).toContain("+ c 9 gr");
    expect(s).toContain("− b");
  });

  it("isi batch dan overhead ikut, sekalipun komponennya tak bergerak", () => {
    const s = kalimatResep([k("a", 200)], [k("a", 200)], {
      isiLama: 90,
      isiBaru: 100,
      overheadLama: 1,
      overheadBaru: 1.2,
    })!;
    expect(s).toContain("isi batch 90 → 100");
    expect(s).toContain("overhead ×1 → ×1,2");
  });

  it("lebih dari lima perubahan diringkas, tak dibuang diam-diam", () => {
    const lama = ["a", "b", "c", "d", "e", "f", "g"].map((x) => k(x, 1));
    const s = kalimatResep(lama, [], diam)!;
    expect(s).toContain("+2 perubahan lain");
  });
});

describe("biayaBatch: satu rumus untuk kedua sisi jejak", () => {
  it("Σ takaran × (harga_beli ÷ isi)", () => {
    // 2 × (12.000/1.000) + 100 × (5.000/1.000) = 24 + 500 = 524
    expect(
      biayaBatch([
        { qty: 2, hargaBeli: 12000, isi: 1000 },
        { qty: 100, hargaBeli: 5000, isi: 1000 },
      ]),
    ).toBe(524);
  });
  it("isi 0 tak melempar dan tak menghasilkan Infinity", () => {
    // `hargaPerUnit` memulangkan 0 untuk isi ≤ 0. Yang dijaga di sini bukan
    // rumusnya melainkan bahwa satu baris rusak tak meracuni seluruh angka.
    expect(biayaBatch([{ qty: 5, hargaBeli: 1000, isi: 0 }])).toBe(0);
  });
  it("resep kosong = 0, bukan NaN", () => {
    expect(biayaBatch([])).toBe(0);
  });
});
