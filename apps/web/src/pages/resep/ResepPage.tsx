import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BahanDto, BahanKategori, BahanResepRow, KategoriDto, SatuanDto } from "@kakarut/shared";
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
import { BahanPicker } from "../../components/BahanPicker";
import { SatuanSelect } from "../../components/SatuanSelect";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

/** Baris editor resep (bahan mentah per 1 batch bahan jadi). */
interface ResepDraft {
  ingredient_id: string;
  qty: string;
}

/**
 * Form buat bahan jadi (produksi) baru — cukup kode/nama/kategori.
 * Batch, harga (overhead), dan stok minimum diatur di bawah resep.
 */
interface BahanBaruForm {
  kode: string;
  nama: string;
  kategori: BahanKategori;
}

/** Pengaturan batch & harga bahan produksi terpilih (diedit di bawah resep). */
interface PengaturanBatch {
  isi: string; // hasil per 1 batch
  satuan: string;
  overhead: string; // pengali biaya resep → harga per batch (1 = mengikuti resep)
  stokMin: string; // ambang menipis di Central Kitchen
  stokMinToko: string; // ambang menipis di toko
  /** lokasi produksi: "ck" (Central Kitchen) atau "cabang" (kitchen toko) */
  produksiDi: "ck" | "cabang";
  /** cabang produsen saat "cabang" (kosong = semua cabang store) */
  produksiBranchIds: string[];
}

/**
 * Halaman Resep produksi (BOM): master-detail. Kiri = daftar bahan jenis
 * "produksi"; kanan = editor resep bahan terpilih (bahan mentah per 1 batch).
 * Dipisah dari form Bahan Baku agar keduanya tak bercampur. Owner/admin bisa
 * mengubah; peran tim hanya melihat. Dipakai ulang endpoint /bahan/:id/resep.
 */
export function ResepPage() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";
  // daftar cabang toko aktif — pilihan "cabang produsen" saat produksi di cabang
  const { cabang } = useBranch();
  const cabangStore = cabang.filter((b) => b.is_active && b.tipe === "store");

  const { data: bahan, isLoading } = useQuery({
    queryKey: ["bahan", "ringkas"],
    queryFn: () => api<BahanDto[]>("/bahan?ringkas=1"),
  });
  const semua = bahan ?? [];
  const produksi = semua.filter((b) => b.pengadaan === "produksi");

  const [cari, setCari] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dipilih = produksi.find((b) => b.id === selectedId) ?? null;

  // Deep-link dari halaman Bahan Baku: ?bahan=<id> memilih bahan produksi itu
  // langsung. Konsumsi param sekali (replace) agar refetch tak memaksa pilih ulang.
  const [searchParams, setSearchParams] = useSearchParams();
  const bahanParam = searchParams.get("bahan");
  useEffect(() => {
    if (!bahanParam) return;
    const ada = semua.some((b) => b.id === bahanParam && b.pengadaan === "produksi");
    if (ada) {
      setSelectedId(bahanParam);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bahanParam, bahan]);

  // Ringkasan jumlah bahan mentah per bahan produksi (utk badge di daftar) —
  // satu request batch; bahan yang tak ada di peta berarti belum punya resep.
  const { data: ringkas } = useQuery({
    queryKey: ["resep-ringkas"],
    enabled: produksi.length > 0,
    queryFn: () => api<Record<string, number>>("/bahan/resep-ringkas"),
  });

  // Muat resep bahan terpilih. react-query membuang respons basi saat ganti
  // bahan cepat (key berubah → tak menimpa panel bahan lain).
  const {
    data: resepServer,
    isLoading: resepLoading,
    isError: resepGagal,
  } = useQuery({
    queryKey: ["bahan-resep", selectedId],
    enabled: !!selectedId,
    queryFn: () => api<BahanResepRow[]>(`/bahan/${selectedId}/resep`),
  });

  // Draft editor lokal, di-seed dari resep server tiap kali data/bahan berubah.
  const [resep, setResep] = useState<ResepDraft[]>([]);
  useEffect(() => {
    if (resepServer) {
      setResep(
        resepServer.map((r) => ({ ingredient_id: r.ingredient_id, qty: String(r.qty) })),
      );
    } else {
      setResep([]);
    }
  }, [resepServer, selectedId]);

  // Pengaturan batch & harga, di-seed dari bahan terpilih (ikut ter-reset
  // saat master di-refresh — pola yang sama dengan draft resep di atas).
  const [atur, setAtur] = useState<PengaturanBatch | null>(null);
  useEffect(() => {
    setAtur(
      dipilih
        ? {
            isi: String(dipilih.isi),
            satuan: dipilih.satuan,
            overhead: String(dipilih.overhead_x ?? 1),
            stokMin: String(dipilih.stok_minimum),
            stokMinToko: String(dipilih.stok_minimum_toko ?? 0),
            produksiDi: dipilih.produksi_di ?? "ck",
            produksiBranchIds: dipilih.produksi_branch_ids ?? [],
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dipilih]);

  // Estimasi biaya bahan per batch (takaran × harga per satuan resep) —
  // dasar harga batch: harga = biaya × overhead.
  const semuaById = new Map(semua.map((b) => [b.id, b]));
  const biayaResep = resep.reduce((a, r) => {
    const x = semuaById.get(r.ingredient_id);
    return a + (x ? (Number(r.qty) || 0) * x.harga_per_unit : 0);
  }, 0);
  const overhead = Number(atur?.overhead) > 0 ? Number(atur?.overhead) : 1;
  const hargaBatch = Math.round(biayaResep * overhead * 100) / 100;
  const isiBatch = Number(atur?.isi) > 0 ? Number(atur?.isi) : 0;

  // Simpan resep + pengaturan batch sekaligus: komponen dulu, lalu master
  // bahan (isi/satuan/overhead/stok minimum + harga_beli = biaya × overhead)
  // supaya baris bahan langsung menampilkan harga hasil resep.
  const simpan = useMutation({
    mutationFn: async () => {
      await api(`/bahan/${selectedId}/resep`, {
        method: "PUT",
        body: {
          komponen: resep
            .filter((r) => r.ingredient_id && Number(r.qty) > 0)
            .map((r) => ({ ingredient_id: r.ingredient_id, qty: Number(r.qty) })),
        },
      });
      if (atur) {
        await api(`/bahan/${selectedId}`, {
          method: "PUT",
          body: {
            isi: Number(atur.isi) > 0 ? Number(atur.isi) : 1,
            satuan: atur.satuan.trim() || "pcs",
            overhead_x: overhead,
            stok_minimum: Number(atur.stokMin) || 0,
            stok_minimum_toko: Number(atur.stokMinToko) || 0,
            harga_beli: hargaBatch,
            produksi_di: atur.produksiDi,
            produksi_branch_ids:
              atur.produksiDi === "cabang" ? atur.produksiBranchIds : [],
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP bisa berubah
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
    onError: () => {
      // resep bisa saja sudah tersimpan sebelum pengaturan gagal — refresh
      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
    },
  });

  // Master satuan & kategori bahan (dropdown form buat bahan produksi)
  const { data: satuanList } = useQuery({
    queryKey: ["satuan"],
    queryFn: () => api<SatuanDto[]>("/satuan"),
  });
  const { data: kategoriList } = useQuery({
    queryKey: ["kategori-bahan"],
    queryFn: () => api<KategoriDto[]>("/kategori-bahan"),
  });
  const satuanDefault = satuanList?.some((s) => s.nama === "pcs")
    ? "pcs"
    : satuanList?.[0]?.nama ?? "pcs";
  // Buat bahan produksi baru langsung dari halaman Resep — cukup kode/nama/
  // kategori; batch, harga (overhead), dan stok minimum diatur di bawah resep.
  const [formBaru, setFormBaru] = useState<BahanBaruForm | null>(null);
  const buatBahan = useMutation({
    mutationFn: (f: BahanBaruForm) =>
      api<BahanDto>("/bahan", {
        method: "POST",
        body: {
          kode: f.kode.trim() || null,
          nama: f.nama.trim(),
          harga_beli: 0,
          isi: 1,
          satuan: satuanDefault,
          kategori: f.kategori,
          pengadaan: "produksi",
          track_stok: true,
          stok_minimum: 0,
        },
      }),
    onSuccess: (b) => {
      setFormBaru(null);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      setSelectedId(b.id);
    },
  });

  if (isLoading) return <Spinner />;

  const daftar = produksi
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()))
    .sort((a, b) => a.nama.localeCompare(b.nama));

  const bukaFormBaru = () => setFormBaru({ kode: "", nama: "", kategori: "baso" });

  return (
    <div>
      <PageTitle
        aksi={
          bolehUbah ? (
            <button onClick={bukaFormBaru} className={btnPrimary}>
              + Resep produksi
            </button>
          ) : undefined
        }
      >
        🧾 Resep Produksi
      </PageTitle>
      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        {bolehUbah ? (
          <>
            Atur bahan baku yang dibutuhkan untuk memproduksi <b>1 batch</b> tiap bahan jenis
            produksi. Dipakai untuk <b>rencana belanja bahan produksi</b> dan <b>pemotongan stok
            bahan baku otomatis</b> saat produksi selesai.
          </>
        ) : (
          <>
            Resep tiap bahan produksi: <b>bahan baku apa saja</b> &amp; <b>takaran</b>-nya untuk
            memproduksi <b>1 batch</b> (lihat hasil per batch di judul). Harga tak ditampilkan.
          </>
        )}
      </div>

      {produksi.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada bahan produksi.{" "}
          {bolehUbah ? (
            <button onClick={bukaFormBaru} className="font-medium text-orange-600 hover:underline">
              + Buat resep produksi
            </button>
          ) : (
            <Link to="/bahan" className="font-medium text-orange-600 hover:underline">
              Bahan Baku
            </Link>
          )}{" "}
          untuk membuat bahan yang diproduksi sendiri lalu mengatur resepnya.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          {/* Kiri: daftar bahan produksi */}
          <Card className="p-3">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari bahan produksi…"
              className={`${inputClass} mb-2`}
            />
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {daftar.map((b) => {
                // peta hanya berisi bahan yang PUNYA komponen — absen berarti
                // 0 (belum ada resep); null hanya selagi peta belum termuat.
                const n = ringkas ? (ringkas[b.id] ?? 0) : null;
                const aktif = b.id === selectedId;
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`block w-full rounded-lg px-3 py-2 text-left transition ${
                      aktif ? "bg-orange-600 text-white" : "hover:bg-stone-100"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{b.nama}</span>
                      {/* harga hanya untuk owner/admin — tim cukup lihat resep & takaran */}
                      {bolehUbah && (
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {formatRupiah(b.harga_beli)}
                        </span>
                      )}
                    </div>
                    <div className={`text-xs ${aktif ? "text-orange-100" : "text-stone-500"}`}>
                      batch {formatAngka(b.isi)} {b.satuan} ·{" "}
                      {n == null ? "—" : n > 0 ? `${n} bahan baku` : "belum ada resep"}
                    </div>
                  </button>
                );
              })}
              {daftar.length === 0 && (
                <div className="py-6 text-center text-sm text-stone-400">
                  Tidak ada yang cocok.
                </div>
              )}
            </div>
          </Card>

          {/* Kanan: editor resep bahan terpilih */}
          <Card className="p-4">
            {!dipilih ? (
              <div className="py-16 text-center text-sm text-stone-400">
                Pilih bahan produksi di kiri untuk mengatur resepnya.
              </div>
            ) : (
              <div>
                <div className="mb-1 text-lg font-bold text-stone-800">{dipilih.nama}</div>
                <div className="mb-4 text-sm text-stone-500">
                  Resep per 1 batch = {formatAngka(dipilih.isi)} {dipilih.satuan}
                </div>

                {resepLoading ? (
                  <Spinner />
                ) : resepGagal ? (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Resep gagal dimuat.{" "}
                    <button
                      onClick={() =>
                        queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] })
                      }
                      className="font-semibold underline"
                    >
                      Muat ulang
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {resep.map((r, i) => {
                        // nilai terpilih selalu punya option (walau bahan
                        // nonaktif); sisanya bahan AKTIF apa pun jenisnya —
                        // bahan baku (beli) maupun bahan produksi (resep
                        // bertingkat) — kecuali bahan ini sendiri & yang sudah
                        // dipakai di baris lain. BahanPicker memisah 2 grup.
                        const pilihan = semua.filter(
                          (x) =>
                            x.id === r.ingredient_id ||
                            (x.is_active &&
                              x.id !== dipilih.id &&
                              !resep.some((lain, j) => j !== i && lain.ingredient_id === x.id)),
                        );
                        const terpilih = semua.find((x) => x.id === r.ingredient_id);
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <BahanPicker
                              bahan={pilihan}
                              value={r.ingredient_id}
                              onChange={(id) => {
                                const salinan = [...resep];
                                salinan[i] = { ...salinan[i], ingredient_id: id };
                                setResep(salinan);
                              }}
                              placeholder="— pilih bahan —"
                              className="flex-1"
                              disabled={!bolehUbah}
                            />
                            <input
                              type="number"
                              min="0.0001"
                              step="any"
                              value={r.qty}
                              onChange={(e) => {
                                const salinan = [...resep];
                                salinan[i] = { ...salinan[i], qty: e.target.value };
                                setResep(salinan);
                              }}
                              placeholder="qty"
                              className="w-24 shrink-0 rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-orange-500 focus:outline-none"
                              disabled={!bolehUbah}
                              required
                            />
                            <span className="w-12 shrink-0 text-xs text-stone-500">
                              {terpilih?.satuan ?? ""}
                            </span>
                            {/* kolom harga (per satuan & subtotal) hanya untuk owner/admin —
                                tim cukup lihat bahan + takaran + satuan, tanpa harga */}
                            {bolehUbah && (
                              <>
                                <span className="w-28 shrink-0 text-right text-xs whitespace-nowrap text-stone-400 tabular-nums">
                                  {terpilih ? `× Rp ${formatAngka(terpilih.harga_per_unit, 2)}` : ""}
                                </span>
                                <span className="w-28 shrink-0 text-right text-sm whitespace-nowrap font-medium text-stone-700 tabular-nums">
                                  {terpilih && Number(r.qty) > 0
                                    ? formatRupiah(Number(r.qty) * terpilih.harga_per_unit)
                                    : "—"}
                                </span>
                              </>
                            )}
                            <span className="w-6 shrink-0 text-center">
                              {bolehUbah && (
                                <button
                                  type="button"
                                  onClick={() => setResep(resep.filter((_, j) => j !== i))}
                                  className="text-sm font-medium text-red-500 hover:underline"
                                  aria-label="Hapus baris resep"
                                >
                                  ✕
                                </button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {resep.length === 0 && (
                        <div className="rounded-lg bg-stone-50 py-6 text-center text-sm text-stone-400">
                          Belum ada bahan baku pada resep ini.
                        </div>
                      )}
                    </div>

                    {/* total biaya bahan baku hanya untuk owner/admin — tim tanpa harga */}
                    {bolehUbah && resep.length > 0 && (
                      <div className="mt-2 flex items-center gap-2 border-t border-stone-200 pt-2">
                        <span className="flex-1 text-right text-sm font-semibold text-stone-600">
                          Total bahan baku <span className="font-normal text-stone-400">(sebelum overhead)</span>
                        </span>
                        {/* sejajar dengan kolom subtotal tiap baris */}
                        <span className="w-28 shrink-0 text-right text-sm font-bold text-stone-800 tabular-nums">
                          {formatRupiah(biayaResep)}
                        </span>
                        <span className="w-6 shrink-0" aria-hidden="true" />
                      </div>
                    )}

                    {bolehUbah && (
                      <button
                        type="button"
                        onClick={() => setResep([...resep, { ingredient_id: "", qty: "" }])}
                        className="mt-2 text-sm font-medium text-orange-600 hover:underline"
                      >
                        + Tambah bahan baku
                      </button>
                    )}

                    {/* ⚙ Batch, harga & stok minimum — diatur DI BAWAH resep
                        (bukan di modal buat bahan). Harga per batch = biaya
                        bahan resep × overhead; tersimpan saat Simpan Resep.
                        Hanya owner/admin — tim cukup lihat resep (bahan+takaran),
                        hasil per batch sudah tampil di judul di atas. */}
                    {atur && bolehUbah && (
                      <div className="mt-4 rounded-lg border border-stone-200 p-3">
                        <div className="mb-2 text-sm font-semibold text-stone-700">
                          ⚙️ Batch, harga &amp; stok minimum
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-stone-500">
                              1 batch menghasilkan
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min="0.0001"
                                step="any"
                                value={atur.isi}
                                onChange={(e) => setAtur({ ...atur, isi: e.target.value })}
                                className={inputClass}
                                disabled={!bolehUbah}
                                aria-label="Isi per batch"
                              />
                              <SatuanSelect
                                value={atur.satuan}
                                onChange={(v) => setAtur({ ...atur, satuan: v })}
                                selectClassName={`${inputClass} max-w-28`}
                                disabled={!bolehUbah}
                                aria-label="Satuan batch"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-stone-500">
                              Overhead biaya (×)
                            </label>
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              value={atur.overhead}
                              onChange={(e) => setAtur({ ...atur, overhead: e.target.value })}
                              className={inputClass}
                              disabled={!bolehUbah}
                              aria-label="Overhead biaya"
                            />
                            <p className="mt-1 text-xs text-stone-500">
                              <b>1</b> = harga mengikuti biaya resep; mis. <b>1,2</b> = biaya +
                              20% (gas, listrik, tenaga).
                            </p>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-stone-500">
                              Stok minimum di Central Kitchen ({atur.satuan})
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={atur.stokMin}
                              onChange={(e) => setAtur({ ...atur, stokMin: e.target.value })}
                              className={inputClass}
                              disabled={!bolehUbah}
                              aria-label="Stok minimum Central Kitchen"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-stone-500">
                              Stok minimum di toko ({atur.satuan})
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={atur.stokMinToko}
                              onChange={(e) =>
                                setAtur({ ...atur, stokMinToko: e.target.value })
                              }
                              className={inputClass}
                              disabled={!bolehUbah}
                              aria-label="Stok minimum toko"
                            />
                            <p className="mt-1 text-xs text-stone-500">
                              <b>0</b> = ikut nilai Central Kitchen.
                            </p>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-stone-500">
                              Diproduksi di
                            </label>
                            <select
                              value={atur.produksiDi}
                              onChange={(e) =>
                                setAtur({
                                  ...atur,
                                  produksiDi: e.target.value as "ck" | "cabang",
                                })
                              }
                              className={inputClass}
                              disabled={!bolehUbah}
                              aria-label="Lokasi produksi"
                            >
                              <option value="ck">Central Kitchen (dikirim ke cabang)</option>
                              <option value="cabang">Cabang (kitchen toko)</option>
                            </select>
                            <p className="mt-1 text-xs text-stone-500">
                              <b>Cabang</b> = diproduksi peran <b>Kitchen</b> di cabang
                              masing-masing; hasil langsung masuk stok cabang itu.
                            </p>
                            {atur.produksiDi === "cabang" && (
                              <div className="mt-2 rounded-lg border border-stone-200 p-2">
                                <div className="mb-1 text-xs font-medium text-stone-500">
                                  Cabang produsen
                                </div>
                                {cabangStore.length === 0 ? (
                                  <p className="text-xs text-stone-400">
                                    Belum ada cabang toko aktif.
                                  </p>
                                ) : (
                                  cabangStore.map((b) => (
                                    <label
                                      key={b.id}
                                      className="flex items-center gap-2 py-0.5 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={atur.produksiBranchIds.includes(b.id)}
                                        disabled={!bolehUbah}
                                        onChange={(e) =>
                                          setAtur({
                                            ...atur,
                                            produksiBranchIds: e.target.checked
                                              ? [...atur.produksiBranchIds, b.id]
                                              : atur.produksiBranchIds.filter(
                                                  (id) => id !== b.id,
                                                ),
                                          })
                                        }
                                      />
                                      {b.nama}
                                    </label>
                                  ))
                                )}
                                <p className="mt-1 text-xs text-stone-500">
                                  Kosong = <b>semua cabang</b>. Cabang di luar daftar
                                  dipenuhi lewat jalur CK (produksi CK → kirim) dan
                                  kitchen-nya tidak bisa memproduksi bahan ini.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
                          Biaya bahan per batch <b>{formatRupiah(biayaResep)}</b> × overhead{" "}
                          <b>{formatAngka(overhead, 2)}</b> → harga per batch{" "}
                          <b>{formatRupiah(hargaBatch)}</b>
                          {isiBatch > 0 && (
                            <>
                              {" "}
                              · ≈ <b>Rp {formatAngka(hargaBatch / isiBatch, 2)}</b>/{atur.satuan}
                            </>
                          )}
                          <span className="block text-xs text-orange-700">
                            Harga bahan diperbarui otomatis saat “Simpan Resep”.
                          </span>
                        </div>
                      </div>
                    )}

                    {bolehUbah && (
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          onClick={() => simpan.mutate()}
                          disabled={simpan.isPending}
                          className={btnPrimary}
                        >
                          Simpan Resep
                        </button>
                        {simpan.isSuccess && !simpan.isPending && (
                          <span className="text-sm font-medium text-green-600">✓ Tersimpan</span>
                        )}
                      </div>
                    )}
                    <ErrorText error={simpan.error} />
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={formBaru !== null}
        onClose={() => setFormBaru(null)}
        title="Resep produksi baru"
      >
        {formBaru && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              buatBahan.mutate(formBaru);
            }}
            className="space-y-3"
          >
            <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-stone-600">
              Bahan yang <b>diproduksi sendiri</b> (mis. baso). Cukup kode, nama, dan kategori —{" "}
              <b>batch, harga (overhead), dan stok minimum</b> diatur di bawah resep pada panel
              kanan setelah bahan dibuat.
            </p>
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Kode</label>
                <input
                  value={formBaru.kode}
                  onChange={(e) => setFormBaru({ ...formBaru, kode: e.target.value })}
                  className={inputClass}
                  placeholder="otomatis"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Nama</label>
                <input
                  required
                  autoFocus
                  value={formBaru.nama}
                  onChange={(e) => setFormBaru({ ...formBaru, nama: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Kategori</label>
              <select
                value={formBaru.kategori}
                onChange={(e) =>
                  setFormBaru({ ...formBaru, kategori: e.target.value as BahanKategori })
                }
                className={inputClass}
              >
                {!kategoriList?.some((k) => k.nama === formBaru.kategori) &&
                  formBaru.kategori && (
                    <option value={formBaru.kategori}>{formBaru.kategori}</option>
                  )}
                {(kategoriList ?? []).map((k) => (
                  <option key={k.id} value={k.nama}>
                    {k.nama}
                  </option>
                ))}
              </select>
            </div>
            <ErrorText error={buatBahan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setFormBaru(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={buatBahan.isPending} className={btnPrimary}>
                Simpan &amp; atur resep
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
