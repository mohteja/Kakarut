import { Link } from "react-router-dom";
import type {
  PermintaanStokBagian,
  PermintaanStokRow,
  StatusPermintaan,
} from "@kakarut/shared";
import { statusPermintaan } from "@kakarut/shared";
import type { KolomTabel } from "../../components/TabelResponsif";
import { formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

/**
 * BENTUK TABEL "Data Permintaan Stok" — kolomnya, di luar komponen.
 *
 * Rumahnya terpisah mengikuti teladan `kolomPengadaan` (`TambahStokPage`) dan
 * `kolomDaftarResep` (`ResepPage`): definisi kolom yang tinggal di dalam badan
 * komponen ikut dirakit ulang tiap render dan tak bisa dibaca penjaga statis
 * sebagai satu blok.
 *
 * SATU BARIS = SATU PERMINTAAN (keputusan pemilik repo). Alternatifnya —
 * memecah tiap permintaan jadi sampai enam baris per faktur — membuat "satu
 * submit" berhenti terlihat sebagai satu hal, dan daftarnya bisa enam kali
 * lebih panjang tanpa memuat informasi baru. Terukur 2026-09-03: rata-rata
 * 1,79 jalur per permintaan (maksimum 4 dari 6 yang mungkin), jadi kolom
 * "Isi" memang muat.
 */

/** Label & warna keadaan — MILIK LAYAR; aturannya di `@kakarut/shared`. */
export const LABEL_STATUS: Record<StatusPermintaan, string> = {
  berjalan: "🔄 Berjalan",
  selesai: "📦 Selesai ✓",
  selesai_ada_ditolak: "⚠ Selesai — ada ditolak",
};

export const STYLE_STATUS: Record<StatusPermintaan, string> = {
  berjalan: "bg-blue-100 text-blue-700",
  selesai: "bg-green-100 text-green-700",
  selesai_ada_ditolak: "bg-amber-100 text-amber-700",
};

/**
 * Total transaksi satu permintaan.
 *
 * `beli_produksi` SENGAJA TIDAK DIJUMLAHKAN: ia belanja bahan mentah yang jadi
 * input faktur produksi, dan nilainya sudah termasuk di dalam total produksi.
 * Menjumlahkannya lagi = dobel hitung. Aturan itu dulu diketik di dalam badan
 * halaman; ia pindah ke sini supaya bentuk kartu dan bentuk tabel tak bisa
 * menyebut angka yang berbeda untuk permintaan yang sama.
 */
export function totalPermintaan(r: PermintaanStokRow): number {
  return (
    (r.produksi?.total ?? 0) +
    (r.produksi_cabang?.total ?? 0) +
    (r.beli?.total ?? 0) +
    (r.beli_perlengkapan?.total ?? 0)
  );
}

/** Lambang tiap jalur — satu kosakata dengan kartu. */
const IKON_JALUR = {
  kirim: "🚚",
  produksi: "🏭",
  produksi_cabang: "🏪",
  beli: "🛒",
  beli_produksi: "🧺",
  beli_perlengkapan: "🧰",
} as const;

type Jalur = keyof typeof IKON_JALUR;

/**
 * Ke mana sebuah jalur menautkan.
 *
 * SEJAK 2026-09-03 KE FAKTURNYA, bukan ke daftarnya. Sebelumnya tiap blok
 * menunjuk `/produksi` atau `/pembelian` — halaman riwayat, berhalaman 20 —
 * padahal `faktur_id`-nya sudah ada di tangan. Mengklik "🏭 Produksi · 3 bahan"
 * karena itu mendaratkan orang di halaman 1 dari 4 dan menyuruhnya mencari
 * sendiri faktur yang barusan ia klik.
 *
 * BATAS YANG DISENGAJA: `beli_perlengkapan` (BP-) TETAP ke daftarnya. Fakturnya
 * hidup di `supply_purchases` — tabel yang berbeda — dan halaman dokumen
 * `/produksi/:fakturId` hanya melayani `productions`. Mengarahkannya ke sana
 * menghasilkan 404 yang terbaca seperti "fakturnya hilang".
 */
function tautanJalur(jalur: Jalur, fakturId: string): string {
  if (jalur === "beli_perlengkapan") return "/perlengkapan/beli";
  if (jalur === "beli" || jalur === "beli_produksi") return `/pembelian/${fakturId}`;
  return `/produksi/${fakturId}`;
}

/** Lencana satu jalur di kolom "Isi". */
function LencanaJalur({
  jalur,
  fakturId,
  jumlah,
  satuanIsi,
  status,
  gaya,
}: {
  jalur: Jalur;
  fakturId: string;
  jumlah: number;
  satuanIsi: string;
  status: string;
  gaya: string;
}) {
  return (
    <Link
      to={tautanJalur(jalur, fakturId)}
      className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[11px] leading-tight transition hover:border-orange-400"
    >
      <span>{IKON_JALUR[jalur]}</span>
      <span className="font-semibold text-stone-700">
        {jumlah} {satuanIsi}
      </span>
      <span className={`rounded-full px-1.5 font-semibold ${gaya}`}>{status}</span>
    </Link>
  );
}

export interface OpsiKolomPermintaan {
  /** Gaya & label status per jalur — dipakai bersama kartu, bukan disalin. */
  gayaBagian: (b: PermintaanStokBagian, jalur: Jalur) => { label: string; gaya: string };
  gayaPerlengkapan: (r: PermintaanStokRow) => { label: string; gaya: string };
  onHapus: (rencanaId: string) => void;
  hapusSedang: boolean;
}

export function kolomPermintaan(opsi: OpsiKolomPermintaan): KolomTabel<PermintaanStokRow>[] {
  /*
   * Urutan jalur SAMA dengan urutan blok di bentuk kartu — kirim dulu (stok
   * yang sudah ada), baru yang harus dibuat/dibeli. Dua bentuk yang mengurut
   * isinya berbeda memaksa orang membaca ulang tiap kali berganti bentuk.
   * `beli_perlengkapan` menyusul terpisah: pipeline statusnya berbeda.
   */
  const bagian = (r: PermintaanStokRow): { jalur: Jalur; b: PermintaanStokBagian }[] => {
    const urut: [Jalur, PermintaanStokBagian | null][] = [
      ["kirim", r.kirim],
      ["produksi", r.produksi],
      ["produksi_cabang", r.produksi_cabang],
      ["beli", r.beli],
      ["beli_produksi", r.beli_produksi],
    ];
    return urut
      .filter((x): x is [Jalur, PermintaanStokBagian] => x[1] != null)
      .map(([jalur, b]) => ({ jalur, b }));
  };

  return [
    {
      judul: "Dokumen",
      hp: "judul",
      kelasJudul: "w-52",
      sel: (r) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-bold text-stone-800">📋</span>
            {r.nomor && (
              <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                {r.nomor}
              </span>
            )}
          </div>
          {/* Ringkasan menu ("50× BASOAC, 30× PYO") IKUT — ia satu-satunya
              petunjuk APA yang diminta, dan tabel tanpanya memaksa orang
              membuka fakturnya untuk tahu. */}
          {r.catatan && (
            <div className="truncate pt-0.5 text-xs text-stone-500">{r.catatan}</div>
          )}
        </div>
      ),
    },
    {
      judul: "Dibuat",
      kelasJudul: "w-32",
      sel: (r) => (
        <span className="whitespace-nowrap text-stone-600">
          {formatTanggalRingkas(r.waktu)}
          <span className="text-stone-400"> · {formatWaktu(r.waktu)}</span>
        </span>
      ),
    },
    {
      judul: "Tujuan",
      kelasJudul: "w-40",
      sel: (r) =>
        r.tujuan_cabang ? (
          <span className="whitespace-nowrap rounded-md bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-800">
            📦 {r.tujuan_cabang}
          </span>
        ) : (
          <span className="text-stone-300">—</span>
        ),
    },
    {
      judul: "Isi",
      sel: (r) => (
        <div className="flex flex-wrap gap-1">
          {bagian(r).map(({ jalur, b }) => {
            const g = opsi.gayaBagian(b, jalur);
            return (
              <LencanaJalur
                key={jalur}
                jalur={jalur}
                fakturId={b.faktur_id}
                jumlah={b.jumlah_baris}
                satuanIsi="bahan"
                status={g.label}
                gaya={g.gaya}
              />
            );
          })}
          {r.beli_perlengkapan && (
            <LencanaJalur
              jalur="beli_perlengkapan"
              fakturId={r.beli_perlengkapan.faktur_id}
              jumlah={r.beli_perlengkapan.jumlah_baris}
              satuanIsi="item"
              status={opsi.gayaPerlengkapan(r).label}
              gaya={opsi.gayaPerlengkapan(r).gaya}
            />
          )}
        </div>
      ),
    },
    {
      judul: "Status",
      hp: "sub",
      kelasJudul: "w-44",
      sel: (r) => {
        const st = statusPermintaan(r);
        return (
          <span
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE_STATUS[st]}`}
          >
            {LABEL_STATUS[st]}
          </span>
        );
      },
    },
    {
      judul: "Nilai",
      kanan: true,
      kelasJudul: "w-32",
      sel: (r) => (
        <span className="whitespace-nowrap font-semibold text-stone-800">
          {formatRupiah(totalPermintaan(r))}
        </span>
      ),
    },
    {
      judul: "Orang",
      kelasJudul: "w-36",
      sel: (r) =>
        r.pembuat ? (
          <span className="text-xs text-stone-500">{r.pembuat}</span>
        ) : (
          <span className="text-stone-300">—</span>
        ),
    },
    {
      judul: "Aksi",
      hp: "aksi",
      kelasJudul: "w-28",
      kelasSel: "whitespace-nowrap text-right",
      sel: (r) => (
        <button
          onClick={() => opsi.onHapus(r.rencana_id)}
          disabled={opsi.hapusSedang}
          className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          🗑 Hapus
        </button>
      ),
    },
  ];
}
