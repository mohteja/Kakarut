import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BahanKategori, SatuanDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, btnPrimary, btnSecondary } from "../../components/ui";
import { api } from "../../lib/api";

/** Satu baris input bahan baku (nilai numerik sebagai string sampai disimpan). */
interface Baris {
  kode: string;
  nama: string;
  harga_beli: string;
  isi: string;
  satuan: string;
  kategori: BahanKategori;
  boleh_eceran: boolean;
  track_stok: boolean;
  stok_minimum: string;
}

const cell = "rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none";

function barisKosong(satuan: string): Baris {
  return {
    kode: "",
    nama: "",
    harga_beli: "",
    isi: "1",
    satuan,
    kategori: "lain",
    boleh_eceran: false,
    track_stok: true,
    stok_minimum: "0",
  };
}

/**
 * Tambah Bahan Baku (multi-baris) — halaman tersendiri, bukan modal. Owner/admin
 * memasukkan banyak bahan sekaligus (jalur BELI). Kode kosong → otomatis dari
 * nama saat disimpan. Bahan PRODUKSI dibuat terpisah di halaman Resep.
 */
export function TambahBahanBakuPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: satuanList } = useQuery({
    queryKey: ["satuan"],
    queryFn: () => api<SatuanDto[]>("/satuan"),
  });
  const satuanDefault = satuanList?.some((s) => s.nama === "pcs")
    ? "pcs"
    : satuanList?.[0]?.nama ?? "pcs";

  const [rows, setRows] = useState<Baris[]>(() => [
    barisKosong("pcs"),
    barisKosong("pcs"),
    barisKosong("pcs"),
  ]);

  const ubah = (i: number, patch: Partial<Baris>) =>
    setRows((r) => r.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const tambahBaris = () => setRows((r) => [...r, barisKosong(satuanDefault)]);
  const hapusBaris = (i: number) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r));

  // baris valid: punya nama & isi > 0 (harga boleh 0)
  const valid = rows.filter((b) => b.nama.trim() !== "" && Number(b.isi) > 0);

  const simpan = useMutation({
    mutationFn: () =>
      api<{ jumlah: number }>("/bahan/bulk", {
        method: "POST",
        body: {
          items: valid.map((b) => ({
            kode: b.kode.trim() || null,
            nama: b.nama.trim(),
            harga_beli: Number(b.harga_beli) || 0,
            isi: Number(b.isi),
            satuan: b.satuan.trim() || "pcs",
            kategori: b.kategori,
            track_stok: b.track_stok,
            stok_minimum: Number(b.stok_minimum) || 0,
            boleh_eceran: b.boleh_eceran,
          })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      navigate("/bahan");
    },
  });

  return (
    <div>
      <PageTitle
        aksi={
          <button onClick={() => navigate("/bahan")} className={btnSecondary}>
            ← Kembali
          </button>
        }
      >
        Tambah Bahan Baku
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Masukkan beberapa bahan sekaligus (jalur <b>beli</b>). Kode dikosongkan → dibuat otomatis
        dari nama. Bahan yang <b>diproduksi sendiri</b> dibuat di menu <b>Resep</b>.
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Kode</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Nama *</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Harga beli</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Qty/isi *</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Satuan</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Kategori</th>
              <th className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">Ecer</th>
              <th className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">Lacak</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Stok min</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((b, i) => (
              <tr key={i} className="align-middle">
                <td className="px-2 py-1.5">
                  <input
                    value={b.kode}
                    onChange={(e) => ubah(i, { kode: e.target.value })}
                    placeholder="otomatis"
                    className={`${cell} w-24`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={b.nama}
                    onChange={(e) => ubah(i, { nama: e.target.value })}
                    placeholder="Nama bahan"
                    className={`${cell} w-44`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={b.harga_beli}
                    onChange={(e) => ubah(i, { harga_beli: e.target.value })}
                    placeholder="0"
                    className={`${cell} w-28`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={b.isi}
                    onChange={(e) => ubah(i, { isi: e.target.value })}
                    className={`${cell} w-20`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={b.satuan}
                    onChange={(e) => ubah(i, { satuan: e.target.value })}
                    className={`${cell} w-24`}
                  >
                    {!satuanList?.some((s) => s.nama === b.satuan) && b.satuan && (
                      <option value={b.satuan}>{b.satuan}</option>
                    )}
                    {(satuanList ?? []).map((s) => (
                      <option key={s.id} value={s.nama}>
                        {s.nama}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={b.kategori}
                    onChange={(e) => ubah(i, { kategori: e.target.value as BahanKategori })}
                    className={`${cell} w-28`}
                  >
                    <option value="baso">baso</option>
                    <option value="minuman">minuman</option>
                    <option value="lain">lain</option>
                  </select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={b.boleh_eceran}
                    onChange={(e) => ubah(i, { boleh_eceran: e.target.checked })}
                    title="Bisa dibeli eceran (tanpa pembulatan per kemasan)"
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={b.track_stok}
                    onChange={(e) => ubah(i, { track_stok: e.target.checked })}
                    title="Lacak stok bahan ini"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={b.stok_minimum}
                    onChange={(e) => ubah(i, { stok_minimum: e.target.value })}
                    className={`${cell} w-20`}
                    disabled={!b.track_stok}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => hapusBaris(i)}
                    className="text-sm font-medium text-red-500 hover:underline disabled:opacity-30"
                    disabled={rows.length <= 1}
                    aria-label="Hapus baris"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={tambahBaris} className={btnSecondary}>
          + Tambah baris
        </button>
        <div className="flex-1 text-sm text-stone-500">
          {valid.length} bahan siap disimpan
        </div>
        <button
          type="button"
          onClick={() => simpan.mutate()}
          disabled={valid.length === 0 || simpan.isPending}
          className={btnPrimary}
        >
          {simpan.isPending ? "Menyimpan…" : `Simpan semua (${valid.length})`}
        </button>
      </div>
      <div className="mt-2">
        <ErrorText error={simpan.error} />
      </div>
    </div>
  );
}
