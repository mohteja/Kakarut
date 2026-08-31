import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SampahRow } from "@kakarut/shared";
import {
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
} from "../components/ui";
import { TabelResponsif } from "../components/TabelResponsif";
import { api, bacaTerpotong } from "../lib/api";
import { formatRupiah, formatWaktu } from "../lib/format";

const JENIS: Record<SampahRow["jenis"], { label: string; cls: string }> = {
  penjualan: { label: "Penjualan", cls: "bg-orange-100 text-orange-700" },
  pembelian: { label: "Pembelian", cls: "bg-blue-100 text-blue-700" },
  produksi: { label: "Produksi", cls: "bg-purple-100 text-purple-700" },
};

/** Tempat Sampah: transaksi yang di-soft-delete — bisa DIPULIHKAN kembali. */
export function TempatSampahPage() {
  const queryClient = useQueryClient();
  /*
   * Daftarnya BERLANGIT-LANGIT sejak balasan ini bisa mencapai 2,44 MB pada
   * 10.000 penjualan yang pernah dihapus. Bentuknya tetap larik (build ponsel
   * yang sudah terpasang membacanya `as List`), jadi pemotongannya datang
   * lewat header — dan halaman ini WAJIB mengatakannya. Daftar yang dipotong
   * diam-diam membuat orang menyimpulkan transaksinya sudah hilang permanen
   * padahal cuma tak ditampilkan.
   */
  const [terpotong, setTerpotong] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["sampah"],
    queryFn: () =>
      api<SampahRow[]>("/sampah", {
        bacaHeader: bacaTerpotong(setTerpotong),
      }),
  });
  const list = data ?? [];
  const [konfirmasiKosong, setKonfirmasiKosong] = useState(false);

  const pulihkan = useMutation({
    mutationFn: (r: SampahRow) =>
      api("/sampah/pulihkan", { method: "POST", body: { jenis: r.jenis, key: r.key } }),
    onSuccess: () => {
      // stok/laporan/daftar transaksi langsung terhitung lagi. Daftar transaksi
      // itu "riwayat" + "transaksi-detail" — "penjualan" cuma nama endpoint-nya
      // dan tak dipakai sebagai kunci query mana pun.
      for (const key of [
        "sampah",
        "stok",
        "laporan",
        "riwayat",
        "transaksi-detail",
        "/pembelian",
        "/produksi",
        "rekomendasi",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const kosongkan = useMutation({
    mutationFn: () => api<{ ok: true; penjualan: number; faktur: number }>("/sampah/kosongkan", { method: "POST" }),
    onSuccess: () => {
      setKonfirmasiKosong(false);
      queryClient.invalidateQueries({ queryKey: ["sampah"] });
    },
  });

  return (
    <div className="max-w-5xl">
      <PageTitle
        aksi={
          list.length > 0 ? (
            <button
              onClick={() => setKonfirmasiKosong(true)}
              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              🗑 Kosongkan Tempat Sampah
            </button>
          ) : undefined
        }
      >
        Tempat Sampah
      </PageTitle>
      <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
        Transaksi yang dihapus disimpan di sini (soft delete) — stok & laporan sudah
        dikoreksi. Salah hapus? Tekan <b>♻ Pulihkan</b> untuk mengembalikannya.
      </div>
      {terpotong !== null && (
        <div className="mb-3 rounded-lg bg-orange-50 px-4 py-2 text-sm text-orange-800">
          Menampilkan <b>{terpotong} terbaru</b>. Masih ada yang lebih lama di
          belakangnya — pulihkan atau kosongkan dulu untuk melihat sisanya.
        </div>
      )}
      <ErrorText error={pulihkan.error} />

      {isLoading ? (
        <Spinner />
      ) : (
        <TabelResponsif
          data={list}
          kunci={(r) => `${r.jenis}-${r.key}`}
          kosong="Tempat sampah kosong."
          kolom={[
            {
              judul: "Jenis",
              hp: "sub",
              sel: (r) => (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${JENIS[r.jenis].cls}`}
                >
                  {JENIS[r.jenis].label}
                </span>
              ),
            },
            {
              judul: "Ringkasan",
              hp: "judul",
              kelasSel: "max-w-xs truncate font-medium",
              sel: (r) => r.label,
            },
            { judul: "Waktu", sel: (r) => formatWaktu(r.waktu) },
            { judul: "Dibuat oleh", sel: (r) => r.dibuat_oleh ?? "—" },
            {
              judul: "Dihapus oleh",
              kelasSel: "font-medium text-red-600",
              sel: (r) => (
                <span className="font-medium text-red-600">{r.dihapus_oleh ?? "—"}</span>
              ),
            },
            { judul: "Dihapus pada", sel: (r) => formatWaktu(r.dihapus_pada) },
            {
              judul: "Total",
              kanan: true,
              sel: (r) => (r.total > 0 ? formatRupiah(r.total) : "—"),
            },
            {
              hp: "aksi",
              kelasSel: "text-right",
              sel: (r) => (
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Pulihkan ${JENIS[r.jenis].label.toLowerCase()} "${r.label}"? Stok & laporan akan terhitung kembali.`,
                      )
                    )
                      pulihkan.mutate(r);
                  }}
                  disabled={pulihkan.isPending}
                  className="text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50"
                >
                  ♻ Pulihkan
                </button>
              ),
            },
          ]}
        />
      )}

      {konfirmasiKosong && (
        <Modal
          open
          onClose={() => setKonfirmasiKosong(false)}
          title="🗑 Kosongkan Tempat Sampah?"
          lebar="max-w-md"
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <b>{list.length} transaksi</b> di tempat sampah akan <b>DIHAPUS PERMANEN</b> dan
              <b> tidak bisa dipulihkan lagi</b>. Stok &amp; laporan tidak terpengaruh (transaksi ini
              memang sudah dihapus).
            </div>
            <ErrorText error={kosongkan.error} />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setKonfirmasiKosong(false)}
                disabled={kosongkan.isPending}
                className={btnSecondary}
              >
                Batal
              </button>
              <button
                onClick={() => kosongkan.mutate()}
                disabled={kosongkan.isPending}
                className={`${btnPrimary} !bg-red-600 hover:!bg-red-700`}
              >
                {kosongkan.isPending ? "Menghapus…" : "Ya, Hapus Permanen"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
