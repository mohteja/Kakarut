import { describe, expect, it } from "vitest";
import {
  BATAS_JUMLAH_ADDON,
  hargaAddon,
  ringkasAddon,
  tandaAddon,
  validasiPilihanAddon,
  type GrupAturan,
} from "@kakarut/shared";

/**
 * ATURAN PILIHAN ADD-ON — satu rumah untuk server, kasir web, dan (dicermin)
 * kasir ponsel. Kalau ketiganya berbeda pendapat, tombol Tambah menyala lalu
 * server menolak tepat di saat bayar; uji ini memaku tiap cabang aturannya.
 */
const tambahan: GrupAturan = {
  id: "g-tambah",
  nama: "Tambahan",
  min_pilih: 0,
  maks_pilih: null,
  addons: [
    { id: "a-mie", nama: "Extra mie", maks_jumlah: 3, is_active: true },
    { id: "a-sayur", nama: "Tanpa sayur", maks_jumlah: 1, is_active: true },
    { id: "a-telur", nama: "Extra telur", maks_jumlah: null, is_active: false },
  ],
};
const pedas: GrupAturan = {
  id: "g-pedas",
  nama: "Level pedas",
  min_pilih: 1,
  maks_pilih: 1,
  addons: [
    { id: "p-sedang", nama: "Sedang", maks_jumlah: 1, is_active: true },
    { id: "p-pedas", nama: "Pedas", maks_jumlah: 1, is_active: true },
  ],
};
const G = [tambahan, pedas];

describe("validasiPilihanAddon — ketat (kasir online)", () => {
  it("pilihan sah: grup wajib terpenuhi, add-on opsional berjumlah", () => {
    expect(validasiPilihanAddon(G, [{ id: "p-pedas", jumlah: 1 }, { id: "a-mie", jumlah: 2 }])).toEqual({ ok: true });
  });

  it("grup wajib tak dipilih → ditolak dengan nama grupnya", () => {
    const h = validasiPilihanAddon(G, [{ id: "a-mie", jumlah: 1 }]);
    expect(h).toEqual({ ok: false, pesan: 'Pilih satu di grup "Level pedas"' });
  });

  it("melebihi maks_pilih grup → ditolak", () => {
    const h = validasiPilihanAddon(G, [
      { id: "p-pedas", jumlah: 1 },
      { id: "p-sedang", jumlah: 1 },
    ]);
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.pesan).toContain("Paling banyak 1");
  });

  it("jumlah melebihi maks_jumlah add-on → ditolak", () => {
    const h = validasiPilihanAddon(G, [{ id: "p-pedas", jumlah: 1 }, { id: "a-mie", jumlah: 4 }]);
    expect(h).toEqual({ ok: false, pesan: 'Add-on "Extra mie" paling banyak 3× per porsi' });
  });

  it("maks_jumlah null → dibatasi BATAS_JUMLAH_ADDON", () => {
    const g: GrupAturan = { ...tambahan, addons: [{ id: "x", nama: "X", maks_jumlah: null, is_active: true }] };
    expect(validasiPilihanAddon([g], [{ id: "x", jumlah: BATAS_JUMLAH_ADDON }]).ok).toBe(true);
    expect(validasiPilihanAddon([g], [{ id: "x", jumlah: BATAS_JUMLAH_ADDON + 1 }]).ok).toBe(false);
  });

  it("jumlah 0, pecahan, atau negatif → ditolak", () => {
    for (const jumlah of [0, 1.5, -1]) {
      expect(validasiPilihanAddon(G, [{ id: "p-pedas", jumlah: 1 }, { id: "a-mie", jumlah }]).ok, String(jumlah)).toBe(false);
    }
  });

  it("add-on nonaktif atau terhapus → tidak tersedia", () => {
    expect(validasiPilihanAddon(G, [{ id: "p-pedas", jumlah: 1 }, { id: "a-telur", jumlah: 1 }])).toEqual({
      ok: false,
      pesan: 'Add-on "Extra telur" sedang tidak tersedia',
    });
    const g: GrupAturan = { ...tambahan, addons: [{ id: "z", nama: "Z", maks_jumlah: null, is_active: true, terhapus: true }] };
    expect(validasiPilihanAddon([g], [{ id: "z", jumlah: 1 }]).ok).toBe(false);
  });

  it("id ganda dan id asing → ditolak", () => {
    expect(validasiPilihanAddon(G, [{ id: "p-pedas", jumlah: 1 }, { id: "p-pedas", jumlah: 1 }]).ok).toBe(false);
    expect(validasiPilihanAddon(G, [{ id: "p-pedas", jumlah: 1 }, { id: "milik-menu-lain", jumlah: 1 }])).toEqual({
      ok: false,
      pesan: "Add-on tidak dikenal untuk menu ini",
    });
  });

  it("grup wajib yang semua pilihannya nonaktif → pesan yang menyebut sebabnya", () => {
    const habis: GrupAturan = { ...pedas, addons: pedas.addons.map((a) => ({ ...a, is_active: false })) };
    const h = validasiPilihanAddon([habis], []);
    expect(h).toEqual({ ok: false, pesan: 'Grup "Level pedas" wajib, tapi pilihannya sedang tidak tersedia' });
  });

  it("grup terhapus tak lagi menuntut pilihan", () => {
    expect(validasiPilihanAddon([{ ...pedas, terhapus: true }], []).ok).toBe(true);
  });

  it("menu tanpa grup + tanpa pilihan → sah (baris lama tetap sah)", () => {
    expect(validasiPilihanAddon([], []).ok).toBe(true);
  });
});

describe("validasiPilihanAddon — lenien (penjualan offline disusulkan)", () => {
  it("add-on nonaktif/terhapus & grup wajib yang tak terpenuhi DITERIMA", () => {
    expect(validasiPilihanAddon(G, [{ id: "a-telur", jumlah: 5 }], { lenien: true }).ok).toBe(true);
  });

  it("tapi id asing & jumlah tak sah TETAP ditolak", () => {
    expect(validasiPilihanAddon(G, [{ id: "asing", jumlah: 1 }], { lenien: true }).ok).toBe(false);
    expect(validasiPilihanAddon(G, [{ id: "a-mie", jumlah: 0 }], { lenien: true }).ok).toBe(false);
  });
});

describe("tandaAddon, hargaAddon, ringkasAddon", () => {
  it("tanda tak bergantung urutan, bergantung jumlah", () => {
    const a = tandaAddon([{ id: "b", jumlah: 1 }, { id: "a", jumlah: 2 }]);
    expect(a).toBe(tandaAddon([{ id: "a", jumlah: 2 }, { id: "b", jumlah: 1 }]));
    expect(a).not.toBe(tandaAddon([{ id: "a", jumlah: 1 }, { id: "b", jumlah: 1 }]));
    expect(tandaAddon([])).toBe("");
  });

  it("harga = Σ harga × jumlah, dibulatkan ke sen", () => {
    expect(hargaAddon([{ harga: 3000, jumlah: 2 }, { harga: 0, jumlah: 1 }])).toBe(6000);
    expect(hargaAddon([{ harga: 0.1, jumlah: 3 }])).toBe(0.3);
    expect(hargaAddon([])).toBe(0);
  });

  it("ringkasan memakai 'x' ASCII (dicetak printer thermal)", () => {
    expect(ringkasAddon([{ nama: "Extra mie", jumlah: 2 }, { nama: "Pedas", jumlah: 1 }])).toBe("Extra mie x2, Pedas");
    expect(ringkasAddon(null)).toBe("");
  });
});
