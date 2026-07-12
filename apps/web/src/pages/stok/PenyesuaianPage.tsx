import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  KLARIFIKASI_KATEGORI,
  type PenyesuaianKategori,
  type PenyesuaianRow,
} from "@kakarut/shared";
import { ImageUpload } from "../../components/ImageUpload";
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
import { useAuth } from "../../context/AuthContext";
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
  const [fotoUrl, setFotoUrl] = useState<string | null>(row.foto_url);
  const [validasi, setValidasi] = useState<string | null>(null);

  const simpan = useMutation({
    mutationFn: () => {
      if (!fotoUrl) {
        setValidasi("Bukti foto wajib dilampirkan.");
        return Promise.reject(new Error("Bukti foto wajib dilampirkan."));
      }
      setValidasi(null);
      return api(`/stok/penyesuaian/${row.id}/klarifikasi`, {
        method: "POST",
        body: { kategori, catatan: catatan || null, foto_url: fotoUrl },
      });
    },
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
        {row.tolak_alasan && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Ditolak owner/admin: {row.tolak_alasan}
          </div>
        )}
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
        <div>
          <label className="mb-1 block text-sm font-medium">
            Bukti foto <span className="text-red-500">*wajib</span>
          </label>
          <ImageUpload
            value={fotoUrl}
            onChange={(u) => {
              setFotoUrl(u);
              if (u) setValidasi(null);
            }}
            tujuan="bukti"
            placeholder="📷"
          />
          <div className="mt-1 text-xs text-stone-400">
            Foto bahan/produk yang menjadi penyebab selisih (mis. bahan rusak, produk gagal).
          </div>
        </div>
        {validasi && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{validasi}</div>
        )}
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={simpan.isPending || !fotoUrl}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "Simpan Klarifikasi"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Modal alasan penolakan — owner/admin mengembalikan ke karyawan. */
function TolakModal({ row, onClose }: { row: PenyesuaianRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [alasan, setAlasan] = useState("");

  const tolak = useMutation({
    mutationFn: () => {
      if (!alasan.trim()) return Promise.reject(new Error("Alasan penolakan wajib diisi."));
      return api(`/stok/penyesuaian/${row.id}/tolak`, {
        method: "POST",
        body: { alasan: alasan.trim() },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["penyesuaian"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={`Tolak penyesuaian — ${row.bahan}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
          Baris ini dikembalikan ke karyawan untuk diklarifikasi ulang. <b>Stok tidak berubah.</b>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            Alasan penolakan <span className="text-red-500">*wajib</span>
          </label>
          <input
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            className={inputClass}
            placeholder="mis. bukti kurang jelas, kategori tidak sesuai"
            autoFocus
          />
        </div>
        <ErrorText error={tolak.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => tolak.mutate()}
            disabled={tolak.isPending || !alasan.trim()}
            className={btnPrimary}
          >
            {tolak.isPending ? "Menolak…" : "Tolak & Kembalikan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

type FilterKey = "belum" | "menunggu" | "semua";
const STATUS_QUERY: Record<FilterKey, string> = {
  belum: "status=belum",
  menunggu: "status=menunggu_persetujuan",
  semua: "",
};
const FILTER_CHIPS: [FilterKey, string][] = [
  ["belum", "Belum diklarifikasi"],
  ["menunggu", "Menunggu persetujuan"],
  ["semua", "Semua"],
];

/**
 * Daftar penyesuaian stok dari selisih opname. Alur: karyawan mengklarifikasi
 * (waste/koreksi + foto) → owner/admin menyetujui → stok baru disesuaikan.
 */
export function PenyesuaianPage() {
  const { auth } = useAuth();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { branchQuery } = useBranch();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("belum");
  const [klarifikasi, setKlarifikasi] = useState<PenyesuaianRow | null>(null);
  const [tolak, setTolak] = useState<PenyesuaianRow | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["penyesuaian", branchQuery, filter],
    queryFn: () =>
      api<PenyesuaianRow[]>(
        `/stok/penyesuaian${branchQuery ? `${branchQuery}&` : "?"}${STATUS_QUERY[filter]}`,
      ),
  });

  const setuju = useMutation({
    mutationFn: (id: string) => api(`/stok/penyesuaian/${id}/setujui`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["penyesuaian"] }),
  });
  const setujuMassal = useMutation({
    mutationFn: () =>
      api(`/stok/penyesuaian/setujui-massal${branchQuery || ""}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["penyesuaian"] }),
  });

  const list = rows ?? [];
  const menungguList = list.filter(
    (r) => r.klarifikasi_status === "sudah" && r.penyesuaian_status === "menunggu",
  );

  return (
    <div className="max-w-3xl">
      <PageTitle>Penyesuaian Stok</PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Selisih hasil stock opname (lebih/kurang) muncul di sini. <b>Owner/admin</b>{" "}
        <b>mengklarifikasi</b> penyebabnya (waste atau koreksi) lalu <b>menyetujui</b> — stok
        baru disesuaikan <b>setelah disetujui</b>.
        {!isManajemen && (
          <span className="mt-1 block text-xs text-blue-700">
            Anda kasir: cukup lakukan opname — klarifikasi & persetujuan dilakukan owner/admin.
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTER_CHIPS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === key ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {isManajemen && menungguList.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setujuMassal.mutate()}
            disabled={setujuMassal.isPending}
            className={btnPrimary}
          >
            {setujuMassal.isPending
              ? "Menyetujui…"
              : `✔ Setujui semua yang diklarifikasi (${menungguList.length})`}
          </button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {filter === "belum"
            ? "Tidak ada penyesuaian yang perlu diklarifikasi. 🎉"
            : filter === "menunggu"
              ? "Tidak ada penyesuaian yang menunggu persetujuan. 🎉"
              : "Belum ada penyesuaian stok."}
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((r) => {
            const kat = r.kategori ? KATEGORI_LABEL[r.kategori] : null;
            const sudahKlar = r.klarifikasi_status === "sudah";
            const disetujui = r.penyesuaian_status === "disetujui";
            const menungguPersetujuan = sudahKlar && !disetujui;
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
                    {r.selisih > 0
                      ? `Lebih ${formatAngka(r.selisih)}`
                      : `Kurang ${formatAngka(-r.selisih)}`}{" "}
                    {r.satuan}
                  </span>
                </div>

                {!sudahKlar && r.tolak_alasan && (
                  <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    Ditolak owner/admin: {r.tolak_alasan} — mohon klarifikasi ulang.
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    {kat && (disetujui || menungguPersetujuan) && r.foto_url && (
                      <a
                        href={r.foto_url}
                        target="_blank"
                        rel="noopener"
                        title="Lihat bukti foto"
                      >
                        <img
                          src={r.foto_url}
                          alt="bukti"
                          className="h-10 w-10 rounded-lg border border-stone-200 object-cover"
                        />
                      </a>
                    )}
                    <div>
                      {disetujui ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          ✔ Disetujui · stok disesuaikan
                        </span>
                      ) : menungguPersetujuan ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          Menunggu persetujuan
                        </span>
                      ) : (
                        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                          Belum diklarifikasi
                        </span>
                      )}
                      {kat && (disetujui || menungguPersetujuan) && (
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${kat.is_waste ? "bg-red-100 text-red-700" : "bg-stone-200 text-stone-600"}`}
                        >
                          {kat.label}
                        </span>
                      )}
                      {disetujui && r.disetujui_oleh && (
                        <span className="ml-2 text-xs text-stone-400">
                          — disetujui {r.disetujui_oleh}
                        </span>
                      )}
                      {menungguPersetujuan && r.diklarifikasi_oleh && (
                        <span className="ml-2 text-xs text-stone-400">
                          — oleh {r.diklarifikasi_oleh}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {/* klarifikasi hanya owner/admin — kasir cukup opname */}
                    {isManajemen && !disetujui && (
                      <button
                        onClick={() => setKlarifikasi(r)}
                        className={sudahKlar ? btnSecondary : btnPrimary}
                      >
                        {sudahKlar ? "Ubah" : "Klarifikasi"}
                      </button>
                    )}
                    {isManajemen && menungguPersetujuan && (
                      <>
                        <button
                          onClick={() => setTolak(r)}
                          className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                        >
                          ✕ Tolak
                        </button>
                        <button
                          onClick={() => setuju.mutate(r.id)}
                          disabled={setuju.isPending}
                          className={btnPrimary}
                        >
                          ✔ Setujui
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {klarifikasi && (
        <KlarifikasiModal row={klarifikasi} onClose={() => setKlarifikasi(null)} />
      )}
      {tolak && <TolakModal row={tolak} onClose={() => setTolak(null)} />}
    </div>
  );
}
