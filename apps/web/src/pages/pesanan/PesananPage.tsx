import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ringkasPesanan,
  sajianBedaDariNota,
  urutkanPesanan,
  type PesananItemRow,
  type PesananLogRow,
  type PesananRow,
  type PesananStatus,
} from "@kakarut/shared";
import { CabangDataBar } from "../../components/CabangDataBar";
import { Card, ErrorText, Modal, PageTitle, Spinner } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatRupiah, formatWaktu, hariIniWIB } from "../../lib/format";

const KOLOM: { status: PesananStatus; judul: string; warna: string }[] = [
  { status: "dikerjakan", judul: "🔥 Dikerjakan", warna: "border-orange-300 bg-orange-50" },
  { status: "selesai", judul: "✅ Selesai", warna: "border-green-300 bg-green-50" },
  { status: "batal", judul: "✖ Batal", warna: "border-stone-300 bg-stone-100" },
];

const CHIP_BARIS: Record<PesananStatus, string> = {
  dikerjakan: "bg-orange-100 text-orange-800",
  selesai: "bg-green-100 text-green-800",
  batal: "bg-stone-200 text-stone-500",
};
const LABEL_BARIS: Record<PesananStatus, string> = {
  dikerjakan: "🔥 Dikerjakan",
  selesai: "✅ Selesai",
  batal: "✖ Batal",
};

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
function RiwayatModal({ pesanan, onClose }: { pesanan: PesananRow; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pesanan-log", pesanan.jenis, pesanan.id],
    queryFn: () => api<PesananLogRow[]>(`/pesanan/${pesanan.jenis}/${pesanan.id}/log`),
  });
  return (
    <Modal open onClose={onClose} title="Riwayat perubahan">
      {/* Cabang GAGAL didahulukan. Tanpa ini, bacaan yang gagal jatuh ke
          `(data ?? []).length === 0` dan layar menjawab "belum ada perubahan
          status" — kalimat yang justru menutup pertanyaan yang sedang dibawa
          orang ke sini. Riwayat ini dibuka untuk memastikan SIAPA yang menandai
          sajian; menjawab "tak ada apa-apa" saat sebenarnya tak terbaca membuat
          orang menyimpulkan tak ada yang menyentuhnya. */}
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-3 text-center text-sm text-red-700">
          Riwayat gagal dimuat{error instanceof Error ? `: ${error.message}` : ""}. Tutup lalu
          buka lagi untuk mencoba ulang.
        </p>
      ) : isLoading ? (
        <Spinner />
      ) : (data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-400">
          Belum ada perubahan status pada pesanan ini.
        </p>
      ) : (
        <ol className="space-y-2">
          {(data ?? []).map((r, i) => (
            <li key={i} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
              <div className="font-medium text-stone-800">
                {/* nama baris di depan: yang dicari orang saat membuka riwayat
                    adalah "sajian mana", bukan "aksi apa" */}
                {r.item_nama && <span className="text-orange-700">{r.item_nama} — </span>}
                {r.aksi}
              </div>
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

/**
 * Satu sajian dalam pesanan — SATUAN KERJA dapur.
 *
 * Tombolnya ada di sini, bukan di kartunya: dapur menyelesaikan minuman lebih
 * dulu lalu gorengan menyusul, dan dengan status setingkat kartu tak ada cara
 * memberi tahu siapa pun mana yang sudah keluar.
 *
 * Tombolnya SENGAJA tidak pernah dinonaktifkan sambil menunggu server. Dulu satu
 * bendera `sibuk` mematikan setiap tombol di SELURUH papan sampai satu permintaan
 * selesai — menandai satu minuman membekukan semua kartu. Sekarang perubahannya
 * sudah tampil sebelum permintaan berangkat, jadi tak ada yang perlu ditunggu;
 * menekan dua kali pun aman karena perintahnya "jadikan X", bukan "naikkan satu".
 */
function BarisPesanan({
  it,
  onStatus,
  onSajian,
}: {
  it: PesananItemRow;
  onStatus: (status: PesananStatus) => void;
  onSajian: (takeaway: boolean) => void;
}) {
  /*
   * `it.qty` SUDAH porsi yang ditagih — server mengurangkan yang direfund.
   * Yang dicoret di sini adalah baris yang tak menyisakan pekerjaan sama sekali:
   * dibatalkan dapur, atau seluruh porsinya sudah dikembalikan uangnya. Tanpa
   * baris keterangan di bawahnya, angka yang menyusut sendiri akan terbaca
   * seperti kesalahan sistem, bukan seperti keputusan yang memang diambil.
   */
  const habisRefund = it.qty_refund > 0 && it.qty <= 0;
  return (
    <li className="rounded-lg border border-stone-100 bg-stone-50/60 px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm text-stone-700">
          <span
            className={it.status === "batal" || habisRefund ? "line-through text-stone-400" : ""}
          >
            <span className="font-semibold text-stone-800">{it.qty}×</span> {it.nama}
          </span>
          {it.qty_refund > 0 && (
            <div className="text-xs font-semibold text-rose-600">
              ↩ {it.qty_refund} porsi dikembalikan — jangan dibuat
            </div>
          )}
          {it.catatan && <div className="text-xs italic text-orange-600">📝 {it.catatan}</div>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP_BARIS[it.status]}`}
        >
          {LABEL_BARIS[it.status]}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {it.status !== "selesai" && (
          <button
            onClick={() => onStatus("selesai")}
            className="rounded-md bg-green-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-green-700"
          >
            ✅ Selesai
          </button>
        )}
        {/*
          TIDAK ADA tombol Batal di papan. Membatalkan pesanan menyentuh uang —
          tagihan, stok, dan tamu yang mungkin sudah menerima piringnya — dan itu
          keputusan kasir, bukan dapur. Papan ini hanya menandai mana yang sudah
          keluar dari dapur.

          Kolom "Batal" TETAP ada: pesanan yang dibatalkan kasir (hapus bill di
          daftar Open Bill) harus tetap terlihat di sini, supaya dapur yang sedang
          memasaknya dapat sinyal untuk berhenti. Kalau kolomnya ikut dihapus,
          kartunya lenyap dari papan tanpa pemberitahuan apa pun.

          `↩ Kembalikan` DIPERTAHANKAN, termasuk pada baris yang batal: setelah
          Batal hilang, ini satu-satunya jalan mundur kalau ada yang salah tekan —
          dan pada baris batal ia membuka lagi bill yang telanjur dihapus kasir.
        */}
        {it.status !== "dikerjakan" && (
          <button
            onClick={() => onStatus("dikerjakan")}
            title={
              it.status === "batal"
                ? "Kembalikan ke dapur — pesanan ini dibatalkan kasir"
                : "Belum selesai — kembalikan ke daftar kerja"
            }
            className="rounded-md bg-orange-100 px-2 py-1 text-[11px] font-semibold text-orange-800 hover:bg-orange-200"
          >
            ↩ Kembalikan
          </button>
        )}
        <button
          onClick={() => onSajian(!it.sajian_takeaway)}
          title={
            it.sajian_takeaway ? "Sajikan di tempat" : "Bungkus untuk dibawa pulang"
          }
          className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
            it.sajian_takeaway
              ? "bg-stone-200 text-stone-700 hover:bg-stone-300"
              : "bg-blue-50 text-blue-700 hover:bg-blue-100"
          }`}
        >
          {it.sajian_takeaway ? "🥡 Bawa pulang" : "🍽 Di tempat"}
        </button>
      </div>
      {it.status_oleh && it.status_pada && (
        <div className="mt-0.5 text-[10px] text-stone-400">
          {it.status_oleh} · {formatWaktu(it.status_pada)}
        </div>
      )}
    </li>
  );
}

function KartuPesanan({
  p,
  onStatusItem,
  onSajianItem,
  onPindahSelesai,
  onRiwayat,
}: {
  p: PesananRow;
  onStatusItem: (itemId: string, status: PesananStatus) => void;
  onSajianItem: (itemId: string, takeaway: boolean) => void;
  onPindahSelesai: () => void;
  onRiwayat: () => void;
}) {
  // label meja SUDAH berbunyi "Meja 1"/"Ruang Tunggu" — jangan diberi awalan
  // lagi, hasilnya "Meja Meja 1".
  const judul = p.nomor ?? p.meja ?? "Pesanan";
  // Penanda penyajian BEDA dari fakta pembukuan (is_dine_in) → katakan, jangan
  // sembunyikan. Diperiksa PER BARIS: kartu yang cuma sebagian dibungkus tetap
  // berbeda, dan pada penjualan lunas kemasannya sudah masuk HPP & keluar dari
  // stok. Yang TIDAK boleh dikatakan: kapan bedanya muncul — baris bisa LAHIR
  // begini (lihat `sajianBedaDariNota`).
  const bedaDariNota = sajianBedaDariNota(p);
  // "Belum dibayar" adalah AJAKAN menagih, jadi hanya untuk pesanan yang masih
  // hidup. Pada pesanan batal tak ada yang perlu ditagih — menandainya kuning
  // justru menyuruh kasir mengejar uang yang memang tak akan datang.
  const perluDitagih = !p.dibayar && p.status !== "batal";
  const sisa = p.items.length - p.item_selesai - p.item_batal;
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

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {/* Ringkasan pengerjaan: inilah yang dicari orang dari kejauhan —
            berapa sajian yang sudah keluar dari pesanan ini. */}
        {p.items.length > 0 && (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700">
            {p.item_selesai}/{p.items.length} selesai
            {sisa > 0 ? ` · ${sisa} jalan` : ""}
            {p.item_batal > 0 ? ` · ${p.item_batal} batal` : ""}
          </span>
        )}
        {p.sajian_takeaway && (
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-700">
            🥡 Semua bawa pulang
          </span>
        )}
        {bedaDariNota && (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
            penyajian beda dari nota
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-1.5 border-t border-stone-100 pt-2">
        {p.items.map((it) => (
          <BarisPesanan
            key={it.id}
            it={it}
            onStatus={(status) => onStatusItem(it.id, status)}
            onSajian={(takeaway) => onSajianItem(it.id, takeaway)}
          />
        ))}
        {p.items.length === 0 && <li className="text-xs text-stone-400">Tanpa item.</li>}
      </ul>
      {p.catatan && (
        <div className="mt-2 rounded-lg bg-orange-50 px-2 py-1 text-xs text-orange-800">
          📝 {p.catatan}
        </div>
      )}

      {/*
        SATU pintasan kartu, dan hanya yang aman: pindahkan pesanan ini ke
        Selesai. Pesanan satu-dua sajian adalah mayoritas, dan menekan tombol
        per baris untuk itu melelahkan — jadi pintasannya tetap perlu ada.

        Papan ini TIDAK punya Batal sama sekali — tidak per sajian, tidak per
        kartu. Membatalkan pesanan menyentuh uang, dan itu pekerjaan kasir.
        "Kembalikan semua" juga tak ada: mengembalikan pesanan yang sudah keluar
        adalah koreksi, dan koreksi menunjuk sajian tertentu.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-2">
        {p.status !== "selesai" && p.items.length > 0 && (
          <button
            onClick={onPindahSelesai}
            title="Tandai semua sajian yang masih dikerjakan sebagai selesai (yang batal tetap batal)"
            className="rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
          >
            ✅ Pindahkan ke Selesai
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
 * dari open bill ke penjualan (status tiap barisnya ikut terbawa).
 *
 * Yang ditandai dapur adalah BARIS, bukan kartu. Status kartu cuma turunan:
 * ia pindah ke kolom Selesai saat tak ada lagi sajian yang menunggu.
 */
export function PesananPage() {
  const { query: branchQuery } = useCabangData();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [fokus, setFokus] = useState<PesananStatus>("dikerjakan");
  const [riwayat, setRiwayat] = useState<PesananRow | null>(null);

  const kunci = ["pesanan", branchQuery, tanggal];
  const qs = `${branchQuery ? `${branchQuery}&` : "?"}tanggal=${tanggal}`;
  /**
   * Selama ada tombol status yang belum dijawab server, polling DIMATIKAN.
   *
   * Kalau tidak: jawaban polling yang berangkat sebelum perubahan tersimpan akan
   * mendarat sesudahnya dan menimpa tampilan optimistis dengan status lama —
   * badge berkedip balik lalu maju lagi. Itu justru terbaca "lemot", bukan cepat.
   */
  const adaAksi = useIsMutating({ mutationKey: ["pesanan-aksi"] }) > 0;
  const { data, isLoading, error } = useQuery({
    queryKey: kunci,
    queryFn: () => api<PesananRow[]>(`/pesanan${qs}`),
    // Papan dapur = satu-satunya layar yang keterlambatannya berujung makanan
    // tak dibuat, jadi lebih rapat dari norma 30 dtk aplikasi ini.
    refetchInterval: adaAksi ? false : 15_000,
  });

  /**
   * TAMPILKAN DULU, KIRIM BELAKANGAN.
   *
   * Dapur menekan tombol ini puluhan kali per shift sambil memegang piring.
   * Menunggu satu putaran jaringan + satu refetch penuh sebelum badge berubah
   * membuat setiap ketukan terasa menggantung — itu keluhan "lemot"-nya. Kartu
   * di cache diperbarui lebih dulu memakai aturan turunan yang SAMA dengan
   * server (`ringkasPesanan`), jadi kolom, hitungan "2/3 selesai", dan urutan
   * langsung benar. Kalau servernya menolak, `onError` memulihkan apa adanya.
   */
  function terapkanOptimistis(
    p: PesananRow,
    ubahBaris: (it: PesananItemRow) => PesananItemRow,
  ): { sebelum: PesananRow[] | undefined } {
    const sebelum = queryClient.getQueryData<PesananRow[]>(kunci);
    queryClient.setQueryData<PesananRow[]>(kunci, (lama) =>
      lama
        ? urutkanPesanan(
            lama.map((r) => {
              if (r.jenis !== p.jenis || r.id !== p.id) return r;
              const items = r.items.map(ubahBaris);
              return { ...r, items, ...ringkasPesanan(items) };
            }),
          )
        : lama,
    );
    return { sebelum };
  }
  const pulihkan = (ctx: { sebelum: PesananRow[] | undefined } | undefined) => {
    if (ctx?.sebelum) queryClient.setQueryData(kunci, ctx.sebelum);
  };
  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["pesanan"] });
    queryClient.invalidateQueries({ queryKey: ["pesanan-log"] });
  };
  /**
   * Menandai TA pada penjualan yang SUDAH DIBAYAR bukan lagi sekadar penanda
   * penyajian: server menghitung ulang `hpp_satuan`/`total_hpp` dan menulis
   * ulang `sale_consumptions` (`hitungUlangBiayaPenjualan`). Uang dan stok
   * benar-benar berpindah.
   *
   * Tanpa ini papan tampak berhasil sementara Laporan dan Stok masih memajang
   * angka lama — dan gejalanya justru membuat orang menyimpulkan fiturnya tak
   * bekerja, padahal pembukuannya sudah benar.
   *
   * Sengaja TIDAK disatukan ke `segarkan`: papan dapur menekan tombol status
   * terus-menerus, dan menyegarkan stok/laporan tiap ketukan membebani tablet
   * tanpa alasan. Hanya `sajian` yang memindahkan uang.
   *
   * Cakupannya pun dipilih, bukan disapu rata: `laporan` memuat `total_hpp`,
   * `riwayat` memajang penjualan yang penandanya baru berubah, `stok` memuat
   * saldo bahan kemasan. `menu-laris` tak memuat HPP dan `laporan-pembelian`
   * urusan pembelian — keduanya tak tersentuh.
   */
  const segarkanBiaya = () => {
    queryClient.invalidateQueries({ queryKey: ["stok"] });
    queryClient.invalidateQueries({ queryKey: ["laporan"] });
    queryClient.invalidateQueries({ queryKey: ["riwayat"] });
  };
  /** Jejak "siapa & kapan" versi klien — ditimpa jawaban server saat refetch. */
  const jejak = () => ({
    status_oleh: auth?.user.nama ?? null,
    status_pada: new Date().toISOString(),
  });

  const statusItem = useMutation({
    mutationKey: ["pesanan-aksi"],
    mutationFn: (v: { p: PesananRow; itemId: string; status: PesananStatus }) =>
      api(`/pesanan/${v.p.jenis}/${v.p.id}/item/${v.itemId}/status`, {
        method: "POST",
        body: { status: v.status },
      }),
    onMutate: (v) =>
      terapkanOptimistis(v.p, (it) =>
        it.id === v.itemId ? { ...it, status: v.status, ...jejak() } : it,
      ),
    onError: (_e, _v, ctx) => pulihkan(ctx),
    onSettled: segarkan,
  });
  const sajianItem = useMutation({
    mutationKey: ["pesanan-aksi"],
    mutationFn: (v: { p: PesananRow; itemId: string; takeaway: boolean }) =>
      api(`/pesanan/${v.p.jenis}/${v.p.id}/item/${v.itemId}/sajian`, {
        method: "POST",
        body: { takeaway: v.takeaway },
      }),
    onMutate: (v) =>
      terapkanOptimistis(v.p, (it) =>
        it.id === v.itemId ? { ...it, sajian_takeaway: v.takeaway } : it,
      ),
    onError: (_e, _v, ctx) => pulihkan(ctx),
    onSettled: (_d, _e, v) => {
      segarkan();
      // Bill yang belum dibayar belum punya biaya terbuku — penandanya baru
      // sampai ke angka saat dibayar, jadi tak ada yang basi untuk disegarkan.
      if (v.p.jenis === "penjualan") segarkanBiaya();
    },
  });
  /**
   * "Pindahkan ke Selesai" — satu tombol untuk seluruh kartu.
   *
   * Hanya baris yang masih `dikerjakan` yang ikut selesai; yang `batal` tetap
   * batal. Menandai pesanan kelar bukan alasan menghidupkan lagi sajian yang
   * dibatalkan — servernya menerapkan aturan yang sama.
   */
  const pindahSelesai = useMutation({
    mutationKey: ["pesanan-aksi"],
    mutationFn: (v: { p: PesananRow }) =>
      api(`/pesanan/${v.p.jenis}/${v.p.id}/status`, {
        method: "POST",
        body: { status: "selesai" },
      }),
    onMutate: (v) =>
      terapkanOptimistis(v.p, (it) =>
        it.status === "dikerjakan" ? { ...it, status: "selesai", ...jejak() } : it,
      ),
    onError: (_e, _v, ctx) => pulihkan(ctx),
    onSettled: segarkan,
  });
  const galat = statusItem.error ?? sajianItem.error ?? pindahSelesai.error;

  const rows = data ?? [];
  const perKolom = (s: PesananStatus) => rows.filter((r) => r.status === s);
  const sajianJalan = rows.reduce(
    (n, r) => n + r.items.filter((i) => i.status === "dikerjakan").length,
    0,
  );

  return (
    <div className="max-w-6xl">
      <PageTitle>Papan Pesanan Masuk</PageTitle>
      <CabangDataBar />
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Setiap pesanan yang diinput kasir muncul di sini — termasuk yang{" "}
        <b>belum dibayar</b>. Tandai <b>tiap sajian</b> begitu keluar dari dapur, jadi
        semua orang tahu mana yang sudah dan mana yang belum. Tombol <b>bawa pulang</b>{" "}
        hanya mengubah cara penyajian, tidak mengubah nota atau perhitungan stok.
        {/* Tanpa keterangan ini, dapur akan mencari tombol Batal yang sudah tak
            ada dan menyangka papannya rusak. */}
        <div className="mt-1">
          <b>Membatalkan pesanan dilakukan kasir</b>, bukan dari papan ini — karena
          menyangkut tagihan. Pesanan yang dibatalkan kasir tetap muncul di kolom{" "}
          <b>Batal</b> supaya dapur tahu harus berhenti memasak.
        </div>
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
          {rows.length} pesanan · <b>{sajianJalan}</b> sajian masih dikerjakan
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
                      onStatusItem={(itemId, status) => statusItem.mutate({ p, itemId, status })}
                      onSajianItem={(itemId, takeaway) => sajianItem.mutate({ p, itemId, takeaway })}
                      onPindahSelesai={() => pindahSelesai.mutate({ p })}
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
