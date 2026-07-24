import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { BahanDetailDto, BahanFifoDto, KartuStokDto, MutasiJenis } from "@kakarut/shared";
import { RiwayatHargaPanel } from "../../components/RiwayatHargaModal";
import { Card, ErrorText, PageTitle, Spinner, btnSecondary, tdClass, thClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggal, hariIniWIB } from "../../lib/format";

const JENIS_BADGE: Record<MutasiJenis, { label: string; cls: string }> = {
  opname: { label: "Opname", cls: "bg-blue-100 text-blue-800" },
  beli: { label: "Pembelian", cls: "bg-teal-100 text-teal-800" },
  produksi: { label: "Produksi", cls: "bg-orange-100 text-orange-800" },
  penjualan: { label: "Penjualan", cls: "bg-red-100 text-red-700" },
  pemakaian: { label: "Pemakaian produksi", cls: "bg-amber-100 text-amber-800" },
  kirim: { label: "Kirim keluar", cls: "bg-purple-100 text-purple-800" },
};

const FIFO_JENIS: Record<string, { label: string; cls: string }> = {
  beli: JENIS_BADGE.beli,
  produksi: JENIS_BADGE.produksi,
  transfer: { label: "Transfer masuk", cls: "bg-purple-100 text-purple-800" },
  opname: JENIS_BADGE.opname,
  penjualan: JENIS_BADGE.penjualan,
  pemakaian: JENIS_BADGE.pemakaian,
  kirim: JENIS_BADGE.kirim,
};

/** rentang waktu Transaksi Produk → tanggal `dari` (sampai selalu hari ini) */
const RENTANG: { key: string; label: string; hari: number | null }[] = [
  { key: "7", label: "7 hari", hari: 7 },
  { key: "30", label: "30 hari", hari: 30 },
  { key: "90", label: "90 hari", hari: 90 },
  { key: "semua", label: "Semua waktu", hari: null },
];

const TIPE_FILTER: { key: "semua" | MutasiJenis; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "beli", label: "Pembelian" },
  { key: "produksi", label: "Produksi" },
  { key: "penjualan", label: "Penjualan" },
  { key: "pemakaian", label: "Pemakaian" },
  { key: "kirim", label: "Kirim" },
  { key: "opname", label: "Opname" },
];

function tanggalNHariLalu(hari: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date(Date.now() - (hari - 1) * 24 * 3600 * 1000),
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-stone-800">{value}</div>
      {sub && <div className="text-xs text-stone-400">{sub}</div>}
    </Card>
  );
}

function waktuRingkas(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/**
 * DETAIL PRODUK satu bahan baku — pengganti modal Riwayat Harga: info produk +
 * aksi Ubah/Hapus, stok per cabang, riwayat harga, transaksi produk, dan
 * kartu FIFO (pemakaian barang dari lot PALING AWAL masuk).
 */
export function DetailBahanPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";

  const { data: detail, isLoading, error } = useQuery({
    queryKey: ["bahan-detail", id],
    queryFn: () => api<BahanDetailDto>(`/bahan/${id}/detail`),
    enabled: Boolean(id),
  });

  // cabang terpilih utk Transaksi & FIFO — default cabang bersaldo terbesar
  const [branchSel, setBranchSel] = useState<string | null>(null);
  useEffect(() => {
    if (!detail || branchSel) return;
    const berisi = [...detail.saldo_cabang]
      .filter((c) => c.saldo !== 0)
      .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
    const utama =
      berisi[0] ?? detail.saldo_cabang.find((c) => c.tipe !== "kantor") ?? detail.saldo_cabang[0];
    if (utama) setBranchSel(utama.branch_id);
  }, [detail, branchSel]);

  const [rentang, setRentang] = useState("30");
  const [tipe, setTipe] = useState<"semua" | MutasiJenis>("semua");
  // hari null = "Semua waktu" — jangan pakai `??` (menelan null yang disengaja)
  const pilihanRentang = RENTANG.find((r) => r.key === rentang);
  const dari =
    !pilihanRentang || pilihanRentang.hari == null
      ? "2020-01-01"
      : tanggalNHariLalu(pilihanRentang.hari);
  const sampai = hariIniWIB();

  const trackStok = detail?.bahan.track_stok ?? false;
  const { data: kartu } = useQuery({
    queryKey: ["kartu-stok", id, branchSel, dari, sampai],
    queryFn: () =>
      api<KartuStokDto>(`/stok/kartu/${id}?dari=${dari}&sampai=${sampai}&branch_id=${branchSel}`),
    enabled: Boolean(id && branchSel && trackStok),
  });
  const { data: fifo } = useQuery({
    queryKey: ["stok-fifo", id, branchSel],
    queryFn: () => api<BahanFifoDto>(`/stok/fifo/${id}?branch_id=${branchSel}`),
    enabled: Boolean(id && branchSel && trackStok),
  });

  const hapus = useMutation({
    mutationFn: () => api(`/bahan/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      navigate("/bahan");
    },
  });

  const mutasiTampil = useMemo(() => {
    const rows = kartu?.mutasi ?? [];
    return tipe === "semua" ? rows : rows.filter((m) => m.jenis === tipe);
  }, [kartu, tipe]);

  if (isLoading) return <Spinner />;
  if (error || !detail) {
    return (
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Detail produk tidak dapat dimuat"}
      </div>
    );
  }

  const b = detail.bahan;
  const chipsSaldo = detail.saldo_cabang.filter((c) => c.saldo !== 0);

  return (
    <div className="max-w-5xl">
      <PageTitle
        aksi={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate(`/stok/kartu/${b.id}${branchSel ? `?branch_id=${branchSel}` : ""}`)}
              className={btnSecondary}
            >
              📒 Kartu Stok
            </button>
            {bolehUbah && (
              <>
                <button
                  onClick={() =>
                    navigate(
                      b.pengadaan === "produksi" ? `/resep?bahan=${b.id}` : `/bahan/ubah?ids=${b.id}`,
                    )
                  }
                  className="rounded-lg bg-stone-800 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700"
                >
                  ✏️ Ubah Produk
                </button>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Hapus bahan "${b.nama}"? Bahan dinonaktifkan dari daftar (riwayat transaksi tetap tersimpan).`,
                      )
                    )
                      hapus.mutate();
                  }}
                  disabled={hapus.isPending}
                  className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  🗑 Hapus
                </button>
              </>
            )}
          </div>
        }
      >
        <button
          onClick={() => navigate("/bahan")}
          className="mr-2 text-stone-400 hover:text-stone-600"
          aria-label="Kembali ke daftar bahan"
        >
          ←
        </button>
        {b.nama}
      </PageTitle>
      <ErrorText error={hapus.error} />

      {/* Info produk */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {b.kode && (
            <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-xs font-bold text-stone-600">
              {b.kode}
            </span>
          )}
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold capitalize text-stone-700">
            {b.kategori}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              b.pengadaan === "beli" ? "bg-teal-100 text-teal-800" : "bg-orange-100 text-orange-800"
            }`}
          >
            {b.pengadaan === "beli" ? "BELI" : "PRODUKSI SENDIRI"}
          </span>
          {/* metode perhitungan biaya perusahaan (pengaturan Perusahaan) */}
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
            {detail.metode_hpp === "fifo" ? "FIFO" : "Average Cost"}
          </span>
          {!b.track_stok && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
              stok tidak dilacak
            </span>
          )}
          {b.supplier_utama && (
            <span className="text-xs text-stone-500">🏬 {b.supplier_utama}</span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Harga acuan"
            value={formatRupiah(b.harga_per_unit)}
            sub={`/ ${b.satuan}`}
          />
          <StatTile
            label="Stok saat ini"
            value={`${formatAngka(detail.total_saldo)} ${b.satuan}`}
            sub="semua cabang"
          />
          <StatTile
            label="Stok minimum"
            value={`${formatAngka(b.stok_minimum)} ${b.satuan}`}
            sub={b.stok_minimum_toko > 0 ? `toko: ${formatAngka(b.stok_minimum_toko)}` : undefined}
          />
          <StatTile
            label="Masa simpan"
            value={b.masa_simpan_hari > 0 ? `${b.masa_simpan_hari} hari` : "—"}
            sub={b.lead_time_hari > 0 ? `lead time ${b.lead_time_hari} hari` : undefined}
          />
        </div>

        {trackStok && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
              📦 Stok per Cabang
            </div>
            {chipsSaldo.length === 0 ? (
              <div className="text-sm text-stone-400">Belum ada stok di cabang mana pun.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {chipsSaldo.map((c) => (
                  <span
                    key={c.branch_id}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm text-blue-800"
                  >
                    {c.tipe === "central_kitchen" ? "🏭" : "🏪"} {c.nama}{" "}
                    <b>
                      {formatAngka(c.saldo)} {b.satuan}
                    </b>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Riwayat harga + catat harga acuan */}
      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-bold text-stone-700">💰 Riwayat Harga Pembelian</h2>
        <RiwayatHargaPanel
          endpoint={`/bahan/${b.id}`}
          satuan={b.satuan}
          bolehUbah={bolehUbah}
          invalidateKeys={[["bahan"], ["stok"], ["bahan-detail", b.id ?? ""]]}
        />
      </Card>

      {trackStok && (
        <>
          {/* pemilih cabang utk Transaksi + FIFO */}
          {detail.saldo_cabang.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-stone-500">Cabang:</span>
              {detail.saldo_cabang
                .filter((c) => c.tipe !== "kantor" || c.saldo !== 0)
                .map((c) => (
                  <button
                    key={c.branch_id}
                    onClick={() => setBranchSel(c.branch_id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      branchSel === c.branch_id
                        ? "bg-orange-600 text-white"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                    }`}
                  >
                    {c.nama}
                  </button>
                ))}
            </div>
          )}

          {/* Transaksi produk */}
          <Card className="mb-4 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-stone-700">🧾 Transaksi Produk</h2>
              <div className="flex flex-wrap gap-1.5">
                {RENTANG.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRentang(r.key)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      rentang === r.key
                        ? "bg-stone-800 text-white"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {TIPE_FILTER.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTipe(t.key)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    tipe === t.key
                      ? "bg-orange-600 text-white"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {kartu && (
              <div className="mb-3 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-green-50 px-3 py-2">
                  <div className="text-xs text-stone-500">Total masuk</div>
                  <div className="text-sm font-bold text-green-700">
                    +{formatAngka(kartu.total_masuk)} {b.satuan}
                  </div>
                </div>
                <div className="rounded-lg bg-red-50 px-3 py-2">
                  <div className="text-xs text-stone-500">Total keluar</div>
                  <div className="text-sm font-bold text-red-600">
                    −{formatAngka(kartu.total_keluar)} {b.satuan}
                  </div>
                </div>
                <div className="rounded-lg bg-stone-50 px-3 py-2">
                  <div className="text-xs text-stone-500">Saldo akhir</div>
                  <div className="text-sm font-bold text-stone-800">
                    {formatAngka(kartu.saldo_akhir)} {b.satuan}
                  </div>
                </div>
              </div>
            )}
            {kartu?.terpotong && (
              <div className="mb-2 rounded-lg bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800">
                Mutasi melebihi 500 baris — persempit rentang waktu.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className={thClass}>Waktu</th>
                    <th className={thClass}>Tipe</th>
                    <th className={thClass}>Keterangan</th>
                    <th className={`${thClass} text-right`}>Qty</th>
                    <th className={`${thClass} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {/* terbaru dulu — pola daftar transaksi */}
                  {[...mutasiTampil].reverse().map((m, i) => {
                    const badge = JENIS_BADGE[m.jenis];
                    return (
                      <tr key={i} className="hover:bg-stone-50">
                        <td className={`${tdClass} whitespace-nowrap`}>{waktuRingkas(m.waktu)}</td>
                        <td className={tdClass}>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td
                          className={`${tdClass} max-w-64 truncate text-stone-500`}
                          title={m.keterangan ?? ""}
                        >
                          {m.keterangan ?? "—"}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-right`}>
                          {m.jenis === "opname" ? (
                            <span className="text-xs text-blue-600">
                              reset → {formatAngka(m.saldo)}
                            </span>
                          ) : m.masuk != null ? (
                            <span className="font-semibold text-green-700">
                              +{formatAngka(m.masuk)}
                            </span>
                          ) : (
                            <span className="font-semibold text-red-600">
                              −{formatAngka(m.keluar ?? 0)}
                            </span>
                          )}
                        </td>
                        <td className={`${tdClass} text-right font-bold`}>{formatAngka(m.saldo)}</td>
                      </tr>
                    );
                  })}
                  {mutasiTampil.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-stone-400">
                        Tidak ada transaksi pada filter ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Kartu FIFO */}
          <Card className="mb-4 p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-stone-700">
                ⏳ Pemakaian FIFO {fifo ? `— ${fifo.branch_nama}` : ""}
              </h2>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                First-In First-Out
              </span>
            </div>
            <p className="mb-3 text-xs text-stone-500">
              Barang keluar dihitung dari lot yang <b>paling awal masuk</b>. Tiap lot menampilkan
              berapa yang sudah terpakai &amp; sisanya; tiap pemakaian menampilkan diambil dari lot
              mana saja.
            </p>

            {!fifo ? (
              <Spinner />
            ) : (
              <>
                {fifo.defisit > 0 && (
                  <div className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
                    ⚠ Stok minus {formatAngka(fifo.defisit)} {b.satuan} — ada pemakaian yang belum
                    tertutup lot mana pun.
                  </div>
                )}

                {/* LOT MASUK — paling awal di atas */}
                <div className="mb-4 overflow-x-auto rounded-lg border border-stone-200">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Lot</th>
                        <th className="px-2 py-1.5 text-left">Masuk</th>
                        <th className="px-2 py-1.5 text-right">Qty</th>
                        <th className="px-2 py-1.5 text-right">Harga/{b.satuan}</th>
                        <th className="px-2 py-1.5 text-right">Terpakai</th>
                        <th className="px-2 py-1.5 text-right">Sisa</th>
                        <th className="px-2 py-1.5 text-left">Exp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {fifo.lots.map((l, i) => {
                        const badge = FIFO_JENIS[l.jenis] ?? JENIS_BADGE.beli;
                        const habis = l.sisa <= 0;
                        return (
                          <tr key={i} className={habis ? "text-stone-400" : ""}>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs font-bold">
                              #{i + 1}
                            </td>
                            <td className="px-2 py-1.5">
                              <span
                                className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                              >
                                {badge.label}
                              </span>
                              <span className="whitespace-nowrap text-stone-700">
                                {waktuRingkas(l.waktu)}
                              </span>
                              <div className="text-[10px] text-stone-400">
                                {l.nomor ?? ""}
                                {l.supplier ? ` · ${l.supplier}` : ""}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right">{formatAngka(l.qty_masuk)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right">
                              {l.harga_satuan != null ? (
                                <>
                                  {formatRupiah(l.harga_satuan)}
                                  {l.harga_acuan && (
                                    <span className="ml-0.5 text-[10px] text-stone-400">acuan</span>
                                  )}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right text-red-600">
                              {l.terpakai > 0 ? `−${formatAngka(l.terpakai)}` : ""}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {habis ? (
                                <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold">
                                  Habis
                                </span>
                              ) : (
                                <b>{formatAngka(l.sisa)}</b>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                              {l.exp_date ? `⏳ ${formatTanggal(l.exp_date)}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {fifo.lots.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-sm text-stone-400">
                            Belum ada lot masuk di cabang ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* RIWAYAT PENGGUNAAN — terbaru dulu */}
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Riwayat penggunaan (dari lot paling awal)
                </div>
                {fifo.terpotong && (
                  <div className="mb-2 rounded-lg bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800">
                    Menampilkan {fifo.pemakaian.length} pemakaian terbaru.
                  </div>
                )}
                {fifo.pemakaian.length === 0 ? (
                  <div className="rounded-lg bg-stone-50 px-3 py-5 text-center text-sm text-stone-400">
                    Belum ada pemakaian.
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                    {fifo.pemakaian.map((p, i) => {
                      const badge = FIFO_JENIS[p.jenis] ?? JENIS_BADGE.pemakaian;
                      return (
                        <div key={i} className="px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="whitespace-nowrap text-xs text-stone-500">
                              {waktuRingkas(p.waktu)}
                            </span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                            <span className="max-w-56 truncate text-xs text-stone-500">
                              {p.keterangan ?? ""}
                            </span>
                            <span className="ml-auto font-semibold text-red-600">
                              −{formatAngka(p.qty)} {b.satuan}
                            </span>
                            {p.hpp != null && (
                              <span className="text-xs text-stone-500">≈ {formatRupiah(p.hpp)}</span>
                            )}
                          </div>
                          {/* diambil dari lot mana saja */}
                          <div className="mt-0.5 text-[11px] text-stone-400">
                            {p.rincian.map((r, j) => (
                              <span key={j} className="mr-2 whitespace-nowrap">
                                {r.lot != null ? `Lot #${r.lot + 1}` : "tanpa lot (minus)"} ×
                                {formatAngka(r.qty)}
                                {r.harga_satuan != null ? ` @${formatRupiah(r.harga_satuan)}` : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}

      {b.catatan && (
        <Card className="mb-4 p-4 text-sm text-stone-600">
          <span className="font-semibold">📝 Catatan:</span> {b.catatan}
        </Card>
      )}
    </div>
  );
}
