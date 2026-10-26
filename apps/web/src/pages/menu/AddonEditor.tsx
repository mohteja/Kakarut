import { useMemo, useState } from "react";
import {
  BATAS_JUMLAH_ADDON,
  angkaDari,
  teksAngka,
  type BahanDto,
  type MenuAddonGroupDto,
  type MenuDto,
} from "@kakarut/shared";
import { BahanPicker } from "../../components/BahanPicker";
import { Card, Modal, btnSecondary, inputClass } from "../../components/ui";
import { formatRupiah } from "../../lib/format";

/**
 * EDITOR ADD-ON per menu — grup (mis. "Level pedas", wajib pilih 1) berisi
 * add-on gratis atau berharga ("Extra mie" Rp3.000, "Tanpa sayur" gratis).
 * Add-on bisa ditautkan ke bahan dengan takaran yang DITAMBAH atau DIKURANGI
 * per satu kali pilih, supaya stok & HPP tetap jujur.
 *
 * Angka disimpan sebagai TEKS selama diketik (sama seperti takaran resep):
 * "0,5" yang sedang diketik tak boleh berubah jadi 0 di tengah jalan.
 */
export interface AddonForm {
  id?: string;
  nama: string;
  harga: string;
  /** "" = s/d BATAS_JUMLAH_ADDON per porsi */
  maksJumlah: string;
  isActive: boolean;
  ingredientId: string;
  /** takaran per satu kali pilih, selalu positif di form — arahnya terpisah */
  qty: string;
  arah: "tambah" | "kurang";
  /** dari server (owner/admin) — hanya untuk add-on yang sudah tersimpan */
  hppDelta?: number | null;
}

export interface GrupForm {
  id?: string;
  nama: string;
  wajib: boolean;
  /** dipakai bila wajib; "" = 1 */
  minPilih: string;
  /** "" = bebas */
  maksPilih: string;
  addons: AddonForm[];
}

export function grupDariDto(groups: MenuAddonGroupDto[], denganId = true): GrupForm[] {
  return groups.map((g) => ({
    ...(denganId ? { id: g.id } : {}),
    nama: g.nama,
    wajib: g.min_pilih >= 1,
    minPilih: g.min_pilih >= 1 ? String(g.min_pilih) : "",
    maksPilih: g.maks_pilih == null ? "" : String(g.maks_pilih),
    addons: g.addons.map((a) => ({
      ...(denganId ? { id: a.id, hppDelta: a.hpp_delta } : {}),
      nama: a.nama,
      harga: teksAngka(a.harga),
      maksJumlah: a.maks_jumlah == null ? "" : String(a.maks_jumlah),
      isActive: a.is_active,
      ingredientId: a.ingredient_id ?? "",
      qty: a.qty_bahan == null ? "" : teksAngka(Math.abs(a.qty_bahan)),
      arah: (a.qty_bahan ?? 0) < 0 ? "kurang" : "tambah",
    })),
  }));
}

/** Bentuk badan `addon_groups` untuk POST/PUT /menu. */
export function grupKeBody(groups: GrupForm[]) {
  return groups.map((g) => ({
    ...(g.id ? { id: g.id } : {}),
    nama: g.nama.trim(),
    min_pilih: g.wajib ? Math.max(1, Math.round(angkaDari(g.minPilih || "1"))) : 0,
    maks_pilih: g.maksPilih.trim() ? Math.round(angkaDari(g.maksPilih)) : null,
    addons: g.addons.map((a) => {
      const qty = angkaDari(a.qty);
      const bertaut = Boolean(a.ingredientId) && qty > 0;
      return {
        ...(a.id ? { id: a.id } : {}),
        nama: a.nama.trim(),
        harga: angkaDari(a.harga || "0"),
        maks_jumlah: a.maksJumlah.trim() ? Math.round(angkaDari(a.maksJumlah)) : null,
        ingredient_id: bertaut ? a.ingredientId : null,
        qty_bahan: bertaut ? (a.arah === "kurang" ? -qty : qty) : null,
        is_active: a.isActive,
      };
    }),
  }));
}

/** Masalah yang menahan tombol Simpan — ditulis untuk admin, bukan developer. */
export function masalahGrup(groups: GrupForm[]): string | null {
  const namaGrup = new Set<string>();
  for (const g of groups) {
    if (!g.nama.trim()) return "Ada grup add-on tanpa nama.";
    const k = g.nama.trim().toLowerCase();
    if (namaGrup.has(k)) return `Nama grup "${g.nama.trim()}" dipakai dua kali.`;
    namaGrup.add(k);
    if (g.addons.length === 0) return `Grup "${g.nama.trim()}" belum punya pilihan.`;
    const min = g.wajib ? Math.max(1, Math.round(angkaDari(g.minPilih || "1"))) : 0;
    const maks = g.maksPilih.trim() ? Math.round(angkaDari(g.maksPilih)) : null;
    if (maks !== null && maks < 1) return `Grup "${g.nama.trim()}": maks pilih minimal 1 (kosongkan = bebas).`;
    if (maks !== null && min > maks) return `Grup "${g.nama.trim()}": minimal pilih melebihi maksimal pilih.`;
    if (min > g.addons.length) return `Grup "${g.nama.trim()}": wajib pilih ${min}, tapi pilihannya cuma ${g.addons.length}.`;
    const namaAddon = new Set<string>();
    for (const a of g.addons) {
      if (!a.nama.trim()) return `Grup "${g.nama.trim()}": ada add-on tanpa nama.`;
      const harga = angkaDari(a.harga || "0");
      if (Number.isNaN(harga) || harga < 0) return `Add-on "${a.nama.trim()}": harga tidak terbaca.`;
      if (namaAddon.has(a.nama.trim().toLowerCase())) return `Add-on "${a.nama.trim()}" dipakai dua kali.`;
      namaAddon.add(a.nama.trim().toLowerCase());
      if (a.ingredientId && !(angkaDari(a.qty) > 0)) return `Add-on "${a.nama.trim()}": isi takaran bahannya.`;
      const mj = a.maksJumlah.trim() ? angkaDari(a.maksJumlah) : null;
      if (mj !== null && (!(mj >= 1) || mj > BATAS_JUMLAH_ADDON)) {
        return `Add-on "${a.nama.trim()}": maks per porsi 1–${BATAS_JUMLAH_ADDON}.`;
      }
    }
  }
  return null;
}

const addonBaru = (): AddonForm => ({
  nama: "",
  harga: "0",
  maksJumlah: "1",
  isActive: true,
  ingredientId: "",
  qty: "",
  arah: "tambah",
});

export function AddonEditor({
  value,
  onChange,
  bahan,
  menus,
  selfId,
  lihatBiaya,
}: {
  value: GrupForm[];
  onChange: (v: GrupForm[]) => void;
  bahan: BahanDto[];
  menus: MenuDto[] | undefined;
  selfId?: string;
  lihatBiaya: boolean;
}) {
  const [salinBuka, setSalinBuka] = useState(false);
  const [cari, setCari] = useState("");
  const bahanById = useMemo(() => new Map(bahan.map((b) => [b.id, b])), [bahan]);
  const sumber = useMemo(
    () =>
      (menus ?? [])
        .filter((m) => m.id !== selfId && m.addon_groups.length > 0)
        .filter((m) => m.nama.toLowerCase().includes(cari.trim().toLowerCase())),
    [menus, selfId, cari],
  );

  const ubahGrup = (i: number, p: Partial<GrupForm>) =>
    onChange(value.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const ubahAddon = (gi: number, ai: number, p: Partial<AddonForm>) =>
    ubahGrup(gi, { addons: value[gi].addons.map((a, j) => (j === ai ? { ...a, ...p } : a)) });

  /**
   * SALIN SEKALI: grup menu lain disalin TANPA id — salinan mandiri yang bisa
   * diedit, tak tertaut ke sumbernya. Nama grup yang bentrok diberi akhiran.
   */
  function salinDari(m: MenuDto) {
    const dipakai = new Set(value.map((g) => g.nama.trim().toLowerCase()));
    const salinan = grupDariDto(m.addon_groups, false).map((g) => {
      let nama = g.nama;
      for (let n = 2; dipakai.has(nama.toLowerCase()); n++) nama = `${g.nama} ${n}`;
      dipakai.add(nama.toLowerCase());
      return { ...g, nama };
    });
    onChange([...value, ...salinan]);
    setSalinBuka(false);
    setCari("");
  }

  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-700">Add-on ({value.length} grup)</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSalinBuka(true)} className={btnSecondary}>
            Salin add-on dari menu…
          </button>
          <button
            type="button"
            onClick={() =>
              onChange([...value, { nama: "", wajib: false, minPilih: "", maksPilih: "", addons: [addonBaru()] }])
            }
            className={btnSecondary}
          >
            + Tambah grup
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-stone-500">
        Pilihan yang ditawarkan kasir saat menu ini masuk keranjang — mis. <b>Extra mie</b> (berbayar) atau{" "}
        <b>Tanpa sayur</b> (gratis). Tercetak di tiket dapur, papan pesanan, bon, dan struk. Harga add-on
        ditambahkan ke harga menu.
      </p>
      <div className="space-y-4">
        {value.map((g, gi) => (
          <div key={gi} className="rounded-lg border border-stone-200 p-3" data-testid="grup-addon">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-stone-500">Nama grup</label>
                <input
                  value={g.nama}
                  onChange={(e) => ubahGrup(gi, { nama: e.target.value })}
                  placeholder="mis. Level pedas / Tambahan"
                  maxLength={60}
                  className={inputClass}
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={g.wajib}
                  onChange={(e) => ubahGrup(gi, { wajib: e.target.checked })}
                />
                Wajib dipilih
              </label>
              {g.wajib && (
                <div className="w-24">
                  <label className="mb-1 block text-xs font-medium text-stone-500">Min pilih</label>
                  <input
                    inputMode="numeric"
                    value={g.minPilih}
                    onChange={(e) => ubahGrup(gi, { minPilih: e.target.value.replace(/\D/g, "") })}
                    placeholder="1"
                    className={inputClass}
                  />
                </div>
              )}
              <div className="w-28">
                <label className="mb-1 block text-xs font-medium text-stone-500">Maks pilih</label>
                <input
                  inputMode="numeric"
                  value={g.maksPilih}
                  onChange={(e) => ubahGrup(gi, { maksPilih: e.target.value.replace(/\D/g, "") })}
                  placeholder="bebas"
                  className={inputClass}
                />
              </div>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== gi))}
                className="pb-2 text-red-500 hover:text-red-700"
                aria-label="Hapus grup"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {g.addons.map((a, ai) => {
                const b = a.ingredientId ? bahanById.get(a.ingredientId) : undefined;
                const gratis = angkaDari(a.harga || "0") === 0;
                return (
                  <div key={ai} className="rounded-md bg-stone-50 p-2" data-testid="baris-addon">
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_8rem_7rem_auto_auto]">
                      <input
                        value={a.nama}
                        onChange={(e) => ubahAddon(gi, ai, { nama: e.target.value })}
                        placeholder="Nama add-on (mis. Extra mie)"
                        maxLength={60}
                        aria-label="Nama add-on"
                        className={`${inputClass} col-span-2 md:col-span-1`}
                      />
                      <div className="relative">
                        <input
                          value={a.harga}
                          // Koma/titik DIPERTAHANKAN: harga tersimpan bisa
                          // berdesimal ("2500,5" dari `teksAngka`), dan
                          // membuang komanya diam-diam menjadikannya 25005.
                          inputMode="decimal"
                          onChange={(e) => ubahAddon(gi, ai, { harga: e.target.value.replace(/[^\d.,]/g, "") })}
                          aria-label="Harga add-on"
                          className={inputClass}
                        />
                        <span
                          className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs ${gratis ? "font-semibold text-green-600" : "text-stone-400"}`}
                        >
                          {gratis ? "Gratis" : "Rp"}
                        </span>
                      </div>
                      <input
                        inputMode="numeric"
                        value={a.maksJumlah}
                        onChange={(e) => ubahAddon(gi, ai, { maksJumlah: e.target.value.replace(/\D/g, "") })}
                        placeholder={`maks ×${BATAS_JUMLAH_ADDON}`}
                        title="Berapa kali boleh dipilih per porsi (mis. Extra mie ×2). Kosong = s/d 20."
                        aria-label="Maks per porsi"
                        className={inputClass}
                      />
                      <label className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={a.isActive}
                          onChange={(e) => ubahAddon(gi, ai, { isActive: e.target.checked })}
                        />
                        Tersedia
                      </label>
                      <button
                        type="button"
                        onClick={() => ubahGrup(gi, { addons: g.addons.filter((_, j) => j !== ai) })}
                        className="text-red-500 hover:text-red-700"
                        aria-label="Hapus add-on"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-xs text-stone-500">Bahan (opsional):</span>
                      <BahanPicker
                        bahan={bahan}
                        value={a.ingredientId}
                        onChange={(id) => ubahAddon(gi, ai, { ingredientId: id })}
                        placeholder="— tanpa bahan —"
                        className="min-w-[12rem] flex-1"
                      />
                      {a.ingredientId && (
                        <>
                          <div className="inline-flex overflow-hidden rounded-md border border-stone-300 text-xs">
                            {(["tambah", "kurang"] as const).map((arah) => (
                              <button
                                key={arah}
                                type="button"
                                onClick={() => ubahAddon(gi, ai, { arah })}
                                className={`px-2 py-1 ${a.arah === arah ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                              >
                                {arah === "tambah" ? "+ Tambah" : "− Kurangi"}
                              </button>
                            ))}
                          </div>
                          <input
                            inputMode="decimal"
                            value={a.qty}
                            onChange={(e) => ubahAddon(gi, ai, { qty: e.target.value })}
                            placeholder="takaran"
                            aria-label="Takaran bahan add-on"
                            className={`${inputClass} w-24`}
                          />
                          <span className="text-xs text-stone-500">{b?.satuan} / pilih</span>
                          <button
                            type="button"
                            onClick={() => ubahAddon(gi, ai, { ingredientId: "", qty: "" })}
                            className="text-xs text-stone-400 hover:text-stone-700"
                          >
                            lepas
                          </button>
                        </>
                      )}
                      {lihatBiaya && a.hppDelta != null && (
                        <span className="text-xs text-stone-500">
                          HPP {a.hppDelta >= 0 ? "+" : "−"}
                          {formatRupiah(Math.abs(a.hppDelta))}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => ubahGrup(gi, { addons: [...g.addons, addonBaru()] })}
                className="text-sm font-medium text-orange-600 hover:underline"
              >
                + Tambah pilihan
              </button>
            </div>
          </div>
        ))}
        {value.length === 0 && (
          <div className="py-3 text-center text-sm text-stone-400">
            Tanpa add-on — menu langsung masuk keranjang saat diketuk kasir.
          </div>
        )}
      </div>

      <Modal open={salinBuka} onClose={() => setSalinBuka(false)} title="Salin add-on dari menu">
        <p className="mb-3 text-sm text-stone-500">
          Grup add-on menu yang dipilih disalin ke form ini sebagai salinan <b>mandiri</b> — mengubahnya
          nanti tak mengubah menu sumbernya.
        </p>
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari menu…"
          className={`${inputClass} mb-3`}
          autoFocus
        />
        <div className="space-y-2">
          {sumber.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => salinDari(m)}
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-left hover:border-orange-400 hover:bg-orange-50"
            >
              <div className="font-semibold text-stone-800">{m.nama}</div>
              <div className="text-xs text-stone-500">
                {m.addon_groups.map((g) => `${g.nama} (${g.addons.length})`).join(" · ")}
              </div>
            </button>
          ))}
          {sumber.length === 0 && (
            <div className="py-4 text-center text-sm text-stone-400">Belum ada menu lain yang punya add-on.</div>
          )}
        </div>
      </Modal>
    </Card>
  );
}
