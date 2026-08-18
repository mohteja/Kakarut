import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * PENANDA SEKALI-JALAN WAJIB IKUT DI `WHERE`.
 *
 * Kelas ini sudah menggigit TIGA kali di repo ini, dan tiap kali bentuknya
 * sama: sebuah `UPDATE` menulis penanda yang hanya boleh terjadi sekali
 * (`closed_at`, `diputus_pada`, `confirmed_at`, …) sementara `WHERE`-nya cuma
 * menyebut `id`. Dua permintaan yang berpapasan sama-sama menemukan barisnya
 * masih "terbuka", sama-sama menulis, dan yang kedua MENIMPA yang pertama —
 * keduanya dibalas 200.
 *
 *   1. tolak undangan menimpa yang baru diterima;
 *   2. putusan selisih shift: yang kalah dibalas keputusan lawan;
 *   3. tutup kasir: nominal 150.000 dan 999.000 dilepas bersamaan → DUA-DUANYA
 *      200 berbunyi 999.000, dan shift tercatat berselisih 899.000.
 *
 * Yang ketiga lolos dari sapuan yang mencari dua yang pertama, sebab sapuan itu
 * mencari `UPDATE` yang menulis STATUS — sementara tutup kasir menulis
 * `closed_at`. Kriteria yang terlalu sempit melewatkan bug tetangganya sendiri.
 *
 * Uji ini menjaga kriteria yang SUDAH DIKOREKSI: penanda apa pun yang menandai
 * peristiwa sekali-jalan, bukan hanya kolom bernama status.
 *
 * Yang dianggap penjaga sah: penandanya sendiri di `WHERE`, ATAU predikat
 * keadaan lain yang sama mengikatnya (`status`, `isNull(...)`, `isActive`).
 * Yang TIDAK sah: hanya `id`.
 */

/** Kolom yang menandai peristiwa yang hanya boleh terjadi sekali. */
const PENANDA =
  /\b(closedAt|confirmedAt|deletedAt|approvedAt|diputusPada|ditolakPada|dikirimAt|gagalPada|selesaiPada|verifiedAt|acceptedAt|revokedAt|archivedAt)\b/;

/** Predikat yang cukup mengikat untuk membuat UPDATE-nya jadi CAS. */
const PENJAGA = /isNull\(|\.status\b|status,|isActive|deletedAt/;

/**
 * Dikecualikan dengan alasan yang ditulis, bukan didiamkan.
 *
 * `onboarding` hapus-akun-sendiri: ketiga UPDATE-nya satu transaksi, dan dua
 * lainnya SUDAH dijaga. Efek ganda pada yang ini cuma awalan `deleted:` yang
 * tertulis dua kali pada email yang memang sudah jadi nisan — akunnya hilang
 * dengan cara yang sama, dan alamat aslinya tetap bebas dipakai ulang.
 */
const DIKECUALIKAN = new Set(["modules/onboarding/routes.ts"]);

function berkasTs(dir: string, akar: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkasTs(p, akar, keluar);
    else if (nama.endsWith(".ts")) keluar.push(p.slice(akar.length + 1));
  }
  return keluar;
}

const AKAR = fileURLToPath(new URL("../src", import.meta.url));

/** Setiap `.update(x)` beserta bagian `.set()` dan `.where()`-nya. */
function updateTanpaPenjaga(rel: string) {
  const isi = readFileSync(join(AKAR, rel), "utf8");
  const temuan: { baris: number; tabel: string; penanda: string }[] = [];
  for (const m of isi.matchAll(/\.update\((\w+)\)/g)) {
    const blok = isi.slice(m.index!, m.index! + 2200);
    const w = blok.indexOf(".where(");
    if (w < 0) continue;
    const bagianSet = blok.slice(0, w);
    const bagianWhere = blok.slice(w, w + 900);
    const p = bagianSet.match(PENANDA);
    if (!p) continue;
    if (PENANDA.test(bagianWhere) || PENJAGA.test(bagianWhere)) continue;
    temuan.push({
      baris: isi.slice(0, m.index!).split("\n").length,
      tabel: m[1],
      penanda: p[0],
    });
  }
  return temuan;
}

describe("UPDATE yang menulis penanda sekali-jalan harus bersyarat", () => {
  const semua = berkasTs(AKAR, AKAR);

  it("menemukan berkas sumber untuk dipindai (bukan lolos karena kosong)", () => {
    // Tanpa ini, kesalahan jalur membuat seluruh uji hijau tanpa memeriksa apa pun.
    expect(semua.length).toBeGreaterThan(30);
  });

  it("tak ada UPDATE penanda sekali-jalan yang hanya ber-WHERE id", () => {
    const pelanggar = semua
      .filter((f) => !DIKECUALIKAN.has(f))
      .flatMap((f) => updateTanpaPenjaga(f).map((t) => `${f}:${t.baris} (${t.tabel}.${t.penanda})`));
    expect(
      pelanggar,
      "tambahkan penandanya (atau predikat keadaan lain) ke WHERE, lalu " +
        "periksa jumlah baris terperbarui dan balas 409 bila 0 — lihat " +
        "shift/tutup dan pengajuan/putuskan sebagai contoh",
    ).toEqual([]);
  });

  it("pengecualiannya masih ADA — daftar tak boleh jadi kuburan nama basi", () => {
    // Berkas yang dipindah/dihapus membuat pengecualiannya diam-diam melebar
    // ke berkas lain yang kebetulan bernama sama kelak.
    for (const rel of DIKECUALIKAN) {
      expect(semua, rel).toContain(rel);
    }
  });
});
