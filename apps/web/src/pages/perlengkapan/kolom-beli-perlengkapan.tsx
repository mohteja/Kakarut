import { butuhAksiBP } from "@kakarut/shared";
import type { KolomTabel } from "../../components/TabelResponsif";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";
import { BeliStatusBadge, type FakturBeli } from "./BeliPerlengkapanPage";

/**
 * KOLOM tabel Beli Perlengkapan — rumahnya terpisah, meniru `kolomPengadaan`
 * (`TambahStokPage`) dan `kolomPermintaan` (`kolom-permintaan.tsx`).
 *
 * Terpisah bukan demi kerapian: urutan dan isi kolomnya DIPAKU penjaga statis,
 * dan penjaga yang harus mencari daftar kolom di tengah komponen 900 baris
 * adalah penjaga yang pelan-pelan berhenti melihat. Di sini ia satu ekspresi.
 */
export interface OpsiKolomBeli {
  isManajemen: boolean;
  /** faktur ini boleh dihapus permanen (tak terkait permintaan aktif, tak ada baris tiba) */
  bisaHapus: (g: FakturBeli) => boolean;
  onRab: (g: FakturBeli) => void;
  onProses: (g: FakturBeli) => void;
  onTiba: (g: FakturBeli) => void;
  onBatal: (g: FakturBeli) => void;
  onHapus: (g: FakturBeli) => void;
}

/**
 * Nilai yang PANTAS ditampilkan untuk satu faktur.
 *
 * Harga riil bila sudah ada; kalau belum, estimasi RAB — dan estimasi itu
 * hanya untuk faktur yang masih menuntut pekerjaan. Faktur yang sudah tiba
 * tanpa harga riil memang tak punya nilai untuk disebut, dan memajang
 * estimasinya di sana membuat angka rencana terbaca sebagai angka belanja.
 */
function nilaiFaktur(g: FakturBeli): { teks: string; estimasi: boolean } | null {
  if (g.totalHarga > 0) return { teks: formatRupiah(g.totalHarga), estimasi: false };
  if (butuhAksiBP(g.status) && g.totalEstimasi > 0) {
    return { teks: formatRupiah(g.totalEstimasi), estimasi: true };
  }
  return null;
}

export function kolomBeliPerlengkapan(opsi: OpsiKolomBeli): KolomTabel<FakturBeli>[] {
  const bolehUbahTahap = (g: FakturBeli) => opsi.isManajemen && butuhAksiBP(g.status);
  return [
    {
      judul: "Dokumen",
      hp: "judul",
      kelasJudul: "w-48",
      sel: (g) => (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-bold text-stone-800">🛒</span>
          {g.nomor && (
            <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
              {g.nomor}
            </span>
          )}
          <span className="truncate text-sm font-semibold text-stone-800">{g.rows[0]?.nama}</span>
        </div>
      ),
    },
    {
      judul: "Dibuat",
      sel: (g) => (
        <span className="whitespace-nowrap text-xs text-stone-500">
          {formatTanggalRingkas(g.waktu)} · {formatWaktu(g.waktu)}
        </span>
      ),
    },
    {
      judul: "Tujuan",
      sel: (g) =>
        g.tujuanNama ? (
          <span className="whitespace-nowrap rounded-md bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-800">
            📦 {g.tujuanNama}
          </span>
        ) : (
          <span className="whitespace-nowrap text-xs text-stone-500">🏪 {g.ckNama} (stok CK)</span>
        ),
    },
    {
      judul: "Isi",
      sel: (g) => (
        <span className="whitespace-nowrap text-xs text-stone-600">
          {g.rows.length} item
          {g.rows[0] && (
            <span className="text-stone-400">
              {" "}
              · {formatAngka(g.rows[0].qty)} {g.rows[0].satuan}
              {g.rows.length > 1 && ` +${g.rows.length - 1}`}
            </span>
          )}
        </span>
      ),
    },
    {
      judul: "Status",
      hp: "sub",
      sel: (g) => <BeliStatusBadge status={g.status} />,
    },
    {
      judul: "Nilai",
      kanan: true,
      sel: (g) => {
        const n = nilaiFaktur(g);
        if (!n) return <span className="text-stone-300">—</span>;
        return (
          <span className={`whitespace-nowrap text-sm ${n.estimasi ? "text-stone-500" : "font-semibold text-stone-800"}`}>
            {n.estimasi && <span className="text-xs text-stone-400">est. </span>}
            {n.teks}
          </span>
        );
      },
    },
    {
      judul: "Orang",
      sel: (g) => (
        <span className="whitespace-nowrap text-xs text-stone-500">
          {g.oleh ?? "—"}
          {g.diprosesOleh && <span className="block text-stone-400">🔧 {g.diprosesOleh}</span>}
        </span>
      ),
    },
    {
      judul: "Aksi",
      hp: "aksi",
      sel: (g) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {bolehUbahTahap(g) && (
            <>
              <button
                type="button"
                onClick={() => opsi.onRab(g)}
                className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
              >
                📄 RAB
              </button>
              {/*
                `<select>` yang sama dengan bentuk kartu, dan `TabelResponsif`
                sudah kebal klik pada `a/button/input/select` — jadi memilih
                tahap tak ikut membuka modal detail barisnya.
              */}
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "diproses") opsi.onProses(g);
                  else if (v === "tiba") opsi.onTiba(g);
                  else if (v === "batal") opsi.onBatal(g);
                  e.target.value = "";
                }}
                aria-label={`Ubah tahap ${g.nomor ?? "faktur"}`}
                className="rounded-lg bg-orange-600 px-2 py-1 text-xs font-semibold text-white hover:bg-orange-700"
              >
                <option value="" disabled>
                  ➡ Tahap
                </option>
                {g.status === "menunggu" && g.fakturId && (
                  <option value="diproses">🛒 Diproses (dibelanjakan)</option>
                )}
                <option value="tiba">📦 Tiba di CK</option>
                <option value="batal">❌ Batalkan</option>
              </select>
            </>
          )}
          {opsi.bisaHapus(g) && (
            <button
              type="button"
              onClick={() => opsi.onHapus(g)}
              className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              🗑
            </button>
          )}
        </div>
      ),
    },
  ];
}
