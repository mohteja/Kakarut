/**
 * Draf isi menu dari resep — dipakai tombol "Ambil dari resep" di form Menu.
 *
 * Kasus-kasusnya diambil dari data nyata Basooopa: resep "Premium Basooopa A"
 * memuat `0,7576 butir Baso halus kecil` (angka biaya hasil konversi gram) dan
 * dua baris kemasan take away. Keduanya TIDAK boleh muncul apa adanya di
 * daftar menu pelanggan.
 */
import { describe, expect, it } from "vitest";
import { draftIsiMenu, type KomponenIsi } from "@kakarut/shared";

const k = (
  nama: string,
  qty: number,
  satuan = "butir",
  extra: Partial<KomponenIsi> = {},
): KomponenIsi => ({
  nama,
  qty,
  satuan,
  is_packaging: false,
  is_complement: false,
  ...extra,
});

describe("draftIsiMenu — resep nyata Premium Basooopa A", () => {
  const pba: KomponenIsi[] = [
    k("Baso aci original", 3),
    k("Baso halus kecil", 0.7576),
    k("Baso tahu", 1),
    k("Baso urat besar", 1),
    k("Complement saos & sambal", 1, "porsi", { is_complement: true }),
    k("Kuah dan bumbu", 1, "porsi"),
    k("Siomay", 1),
    k("Topping mie dkk", 1, "porsi"),
    k("kresek take away", 1, "pcs", { is_packaging: true }),
    k("plastik take away", 1, "pcs", { is_packaging: true }),
  ];

  it("kemasan & pelengkap dibuang dari draf", () => {
    const teks = draftIsiMenu(pba);
    expect(teks).not.toContain("kresek");
    expect(teks).not.toContain("plastik");
    expect(teks).not.toContain("saos");
  });

  it("takaran pecahan biaya dibulatkan, tak pernah tampil 0,7576", () => {
    const teks = draftIsiMenu(pba);
    expect(teks).not.toContain("0.7576");
    expect(teks).not.toContain("0,7576");
    expect(teks).toContain("1 baso halus kecil");
  });

  it("hasil lengkapnya", () => {
    expect(draftIsiMenu(pba)).toBe(
      "3 baso aci original, 1 baso halus kecil, 1 baso tahu, 1 baso urat besar, " +
        "1 kuah dan bumbu, 1 siomay, 1 topping mie dkk",
    );
  });
});

describe("draftIsiMenu — aturan penulisan", () => {
  it("satuan yang tersirat tak ditulis ulang (butir/porsi/pcs)", () => {
    expect(draftIsiMenu([k("Baso urat", 2, "butir")])).toBe("2 baso urat");
    expect(draftIsiMenu([k("Kuah", 1, "porsi")])).toBe("1 kuah");
  });

  it("satuan yang membawa arti TETAP ditulis", () => {
    expect(draftIsiMenu([k("Mie basah", 150, "gr")])).toBe("150 gr mie basah");
  });

  it("pecahan di bawah 1 dinaikkan ke 1 — bukan dihapus jadi 0", () => {
    expect(draftIsiMenu([k("Baso", 0.2)])).toBe("1 baso");
  });

  it("takaran ≤ 0 dibuang", () => {
    expect(draftIsiMenu([k("Baso", 0), k("Mie", 1)])).toBe("1 mie");
  });

  it("resep kosong → teks kosong (form membiarkan field apa adanya)", () => {
    expect(draftIsiMenu([])).toBe("");
  });

  it("menu paket: menu dasar disebut lebih dulu", () => {
    const teks = draftIsiMenu([k("Kerupuk", 2, "pcs")], "2× Yamin Misdasem");
    expect(teks).toBe("2× Yamin Misdasem, 2 kerupuk");
  });

  it("paket tanpa komponen tambahan → hanya menu dasarnya", () => {
    expect(draftIsiMenu([], "2,5× Yamin Ori")).toBe("2,5× Yamin Ori");
  });
});
