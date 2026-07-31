import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { KonfirmasiStatus } from "@kakarut/shared";
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
import type { JenisPengadaan } from "@kakarut/shared";
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
  // Kiriman diterima di cabang tujuan. Dari KANTOR tampil SEMUA cabang.
  const { query: dataQuery, dariKantor } = useCabangData();
  const branchQuery = dariKantor ? "?branch_id=all" : dataQuery;
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

  function segarkan() {
    for (const key of ["penerimaan", "/pembelian", "stok"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    setSebagianKey(null);
    setTolakKey(null);
    setAlasan("");
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
            qty_diterima: Number(qtyDraft[r.id] ?? r.qty) || 0,
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
      {!dariKantor && <CabangDataBar />}
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
                              type="number"
                              min="0"
                              max={r.qty}
                              step="any"
                              value={qtyDraft[r.id] ?? String(r.qty)}
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
                      <span className="mr-auto text-xs text-stone-500">
                        Isi jumlah yang benar-benar diterima (0 = baris ditolak).
                      </span>
                      <button
                        onClick={() => terimaSebagian.mutate(g)}
                        disabled={terimaSebagian.isPending}
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
    </div>
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
