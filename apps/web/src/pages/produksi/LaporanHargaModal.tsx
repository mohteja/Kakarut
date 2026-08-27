import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DampakLaporanHarga } from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
import { Modal, ErrorText, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
import type { FakturGroup } from "./TambahStokPage";

/**
 * LAPORAN HARGA — catat harga riil yang dibayar per bahan SETELAH belanja
 * diterima. Memperbarui total baris (harga riil utk HPP FIFO/resep) dan —
 * bila dicentang — menyegarkan harga ACUAN bahan ke median riwayat pembelian.
 * Setelah semua baris berharga final, faktur jadi "Selesai". Hanya jalur BELI.
 *
 * Panel dampak ada karena dua hal itu mudah tertukar: user mengira sedang
 * mencatat nota satu faktur, padahal harga acuan master ikut bergeser dan HPP
 * SEMUA menu yang memakai bahan itu ikut naik/turun. Sekarang pergeserannya
 * ditampilkan lebih dulu dan bisa dimatikan.
 */
export function LaporanHargaModal({
  grup,
  onClose,
}: {
  grup: FakturGroup;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // hanya baris yang tidak ditolak yang perlu dilaporkan harganya
  const rows = grup.rows.filter((r) => r.status !== "ditolak");
  const [harga, setHarga] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.total_harga != null ? teksAngka(r.total_harga) : ""])),
  );
  const [perbaruiAcuan, setPerbaruiAcuan] = useState(true);
  /**
   * Harga TERISI yang tak terbaca sebagai angka ≥ 0.
   *
   * Sebelum pagar ini, bentuknya `angkaDari(...) || 0` — dan NaN lolos jadi
   * NOL, bukan galat. Di layar inilah nol paling mahal:
   *
   *   1. `total_harga` baris ditimpa 0, padahal itulah harga per lot yang
   *      dipakai HPP FIFO;
   *   2. "Perbarui harga acuan" DEFAULTNYA menyala, jadi acuan bahan dihitung
   *      ulang ke MEDIAN riwayat pembelian — kini memuat satu pembelian Rp 0;
   *   3. acuan itu, seperti tertulis di kotak centangnya sendiri, dipakai RAB
   *      belanja berikutnya DAN perhitungan HPP semua menu;
   *   4. sesudah dilaporkan fakturnya berstatus "Selesai" — kesempatan
   *      memperbaikinya lewat layar ini tertutup.
   *
   * Yang paling menyesatkan: panel dampak di bawah dihitung dari `items` yang
   * sama, jadi ia MENAMPILKAN jatuhnya harga acuan itu — dengan warna HIJAU,
   * karena hijau berarti "acuan turun". Satu-satunya panel yang dibuat untuk
   * menangkap kejutan malah melukiskannya sebagai kabar baik.
   *
   * Baris tak terbaca juga dikeluarkan dari `items` supaya pratinjau dampaknya
   * tidak ikut berbohong selama orangnya masih mengetik.
   */
  const salahKetik = rows.filter(
    (r) => (harga[r.id] ?? "").trim() !== "" && !(angkaDari(harga[r.id]) >= 0),
  );
  const items = rows
    .filter((r) => (harga[r.id] ?? "").trim() !== "" && angkaDari(harga[r.id]) >= 0)
    .map((r) => ({ id: r.id, total_harga: angkaDari(harga[r.id]) }));
  const total = items.reduce((t, it) => t + it.total_harga, 0);

  // Dampak dihitung dari angka yang SEDANG diketik, jadi ditunda sebentar
  // supaya tiap ketukan tombol tidak memicu satu request.
  const kunci = JSON.stringify(items);
  const [kunciTunda, setKunciTunda] = useState(kunci);
  useEffect(() => {
    const t = setTimeout(() => setKunciTunda(kunci), 600);
    return () => clearTimeout(t);
  }, [kunci]);

  const { data: dampak, isFetching: dampakJalan, error: dampakGagal } = useQuery({
    queryKey: ["laporan-harga-dampak", grup.fakturId, kunciTunda],
    enabled: perbaruiAcuan && kunciTunda !== "[]",
    queryFn: () =>
      api<DampakLaporanHarga>(`/pembelian/laporan-harga/${grup.fakturId}/dampak`, {
        method: "POST",
        body: { items: JSON.parse(kunciTunda) },
      }),
  });

  const simpan = useMutation({
    mutationFn: () =>
      api(`/pembelian/laporan-harga/${grup.fakturId}`, {
        method: "POST",
        body: { items, perbarui_acuan: perbaruiAcuan },
      }),
    onSuccess: () => {
      // segarkan daftar faktur (total + status Selesai) + master bahan + stok
      queryClient.invalidateQueries({ queryKey: ["/pembelian"] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP ikut bergerak
      onClose();
    },
  });
  // ada minimal satu harga terisi → boleh simpan
  const adaIsi = items.length > 0;
  const bergerak = (dampak?.bahan ?? []).filter((b) => b.acuan_baru !== b.acuan_lama);

  return (
    <Modal open onClose={onClose} title="💰 Laporan Harga" lebar="max-w-lg">
      <div className="space-y-3">
        <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-800">
          Catat <b>harga yang benar-benar dibayar</b> tiap bahan sesuai nota belanja — memperbarui
          harga acuan yang jadi dasar HPP resep &amp; laba-rugi, dan tercatat per lot di kartu
          persediaan. Setelah dilaporkan, faktur ini berstatus{" "}
          <b>✅ Selesai</b>.
        </div>
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-stone-700" title={r.bahan}>
                {r.bahan}
                <span className="ml-1 text-xs font-normal text-stone-400">
                  {formatAngka(r.qty)} {r.satuan}
                </span>
              </span>
              <span className="text-xs text-stone-400">Rp</span>
              <input
                type="text"
                inputMode="decimal"
                value={harga[r.id] ?? ""}
                onChange={(e) => setHarga((s) => ({ ...s, [r.id]: e.target.value }))}
                placeholder="0"
                className={`${inputClass} max-w-32 text-right`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold text-stone-800">
          <span>Total dilaporkan</span>
          <span>{formatRupiah(total)}</span>
        </div>

        <div className="rounded-lg border border-stone-200 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={perbaruiAcuan}
              onChange={(e) => setPerbaruiAcuan(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <b>Perbarui harga acuan bahan</b> ke median riwayat pembelian
              <span className="block text-xs text-stone-500">
                Mencatat nota <b>tidak sama dengan</b> mengubah harga acuan. Acuan dipakai RAB
                belanja berikutnya <b>dan</b> perhitungan HPP semua menu. Matikan bila nota ini
                tidak mewakili harga pasar (mis. beli eceran darurat).
              </span>
            </span>
          </label>

          {perbaruiAcuan && adaIsi && (
            <div className="mt-2 border-t border-stone-200 pt-2 text-sm">
              {dampakJalan && !dampak ? (
                <span className="text-xs text-stone-400">Menghitung dampak…</span>
              ) : bergerak.length === 0 ? (
                <span className="text-xs text-stone-500">
                  Harga acuan tidak bergeser dengan angka ini.
                </span>
              ) : (
                <>
                  <div className="mb-1 text-xs font-semibold text-stone-500">
                    Harga acuan yang akan bergeser
                  </div>
                  <div className="space-y-0.5">
                    {bergerak.map((b) => {
                      const naik = b.acuan_baru > b.acuan_lama;
                      return (
                        <div key={b.ingredient_id} className="flex items-baseline gap-1 text-xs">
                          <span className="min-w-0 flex-1 truncate text-stone-700">{b.nama}</span>
                          <span className="text-stone-400">
                            {formatRupiah(b.acuan_lama)}/{b.satuan} →
                          </span>
                          <span className={naik ? "font-semibold text-red-600" : "font-semibold text-green-600"}>
                            {formatRupiah(b.acuan_baru)}
                          </span>
                          {b.jumlah_menu_terdampak > 0 && (
                            <span className="text-stone-400">· {b.jumlah_menu_terdampak} menu</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <ErrorText error={dampakGagal} />
                  {(dampak?.menu_lewat_ambang.length ?? 0) > 0 && (
                    <div className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
                      <b>{dampak!.menu_lewat_ambang.length} menu</b> akan melewati ambang food cost{" "}
                      {formatAngka(dampak!.food_cost_maks, 0)}%:{" "}
                      {dampak!.menu_lewat_ambang
                        .slice(0, 5)
                        .map((m) => `${m.nama} (${m.food_cost_baru.toFixed(0)}%)`)
                        .join(", ")}
                      {dampak!.menu_lewat_ambang.length > 5 && " …"}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {salahKetik.length > 0 && (
          <div className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800">
            Harga tidak terbaca pada <b>{salahKetik.map((r) => r.bahan).join(", ")}</b> — tulis
            angkanya saja, seperti <b>125000</b> atau <b>125.000</b>. Kosongkan bila baris itu
            belum mau dilaporkan.
          </div>
        )}
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary} disabled={simpan.isPending}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={!adaIsi || salahKetik.length > 0 || simpan.isPending}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "💾 Simpan Laporan Harga"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
