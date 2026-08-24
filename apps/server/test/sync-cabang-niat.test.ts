import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * CABANG NIAT PADA PERINTAH SINKRON OFFLINE.
 *
 * `panggilInternal` mengangkat `body.branch_id` ke query supaya cabang yang
 * diminta perangkat sampai ke `resolveBranchId` — dan komentarnya sendiri
 * menulis alasannya: *"satu eksekutor yang lupa akan mengulang bug yang sama
 * tanpa suara."* Pengangkatan itu membaca kunci yang harus DIKIRIM klien, dan
 * sapuan mekanis (10 situs enqueue × 7 build tayang, detektor dibuktikan
 * menuduh lewat masukan sintetis) menunjukkan EMPAT pintu yang payload-nya tak
 * pernah membawa `branch_id` di build mana pun: `perlengkapan_pakai`,
 * `perlengkapan_opname`, `absen_saya`, `absen_stasiun`.
 *
 * Terukur lewat POST /sync sungguhan (2026-08-24, dua cabang, saldo 100/100):
 *   SEBELUM: pakai niat "Cabang Dua" → PUSAT 100→93, balasan "ok" ·
 *            opname niat "Cabang Dua" → koreksi −38 tercatat di PUSAT ·
 *            absen admin → masuk tercatat di PUSAT
 *   SESUDAH: ketiganya mendarat di Cabang Dua; payload TANPA branch_id
 *            (build lama) tetap ok dengan fallback cabang pertama — perilaku
 *            build terpasang tidak berubah.
 *
 * Uji ini SOURCE-PIN (pengukurannya di atas; balapan/HTTP hidup ada di
 * verify-api §250): keempat pintu wajib mengangkat cabang niat lewat
 * `angkatCabangNiat`, dan pintu yang skemanya MENDEKLARASIKAN `branch_id`
 * (penjualan, shift_buka, stok_opname) tetap meneruskan payload apa adanya.
 */
const SUMBER = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/modules/sync/routes.ts", import.meta.url)), "utf8"),
);

/** Potong badan satu eksekutor dari deklarasinya sampai deklarasi berikutnya. */
function badan(nama: string): string {
  const awal = SUMBER.indexOf(`const ${nama}`);
  expect(awal, `eksekutor ${nama} tidak ditemukan — PREMIS uji ini runtuh`).toBeGreaterThan(-1);
  const akhir = SUMBER.indexOf("\nconst ", awal + 1);
  return SUMBER.slice(awal, akhir === -1 ? undefined : akhir);
}

describe("sync: cabang niat diangkat dari payload", () => {
  it("PREMIS: ketiga belas tipe perintah masih terdaftar di EKSEKUTOR", () => {
    const peta = SUMBER.slice(SUMBER.indexOf("const EKSEKUTOR"));
    for (const tipe of [
      "shift_buka", "penjualan", "absen_saya", "absen_stasiun", "stok_opname",
      "perlengkapan_opname", "perlengkapan_pakai", "faktur_tahap", "faktur_kirim",
      "produksi_kirim_hasil", "penerimaan_terima", "penerimaan_terima_sebagian",
      "penerimaan_tolak",
    ]) {
      expect(peta, `tipe ${tipe} hilang dari EKSEKUTOR`).toContain(`${tipe}:`);
    }
  });

  it("absen_saya & absen_stasiun: parse badan TANPA branch_id, resolver menerima niatnya", () => {
    for (const [nama, skema] of [
      ["execAbsenSaya", "SelfBody"],
      ["execAbsenStasiun", "ClockBody"],
    ] as const) {
      const b = badan(nama);
      expect(b, `${nama} tak memakai angkatCabangNiat`).toContain("angkatCabangNiat(payload)");
      expect(b, `${nama} mem-parse payload mentah — branch_id niat akan 400 di skema strict`)
        .toContain(`${skema}.parse(body)`);
      expect(b, `${nama} kembali ke fallback buta-niat`).toContain("resolveCabangSync(auth, cabang)");
    }
    // Bentuk lamanya tak boleh kembali: null = "cabang pertama" bagi owner/
    // admin, terukur salah cabang tanpa galat.
    expect(SUMBER, "resolveCabangSync(auth, null) muncul lagi").not.toContain(
      "resolveCabangSync(auth, null)",
    );
  });

  it("perlengkapan_pakai & perlengkapan_opname: cabang niat berjalan lewat query internal", () => {
    const pakai = badan("execPerlengkapanPakai");
    expect(pakai).toContain("angkatCabangNiat(");
    expect(pakai).toMatch(/panggilInternal\(authHeader, `\/perlengkapan\/\$\{params\.supply_id\}\/pakai`, badan, cabang\)/);
    const opname = badan("execPerlengkapanOpname");
    expect(opname).toContain("angkatCabangNiat(payload)");
    expect(opname).toContain('panggilInternal(authHeader, "/perlengkapan/opname", body, cabang)');
  });

  it("PASANGAN: pintu yang skemanya mendeklarasikan branch_id TIDAK ikut dilucuti", () => {
    // /stok/opname membaca cabang dari BADAN (branchUntukTulis) — mengangkat
    // kuncinya justru menghilangkan cabang bagi pintu ini. penjualan &
    // shift_buka membawa branch_id lewat skemanya sendiri ke resolveCabangSync.
    expect(badan("execStokOpname")).toContain('panggilInternal(authHeader, "/stok/opname", payload)');
    expect(badan("execPenjualan")).toContain("SaleBody.parse(payload)");
    expect(badan("execPenjualan")).toContain("resolveCabangSync(auth, p.branch_id)");
    expect(badan("execShiftBuka")).toContain("resolveCabangSync(auth, p.branch_id)");
  });

  it("angkatCabangNiat: membuang kuncinya dari badan dan menolak nilai bukan-string", () => {
    const h = SUMBER.slice(SUMBER.indexOf("function angkatCabangNiat"), SUMBER.indexOf("// ---", SUMBER.indexOf("function angkatCabangNiat")));
    expect(h, "helper hilang").toContain("delete body.branch_id");
    expect(h).toContain('typeof p.branch_id === "string"');
  });
});
