/**
 * SAPUAN: penjaga yang dipasang di SEBAGIAN pintu saja.
 *
 * KENAPA UJI INI ADA.
 *
 * Sepanjang satu sesi audit, hampir setiap bug yang ditemukan berbentuk sama —
 * dan bentuknya BUKAN "tak ada yang memikirkan aturan ini". Aturannya selalu
 * sudah dipikirkan, ditulis, bahkan dikomentari panjang. Yang terjadi:
 * penjaganya dipasang di SATU pintu menuju keadaan yang dijaga, lalu pintu
 * lain ke keadaan yang sama dibiarkan terbuka.
 *
 *   · "perusahaan tak boleh kehilangan owner terakhir" dijaga pada jalur
 *     ARSIP — tidak pada jalur TURUN PERAN, yang menghilangkan owner persis
 *     sama. Satu klik, tanpa balapan: owner 2 → 1 → 0, dibalas 200.
 *   · terjemahan bentrok unik (`tanpaBentrok`) dipakai di delapan modul —
 *     semuanya jalur GANTI NAMA. Empat jalur MEMBUAT membalas 500.
 *   · saringan `harga_tebakan` ditegakkan di jalur MENULIS harga acuan —
 *     tidak di jalur MEMBACA, yang menampilkan keempat statistiknya.
 *   · aritmetika waktu yang aman dipasang di §138 — tidak di §198, yang kena
 *     persis sama sepuluh bulan kemudian.
 *
 * Membaca modul satu per satu tidak menemukan bentuk ini; yang menemukannya
 * selalu sapuan mekanis. Uji ini memasang sapuan itu jadi gerbang.
 *
 * CARA KERJANYA. Tiap aturan sepasang pola: `tulis` (pernyataan yang MENCAPAI
 * keadaan yang dijaga) dan `penjaga` (penanda bahwa penjaganya ada di badan
 * yang sama). Badan = seukuran handler rute atau fungsi. Yang dilaporkan:
 * pintu yang cocok `tulis` tapi tidak `penjaga`.
 *
 * IA TIDAK MENUNTUT NOL. Sebagian pintu memang sah tanpa penjaga, dan
 * masing-masing tercatat di `dasar` DENGAN ALASAN. Yang dijaga: tak ada pintu
 * BARU yang terbuka diam-diam, dan pintu yang sudah dibereskan tak boleh
 * terbuka lagi.
 *
 * BATASNYA, supaya tak dikira lebih dari yang sebenarnya:
 *  · granularitasnya BADAN, jadi penjaga yang sah tapi tinggal di PEMANGGIL
 *    tetap terbaca "tanpa penjaga" (lihat entri `buatPerusahaanUntuk`);
 *  · ia hanya melihat bentuk yang ditulis di TypeScript, bukan SQL mentah;
 *  · dan ia hanya tahu aturan yang didaftarkan di bawah. Ia tak menemukan
 *    aturan baru — ia menjaga yang sudah dibayar mahal supaya tak bocor lagi.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const AKAR = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Potong berkas jadi "badan" seukuran handler: dari pendaftaran rute atau
 * deklarasi fungsi sampai yang berikutnya.
 */
const BATAS =
  /^\s*\.(?:post|get|put|patch|delete)\(\s*"|^\s*(?:export\s+)?(?:async\s+)?function\s+\w+|^\s*(?:export\s+)?const\s+\w+\s*(?::[^=]+)?=\s*(?:async\s*)?\(/gm;

function badan(src: string): { baris: number; teks: string }[] {
  const batas = [...src.matchAll(BATAS)].map((m) => m.index!);
  if (batas.length === 0) return [];
  batas.push(src.length);
  const out: { baris: number; teks: string }[] = [];
  for (let i = 0; i < batas.length - 1; i += 1) {
    out.push({
      baris: src.slice(0, batas[i]).split("\n").length,
      teks: src.slice(batas[i], batas[i + 1]),
    });
  }
  return out;
}

function berkasSumber(dir: string): string[] {
  const keluar: string[] = [];
  const jelajah = (d: string) => {
    for (const nama of readdirSync(d)) {
      const p = join(d, nama);
      if (statSync(p).isDirectory()) {
        if (nama !== "node_modules") jelajah(p);
      } else if (nama.endsWith(".ts") && !nama.includes(".test.")) {
        keluar.push(p);
      }
    }
  };
  jelajah(dir);
  return keluar;
}

interface Aturan {
  nama: string;
  /** apa yang rusak kalau pintunya terbuka — untuk pembaca yang menemukannya merah */
  kenapa: string;
  tulis: RegExp;
  penjaga: RegExp;
  /** pintu tanpa penjaga yang SUDAH ditimbang: path → berapa & kenapa */
  dasar: Record<string, { pintu: number; alasan: string }>;
}

const ATURAN: Aturan[] = [
  {
    nama: "owner-terakhir",
    kenapa:
      "Perusahaan tanpa owner terkunci dari seluruh fungsi requireRole(\"owner\") — " +
      "TERMASUK mengangkat owner baru. Tak ada jalan keluar dari dalam aplikasi.",
    // Menulis `role` atau `archivedAt` pada memberships = bisa menghapus owner.
    tulis: /\.update\(\s*memberships\s*\)[\s\S]{0,400}?\.set\(\s*\{[\s\S]{0,300}?(?:archivedAt|role)\s*:/,
    penjaga: /kunciAntrean\([^)]*"owner"/,
    dasar: {
      "modules/users/service.ts": {
        pintu: 1,
        alasan:
          "`arsipkanMembershipNonaktif` — backfill boot sekali jalan (digerbang " +
          "`sekaliSaja`) yang merapikan data pra-penyatuan status: ia hanya " +
          "menyentuh membership milik user yang MEMANG SUDAH `is_active=false`, " +
          "yaitu orang yang sudah tak bisa masuk sama sekali. Tak ada owner " +
          "berjalan yang bisa hilang karenanya",
      },
      "modules/onboarding/service.ts": {
        pintu: 1,
        alasan:
          "`terimaUndangan` menyetel `archivedAt: null` — ia MEMULIHKAN " +
          "keanggotaan, bukan menghapusnya. Arah sebaliknya dari yang dijaga, " +
          "jadi ia tak pernah bisa mengurangi jumlah owner",
      },
      "seed/guest.ts": {
        pintu: 1,
        alasan:
          "penyemai akun demo — berjalan saat provisioning, bukan atas permintaan " +
          "pengguna, dan hanya menyentuh perusahaan demo miliknya sendiri",
      },
    },
  },
  {
    nama: "bentrok-unik",
    kenapa:
      "Pra-cek 'sudah ada?' selalu punya jeda sebelum tulisannya; yang menjaga " +
      "keunikan adalah INDEKSNYA. Tanpa terjemahan, yang kalah balapan menerima " +
      "23505 mentah alias 500 — dan di web itu memicu overlay 'server sedang " +
      "diperbarui'.",
    tulis: /\.insert\(\s*(?:users|invitations|companies)\s*\)/,
    penjaga: /bentrokUnikPada|tanpaBentrok|onConflictDoNothing/,
    dasar: {
      "modules/auth/superadmin.ts": {
        pintu: 1,
        alasan:
          "`pastikanSuperAdmin` berjalan saat BOOT di dalam try/catch yang sengaja " +
          "tak menggagalkan boot (lihat index.ts). Dua instance yang boot " +
          "bersamaan membuat satu di antaranya mencatat galat lalu lanjut — tak " +
          "ada pengguna yang menerima 500, dan akunnya tetap tepat satu",
      },
      "modules/onboarding/service.ts": {
        pintu: 1,
        alasan:
          "`buatPerusahaanUntuk` MEMANG dijaga, tapi penjaganya di PEMANGGIL — " +
          "`POST /onboarding/perusahaan` mengulang transaksinya saat " +
          "`companies_slug_unique` bentrok, sebab slug di sini dipilihkan sistem " +
          "(akhiran acak) dan bukan diketik orang. Sapuan ini bergranularitas " +
          "badan, jadi ia tak bisa melihat ke pemanggil",
      },
      "seed/guest.ts": {
        pintu: 1,
        alasan:
          "penyemai akun demo — dipanggil saat provisioning dengan gerbangnya " +
          "sendiri, bukan dari permintaan HTTP mana pun",
      },
    },
  },
  {
    nama: "cuti-bertindih",
    kenapa:
      "Dua pengajuan hidup yang bertindih membuat rekap absen ambigu: " +
      "`petaIzin.set(\"<user>|<tanggal>\")` atas kueri tanpa ORDER BY memilih " +
      "yang kebetulan terbaca belakangan.",
    tulis: /\.insert\(\s*leaveRequests\s*\)/,
    penjaga: /kunciAntrean\([^)]*"pengajuan"/,
    dasar: {},
  },
];

/** → path relatif → jumlah pintu tanpa penjaga */
function pintuTerbuka(a: Aturan): Map<string, { jumlah: number; baris: number[] }> {
  const peta = new Map<string, { jumlah: number; baris: number[] }>();
  for (const f of berkasSumber(AKAR)) {
    const src = readFileSync(f, "utf8");
    for (const b of badan(src)) {
      if (!a.tulis.test(b.teks)) continue;
      if (a.penjaga.test(b.teks)) continue;
      const rel = relative(AKAR, f).replaceAll("\\", "/");
      const p = peta.get(rel) ?? { jumlah: 0, baris: [] };
      p.jumlah += 1;
      p.baris.push(b.baris);
      peta.set(rel, p);
    }
  }
  return peta;
}

describe.each(ATURAN)("penjaga di semua pintu — $nama", (a) => {
  const terbuka = pintuTerbuka(a);

  it("tak ada BERKAS baru yang menulis tanpa penjaga", () => {
    const baru = [...terbuka.entries()]
      .filter(([f]) => !(f in a.dasar))
      .map(([f, p]) => `${f} (baris ${p.baris.join(", ")})`);
    expect(
      baru,
      baru.length === 0
        ? ""
        : `Pintu BARU tanpa penjaga «${a.nama}»:\n\n${baru.join("\n")}\n\n` +
          `${a.kenapa}\n\n` +
          "Pasang penjaganya di badan yang sama, ATAU daftarkan di `dasar` " +
          "DENGAN ALASAN yang bisa dibaca orang lain. Entri tanpa alasan " +
          "membuat daftar itu jadi tempat sampah, dan gerbangnya berhenti " +
          "menjaga apa pun.",
    ).toEqual([]);
  });

  it("berkas yang sudah ditimbang tidak menambah pintu", () => {
    const meluas = [...terbuka.entries()]
      .filter(([f, p]) => f in a.dasar && p.jumlah > a.dasar[f].pintu)
      .map(([f, p]) => `${f}: ${a.dasar[f].pintu} → ${p.jumlah} (baris ${p.baris.join(", ")})`);
    expect(
      meluas,
      meluas.length === 0
        ? ""
        : `Berkas ini menambah pintu tanpa penjaga «${a.nama}»:\n\n${meluas.join("\n")}\n\n` +
          "Pintu kedua bukan alasan menaikkan angka di `dasar` — alasan yang " +
          "tercatat berlaku untuk pintu yang ITU, bukan untuk yang baru.",
    ).toEqual([]);
  });

  it("`dasar` tak menyimpan entri yang sudah tak berlaku", () => {
    // Tanpa ini daftarnya membusuk: pintu yang SUDAH dijaga tetap tercatat
    // sebagai "boleh terbuka", dan pintu baru di berkas itu lolos diam-diam
    // dengan izin yang sudah kedaluwarsa.
    const basi = Object.keys(a.dasar).filter((f) => !terbuka.has(f));
    expect(
      basi,
      basi.length === 0 ? "" : `Entri \`dasar\` «${a.nama}» sudah tak ditemukan — hapus: ${basi.join(", ")}`,
    ).toEqual([]);
  });

  it("setiap entri `dasar` punya alasan yang benar-benar ditulis", () => {
    const kosong = Object.entries(a.dasar)
      .filter(([, v]) => v.alasan.trim().length < 40)
      .map(([f]) => f);
    expect(kosong, `Entri \`dasar\` «${a.nama}» tanpa alasan memadai: ${kosong.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("detektornya benar-benar mengenali bentuknya", () => {
  /*
   * Pasangan yang wajib ada: pola yang salah ketik membuat SELURUH gerbang di
   * atas hijau selamanya, dan tak ada yang akan curiga — nol temuan terlihat
   * persis seperti nol masalah. Contoh di bawah disalin dari bentuk yang
   * SUNGGUHAN pernah ada di repo ini, bukan dikarang.
   */
  const contoh: [string, string, boolean][] = [
    [
      "owner-terakhir",
      'await tx.update(memberships).set({ archivedAt: new Date() }).where(eq(memberships.id, x));',
      true,
    ],
    [
      "owner-terakhir",
      'await tx.update(memberships).set({ role: targetRole, branchId: null }).where(eq(memberships.id, m.id));',
      true,
    ],
    [
      "bentrok-unik",
      'const [u] = await tx.insert(users).values({ email, passwordHash, nama }).returning();',
      true,
    ],
    ["cuti-bertindih", 'const [row] = await tx.insert(leaveRequests).values({ companyId }).returning();', true],
    // …dan yang TIDAK boleh tertuduh:
    ["owner-terakhir", 'await tx.update(memberships).set({ employeeCode: kode }).where(eq(x));', false],
    ["bentrok-unik", 'await tx.insert(memberships).values({ userId, companyId });', false],
  ];

  it.each(contoh)("%s mengenali: %s → %s", (nama, kode, harus) => {
    const a = ATURAN.find((x) => x.nama === nama)!;
    expect(a.tulis.test(kode)).toBe(harus);
  });

  it("pola penjaganya mengenali panggilan yang sungguhan dipakai", () => {
    const owner = ATURAN.find((a) => a.nama === "owner-terakhir")!;
    expect(owner.penjaga.test('await kunciAntrean(tx, "owner", auth.company_id!);')).toBe(true);
    expect(owner.penjaga.test('await kunciAntrean(tx, "pengajuan", a, b);')).toBe(false);
    const unik = ATURAN.find((a) => a.nama === "bentrok-unik")!;
    expect(unik.penjaga.test('if (bentrokUnikPada(e, "users_email_unique")) {')).toBe(true);
    expect(unik.penjaga.test("const x = 1;")).toBe(false);
  });
});
