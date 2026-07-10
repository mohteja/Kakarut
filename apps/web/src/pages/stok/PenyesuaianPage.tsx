import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  KLARIFIKASI_KATEGORI,
  type PenyesuaianKategori,
  type PenyesuaianRow,
} from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatWaktu } from "../../lib/format";

const KATEGORI_LABEL = Object.fromEntries(
  KLARIFIKASI_KATEGORI.map((k) => [k.key, k]),
) as Record<PenyesuaianKategori, (typeof KLARIFIKASI_KATEGORI)[number]>;

function KlarifikasiModal({
  row,
  onClose,
}: {
  row: PenyesuaianRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [kategori, setKategori] = useState<PenyesuaianKategori>("waste_bahan");
  const [catatan, setCatatan] = useState("");

  const simpan = useMutation({
    mutationFn: () =>
      api(`/stok/penyesuaian/${row.id}/klarifikasi`, {
        method: "POST",
        body: { kategori, catatan: catatan || null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["penyesuaian"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={`Klarifikasi — ${row.bahan}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
          Sistem {formatAngka(row.system_qty ?? 0)} → fisik {formatAngka(row.qty_fisik)} ={" "}
          <b className={row.selisih > 0 ? "text-yellow-700" : "text-red-600"}>
            {row.selisih > 0 ? "+" : ""}
            {formatAngka(row.selisih)} {row.satuan}
          </b>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">Penyebab selisih</div>
          <div className="space-y-2">
            {KLARIFIKASI_KATEGORI.map((k) => (
              <label
                key={k.key}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                  kategori === k.key ? "border-orange-500 bg-orange-50" : "border-stone-200"
                }`}
              >
                <input
                  type="radio"
                  name="kategori"
                  className="mt-0.5"
                  checked={kategori === k.key}
                  onChange={() => setKategori(k.key)}
                />
                <span>
                  <span className="font-medium">
                    {k.label}
                    {k.is_waste && (
                      <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                        waste
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-stone-500">{k.keterangan}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Catatan (opsional)</label>
          <input
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            className={inputClass}
            placeholder="mis. tumpah saat pindah wadah"
          />
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button onClick={() => simpan.mutate()} disabled={simpan.isPending} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan Klarifikasi"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Daftar penyesuaian stok dari selisih opname — karyawan wajib mengklarifikasi
 * tiap selisih (waste atau koreksi pencatatan).
 */
export function PenyesuaianPage() {
  const { branchQuery } = useBranch();
  const [filter, setFilter] = useState<"belum" | "semua">("belum");
  const [klarifikasi, setKlarifikasi] = useState<PenyesuaianRow | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["penyesuaian", branchQuery, filter],
    queryFn: () =>
      api<PenyesuaianRow[]>(
        `/stok/penyesuaian${branchQuery ? `${branchQuery}&` : "?"}${filter === "belum" ? "status=belum" : ""}`,
      ),
  });

  const belumCount = (rows ?? []).filter((r) => r.klarifikasi_status === "belum").length;

  return (
    <div className="max-w-3xl">
      <PageTitle>Penyesuaian Stok</PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Setiap selisih hasil stock opname (lebih/kurang) muncul di sini. Karyawan wajib
        mengklarifikasi penyebabnya — apakah <b>waste</b> (bahan rusak, sudah dimasak tak
        terjual, produk gagal) atau <b>koreksi pencatatan</b>.
      </div>

      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setFilter("belum")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === "belum" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
        >
          Belum diklarifikasi
        </button>
        <button
          onClick={() => setFilter("semua")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === "semua" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
        >
          Semua
        </button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (rows ?? []).length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {filter === "belum"
            ? "Tidak ada penyesuaian yang perlu diklarifikasi. 🎉"
            : "Belum ada penyesuaian stok."}
        </Card>
      ) : (
        <div className="space-y-2">
          {filter === "belum" && belumCount > 0 && (
            <div className="text-sm text-stone-500">{belumCount} menunggu klarifikasi</div>
          )}
          {(rows ?? []).map((r) => {
            const kat = r.kategori ? KATEGORI_LABEL[r.kategori] : null;
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-stone-800">{r.bahan}</div>
                    <div className="text-sm text-stone-500">
                      {formatWaktu(r.waktu)} · Sistem {formatAngka(r.system_qty ?? 0)} → Fisik{" "}
                      {formatAngka(r.qty_fisik)}
                      {r.oleh && ` · oleh ${r.oleh}`}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      r.selisih > 0 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {r.selisih > 0 ? `Lebih ${formatAngka(r.selisih)}` : `Kurang ${formatAngka(-r.selisih)}`}{" "}
                    {r.satuan}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  {r.klarifikasi_status === "sudah" && kat ? (
                    <div className="text-sm">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${kat.is_waste ? "bg-red-100 text-red-700" : "bg-stone-200 text-stone-600"}`}
                      >
                        {kat.label}
                      </span>
                      {r.catatan && <span className="ml-2 text-stone-500">{r.catatan}</span>}
                      {r.diklarifikasi_oleh && (
                        <span className="ml-2 text-xs text-stone-400">
                          — {r.diklarifikasi_oleh}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                      Belum diklarifikasi
                    </span>
                  )}
                  <button
                    onClick={() => setKlarifikasi(r)}
                    className={r.klarifikasi_status === "sudah" ? btnSecondary : btnPrimary}
                  >
                    {r.klarifikasi_status === "sudah" ? "Ubah" : "Klarifikasi"}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {klarifikasi && (
        <KlarifikasiModal row={klarifikasi} onClose={() => setKlarifikasi(null)} />
      )}
    </div>
  );
}
