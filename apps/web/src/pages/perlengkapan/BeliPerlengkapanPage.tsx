import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { BeliPerlengkapanRow, PerlengkapanMasterRow } from "@kakarut/shared";
import { angkaDari } from "@kakarut/shared";
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
import { formatAngka, formatRupiah, formatWaktu } from "../../lib/format";

/**
 * Satu FAKTUR beli perlengkapan (BP-) = kumpulan baris satu submit — tampilan
 * kartu per faktur, sejajar Beli Bahan Baku. Baris warisan tanpa faktur_id
 * diperlakukan sebagai faktur satu-item (kunci = id barisnya).
 */
interface FakturBeli {
  key: string;
  /** faktur_id server (null = baris warisan → aksi per baris) */
  fakturId: string | null;
  nomor: string | null;
  ckNama: string;
  tujuanNama: string | null;
  waktu: string;
  oleh: string | null;
  catatan: string | null;
  rows: BeliPerlengkapanRow[];
  /** tahap paling tertinggal: menunggu > diproses > tiba > batal */
  status: BeliPerlengkapanRow["status"];
  /** pemroses belanja (tercatat saat Diproses) */
  diprosesOleh: string | null;
  totalHarga: number;
  /** estimasi RAB: Σ (harga riil ?? qty × harga_beli master), tanpa baris batal */
  totalEstimasi: number;
  /** terkait permintaan MASIH AKTIF → tak boleh Hapus permanen (kelola dari Permintaan Stok) */
  permintaanAktif: boolean;
}

/** faktur masih perlu aksi (belum tiba/batal seluruhnya) */
function butuhAksi(status: BeliPerlengkapanRow["status"]): boolean {
  return status === "menunggu" || status === "diproses";
}

function kelompokkanFaktur(rows: BeliPerlengkapanRow[]): FakturBeli[] {
  const byKey = new Map<string, FakturBeli>();
  for (const r of rows) {
    const key = r.faktur_id ?? r.id;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        fakturId: r.faktur_id,
        nomor: r.nomor,
        ckNama: r.ck_nama,
        tujuanNama: r.tujuan_nama,
        waktu: r.waktu,
        oleh: r.oleh,
        catatan: r.catatan,
        rows: [],
        status: r.status,
        diprosesOleh: null,
        totalHarga: 0,
        totalEstimasi: 0,
        permintaanAktif: false,
      };
      byKey.set(key, g);
    }
    g.rows.push(r);
    if (r.permintaan_aktif) g.permintaanAktif = true;
    if (r.diproses_oleh && !g.diprosesOleh) g.diprosesOleh = r.diproses_oleh;
    if (r.total_harga != null && r.status !== "batal") g.totalHarga += r.total_harga;
    if (r.status !== "batal") g.totalEstimasi += r.total_harga ?? r.qty * (r.harga_beli ?? 0);
    // status faktur = tahap PALING TERTINGGAL di antara barisnya
    if (r.status === "menunggu") g.status = "menunggu";
    else if (r.status === "diproses" && g.status !== "menunggu") g.status = "diproses";
    else if (r.status === "tiba" && !butuhAksi(g.status)) g.status = "tiba";
  }
  // butuh aksi dulu (menunggu/diproses), lalu terbaru — mengikuti urutan server
  return [...byKey.values()].sort((a, b) => {
    const ba = butuhAksi(a.status) ? 0 : 1;
    const bb = butuhAksi(b.status) ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return b.waktu.localeCompare(a.waktu);
  });
}

/**
 * BELI PERLENGKAPAN ke Central Kitchen — sejajar "Beli Bahan Baku": satu
 * faktur BP- bisa memuat banyak item, dikelompokkan per kartu. Faktur lahir
 * otomatis saat permintaan cabang & stok CK kurang, atau dibuat manual di
 * sini. Alur: beli → Tiba di CK (masuk stok CK) → otomatis dikirim ke cabang.
 */
export function BeliPerlengkapanPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [tiba, setTiba] = useState<FakturBeli | null>(null);
  const [rab, setRab] = useState<FakturBeli | null>(null);
  const [detail, setDetail] = useState<FakturBeli | null>(null);
  const [buatOpen, setBuatOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["perlengkapan-beli"],
    queryFn: () => api<BeliPerlengkapanRow[]>("/perlengkapan/beli"),
  });
  const grup = useMemo(() => kelompokkanFaktur(rows), [rows]);
  const batal = useMutation({
    mutationFn: (g: FakturBeli) =>
      g.fakturId
        ? api(`/perlengkapan/beli/faktur/${g.fakturId}/batal`, { method: "POST", body: {} })
        : api(`/perlengkapan/beli/${g.rows[0].id}/batal`, { method: "POST", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] }),
  });
  // tandai sedang dibelanjakan (pemroses tercatat) — paritas tahap beli bahan baku
  const proses = useMutation({
    mutationFn: (g: FakturBeli) =>
      api(`/perlengkapan/beli/faktur/${g.fakturId}/proses`, { method: "POST", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] }),
  });
  // bersih-bersih massal: faktur lama yang permintaannya sudah terhapus
  // (pra-tautan rencana) tak bisa dibatalkan otomatis — batalkan sekaligus
  const batalSemua = useMutation({
    mutationFn: () => api(`/perlengkapan/beli/batal-semua`, { method: "POST", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] }),
  });
  // HAPUS PERMANEN (bersih-bersih data lama) — hanya faktur yang tak terkait
  // permintaan aktif & belum tiba; server menjaga guard-nya.
  const hapus = useMutation({
    mutationFn: (g: FakturBeli) =>
      g.fakturId
        ? api(`/perlengkapan/beli/faktur/${g.fakturId}`, { method: "DELETE" })
        : api(`/perlengkapan/beli/${g.rows[0].id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] }),
  });

  const menunggu = grup.filter((g) => g.status === "menunggu");

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          isManajemen ? (
            <button onClick={() => setBuatOpen(true)} className={btnPrimary}>
              ➕ Beli Perlengkapan
            </button>
          ) : undefined
        }
      >
        🛒 Beli Perlengkapan
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Faktur beli perlengkapan <b>ke Central Kitchen</b> — satu faktur bisa berisi{" "}
        <b>banyak item</b>, seperti Beli Bahan Baku. Lahir otomatis saat cabang minta &amp; stok
        CK kurang, atau dibuat manual. Tandai <b>Tiba di CK</b> → semua barang masuk stok CK lalu{" "}
        <b>otomatis dikirim</b> ke cabang tujuan.
      </div>
      <ErrorText error={batal.error} />
      <ErrorText error={proses.error} />
      <ErrorText error={batalSemua.error} />
      <ErrorText error={hapus.error} />

      {isLoading ? (
        <Spinner />
      ) : grup.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada faktur beli perlengkapan.
        </Card>
      ) : (
        <div className="space-y-3">
          {menunggu.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-2">
              <span className="text-xs font-semibold text-amber-800">
                {menunggu.length} faktur menunggu dibeli
              </span>
              {isManajemen && (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Batalkan SEMUA ${menunggu.length} faktur yang menunggu dibeli? (yang sudah tiba tidak disentuh)`,
                      )
                    )
                      batalSemua.mutate();
                  }}
                  className="rounded-lg px-2 py-0.5 text-xs font-medium text-red-500 hover:bg-red-50"
                >
                  🧹 Batalkan semua
                </button>
              )}
            </div>
          )}
          {grup.map((g) => {
            // ringkas ala Beli Bahan Baku: 1 barang pertama + jumlah lainnya;
            // rincian lengkap via klik kartu (modal detail)
            const utama = g.rows[0];
            // Hapus permanen (data lama) — hanya bila TAK terkait permintaan
            // aktif & belum ada baris tiba (tak ada dampak stok).
            const bisaHapus =
              isManajemen && !g.permintaanAktif && !g.rows.some((r) => r.status === "tiba");
            return (
            <Card
              key={g.key}
              onClick={() => setDetail(g)}
              className="cursor-pointer overflow-hidden transition hover:border-orange-300 hover:shadow-sm"
            >
              {/* kepala kartu: nomor + badge cabang tujuan + status */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 bg-stone-50 px-4 py-2.5">
                {g.nomor && (
                  <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {g.nomor}
                  </span>
                )}
                {/* BADGE CABANG TUJUAN — langsung nama cabangnya (tanpa rute CK) */}
                {g.tujuanNama ? (
                  <span className="whitespace-nowrap rounded-md bg-purple-100 px-2 py-0.5 text-sm font-bold text-purple-800">
                    📦 {g.tujuanNama}
                  </span>
                ) : (
                  <span className="text-xs text-stone-500">🏪 {g.ckNama} (stok CK)</span>
                )}
                <BeliStatusBadge status={g.status} />
                {/* pemroses belanja — tercatat saat Diproses */}
                {g.diprosesOleh && (
                  <span className="text-xs font-medium text-stone-600">🔧 {g.diprosesOleh}</span>
                )}
                <span className="ml-auto text-xs text-stone-400">
                  {formatWaktu(g.waktu)}
                  {g.oleh ? ` · ${g.oleh}` : ""}
                </span>
              </div>
              {/* isi ringkas: 1 barang + jumlah lainnya + detail › */}
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-stone-800">
                    {utama.nama}
                    {utama.supplier_utama && (
                      <span className="ml-2 text-xs font-normal text-stone-400">
                        🏬 {utama.supplier_utama}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-stone-500">
                    {formatAngka(utama.qty)} {utama.satuan}
                    {g.rows.length > 1 && <> · +{g.rows.length - 1} barang lainnya</>}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-stone-400">detail ›</span>
              </div>
              {/* kaki kartu: ringkasan + Dokumen RAB + Ubah Tahap */}
              <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-2">
                <span className="text-xs text-stone-500">
                  {g.rows.length} item
                  {g.totalHarga > 0 ? (
                    <> · {formatRupiah(g.totalHarga)}</>
                  ) : (
                    butuhAksi(g.status) &&
                    g.totalEstimasi > 0 && <> · estimasi {formatRupiah(g.totalEstimasi)}</>
                  )}
                </span>
                {(butuhAksi(g.status) && isManajemen) || bisaHapus ? (
                  <div className="ml-auto flex items-center gap-2">
                    {isManajemen && butuhAksi(g.status) && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRab(g);
                          }}
                          className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                        >
                          📄 Dokumen RAB
                        </button>
                        {/* Ubah Tahap — dropdown seperti Beli Bahan Baku */}
                        <select
                          value=""
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            const v = e.target.value;
                            if (v === "diproses") proses.mutate(g);
                            else if (v === "tiba") setTiba(g);
                            else if (v === "batal") {
                              if (window.confirm(`Batalkan faktur beli ${g.nomor ?? "ini"}?`))
                                batal.mutate(g);
                            }
                            e.target.value = "";
                          }}
                          aria-label={`Ubah tahap ${g.nomor ?? "faktur"}`}
                          className="rounded-lg bg-orange-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-orange-700"
                        >
                          <option value="" disabled>
                            ➡ Ubah Tahap
                          </option>
                          {g.status === "menunggu" && g.fakturId && (
                            <option value="diproses">🛒 Diproses (dibelanjakan)</option>
                          )}
                          <option value="tiba">📦 Tiba di CK</option>
                          <option value="batal">❌ Batalkan</option>
                        </select>
                      </>
                    )}
                    {/* Hapus permanen — data lama yang tak terkait permintaan aktif */}
                    {bisaHapus && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            window.confirm(
                              `Hapus permanen faktur ${g.nomor ?? "ini"}? Data tidak bisa dikembalikan.`,
                            )
                          )
                            hapus.mutate(g);
                        }}
                        disabled={hapus.isPending}
                        className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        🗑 Hapus
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>
            );
          })}
        </div>
      )}

      {tiba && <TibaFakturModal faktur={tiba} onClose={() => setTiba(null)} />}
      {rab && <DokumenRabPerlengkapanModal faktur={rab} onClose={() => setRab(null)} />}
      {detail && <DetailBeliPerlengkapanModal faktur={detail} onClose={() => setDetail(null)} />}
      {buatOpen && <BuatBeliModal onClose={() => setBuatOpen(false)} />}
    </div>
  );
}

/** Estimasi biaya satu baris: harga riil bila terisi, selain itu qty × harga master. */
function estimasiBaris(r: BeliPerlengkapanRow): number {
  return r.total_harga != null && r.total_harga > 0 ? r.total_harga : r.qty * (r.harga_beli ?? 0);
}

/**
 * Kelompokkan baris faktur perlengkapan per SUPPLIER langganan (tempat beli) —
 * paritas Dokumen Belanja bahan baku: satu toko satu daftar. Supplier bernama
 * dulu (urut abjad), "tanpa supplier" paling akhir.
 */
function perSupplierBeli(rows: BeliPerlengkapanRow[]) {
  const byKey = new Map<string, { nama: string | null; rows: BeliPerlengkapanRow[] }>();
  for (const r of rows) {
    const key = r.supplier_utama ?? "__tanpa";
    let g = byKey.get(key);
    if (!g) {
      g = { nama: r.supplier_utama ?? null, rows: [] };
      byKey.set(key, g);
    }
    g.rows.push(r);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.nama == null) return 1;
    if (b.nama == null) return -1;
    return a.nama.localeCompare(b.nama);
  });
}

/** Detail satu faktur beli perlengkapan (BP-): metadata + item per supplier. */
function DetailBeliPerlengkapanModal({
  faktur: g,
  onClose,
}: {
  faktur: FakturBeli;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`Detail ${g.nomor ?? "Faktur Perlengkapan"}`}>
      <div className="space-y-3">
        <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
          {g.nomor && (
            <>
              <dt className="text-stone-400">Nomor</dt>
              <dd className="col-span-2 font-mono font-bold text-orange-700">{g.nomor}</dd>
            </>
          )}
          <dt className="text-stone-400">Tujuan</dt>
          <dd className="col-span-2">
            {g.tujuanNama ? `📦 ${g.tujuanNama}` : `🏪 ${g.ckNama} (stok CK)`}
          </dd>
          <dt className="text-stone-400">Status</dt>
          <dd className="col-span-2">
            <BeliStatusBadge status={g.status} />
          </dd>
          <dt className="text-stone-400">Waktu</dt>
          <dd className="col-span-2">
            {formatWaktu(g.waktu)}
            {g.oleh ? ` · ${g.oleh}` : ""}
          </dd>
          {g.diprosesOleh && (
            <>
              <dt className="text-stone-400">Diproses oleh</dt>
              <dd className="col-span-2">{g.diprosesOleh}</dd>
            </>
          )}
          {g.catatan && (
            <>
              <dt className="text-stone-400">Catatan</dt>
              <dd className="col-span-2">{g.catatan}</dd>
            </>
          )}
        </dl>

        {/* Item DIKELOMPOKKAN per SUPPLIER (tempat beli) — paritas bahan baku */}
        <div className="space-y-2">
          {perSupplierBeli(g.rows).map((s, i) => {
            const subtotal = s.rows.reduce((t, r) => t + estimasiBaris(r), 0);
            return (
              <div key={i} className="overflow-hidden rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-3 py-1.5 text-sm font-semibold text-stone-700">
                  <span>
                    {s.nama ? `🏬 ${s.nama}` : "🛒 Tanpa tempat beli (bebas beli di mana)"}
                  </span>
                  {subtotal > 0 && (
                    <span className="text-xs font-medium text-stone-500">
                      ± {formatRupiah(subtotal)}
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-stone-100">
                    {s.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-1.5 font-medium">
                          {r.nama}
                          {g.rows.length > 1 && r.status !== g.status && (
                            <span className="ml-1.5 inline-block">
                              <BeliStatusBadge status={r.status} />
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap text-stone-600">
                          {formatAngka(r.qty)} {r.satuan}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap text-stone-500">
                          {r.total_harga != null && r.total_harga > 0
                            ? formatRupiah(r.total_harga)
                            : r.harga_beli > 0
                              ? `± ${formatRupiah(r.qty * r.harga_beli)}`
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        <div className="text-right text-sm font-semibold text-stone-700">
          Total{g.totalHarga > 0 ? "" : " estimasi"}:{" "}
          {formatRupiah(g.totalHarga > 0 ? g.totalHarga : g.totalEstimasi)}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Tutup
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function BeliStatusBadge({ status }: { status: BeliPerlengkapanRow["status"] }) {
  const map = {
    menunggu: { teks: "RAB (Menunggu dibeli)", cls: "bg-amber-100 text-amber-800" },
    diproses: { teks: "🛒 Diproses", cls: "bg-sky-100 text-sky-800" },
    tiba: { teks: "Tiba di CK ✓", cls: "bg-blue-100 text-blue-800" },
    batal: { teks: "Dibatalkan", cls: "bg-stone-100 text-stone-500" },
  }[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map.cls}`}>{map.teks}</span>
  );
}

/**
 * DOKUMEN RAB perlengkapan — pegangan belanja (paritas Dokumen RAB bahan
 * baku): daftar item, qty, tempat beli (supplier langganan), dan estimasi
 * biaya (harga riil bila sudah diisi, selain itu qty × harga master).
 * Bisa dicetak lewat kontainer #dokumen-print.
 */
function DokumenRabPerlengkapanModal({
  faktur,
  onClose,
}: {
  faktur: FakturBeli;
  onClose: () => void;
}) {
  const rows = faktur.rows.filter((r) => r.status !== "batal");
  const estimasi = (r: BeliPerlengkapanRow) =>
    r.total_harga != null && r.total_harga > 0 ? r.total_harga : r.qty * (r.harga_beli ?? 0);
  const total = rows.reduce((t, r) => t + estimasi(r), 0);

  const isi = (cetak: boolean) => (
    <div className={cetak ? "text-black" : ""}>
      <div className={`border-b pb-2 ${cetak ? "border-black" : "border-stone-200"}`}>
        <div className="text-base font-bold">📄 Dokumen RAB — Beli Perlengkapan</div>
        <div className={`text-xs ${cetak ? "" : "text-stone-500"}`}>
          {faktur.nomor && <span className="font-mono">{faktur.nomor} · </span>}
          {formatWaktu(faktur.waktu)}
          {faktur.oleh && <> · dibuat {faktur.oleh}</>}
          {faktur.catatan && <> · 📝 {faktur.catatan}</>}
        </div>
        <div
          className={`mt-2 rounded-lg px-3 py-2 text-sm font-bold ${
            cetak ? "border-2 border-black" : "bg-purple-100 text-purple-900"
          }`}
        >
          {faktur.tujuanNama
            ? `📦 Untuk cabang: ${faktur.tujuanNama} (lewat ${faktur.ckNama})`
            : `🏪 Stok ${faktur.ckNama}`}
        </div>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className={`text-left text-xs ${cetak ? "" : "text-stone-400"}`}>
            <th className="py-1 pr-2 font-medium">Item</th>
            <th className="py-1 pr-2 font-medium">Qty</th>
            <th className="py-1 pr-2 font-medium">Tempat beli</th>
            <th className="py-1 text-right font-medium">Estimasi</th>
          </tr>
        </thead>
        <tbody className={`divide-y ${cetak ? "divide-stone-300" : "divide-stone-100"}`}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1 pr-2 font-medium">{r.nama}</td>
              <td className="whitespace-nowrap py-1 pr-2">
                {formatAngka(r.qty)} {r.satuan}
              </td>
              <td className="py-1 pr-2">{r.supplier_utama ?? "—"}</td>
              <td className="whitespace-nowrap py-1 text-right">
                {estimasi(r) > 0 ? formatRupiah(estimasi(r)) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className={`mt-2 flex justify-between border-t pt-2 text-sm ${cetak ? "border-black" : "border-stone-200"}`}
      >
        <span>Total {rows.length} item</span>
        <b>{total > 0 ? formatRupiah(total) : "—"}</b>
      </div>
    </div>
  );

  return (
    <>
      <Modal open onClose={onClose} title="📄 Dokumen RAB" lebar="max-w-xl">
        {isi(false)}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Tutup
          </button>
          <button onClick={() => window.print()} className={btnPrimary}>
            🖨 Cetak dokumen
          </button>
        </div>
      </Modal>
      {/* Kontainer khusus cetak — hanya dokumen yang tampil saat window.print() */}
      <div id="dokumen-print" className="hidden print:block">
        {isi(true)}
        <div className="mt-6 flex justify-between gap-4 text-xs">
          <div className="text-center">
            Pembelanja
            <div className="mt-10 border-t border-black px-8">( ………… )</div>
          </div>
          <div className="text-center">
            Finance
            <div className="mt-10 border-t border-black px-8">( ………… )</div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Konfirmasi barang SATU FAKTUR tiba di CK: qty final + nilai belanja per
 * item. Semua baris 'menunggu' diproses sekaligus → masuk stok CK + otomatis
 * dikirim ke cabang tujuan.
 */
function TibaFakturModal({ faktur, onClose }: { faktur: FakturBeli; onClose: () => void }) {
  const queryClient = useQueryClient();
  const barisMenunggu = faktur.rows.filter((r) => butuhAksi(r.status));
  const [draft, setDraft] = useState<Record<string, { qty: string; harga: string }>>(() =>
    Object.fromEntries(
      barisMenunggu.map((r) => [
        r.id,
        { qty: String(r.qty), harga: r.total_harga ? String(r.total_harga) : "" },
      ]),
    ),
  );

  const simpan = useMutation({
    mutationFn: () => {
      const items = barisMenunggu.map((r) => ({
        id: r.id,
        qty: angkaDari(draft[r.id]?.qty) || r.qty,
        total_harga: draft[r.id]?.harga === "" ? null : angkaDari(draft[r.id]?.harga),
      }));
      if (faktur.fakturId) {
        return api(`/perlengkapan/beli/faktur/${faktur.fakturId}/tiba`, {
          method: "POST",
          body: { items },
        });
      }
      // baris warisan tanpa faktur — endpoint per baris
      const it = items[0];
      return api(`/perlengkapan/beli/${it.id}/tiba`, {
        method: "POST",
        body: { qty: it.qty, total_harga: it.total_harga },
      });
    },
    onSuccess: () => {
      // "perlengkapan-master" ikut disebut sendiri: barang yang tiba menambah
      // saldo CK, dan halaman MASTER Perlengkapan menampilkan sebaran saldo itu.
      // ["perlengkapan"] tidak menjangkaunya — pencocokan awalan TanStack Query
      // membandingkan elemen pertama secara utuh.
      for (const key of [
        "perlengkapan-beli",
        "perlengkapan",
        "perlengkapan-master",
        "perlengkapan-kiriman",
        "penerimaan",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });

  const adaInvalid = barisMenunggu.some((r) => !(angkaDari(draft[r.id]?.qty) > 0));

  return (
    <Modal open onClose={onClose} title={`Tiba di CK — ${faktur.nomor ?? "faktur"}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Barang masuk stok <b>{faktur.ckNama}</b>
          {faktur.tujuanNama ? (
            <>
              {" "}
              lalu <b>otomatis dikirim</b> ke <b>{faktur.tujuanNama}</b> (cabang tinggal
              menerima).
            </>
          ) : (
            <> (disimpan sebagai stok CK).</>
          )}
        </div>
        <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {barisMenunggu.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-[8rem] flex-1 text-sm font-medium text-stone-800">
                {r.nama}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={draft[r.id]?.qty ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, [r.id]: { ...p[r.id], qty: e.target.value } }))
                }
                aria-label={`Jumlah tiba ${r.nama}`}
                className={`${inputClass} !w-24`}
              />
              <span className="text-xs text-stone-500">{r.satuan}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={draft[r.id]?.harga ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, [r.id]: { ...p[r.id], harga: e.target.value } }))
                }
                placeholder="harga (Rp)"
                aria-label={`Nilai belanja ${r.nama}`}
                className={`${inputClass} !w-28`}
              />
            </div>
          ))}
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={simpan.isPending || adaInvalid}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "✅ Tiba & Kirim"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface BarisBeliDraft {
  supplyId: string;
  qty: string;
  harga: string;
  /** true bila harga diketik manual — auto-isi dari acuan berhenti menimpa */
  hargaManual?: boolean;
}

/** Buat faktur beli perlengkapan manual MULTI-ITEM: daftar item + CK + cabang tujuan. */
function BuatBeliModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const ckList = useMemo(
    () => cabang.filter((b) => b.tipe === "central_kitchen" && b.is_active),
    [cabang],
  );
  const storeList = useMemo(
    () => cabang.filter((b) => b.tipe === "store" && b.is_active),
    [cabang],
  );
  const { data: items = [] } = useQuery({
    queryKey: ["perlengkapan-master"],
    queryFn: () => api<PerlengkapanMasterRow[]>("/perlengkapan/master"),
  });

  const [baris, setBaris] = useState<BarisBeliDraft[]>([{ supplyId: "", qty: "", harga: "" }]);
  const [ckId, setCkId] = useState(ckList.length === 1 ? ckList[0].id : "");
  const [tujuanId, setTujuanId] = useState("");

  function ubahBaris(i: number, patch: Partial<BarisBeliDraft>) {
    setBaris((prev) =>
      prev.map((b, j) => {
        if (j !== i) return b;
        const next = { ...b, ...patch };
        // HARGA ACUAN otomatis: item/qty berubah → isi harga dari master
        // (harga_beli × qty) selama belum diketik manual; kosong bila belum
        // lengkap. Ketikan manual mematikan auto-isi utk baris ini.
        if (!next.hargaManual && ("supplyId" in patch || "qty" in patch)) {
          const acuan = items.find((x) => x.id === next.supplyId)?.harga_beli ?? 0;
          const qty = angkaDari(next.qty);
          next.harga = acuan > 0 && qty > 0 ? String(Math.round(acuan * qty)) : "";
        }
        return next;
      }),
    );
  }

  const barisValid = baris.filter((b) => b.supplyId && angkaDari(b.qty) > 0);
  const simpan = useMutation({
    mutationFn: () =>
      api("/perlengkapan/beli", {
        method: "POST",
        body: {
          items: barisValid.map((b) => ({
            supply_id: b.supplyId,
            qty: angkaDari(b.qty),
            total_harga: b.harga === "" ? null : angkaDari(b.harga),
          })),
          ck_branch_id: ckId || null,
          tujuan_branch_id: tujuanId || null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] });
      onClose();
    },
  });

  const valid = barisValid.length > 0 && (ckList.length <= 1 || ckId);

  return (
    <Modal open onClose={onClose} title="Beli Perlengkapan ke CK">
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Satu faktur (BP-) bisa berisi banyak item — semua dibeli bersama lalu ditandai{" "}
          <b>Tiba di CK</b> sekaligus.
        </div>
        <div className="space-y-2">
          {baris.map((b, i) => {
            const item = items.find((x) => x.id === b.supplyId);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={b.supplyId}
                  onChange={(e) => ubahBaris(i, { supplyId: e.target.value })}
                  aria-label={`Perlengkapan baris ${i + 1}`}
                  className={`${inputClass} !w-auto min-w-[10rem] flex-1`}
                >
                  <option value="">— pilih item —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.nama} ({it.satuan})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={b.qty}
                  onChange={(e) => ubahBaris(i, { qty: e.target.value })}
                  placeholder={item ? `qty (${item.satuan})` : "qty"}
                  aria-label={`Jumlah baris ${i + 1}`}
                  className={`${inputClass} !w-24`}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={b.harga}
                  onChange={(e) =>
                    // ketikan manual mengunci nilai; dikosongkan = kembali auto
                    ubahBaris(i, { harga: e.target.value, hargaManual: e.target.value !== "" })
                  }
                  placeholder="harga (Rp)"
                  aria-label={`Harga baris ${i + 1}`}
                  className={`${inputClass} !w-28`}
                />
                {baris.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBaris((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Hapus baris ${i + 1}`}
                    className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                  >
                    ✕
                  </button>
                )}
                {item && item.harga_beli > 0 && (
                  <div className="w-full text-[11px] text-stone-400">
                    harga acuan {formatRupiah(item.harga_beli)} / {item.satuan}
                    {!b.hargaManual && angkaDari(b.qty) > 0 && (
                      <> — terisi otomatis, boleh diubah</>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setBaris((prev) => [...prev, { supplyId: "", qty: "", harga: "" }])}
            className="text-xs font-medium text-orange-600 hover:underline"
          >
            ➕ Tambah item
          </button>
        </div>
        {ckList.length > 1 && (
          <div>
            <label className="mb-1 block text-sm font-medium">Beli untuk CK</label>
            <select value={ckId} onChange={(e) => setCkId(e.target.value)} className={inputClass}>
              <option value="">— pilih CK —</option>
              {ckList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">Kirim ke cabang (opsional)</label>
          <select value={tujuanId} onChange={(e) => setTujuanId(e.target.value)} className={inputClass}>
            <option value="">— Stok CK saja (tidak dikirim) —</option>
            {storeList.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nama}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-stone-400">
            Bila diisi, semua barang otomatis dikirim ke cabang ini setelah tiba di CK.
          </div>
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={simpan.isPending || !valid}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "Buat Faktur"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
