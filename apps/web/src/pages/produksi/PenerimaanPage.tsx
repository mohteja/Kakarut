import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { KonfirmasiStatus } from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import type { JenisPengadaan, RiwayatPenerimaanFaktur } from "@kakarut/shared";
import { useCabangData } from "../../context/BranchContext";
import { useAuth } from "../../context/AuthContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { api } from "../../lib/api";
import { KUNCI_ANOMALI, useKirimanMenggantung } from "../../lib/menggantung";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

interface PenerimaanRow {
  id: string;
  ingredient_id: string;
  bahan: string;
  isi: number;
  satuan: string;
  qty: number;
  total_harga: number | null;
  is_batch: boolean;
  catatan: string | null;
  waktu: string;
  prod_date: string;
  faktur_id: string | null;
  no_faktur: string | null;
  /** nomor faktur asal (PB-/PR-) — "dari faktur nomor berapa" */
  nomor?: string | null;
  status: KonfirmasiStatus;
  supplier: string | null;
  tempat: string | null;
  qty_dipesan: number | null;
  alasan_tolak: string | null;
  /** jalur kiriman: 🛒 beli (pemasok) / 🏭 produksi (Central Kitchen) */
  jalur?: JenisPengadaan;
  /** cabang penerima (utk tampilan Kantor "semua cabang") */
  cabang?: string | null;
}

interface KirimanGroup {
  key: string;
  fakturId: string | null;
  waktu: string;
  supplier: string | null;
  noFaktur: string | null;
  /** nomor faktur asal (PB-/PR-) */
  nomor: string | null;
  catatan: string | null;
  status: KonfirmasiStatus;
  alasanTolak: string | null;
  jalur: JenisPengadaan;
  cabang: string | null;
  rows: PenerimaanRow[];
}

/**
 * Penerimaan barang di toko/cabang: kiriman pembelian berstatus "Dikirim"
 * diterima semua, diterima sebagian (barang kurang — isi qty per baris), atau
 * ditolak. Penolakan bisa dibatalkan (salah cek) → faktur selesai & stok masuk.
 * Dapat diakses semua peran; kasir terkunci ke cabangnya.
 */
export function PenerimaanPage() {
  /**
   * SATU CABANG SEKALI LIHAT — halaman ini menirukan berdirinya orang di
   * gudang satu cabang: apa yang menunggu di SINI, apa yang sudah diterima di
   * SINI. Dulu dari Kantor dipaksa "semua cabang", dan riwayatnya jadi campuran
   * penerimaan CK + cabang tanpa ada cara memisahkannya — sementara badge
   * "Penerimaan Barang" di sidebar sudah menghitung PER CABANG (`dataQuery`),
   * jadi angkanya tak pernah cocok dengan isi halamannya.
   *
   * Sekarang keduanya memakai satu sumber yang sama, dan dari Kantor cabangnya
   * dipilih lewat CabangDataBar — pola yang sama dengan Stok, Meja, dan Kasir.
   */
  const { query: branchQuery, dariKantor } = useCabangData();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["penerimaan", branchQuery],
    queryFn: () => api<{ rows: PenerimaanRow[] }>(`/penerimaan${branchQuery}`),
  });

  // mode terima-sebagian per faktur: draft qty diterima per baris
  const [sebagianKey, setSebagianKey] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  // mode tolak per faktur: input alasan
  const [tolakKey, setTolakKey] = useState<string | null>(null);
  const [alasan, setAlasan] = useState("");

  const grup = useMemo<KirimanGroup[]>(() => {
    const byKey = new Map<string, KirimanGroup>();
    for (const r of data?.rows ?? []) {
      const key = r.faktur_id ?? r.id;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          fakturId: r.faktur_id,
          waktu: r.waktu,
          supplier: r.supplier,
          noFaktur: r.no_faktur,
          nomor: r.nomor ?? null,
          catatan: r.catatan,
          status: r.status,
          alasanTolak: r.alasan_tolak,
          jalur: r.jalur ?? "beli",
          cabang: r.cabang ?? null,
          rows: [],
        };
        byKey.set(key, g);
      }
      g.rows.push(r);
      if (r.alasan_tolak && !g.alasanTolak) g.alasanTolak = r.alasan_tolak;
    }
    return [...byKey.values()];
  }, [data]);

  const dikirim = grup.filter((g) => g.status === "menunggu");
  const ditolak = grup.filter((g) => g.status === "ditolak");

  /**
   * Semua yang berubah begitu barang diterima/ditolak — daftarnya harus utuh,
   * karena kunci yang terlewat tidak memberi tanda apa pun: layarnya cuma diam
   * menampilkan keadaan lama sampai pengguna memuat ulang.
   *
   * - `penerimaan-riwayat` BUKAN turunan `penerimaan`: pencocokan awalan
   *   TanStack membandingkan elemen pertama utuh, jadi `["penerimaan"]` tak
   *   pernah mengenai `["penerimaan-riwayat", …]`. Tanpa ini faktur yang baru
   *   diterima lenyap dari Menunggu tapi tak muncul di Riwayat di bawahnya —
   *   persis bagian layar yang seharusnya membuktikan penerimaannya tercatat.
   * - `/produksi` sama pentingnya dengan `/pembelian`: sejak kiriman beralamat
   *   hanya sah lewat tombol Terima, faktur PRODUKSI pun diselesaikan di sini.
   */
  function segarkan() {
    for (const key of [
      "penerimaan",
      "penerimaan-riwayat",
      "/pembelian",
      "/produksi",
      "stok",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    setSebagianKey(null);
    setTolakKey(null);
    setAlasan("");
  }

  /**
   * Baris yang qty diterimanya tak terbaca sebagai angka ≥ 0.
   *
   * Di layar ini salah ketik tidak menghasilkan angka yang salah — ia
   * menghasilkan HASIL YANG BERLAWANAN. Bentuk lamanya `angkaDari(...) || 0`,
   * dan nol punya arti tegas yang ditulis di dua tempat sekaligus: label di
   * bawah tabel ("0 = baris ditolak") dan server, yang menyetel baris ber-qty 0
   * jadi status "ditolak" beralasan "Barang tidak diterima". Jadi yang mengetik
   * "5 kg" — bermaksud "saya menerima sebanyak ini" — justru menolak barangnya,
   * dan stoknya tak pernah masuk.
   *
   * `angkaDari` sendiri sudah melarang bentuk itu, dengan alasan yang sama
   * persis: "Sengaja TIDAK memulangkan 0: 0 adalah angka yang sah dan bermakna
   * di stok, dan menjadikannya nilai kegagalan membuat salah ketik tak bisa
   * dibedakan dari 'memang nol'."
   *
   * Kotak KOSONG ikut ditahan, bukan dianggap "pakai bawaan": kotaknya sudah
   * terisi qty kiriman sejak awal, jadi mengosongkannya adalah tindakan — dan
   * hari ini tindakan itu berarti menolak. Yang mau menolak mengetik 0.
   */
  function qtyTakTerbaca(g: KirimanGroup) {
    return g.rows.filter((r) => !(angkaDari(qtyDraft[r.id] ?? r.qty) >= 0));
  }

  const terima = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/penerimaan/${fakturId}/terima`, { method: "POST" }),
    onSuccess: segarkan,
  });
  const terimaSebagian = useMutation({
    mutationFn: (g: KirimanGroup) =>
      api(`/penerimaan/${g.fakturId}/terima-sebagian`, {
        method: "POST",
        body: {
          items: g.rows.map((r) => ({
            id: r.id,
            // TANPA `|| 0`. Nol di sini bukan nilai cadangan — ia PERINTAH:
            // server menyetel baris ber-qty 0 jadi status "ditolak" beralasan
            // "Barang tidak diterima". `qtyTakTerbaca` di bawah menahannya
            // sebelum sampai sini; kalaupun lolos, JSON `null` ditolak zod
            // dengan berisik, dan berisik jauh lebih baik daripada penolakan
            // barang yang diam-diam.
            qty_diterima: angkaDari(qtyDraft[r.id] ?? r.qty),
          })),
          alasan: alasan.trim() || null,
        },
      }),
    onSuccess: segarkan,
  });
  const tolak = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/penerimaan/${fakturId}/tolak`, {
        method: "POST",
        body: { alasan: alasan.trim() || null },
      }),
    onSuccess: segarkan,
  });
  const batalTolak = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/penerimaan/${fakturId}/batal-tolak`, { method: "POST" }),
    onSuccess: segarkan,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      {/* Dari Kantor: pemilih cabang. Komponennya menyembunyikan diri sendiri
          saat bukan dari Kantor — membungkusnya dengan `!dariKantor` (seperti
          dulu) membuatnya TIDAK PERNAH tampil, karena kedua syaratnya
          berlawanan. Itulah sebabnya Kantor tak punya cara memilih cabang. */}
      <CabangDataBar />
      <PageTitle>Penerimaan Barang</PageTitle>
      <div className="mb-4 text-sm text-stone-500">
        Kiriman pembelian yang sudah <b>dikirim ke toko</b> diterima di sini. Bila barang
        kurang, pilih <b>Terima Sebagian</b> dan isi jumlah yang benar-benar diterima; bila
        salah/tidak sesuai, <b>Tolak</b>. Penolakan bisa <b>dibatalkan</b> jika ternyata salah
        cek — faktur langsung selesai & stok masuk.
      </div>

      <ErrorText error={terima.error || terimaSebagian.error || tolak.error || batalTolak.error} />

      <PanelMenggantung />

      <h2 className="mb-2 text-lg font-semibold text-stone-700">
        🚚 Menunggu penerimaan{" "}
        <span className="text-sm font-normal text-stone-400">({dikirim.length})</span>
      </h2>
      {dikirim.length === 0 ? (
        <Card className="mb-6 p-6 text-center text-sm text-stone-400">
          Tidak ada kiriman yang menunggu penerimaan.
        </Card>
      ) : (
        <div className="mb-6 space-y-3">
          {dikirim.map((g) => {
            const modeSebagian = sebagianKey === g.key;
            const modeTolak = tolakKey === g.key;
            return (
              <Card key={g.key} className="overflow-hidden border-yellow-300">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-stone-700">
                      {formatTanggalRingkas(g.waktu)} {formatWaktu(g.waktu)}
                    </span>
                    {/* nomor faktur asal — "penerimaan dari faktur nomor berapa" */}
                    {g.nomor && (
                      <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                        {g.nomor}
                      </span>
                    )}
                    <span className="text-stone-500">
                      {g.jalur === "produksi"
                        ? "🏭 Dari Central Kitchen"
                        : (g.supplier ?? "🛒 Tanpa supplier")}
                    </span>
                    {dariKantor && g.cabang && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">
                        🏪 {g.cabang}
                      </span>
                    )}
                    {g.noFaktur && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
                        {g.noFaktur}
                      </span>
                    )}
                    {g.catatan && <span className="text-xs text-stone-400">· {g.catatan}</span>}
                  </div>
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                    🚚 Dikirim
                  </span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>Bahan</th>
                      <th className={`${thClass} text-right`}>Dikirim</th>
                      {modeSebagian && <th className={`${thClass} text-right`}>Diterima</th>}
                      <th className={thClass}>Disimpan di</th>
                      <th className={`${thClass} text-right`}>Harga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td className={`${tdClass} font-medium`}>{r.bahan}</td>
                        <td className={`${tdClass} text-right`}>
                          {formatAngka(r.qty)} {r.satuan}
                        </td>
                        {modeSebagian && (
                          <td className={`${tdClass} text-right`}>
                            <input
                              /* Koma adalah pemisah desimal bahasa Indonesia, dan
                                 `type="number"` MEMBUANG-nya saat diketik: "1,5"
                                 tersimpan "15" dengan `badInput` false — tak ada
                                 satu pun tanda di layar. `angkaDari` membaca
                                 koma maupun titik ribuan. */
                              type="text"
                              inputMode="decimal"
                              value={qtyDraft[r.id] ?? teksAngka(r.qty)}
                              onChange={(e) =>
                                setQtyDraft((p) => ({ ...p, [r.id]: e.target.value }))
                              }
                              className={`${inputClass} w-24 text-right`}
                            />
                          </td>
                        )}
                        <td className={tdClass}>{r.tempat ?? "—"}</td>
                        <td className={`${tdClass} text-right`}>
                          {r.total_harga != null ? formatRupiah(r.total_harga) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 px-4 py-2.5">
                  {modeTolak ? (
                    <>
                      <input
                        value={alasan}
                        onChange={(e) => setAlasan(e.target.value)}
                        className={`${inputClass} max-w-xs flex-1`}
                        placeholder="alasan penolakan (mis. barang kurang)"
                      />
                      <button
                        onClick={() => tolak.mutate(g.fakturId!)}
                        disabled={tolak.isPending}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        ❌ Tolak Kiriman
                      </button>
                      <button onClick={() => setTolakKey(null)} className={btnSecondary}>
                        Batal
                      </button>
                    </>
                  ) : modeSebagian ? (
                    <>
                      {qtyTakTerbaca(g).length > 0 ? (
                        <span className="mr-auto rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-800">
                          Jumlah tidak terbaca pada{" "}
                          <b>{qtyTakTerbaca(g).map((r) => r.bahan).join(", ")}</b> — tulis
                          seperti <b>5</b> atau <b>1,5</b>. Isi <b>0</b> bila barisnya memang
                          tidak diterima.
                        </span>
                      ) : (
                        <span className="mr-auto text-xs text-stone-500">
                          Isi jumlah yang benar-benar diterima (0 = baris ditolak).
                        </span>
                      )}
                      <button
                        onClick={() => terimaSebagian.mutate(g)}
                        disabled={terimaSebagian.isPending || qtyTakTerbaca(g).length > 0}
                        className={btnPrimary}
                      >
                        {terimaSebagian.isPending ? "Menyimpan…" : "Simpan Penerimaan"}
                      </button>
                      <button onClick={() => setSebagianKey(null)} className={btnSecondary}>
                        Batal
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => terima.mutate(g.fakturId!)}
                        disabled={terima.isPending}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        ✔ Terima Semua
                      </button>
                      <button
                        onClick={() => {
                          setSebagianKey(g.key);
                          setTolakKey(null);
                          setQtyDraft({});
                        }}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                      >
                        ⚖ Terima Sebagian
                      </button>
                      <button
                        onClick={() => {
                          setTolakKey(g.key);
                          setSebagianKey(null);
                          setAlasan("");
                        }}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        ❌ Tolak
                      </button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold text-stone-700">
        ❌ Ditolak <span className="text-sm font-normal text-stone-400">({ditolak.length})</span>
      </h2>
      {ditolak.length === 0 ? (
        <Card className="p-6 text-center text-sm text-stone-400">
          Tidak ada kiriman yang ditolak.
        </Card>
      ) : (
        <div className="space-y-3">
          {ditolak.map((g) => (
            <Card key={g.key} className="overflow-hidden border-red-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-stone-700">
                    {formatTanggalRingkas(g.waktu)} {formatWaktu(g.waktu)}
                  </span>
                  {g.nomor && (
                    <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                      {g.nomor}
                    </span>
                  )}
                  <span className="text-stone-500">{g.supplier ?? "Tanpa supplier"}</span>
                  {g.alasanTolak && (
                    <span className="text-xs text-red-600">· {g.alasanTolak}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    ❌ Ditolak
                  </span>
                  <button
                    onClick={() => batalTolak.mutate(g.fakturId!)}
                    disabled={batalTolak.isPending}
                    className={btnSecondary}
                    title="Salah cek? Batalkan penolakan — faktur selesai & stok masuk."
                  >
                    ↩ Batalkan Penolakan
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-stone-100 px-4 py-1 text-sm">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex justify-between py-1.5">
                    <span className="font-medium">{r.bahan}</span>
                    <span className="text-stone-500">
                      {formatAngka(r.qty)} {r.satuan}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <RiwayatPenerimaan />
    </div>
  );
}

const HASIL_BADGE = {
  diterima: { label: "✅ Diterima", cls: "bg-green-100 text-green-800" },
  sebagian: { label: "📦 Diterima sebagian", cls: "bg-amber-100 text-amber-800" },
  ditolak: { label: "❌ Ditolak", cls: "bg-red-100 text-red-800" },
} as const;

/**
 * RIWAYAT PENERIMAAN — PER FAKTUR.
 *
 * Daftar di atas sengaja hanya memuat yang belum selesai, jadi begitu sebuah
 * kiriman diterima kartunya lenyap tanpa jejak. Padahal justru itu yang dicari
 * saat stok tak cocok: "kiriman kemarin jadi diterima berapa, oleh siapa?".
 *
 * Satu kartu = satu faktur, sama seperti daftar Menunggu di atas — orang gudang
 * tak perlu berpindah cara pandang saat mencocokkan surat jalan.
 */
function RiwayatPenerimaan() {
  // Cabangnya dibaca dari sumber yang SAMA dengan daftar Menunggu di atas,
  // bukan dioper lewat prop — riwayat yang cabangnya beda dari daftar di
  // atasnya adalah persis kekeliruan yang membuat halaman ini membingungkan.
  const { query: branchQuery, dariKantor } = useCabangData();
  const [page, setPage] = useState(1);
  const [buka, setBuka] = useState<Set<string>>(new Set());
  const q = branchQuery ? `${branchQuery}&page=${page}` : `?page=${page}`;

  const { data, isLoading } = useQuery({
    queryKey: ["penerimaan-riwayat", branchQuery, page],
    queryFn: () =>
      api<{
        rows: RiwayatPenerimaanFaktur[];
        total: number;
        page: number;
        per_page: number;
      }>(`/penerimaan/riwayat${q}`),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const perPage = data?.per_page ?? 20;
  const halamanAkhir = Math.max(Math.ceil(total / perPage), 1);
  // Ganti cabang mengganti seluruh isi riwayat, tapi `page` bertahan. Kontrol
  // paginasi hanya dirender saat `halamanAkhir > 1`, jadi pindah ke cabang yang
  // riwayatnya muat satu halaman akan menampilkan halaman 2 yang kosong SEKALIGUS
  // menghilangkan tombol untuk kembali — persis pesan "belum ada kiriman yang
  // pernah diterima" pada cabang yang riwayatnya justru ada.
  useEffect(() => {
    setPage(1);
  }, [branchQuery]);
  // Jaring pengaman: penerimaan baru menggeser jumlah halaman tanpa sentuhan
  // filter apa pun.
  //
  // Penjagaan `data` WAJIB, jangan dilepas. `page` ikut ke dalam queryKey dan
  // query ini tak memakai `placeholderData`, jadi begitu berpindah ke halaman
  // yang belum pernah di-cache, `data` undefined sesaat → `total` jatuh ke 0 →
  // `halamanAkhir` jadi 1. Tanpa penjagaan ini, klik "halaman berikutnya"
  // langsung dipental balik ke halaman 1 sebelum datanya sempat tiba — jumlah
  // halaman hanya bermakna setelah ada data yang menghitungnya.
  useEffect(() => {
    if (data && page > halamanAkhir) setPage(halamanAkhir);
  }, [data, page, halamanAkhir]);

  return (
    <>
      <h2 className="mb-2 mt-8 text-lg font-semibold text-stone-700">
        📜 Riwayat penerimaan{" "}
        <span className="text-sm font-normal text-stone-400">({total})</span>
      </h2>
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-stone-400">
          Belum ada kiriman yang pernah diterima atau ditolak.
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const badge = HASIL_BADGE[r.hasil];
            const terbuka = buka.has(r.faktur_id);
            return (
              <Card key={r.faktur_id} className="overflow-hidden">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-left hover:bg-stone-50"
                  onClick={() =>
                    setBuka((s) => {
                      const n = new Set(s);
                      if (n.has(r.faktur_id)) n.delete(r.faktur_id);
                      else n.add(r.faktur_id);
                      return n;
                    })
                  }
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-stone-700">
                        {r.waktu ? `${formatTanggalRingkas(r.waktu)} ${formatWaktu(r.waktu)}` : "—"}
                      </span>
                      {r.nomor && (
                        <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                          {r.nomor}
                        </span>
                      )}
                      <span className="text-stone-500">
                        {r.jalur === "produksi"
                          ? "🏭 Dari Central Kitchen"
                          : (r.supplier ?? "🛒 Tanpa supplier")}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-stone-500">
                      {r.jumlah_item} barang
                      {r.oleh && <> · diterima oleh {r.oleh}</>}
                      {/* nama cabang hanya perlu saat bekerja dari Kantor —
                          orang di cabangnya sendiri sudah tahu di mana ia berdiri */}
                      {dariKantor && r.cabang && <> · 🏪 {r.cabang}</>}
                      {r.alasan_tolak && (
                        <> · <span className="text-red-600">{r.alasan_tolak}</span></>
                      )}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </button>
                {terbuka && (
                  <ul className="divide-y divide-stone-100 border-t border-stone-100 px-4 py-1 text-sm">
                    {r.items.map((i) => (
                      <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span className="font-medium">
                          {i.bahan}
                          {i.status === "ditolak" && (
                            <span className="ml-1.5 text-xs font-normal text-red-600">ditolak</span>
                          )}
                          {i.tempat && (
                            <span className="ml-1.5 text-xs font-normal text-stone-400">
                              → {i.tempat}
                            </span>
                          )}
                        </span>
                        <span className="text-stone-500">
                          {i.qty_teks}
                          {/* Yang dikirim ditampilkan HANYA saat berbeda dari yang
                              diterima — itulah selisih yang dicari orang. */}
                          {i.qty_dipesan != null && i.qty_dipesan !== i.qty && (
                            <span className="ml-1 text-xs text-amber-700">
                              (dikirim {i.qty_dipesan_teks})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {halamanAkhir > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            className={btnSecondary}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
          >
            ← Sebelumnya
          </button>
          <span className="text-stone-500">
            Halaman {page} dari {halamanAkhir}
          </span>
          <button
            type="button"
            className={btnSecondary}
            disabled={page >= halamanAkhir}
            onClick={() => setPage((p) => Math.min(p + 1, halamanAkhir))}
          >
            Berikutnya →
          </button>
        </div>
      )}
    </>
  );
}

/**
 * KIRIMAN MENGGANTUNG — barang yang fakturnya berbunyi "Dikirim" tapi tak
 * pernah sampai ke layar Penerimaan siapa pun, jadi stoknya tak pernah masuk.
 *
 * Panel ini SENGAJA hanya muncul saat ada masalah. Keadaan sehat adalah nol,
 * dan spanduk peringatan yang selalu nongol setiap hari akan berhenti dibaca
 * persis pada hari ia benar-benar penting.
 */
function PanelMenggantung() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { data, jumlah } = useKirimanMenggantung();
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [alasan, setAlasan] = useState("");

  const bolehHapus = auth?.user.role === "owner" || auth?.user.role === "admin";

  const tutup = useMutation({
    mutationFn: () =>
      api<{ ditutup: number; dilewati: number }>("/penerimaan/anomali/tutup", {
        method: "POST",
        body: { ids: [...pilih], alasan: alasan.trim() || null },
      }),
    onSuccess: () => {
      for (const key of [...KUNCI_ANOMALI, "penerimaan", "/pembelian", "/produksi", "stok"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setPilih(new Set());
      setKonfirmasi(false);
      setAlasan("");
    },
  });

  if (jumlah === 0) return null;
  const rows = data?.rows ?? [];

  function toggle(id: string) {
    setPilih((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <Card className="mb-6 overflow-hidden border-red-300 bg-red-50/40">
      <div className="border-b border-red-200 px-4 py-3">
        <div className="font-semibold text-red-800">
          ⚠️ {jumlah} kiriman tidak sampai — stok tidak pernah masuk
        </div>
        <p className="mt-1 text-sm text-red-700">
          Barang ini <b>sudah dikirim</b> menurut fakturnya, tapi tak pernah muncul di layar
          Penerimaan mana pun sehingga stok cabang tak bertambah. Penyebabnya sudah diperbaiki
          untuk pengiriman baru; yang di bawah ini sisa dari sebelumnya.
        </p>
        <p className="mt-2 text-sm text-red-700">
          Kalau stoknya <b>sudah dicatat manual</b> (Stok Awal / opname / faktur manual),
          <b> hapuskan</b> — menerimanya justru menghitung barang yang sama dua kali. Yang
          dihapuskan masuk <b>Tempat Sampah</b> dan masih bisa dipulihkan.
        </p>
      </div>

      <ul className="divide-y divide-red-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            {bolehHapus && (
              <input
                type="checkbox"
                className="h-4 w-4 accent-red-600"
                checked={pilih.has(r.id)}
                onChange={() => toggle(r.id)}
                aria-label={`Pilih ${r.bahan}`}
              />
            )}
            <span className="font-medium text-stone-800">{r.bahan}</span>
            <span className="text-stone-600">
              {formatAngka(r.qty)} {r.satuan}
            </span>
            {r.nomor && (
              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                {r.nomor}
              </span>
            )}
            <span className="text-xs text-stone-500">
              {r.tipe === "produksi" ? "🏭" : "🛒"} {r.dikirim_dari ?? "?"} →{" "}
              {r.posisi_sekarang ?? "?"}
            </span>
            <span className="ml-auto text-xs text-red-700">
              menggantung {r.umur_hari} hari
            </span>
          </li>
        ))}
      </ul>

      {bolehHapus && (
        <div className="flex flex-wrap items-center gap-2 border-t border-red-200 px-4 py-3">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setPilih(new Set(rows.map((r) => r.id)))}
          >
            Pilih semua
          </button>
          <button
            type="button"
            className={`${btnPrimary} bg-red-600 hover:bg-red-700`}
            disabled={pilih.size === 0}
            onClick={() => setKonfirmasi(true)}
          >
            Hapuskan {pilih.size > 0 ? `(${pilih.size})` : ""}
          </button>
          <span className="text-xs text-stone-500">
            Hanya owner/admin. Bisa dipulihkan dari Tempat Sampah.
          </span>
        </div>
      )}

      <ErrorText error={tutup.error} />

      <Modal
        open={konfirmasi}
        onClose={() => setKonfirmasi(false)}
        title="Hapuskan kiriman yang tidak sampai?"
      >
        <p className="text-sm text-stone-600">
          <b>{pilih.size} baris</b> akan dihapuskan dari pembukuan dan masuk Tempat Sampah.
          Stok <b>tidak</b> akan bertambah — itu memang tujuannya: barangnya sudah dicatat
          lewat jalur lain, jadi menerimanya akan menghitungnya dua kali.
        </p>
        <label className="mt-3 block text-sm font-medium text-stone-700">
          Alasan (opsional, tersimpan di riwayat faktur)
          <input
            className={inputClass}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="mis. sudah dicatat lewat Stok Awal"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setKonfirmasi(false)}>
            Batal
          </button>
          <button
            type="button"
            className={`${btnPrimary} bg-red-600 hover:bg-red-700`}
            disabled={tutup.isPending}
            onClick={() => tutup.mutate()}
          >
            {tutup.isPending ? "Menghapuskan…" : "Ya, hapuskan"}
          </button>
        </div>
      </Modal>
    </Card>
  );
}
