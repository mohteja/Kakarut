import { useMemo, useState } from "react";
import {
  BATAS_JUMLAH_ADDON,
  hargaAddon,
  validasiPilihanAddon,
  type AddonBarisDto,
  type MenuAddonDto,
  type MenuAddonGroupDto,
  type MenuDto,
} from "@kakarut/shared";
import { Modal, btnPrimary } from "../../components/ui";
import { formatRupiah } from "../../lib/format";

/** Menu ini menawarkan add-on yang bisa dipilih saat ini? */
export function butuhPemilihAddon(menu: MenuDto): boolean {
  return (menu.addon_groups ?? []).some((g) => g.addons.some((a) => a.is_active));
}

/** Pilihan pemilih → snapshot baris keranjang (urut seperti form menu). */
function keSnapshot(groups: MenuAddonGroupDto[], jumlah: Map<string, number>): AddonBarisDto[] {
  return groups.flatMap((g) =>
    g.addons
      .filter((a) => (jumlah.get(a.id) ?? 0) > 0)
      .map((a) => ({ addon_id: a.id, grup_nama: g.nama, nama: a.nama, harga: a.harga, jumlah: jumlah.get(a.id)! })),
  );
}

function labelAturan(g: MenuAddonGroupDto): string {
  if (g.min_pilih >= 1 && g.maks_pilih === g.min_pilih) return g.min_pilih === 1 ? "Wajib pilih 1" : `Wajib pilih ${g.min_pilih}`;
  if (g.min_pilih >= 1) return g.maks_pilih ? `Wajib, ${g.min_pilih}–${g.maks_pilih}` : `Wajib, min ${g.min_pilih}`;
  return g.maks_pilih ? `Opsional, maks ${g.maks_pilih}` : "Opsional";
}

/**
 * PEMILIH ADD-ON KASIR — muncul saat menu ber-add-on diketuk.
 *
 * Grup ber-`maks_pilih` 1 berlaku seperti radio (memilih yang lain mengganti
 * pilihan); add-on yang boleh berjumlah ("Extra mie ×2") punya stepper. Tombol
 * Tambah hanya menyala bila `validasiPilihanAddon` — aturan yang SAMA dengan
 * server — menyetujuinya, jadi kasir tak pernah ditolak di saat bayar.
 */
export function AddonPickerModal({
  menu,
  onClose,
  onPilih,
}: {
  menu: MenuDto | null;
  onClose: () => void;
  onPilih: (menu: MenuDto, addons: AddonBarisDto[]) => void;
}) {
  // Komponen dalam di-key per menu: membuka menu lain mulai dari pilihan kosong.
  return (
    <Modal open={menu !== null} onClose={onClose} title={menu?.nama ?? ""}>
      {menu && <IsiPemilih key={menu.id} menu={menu} onPilih={onPilih} />}
    </Modal>
  );
}

function IsiPemilih({ menu, onPilih }: { menu: MenuDto; onPilih: (menu: MenuDto, addons: AddonBarisDto[]) => void }) {
  const groups = menu.addon_groups;
  const [jumlah, setJumlah] = useState<Map<string, number>>(new Map());
  const snapshot = useMemo(() => keSnapshot(groups, jumlah), [groups, jumlah]);
  const hasil = useMemo(
    () => validasiPilihanAddon(groups, snapshot.map((a) => ({ id: a.addon_id!, jumlah: a.jumlah }))),
    [groups, snapshot],
  );
  const harga = menu.harga_jual + hargaAddon(snapshot);

  function atur(g: MenuAddonGroupDto, a: MenuAddonDto, n: number) {
    setJumlah((prev) => {
      const next = new Map(prev);
      // Radio: grup yang hanya boleh SATU pilihan mengganti pilihan lamanya.
      if (n > 0 && g.maks_pilih === 1) for (const lain of g.addons) if (lain.id !== a.id) next.delete(lain.id);
      if (n <= 0) next.delete(a.id);
      else next.set(a.id, n);
      return next;
    });
  }

  return (
    <div>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => {
          const dipilih = g.addons.filter((a) => (jumlah.get(a.id) ?? 0) > 0).length;
          return (
            <div key={g.id} data-testid="pemilih-grup">
              <div className="mb-1 flex items-center justify-between">
                <div className="font-semibold text-stone-800">{g.nama}</div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    g.min_pilih >= 1
                      ? dipilih >= g.min_pilih
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {labelAturan(g)}
                </span>
              </div>
              <div className="space-y-1.5">
                {g.addons.map((a) => {
                  const n = jumlah.get(a.id) ?? 0;
                  const maks = a.maks_jumlah ?? BATAS_JUMLAH_ADDON;
                  const habis = !a.is_active;
                  const penuhGrup = g.maks_pilih !== null && g.maks_pilih !== 1 && dipilih >= g.maks_pilih && n === 0;
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                        n > 0 ? "border-orange-500 bg-orange-50" : "border-stone-200"
                      } ${habis ? "opacity-50" : ""}`}
                    >
                      <button
                        type="button"
                        disabled={habis || penuhGrup}
                        onClick={() => atur(g, a, n > 0 ? 0 : 1)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center border text-xs ${
                            g.maks_pilih === 1 ? "rounded-full" : "rounded"
                          } ${n > 0 ? "border-orange-600 bg-orange-600 text-white" : "border-stone-300"}`}
                        >
                          {n > 0 ? "✓" : ""}
                        </span>
                        <span className="truncate text-sm font-medium text-stone-800">{a.nama}</span>
                        {habis && <span className="text-[11px] text-stone-500">habis</span>}
                      </button>
                      <span className={`shrink-0 text-xs ${a.harga > 0 ? "text-stone-600" : "font-semibold text-emerald-600"}`}>
                        {a.harga > 0 ? `+${formatRupiah(a.harga)}` : "Gratis"}
                      </span>
                      {maks > 1 && n > 0 && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => atur(g, a, n - 1)}
                            className="h-7 w-7 rounded-md border border-stone-300 text-sm"
                            aria-label={`Kurangi ${a.nama}`}
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm font-semibold">×{n}</span>
                          <button
                            type="button"
                            disabled={n >= maks}
                            onClick={() => atur(g, a, n + 1)}
                            className="h-7 w-7 rounded-md border border-stone-300 text-sm disabled:opacity-40"
                            aria-label={`Tambah ${a.nama}`}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {!hasil.ok && snapshot.length > 0 && <p className="mt-3 text-sm text-red-600">{hasil.pesan}</p>}
      <button
        type="button"
        disabled={!hasil.ok}
        onClick={() => onPilih(menu, snapshot)}
        className={`${btnPrimary} mt-4 w-full`}
      >
        Tambah · {formatRupiah(harga)}
      </button>
    </div>
  );
}
