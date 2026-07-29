import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PesananLogRow, PesananRow, PesananStatus } from "@kakarut/shared";
import { CabangDataBar } from "../../components/CabangDataBar";
import { Card, ErrorText, Modal, PageTitle, Spinner } from "../../components/ui";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatRupiah, formatWaktu, hariIniWIB } from "../../lib/format";

const KOLOM: { status: PesananStatus; judul: string; warna: string }[] = [
  { status: "dikerjakan", judul: "🔥 Dikerjakan", warna: "border-orange-300 bg-orange-50" },
  { status: "selesai", judul: "✅ Selesai", warna: "border-green-300 bg-green-50" },
  { status: "batal", judul: "✖ Batal", warna: "border-stone-300 bg-stone-100" },
];

/** Selisih jam pesanan → sekarang, dibulatkan ke menit. */
function lamaMenunggu(iso: string): string {
  const menit = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  return `${jam} jam ${menit % 60} mnt`;
}

/**
 * Riwayat "siapa menandai apa" untuk satu pesanan. Dimuat saat dibuka saja —
 * papan bisa menampung puluhan kartu dan riwayat hampir tak pernah dibaca.
 */
function RiwayatModal({
  pesanan,
  onClose,
}: {
  pesanan: PesananRow;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["pesanan-log", pesanan.jenis, pesanan.id],
    queryFn: () => api<PesananLogRow[]>(`/pesanan/${pesanan.jenis}/${pesanan.id}/log`),
  });
  return (
    <Modal open onClose={onClose} title="Riwayat perubahan">
      {isLoading ? (
        <Spinner />
      ) : (data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-400">
          Belum ada perubahan status pada pesanan ini.
        </p>
      ) : (
        <ol className="space-y-2">
          {(data ?? []).map((r, i) => (
            <li key={i} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
              <div className="font-medium text-stone-800">{r.aksi}</div>
              <div className="text-xs text-stone-500">
                {formatWaktu(r.waktu)} · {r.oleh ?? "—"}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function KartuPesanan({
  p,
  sibuk,
  onStatus,
  onSajian,
  onRiwayat,
}: {
  p: PesananRow;
  sibuk: boolean;
  onStatus: (status: PesananStatus) => void;
  onSajian: (takeaway: boolean) => void;
  onRiwayat: () => void;
}) {
  // label meja SUDAH berbunyi "Meja 1"/"Ruang Tunggu" — jangan diberi awalan
  // lagi, hasilnya "Meja Meja 1".
  const judul = p.nomor ?? p.meja ?? "Pesanan";
  // Penanda penyajian BEDA dari fakta pembukuan (is_dine_in) → tampilkan
  // keduanya, jangan sembunyikan koreksinya.
  const diubah = p.dibayar && p.sajian_takeaway === p.is_dine_in;
  // "Belum dibayar" adalah AJAKAN menagih, jadi hanya untuk pesanan yang masih
  // hidup. Pada pesanan batal tak ada yang perlu ditagih — menandainya kuning
  // justru menyuruh kasir mengejar uang yang memang tak akan datang.
  const perluDitagih = !p.dibayar && p.status !== "batal";
  return (
    <div
      className={`rounded-xl border bg-white p-3 shadow-sm ${
        perluDitagih ? "border-amber-400 ring-1 ring-amber-200" : "border-stone-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* nomor struk = identitas pesanan di dapur; biarkan melipat (di tanda
              hubung), jangan dipotong jadi "PUSAT-20260729-0…" yang tak bisa
              dicocokkan dengan struk di tangan pelanggan */}
          <div className="font-bold text-stone-800">{judul}</div>
          <div className="text-xs text-stone-500">
            {formatWaktu(p.waktu)} · {lamaMenunggu(p.waktu)}
            {p.meja && p.nomor ? ` · ${p.meja}` : ""}
          </div>
          {p.customer && (
            <div className="truncate text-xs font-medium text-orange-600">👤 {p.customer}</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold text-stone-800">{formatRupiah(p.total)}</div>
          {perluDitagih && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              Belum dibayar
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            p.sajian_takeaway ? "bg-stone-200 text-stone-700" : "bg-blue-100 text-blue-700"
          }`}
        >
          {p.sajian_takeaway ? "🥡 Bawa pulang" : "🍽 Makan di tempat"}
        </span>
        {diubah && (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
            diubah setelah transaksi
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-1 border-t border-stone-100 pt-2">
        {p.items.map((it, i) => (
          <li key={i} className="text-sm text-stone-700">
            <span className="font-semibold text-stone-800">{it.qty}×</span> {it.nama}
            {it.catatan && (
              <div className="pl-5 text-xs italic text-orange-600">📝 {it.catatan}</div>
            )}
          </li>
        ))}
        {p.items.length === 0 && <li className="text-xs text-stone-400">Tanpa item.</li>}
      </ul>
      {p.catatan && (
        <div className="mt-2 rounded-lg bg-orange-50 px-2 py-1 text-xs text-orange-800">
          📝 {p.catatan}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {p.status !== "selesai" && (
          <button
            disabled={sibuk}
            onClick={() => onStatus("selesai")}
            className="rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            ✅ Selesai
          </button>
        )}
        {p.status !== "dikerjakan" && (
          <button
            disabled={sibuk}
            onClick={() => onStatus("dikerjakan")}
            className="rounded-lg bg-orange-100 px-2.5 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-200 disabled:opacity-50"
          >
            ↩ Kembalikan
          </button>
        )}
        <button
          disabled={sibuk}
          onClick={() => onSajian(!p.sajian_takeaway)}
          className="rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-200 disabled:opacity-50"
        >
          {p.sajian_takeaway ? "🍽 Makan di tempat" : "🥡 Jadikan bawa pulang"}
        </button>
        {p.status !== "batal" && (
          <button
            disabled={sibuk}
            onClick={() => onStatus("batal")}
            className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            ✖ Batal
          </button>
        )}
        <button
          onClick={onRiwayat}
          className="ml-auto text-xs font-medium text-stone-500 underline hover:text-stone-700"
        >
          Riwayat
        </button>
      </div>
      {p.status_oleh && p.status_pada && (
        <div className="mt-1.5 text-[11px] text-stone-400">
          Terakhir: {p.status_oleh} · {formatWaktu(p.status_pada)}
        </div>
      )}
    </div>
  );
}

/**
 * PAPAN PESANAN MASUK — layar kerja dapur/bar/kasir di komputer cabang.
 *
 * Menyatukan pesanan yang belum dibayar (open bill) dengan yang sudah dibayar
 * pada tanggal berjalan, supaya tak ada pesanan yang "tertinggal" hanya karena
 * pelanggan belum ke kasir. Satu pesanan = satu kartu, bahkan saat berpindah
 * dari open bill ke penjualan (status & penanda penyajiannya ikut terbawa).
 */
export function PesananPage() {
  const { query: branchQuery } = useCabangData();
  const queryClient = useQueryClient();
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [fokus, setFokus] = useState<PesananStatus>("dikerjakan");
  const [riwayat, setRiwayat] = useState<PesananRow | null>(null);

  const qs = `${branchQuery ? `${branchQuery}&` : "?"}tanggal=${tanggal}`;
  const { data, isLoading, error } = useQuery({
    queryKey: ["pesanan", branchQuery, tanggal],
    queryFn: () => api<PesananRow[]>(`/pesanan${qs}`),
    // Papan dapur = satu-satunya layar yang keterlambatannya berujung makanan
    // tak dibuat, jadi lebih rapat dari norma 30 dtk aplikasi ini.
    refetchInterval: 15_000,
  });

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["pesanan"] });
    queryClient.invalidateQueries({ queryKey: ["pesanan-log"] });
  };
  const ubahStatus = useMutation({
    mutationFn: (v: { p: PesananRow; status: PesananStatus }) =>
      api(`/pesanan/${v.p.jenis}/${v.p.id}/status`, {
        method: "POST",
        body: { status: v.status },
      }),
    onSettled: segarkan,
  });
  const ubahSajian = useMutation({
    mutationFn: (v: { p: PesananRow; takeaway: boolean }) =>
      api(`/pesanan/${v.p.jenis}/${v.p.id}/sajian`, {
        method: "POST",
        body: { takeaway: v.takeaway },
      }),
    onSettled: segarkan,
  });
  const sibuk = ubahStatus.isPending || ubahSajian.isPending;
  const galat = ubahStatus.error ?? ubahSajian.error;

  const rows = data ?? [];
  const perKolom = (s: PesananStatus) => rows.filter((r) => r.status === s);

  return (
    <div className="max-w-6xl">
      <PageTitle>Papan Pesanan Masuk</PageTitle>
      <CabangDataBar />
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Setiap pesanan yang diinput kasir muncul di sini — termasuk yang{" "}
        <b>belum dibayar</b>. Tandai <b>Selesai</b> bila sudah disajikan. Tombol{" "}
        <b>bawa pulang</b> hanya mengubah cara penyajian, tidak mengubah nota atau
        perhitungan stok.
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={tanggal}
          onChange={(e) => setTanggal(e.target.value)}
          className="h-11 rounded-lg border border-stone-300 px-3 text-base focus:border-orange-500 focus:outline-none"
          aria-label="Tanggal pesanan"
        />
        <div className="text-sm text-stone-500">
          {rows.length} pesanan · <b>{perKolom("dikerjakan").length}</b> masih dikerjakan
        </div>
      </div>

      <ErrorText error={error ?? galat} />

      {/* Ponsel: satu kolom + chip pemilih; desktop: tiga kolom berdampingan */}
      <div className="mb-3 flex gap-2 md:hidden">
        {KOLOM.map((k) => (
          <button
            key={k.status}
            onClick={() => setFokus(k.status)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${
              fokus === k.status
                ? "bg-orange-600 text-white"
                : "bg-white text-stone-600 ring-1 ring-stone-200"
            }`}
          >
            {k.judul} ({perKolom(k.status).length})
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {KOLOM.map((k) => {
            const isi = perKolom(k.status);
            return (
              <section
                key={k.status}
                className={`${fokus === k.status ? "" : "hidden md:block"} rounded-xl border ${k.warna} p-2`}
              >
                <h2 className="mb-2 px-1 text-sm font-bold text-stone-700">
                  {k.judul} <span className="text-stone-400">({isi.length})</span>
                </h2>
                <div className="space-y-2">
                  {isi.map((p) => (
                    <KartuPesanan
                      key={`${p.jenis}:${p.id}`}
                      p={p}
                      sibuk={sibuk}
                      onStatus={(status) => ubahStatus.mutate({ p, status })}
                      onSajian={(takeaway) => ubahSajian.mutate({ p, takeaway })}
                      onRiwayat={() => setRiwayat(p)}
                    />
                  ))}
                  {isi.length === 0 && (
                    <Card className="p-6 text-center text-xs text-stone-400">Kosong.</Card>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {riwayat && <RiwayatModal pesanan={riwayat} onClose={() => setRiwayat(null)} />}
    </div>
  );
}
