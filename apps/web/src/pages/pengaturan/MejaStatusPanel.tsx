import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MejaKosongLogRow, MejaStatusDto } from "@kakarut/shared";
import { Modal, Spinner, btnSecondary } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatWaktu } from "../../lib/format";

/**
 * Status okupansi meja — dipakai bersama oleh halaman Meja dan modal "Pilih
 * Meja" di kasir, supaya keduanya mustahil menampilkan warna yang berbeda
 * untuk meja yang sama.
 *
 * Kunci cache SENGAJA terpisah dari `["meja", …]`: kunci itu memuat daftar
 * master yang dipakai layar kasir sepanjang hari, dan menaruh penarikan
 * berkala di sana akan menarik ulang seluruh daftar meja tiap 30 detik di jam
 * paling ramai. Yang berubah cepat cuma statusnya.
 */
export function useMejaStatus(branchQuery: string, aktif = true) {
  return useQuery({
    queryKey: ["meja-status", branchQuery],
    queryFn: () => api<MejaStatusDto[]>(`/meja/status${branchQuery}`),
    enabled: aktif,
    // 30 detik = norma aplikasi ini. Papan dapur memakai 15 detik karena
    // keterlambatannya berujung makanan tak dibuat; layar cek meja tidak punya
    // konsekuensi itu — waiter tetap melihat mejanya sendiri dengan mata.
    refetchInterval: 30_000,
  });
}

/** Sudah berapa lama tamu di meja ini, dari tagihan paling awal. */
export function lamaDuduk(sejak: string | null): string {
  if (!sejak) return "";
  const menit = Math.floor((Date.now() - new Date(sejak).getTime()) / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} mnt`;
  return `${Math.floor(menit / 60)} jam ${menit % 60} mnt`;
}

/** Ringkasan satu baris untuk badge/kartu. */
export function labelStatus(s: MejaStatusDto): string {
  if (s.status === "kosong") return "Kosong";
  if (s.lunas_masih_duduk) return `✓ Sudah bayar · ${lamaDuduk(s.sejak)}`;
  return `Belum bayar · ${s.bill_terbuka} pesanan`;
}

/**
 * Warna meja yang statusnya TIDAK diketahui — abu-abu, bukan hijau.
 *
 * `GET /meja/status` mengembalikan satu baris untuk SETIAP meja dine-in cabang
 * (LEFT JOIN dari tabel meja, lihat `okupansi.ts`). Jadi status yang hilang
 * tidak pernah berarti "meja ini kosong"; ia hanya bisa berarti bacaannya
 * gagal atau belum tiba.
 */
export const KELAS_TAK_DIKETAHUI = "border-stone-300 bg-stone-100 text-stone-500";

export function kelasStatus(s: MejaStatusDto | undefined): string {
  // Dulu `!s` ikut dijawab hijau bersama "kosong". Hijau di layar ini punya
  // arti yang dicetak di legendanya sendiri: "siap ditempati". Menjawab hijau
  // untuk status yang tak diketahui membuat SATU permintaan gagal mengubah
  // seluruh denah jadi hijau — semua meja tampak bebas, termasuk yang masih
  // menunggak bayar, dan tak ada satu pun tanda bahwa layarnya sedang buta.
  if (!s) return KELAS_TAK_DIKETAHUI;
  if (s.status === "kosong") return "border-green-300 bg-green-50 text-green-800";
  if (s.lunas_masih_duduk) return "border-amber-400 bg-amber-50 text-amber-800";
  return "border-red-400 bg-red-50 text-red-800";
}

/**
 * Dialog konfirmasi "bereskan meja". Dua tahap: bila server menjawab masih ada
 * tagihan belum dibayar (`kode: "bill_berjalan"`), dialog berganti jadi
 * peringatan yang menegaskan tagihannya TIDAK dibatalkan, lalu kiriman kedua
 * memakai `paksa`. Tanpa tahap kedua, tombolnya buntu; tanpa tahap pertama,
 * seseorang bisa membereskan meja tanpa sadar ada uang yang belum ditagih.
 */
export function KosongkanMejaModal({
  meja,
  branchQuery,
  onClose,
}: {
  meja: MejaStatusDto;
  branchQuery: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [perluPaksa, setPerluPaksa] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [lihatRiwayat, setLihatRiwayat] = useState(false);

  /*
   * `branchQuery` WAJIB ikut di kedua pintu di bawah, dan bukan demi kerapian.
   *
   * `GET /meja/:id/log` dan `POST /meja/:id/kosongkan` sama-sama memanggil
   * `resolveBranchId(c)`, yang untuk owner/admin berbunyi: "`?branch_id=` bila
   * ada, kalau tidak **cabang aktif PERTAMA**". Keduanya lalu menuntut mejanya
   * berada di cabang itu. Jadi permintaan tanpa `branch_id` dari halaman Meja
   * yang sedang menampilkan cabang lain menanyakan meja yang benar kepada
   * cabang yang salah.
   *
   * Terukur terhadap Postgres sungguhan, meja milik cabang kedua:
   *   GET  /meja/:id/log            tanpa branch_id → 404   dengan → 200
   *   POST /meja/:id/kosongkan      tanpa branch_id → 404   dengan → 200
   *
   * Nilainya sudah ada di berkas ini sejak awal — dipakai `invalidateQueries`
   * beberapa baris di bawah, dan dikirim dengan benar oleh pemanggil kembar di
   * `KasirPage` (`/meja/${id}/kosongkan${branchQuery}`). Yang hilang cuma
   * salinannya di dua pintu ini.
   */
  const {
    data: riwayat,
    isLoading: riwayatMuat,
    error: riwayatGagal,
  } = useQuery({
    // Kuncinya ikut membawa cabang karena URL-nya membawa cabang: dua
    // permintaan yang berbeda tak boleh berbagi satu tempat di cache.
    queryKey: ["meja-log", meja.meja_id, branchQuery],
    queryFn: () => api<MejaKosongLogRow[]>(`/meja/${meja.meja_id}/log${branchQuery}`),
    enabled: lihatRiwayat,
  });

  const kosongkan = useMutation({
    mutationFn: (paksa: boolean) =>
      api(`/meja/${meja.meja_id}/kosongkan${branchQuery}`, { method: "POST", body: { paksa } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meja-status"] });
      queryClient.invalidateQueries({ queryKey: ["meja-log", meja.meja_id] });
      // (prefiks, jadi ia tetap mencakup kunci yang kini berakhiran cabang)
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.data?.kode === "bill_berjalan") {
        setPerluPaksa(true);
        setGalat(null);
        return;
      }
      setGalat(e instanceof Error ? e.message : String(e));
      // meja mungkin sudah berubah di server — tarik ulang supaya layar jujur
      queryClient.invalidateQueries({ queryKey: ["meja-status", branchQuery] });
    },
  });

  return (
    <Modal open onClose={onClose} title={`Bereskan ${meja.nama}?`}>
      {perluPaksa ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Meja ini masih punya <b>{meja.bill_terbuka} pesanan yang belum dibayar</b>.
          </div>
          <p className="text-sm text-stone-600">
            Tagihannya <b>tidak dibatalkan dan tidak hilang</b> — tetap ada di daftar Open Bill
            kasir dan tetap bisa ditagih. Yang berubah hanya: meja ini berhenti ditandai terisi
            sehingga bisa dipakai tamu berikutnya.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            Tandai meja ini sudah dibereskan supaya bisa dipakai konsumen berikutnya. Tercatat
            atas nama Anda.
          </p>
          <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
            {meja.bill_terbuka > 0 && (
              <div>🧾 {meja.bill_terbuka} pesanan belum dibayar</div>
            )}
            {meja.transaksi_aktif > 0 && (
              <div>✓ {meja.transaksi_aktif} transaksi sudah dibayar</div>
            )}
            {meja.sejak && <div className="text-xs text-stone-500">Terisi {lamaDuduk(meja.sejak)}</div>}
          </div>
        </div>
      )}

      {galat && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{galat}</div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setLihatRiwayat((v) => !v)}
          className="text-xs font-medium text-stone-500 underline hover:text-stone-700"
        >
          {lihatRiwayat ? "Sembunyikan riwayat" : "Riwayat meja ini"}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            type="button"
            disabled={kosongkan.isPending}
            onClick={() => kosongkan.mutate(perluPaksa)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              perluPaksa ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {kosongkan.isPending
              ? "Menyimpan…"
              : perluPaksa
                ? "Ya, tetap kosongkan"
                : "Ya, kosongkan meja"}
          </button>
        </div>
      </div>

      {lihatRiwayat && (
        <div className="mt-3 border-t border-stone-100 pt-3">
          {/* Cabang GAGAL didahulukan. Dulu syaratnya `!riwayat`, dan `riwayat`
              tetap undefined saat bacaannya gagal — spinner berputar selamanya,
              tanpa pernah menyebut ada yang salah. */}
          {riwayatGagal ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Riwayat meja gagal dimuat
              {riwayatGagal instanceof Error ? `: ${riwayatGagal.message}` : ""}.
            </p>
          ) : riwayatMuat || !riwayat ? (
            <Spinner />
          ) : riwayat.length === 0 ? (
            <p className="py-3 text-center text-sm text-stone-400">
              Meja ini belum pernah dibereskan lewat aplikasi.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {riwayat.map((r, i) => (
                <li key={i} className="rounded-lg bg-stone-50 px-3 py-1.5 text-sm">
                  <div className="font-medium text-stone-800">{r.aksi}</div>
                  <div className="text-xs text-stone-500">
                    {formatWaktu(r.waktu)} · {r.oleh ?? "—"}
                    {r.detail ? ` · ${r.detail}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}
