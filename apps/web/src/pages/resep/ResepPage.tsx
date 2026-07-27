import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  BahanDto,
  BahanKategori,
  BahanLangkahRow,
  BahanResepRow,
  KategoriDto,
  SatuanDto,
} from "@kakarut/shared";
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
import { ImageUpload } from "../../components/ImageUpload";
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

/** Draft satu langkah cara masak (editor lokal — id server tak dibawa). */
interface LangkahDraft {
  teks: string;
  foto_url: string | null;
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
  /** masa simpan hasil produksi (hari) → dasar exp otomatis saat masuk stok */
  masaSimpan: string;
  /** lama proses produksi (hari) → "buat H-n" agar dibuat jauh-jauh hari */
  leadTime: string;
  /** lokasi produksi: "ck" (Central Kitchen) atau "cabang" (kitchen/bar toko) */
  produksiDi: "ck" | "cabang";
  /** divisi produksi di cabang: role kitchen atau bar yang mengerjakan */
  divisiProduksi: "kitchen" | "bar";
  /** cabang produsen saat "cabang" (kosong = semua cabang store) */
  produksiBranchIds: string[];
}

/** Filter grid resep per lokasi/divisi produksi. */
type FilterResep = "semua" | "ck" | "kitchen" | "bar";

const MAKS_LANGKAH = 30;

/** Badge lokasi/divisi resep — dipakai kartu grid & judul detail. */
function BadgeDivisi({ b }: { b: BahanDto }) {
  if (b.produksi_di === "cabang") {
    return (
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
          b.divisi_produksi === "bar"
            ? "bg-cyan-100 text-cyan-800"
            : "bg-amber-100 text-amber-800"
        }`}
      >
        {b.divisi_produksi === "bar" ? "🍹 Bar" : "🍳 Kitchen"}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">
      🏭 CK
    </span>
  );
}

/**
 * Halaman Resep Produksi: GRID KARTU (thumbnail foto bahan jadi + badge
 * lokasi/divisi + filter chips) → klik kartu membuka DETAIL (?bahan=<id>):
 * editor resep (BOM), CARA MASAK berlangkah + foto proses, foto bahan jadi &
 * cara packing, dan pengaturan batch. Owner/admin bisa mengubah; kitchen,
 * bar, dan tim hanya melihat (resep + cara masak, tanpa harga).
 */
export function ResepPage() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const role = auth?.user.role;
  const bolehUbah = role === "owner" || role === "admin";
  // daftar cabang toko aktif — pilihan "cabang produsen" saat produksi di cabang
  const { cabang } = useBranch();
  const cabangStore = cabang.filter((b) => b.is_active && b.tipe === "store");

  const { data: bahan, isLoading } = useQuery({
    queryKey: ["bahan", "ringkas"],
    queryFn: () => api<BahanDto[]>("/bahan?ringkas=1"),
  });
  const semua = bahan ?? [];
  // `lingkupPeran` (didefinisikan di bawah) dipangkas DI SUMBER, bukan di
  // penyaring grid — supaya hitungan chip, pencarian, dan terutama deep-link
  // `?bahan=<id>` ikut terbatas. Menyaring hanya di grid akan menyisakan celah:
  // menempel id resep divisi lain di URL tetap membuka detailnya.
  const produksiSemua = semua.filter((b) => b.pengadaan === "produksi");

  // Resep terarsip (bahan produksi nonaktif) — chip 🗄 Arsip, hanya owner/admin.
  const { data: arsipData } = useQuery({
    queryKey: ["bahan", "arsip"],
    enabled: bolehUbah,
    queryFn: () => api<BahanDto[]>("/bahan?arsip=1"),
  });
  const arsipProduksi = (arsipData ?? []).filter((b) => b.pengadaan === "produksi");
  const [tab, setTab] = useState<"aktif" | "arsip">("aktif");

  const [cari, setCari] = useState("");
  /**
   * LINGKUP PELAKSANA: peran yang mengerjakan produksi hanya melihat resep yang
   * MEREKA produksi — bar lihat resep bar, kitchen lihat resep kitchen, kru CK
   * lihat resep CK. Bukan sekadar filter awal: chip-nya disembunyikan supaya
   * divisi lain tak bisa dibuka sama sekali (daftar resep divisi lain hanya
   * bikin bingung dan bukan urusan mereka).
   *
   * `tim` = kru Central Kitchen — nav Resep memang hanya muncul untuk tim yang
   * ditempatkan di CK. Owner/admin TIDAK dibatasi: merekalah yang menyusun dan
   * memindahkan resep antar-divisi, jadi butuh melihat semuanya.
   */
  const lingkupPeran: FilterResep | null =
    role === "kitchen" ? "kitchen" : role === "bar" ? "bar" : role === "tim" ? "ck" : null;
  const [filter, setFilter] = useState<FilterResep>(lingkupPeran ?? "semua");
  const produksi = lingkupPeran
    ? produksiSemua.filter((b) =>
        lingkupPeran === "ck"
          ? b.produksi_di === "ck"
          : b.produksi_di === "cabang" && b.divisi_produksi === lingkupPeran,
      )
    : produksiSemua;

  // Bahan terpilih = ?bahan=<id> di URL (state persisten): kartu diklik →
  // param terpasang; ← Kembali → param dihapus. Deep-link dari Bahan Baku /
  // tautan "📖 resep" di faktur produksi langsung membuka detail.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("bahan");
  const bukaDetail = (id: string | null) => setSearchParams(id ? { bahan: id } : {});
  const dipilih = produksi.find((b) => b.id === selectedId) ?? null;

  // Ringkasan jumlah bahan mentah per bahan produksi (utk badge di kartu) —
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

  // CARA MASAK: langkah berurutan + foto proses per langkah.
  const { data: langkahServer } = useQuery({
    queryKey: ["bahan-langkah", selectedId],
    enabled: !!selectedId,
    queryFn: () => api<BahanLangkahRow[]>(`/bahan/${selectedId}/langkah`),
  });
  const [langkah, setLangkah] = useState<LangkahDraft[]>([]);
  useEffect(() => {
    setLangkah((langkahServer ?? []).map((l) => ({ teks: l.teks, foto_url: l.foto_url })));
  }, [langkahServer, selectedId]);

  // Pengaturan batch & harga + foto hasil/packing, di-seed dari bahan terpilih
  // (ikut ter-reset saat master di-refresh — pola sama dgn draft resep).
  const [atur, setAtur] = useState<PengaturanBatch | null>(null);
  const [foto, setFoto] = useState<{ hasil: string | null; packing: string | null }>({
    hasil: null,
    packing: null,
  });
  useEffect(() => {
    setAtur(
      dipilih
        ? {
            isi: String(dipilih.isi),
            satuan: dipilih.satuan,
            overhead: String(dipilih.overhead_x ?? 1),
            stokMin: String(dipilih.stok_minimum),
            stokMinToko: String(dipilih.stok_minimum_toko ?? 0),
            masaSimpan: String(dipilih.masa_simpan_hari ?? 0),
            leadTime: String(dipilih.lead_time_hari ?? 0),
            produksiDi: dipilih.produksi_di ?? "ck",
            divisiProduksi: dipilih.divisi_produksi ?? "kitchen",
            produksiBranchIds: dipilih.produksi_branch_ids ?? [],
          }
        : null,
    );
    setFoto({
      hasil: dipilih?.foto_hasil_url ?? null,
      packing: dipilih?.foto_packing_url ?? null,
    });
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

  // Simpan resep + pengaturan + cara masak berantai: komponen → master bahan
  // (isi/harga/foto) → langkah PALING AKHIR (gagal langkah tak memblokir
  // simpan resep/harga; invalidasi onError merapikan sebagian tersimpan).
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
            masa_simpan_hari: Math.max(0, Math.trunc(Number(atur.masaSimpan) || 0)),
            lead_time_hari: Math.max(0, Math.trunc(Number(atur.leadTime) || 0)),
            harga_beli: hargaBatch,
            produksi_di: atur.produksiDi,
            // divisi hanya bermakna untuk produksi cabang — CK kembali ke default
            divisi_produksi: atur.produksiDi === "cabang" ? atur.divisiProduksi : "kitchen",
            produksi_branch_ids:
              atur.produksiDi === "cabang" ? atur.produksiBranchIds : [],
            foto_hasil_url: foto.hasil,
            foto_packing_url: foto.packing,
          },
        });
      }
      await api(`/bahan/${selectedId}/langkah`, {
        method: "PUT",
        body: {
          langkah: langkah
            .filter((l) => l.teks.trim())
            .map((l) => ({ teks: l.teks.trim(), foto_url: l.foto_url })),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["bahan-langkah", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP bisa berubah
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
    onError: () => {
      // sebagian rantai bisa saja sudah tersimpan sebelum yang gagal — refresh
      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["bahan-langkah", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
    },
  });

  // Arsipkan resep = nonaktifkan bahan produksi (soft-archive). Server menolak
  // (409) bila masih dipakai menu aktif atau resep produksi lain — pesan tampil
  // lewat ErrorText di bawah tombol.
  const arsipkan = useMutation({
    mutationFn: (id: string) => api(`/bahan/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      bukaDetail(null);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
    },
  });
  const pulihkan = useMutation({
    mutationFn: (id: string) => api(`/bahan/${id}/pulihkan`, { method: "POST" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      setTab("aktif");
      bukaDetail(id);
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
  // kategori; batch, harga (overhead), dan stok minimum diatur di detail resep.
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
      bukaDetail(b.id);
    },
  });

  if (isLoading) return <Spinner />;

  const cocokFilter = (b: BahanDto) =>
    filter === "semua"
      ? true
      : filter === "ck"
        ? b.produksi_di === "ck"
        : b.produksi_di === "cabang" && b.divisi_produksi === filter;
  const daftar = produksi
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()) && cocokFilter(b))
    .sort((a, b) => a.nama.localeCompare(b.nama));
  const daftarArsip = arsipProduksi
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()))
    .sort((a, b) => a.nama.localeCompare(b.nama));
  const hitungFilter = (f: FilterResep) =>
    f === "semua"
      ? produksi.length
      : produksi.filter(
          (b) =>
            (f === "ck" && b.produksi_di === "ck") ||
            (f !== "ck" && b.produksi_di === "cabang" && b.divisi_produksi === f),
        ).length;

  const bukaFormBaru = () => setFormBaru({ kode: "", nama: "", kategori: "baso" });
  const chipCls = (aktif: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium transition ${
      aktif ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
    }`;

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
            Atur bahan baku untuk memproduksi <b>1 batch</b> tiap bahan jenis produksi, plus{" "}
            <b>cara masak berlangkah + foto</b>. Dipakai untuk <b>rencana belanja bahan
            produksi</b> dan <b>pemotongan stok bahan baku otomatis</b> saat produksi selesai.
          </>
        ) : (
          <>
            Resep tiap bahan produksi: <b>bahan baku &amp; takaran</b> per <b>1 batch</b>,{" "}
            <b>cara masak</b> berlangkah dengan foto proses, foto bahan jadi, dan cara
            packing. Harga tak ditampilkan.
          </>
        )}
      </div>

      {produksi.length === 0 && arsipProduksi.length === 0 ? (
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
      ) : selectedId && !dipilih ? (
        /* id di URL tak dikenal (terhapus/diarsip/tautan basi) — jangan crash */
        <Card className="p-8 text-center text-sm text-stone-500">
          Resep tidak ditemukan (mungkin sudah diarsipkan).{" "}
          <button
            onClick={() => bukaDetail(null)}
            className="font-medium text-orange-600 hover:underline"
          >
            ← Kembali ke daftar resep
          </button>
        </Card>
      ) : !selectedId ? (
        /* ============ MODE GRID: kartu resep + filter ============ */
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari resep…"
              className={`${inputClass} w-56 flex-none`}
            />
            {/* Chip divisi disembunyikan untuk peran pelaksana — daftarnya sudah
                dipangkas ke divisinya, jadi chip hanya akan menampilkan nol. */}
            {tab === "aktif" && !lingkupPeran && (
              <>
                <button onClick={() => setFilter("semua")} className={chipCls(filter === "semua")}>
                  Semua ({hitungFilter("semua")})
                </button>
                <button onClick={() => setFilter("ck")} className={chipCls(filter === "ck")}>
                  🏭 CK ({hitungFilter("ck")})
                </button>
                <button
                  onClick={() => setFilter("kitchen")}
                  className={chipCls(filter === "kitchen")}
                >
                  🍳 Kitchen ({hitungFilter("kitchen")})
                </button>
                <button onClick={() => setFilter("bar")} className={chipCls(filter === "bar")}>
                  🍹 Bar ({hitungFilter("bar")})
                </button>
              </>
            )}
            {bolehUbah && (
              <button
                onClick={() => setTab(tab === "arsip" ? "aktif" : "arsip")}
                className={chipCls(tab === "arsip")}
              >
                🗄 Arsip ({arsipProduksi.length})
              </button>
            )}
          </div>

          {tab === "arsip" && bolehUbah ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {daftarArsip.map((b) => (
                <Card key={b.id} className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-stone-600">{b.nama}</div>
                    <div className="text-xs text-stone-400">
                      batch {formatAngka(b.isi)} {b.satuan}
                    </div>
                  </div>
                  <button
                    onClick={() => pulihkan.mutate(b.id)}
                    disabled={pulihkan.isPending}
                    className="shrink-0 rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
                  >
                    ↩ Pulihkan
                  </button>
                </Card>
              ))}
              {daftarArsip.length === 0 && (
                <div className="col-span-full py-8 text-center text-sm text-stone-400">
                  {arsipProduksi.length === 0
                    ? "Belum ada resep yang diarsipkan."
                    : "Tidak ada yang cocok."}
                </div>
              )}
              <div className="col-span-full">
                <ErrorText error={pulihkan.error} />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {daftar.map((b) => {
                // peta hanya berisi bahan yang PUNYA komponen — absen berarti
                // 0 (belum ada resep); null hanya selagi peta belum termuat.
                const n = ringkas ? (ringkas[b.id] ?? 0) : null;
                return (
                  <Card
                    key={b.id}
                    onClick={() => bukaDetail(b.id)}
                    className="cursor-pointer overflow-hidden text-left transition hover:border-orange-300 hover:shadow-sm"
                  >
                    <div className="flex aspect-video items-center justify-center bg-stone-100">
                      {b.foto_hasil_url ? (
                        <img
                          src={b.foto_hasil_url}
                          alt={b.nama}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-4xl" aria-hidden>
                          🍲
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-stone-800">
                          {b.nama}
                        </span>
                        <BadgeDivisi b={b} />
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-stone-500">
                        <span className="min-w-0 truncate">
                          batch {formatAngka(b.isi)} {b.satuan} ·{" "}
                          {n == null ? "—" : n > 0 ? `${n} bahan baku` : "belum ada resep"}
                        </span>
                        {/* harga hanya owner/admin — staf produksi tanpa harga */}
                        {bolehUbah && (
                          <span className="shrink-0 font-semibold text-stone-700 tabular-nums">
                            {formatRupiah(b.harga_beli)}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
              {daftar.length === 0 && (
                <div className="col-span-full py-8 text-center text-sm text-stone-400">
                  {produksi.length === 0 ? "Belum ada resep aktif." : "Tidak ada yang cocok."}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* ============ MODE DETAIL: editor/tampilan satu resep ============ */
        <Card className="p-4">
          {dipilih && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <button
                  onClick={() => bukaDetail(null)}
                  className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
                >
                  ← Kembali
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-lg font-bold text-stone-800">
                      {dipilih.nama}
                    </span>
                    <BadgeDivisi b={dipilih} />
                  </div>
                  <div className="text-sm text-stone-500">
                    Resep per 1 batch = {formatAngka(dipilih.isi)} {dipilih.satuan}
                  </div>
                </div>
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
                        ⚙️ Batch, harga, stok minimum &amp; masa simpan
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
                            Masa simpan (hari)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={atur.masaSimpan}
                            onChange={(e) => setAtur({ ...atur, masaSimpan: e.target.value })}
                            className={inputClass}
                            disabled={!bolehUbah}
                            aria-label="Masa simpan hasil produksi (hari)"
                          />
                          <p className="mt-1 text-xs text-stone-500">
                            Umur hasil produksi. <b>Tanggal exp otomatis</b> = tanggal masuk stok
                            + masa simpan. <b>0</b> = tak diatur.
                          </p>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Lama produksi (hari)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={atur.leadTime}
                            onChange={(e) => setAtur({ ...atur, leadTime: e.target.value })}
                            className={inputClass}
                            disabled={!bolehUbah}
                            aria-label="Lama produksi / lead time (hari)"
                          />
                          <p className="mt-1 text-xs text-stone-500">
                            Berapa hari proses produksi. Muncul sebagai <b>⏱ buat H-n</b> di
                            rekomendasi/permintaan agar dibuat jauh-jauh hari. <b>0</b> = tanpa info.
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
                            <option value="cabang">Cabang (kitchen/bar toko)</option>
                          </select>
                          <p className="mt-1 text-xs text-stone-500">
                            <b>Cabang</b> = diproduksi peran <b>Kitchen</b> atau <b>Bar</b>{" "}
                            di cabang masing-masing; hasil langsung masuk stok cabang itu.
                          </p>
                          {atur.produksiDi === "cabang" && (
                            <div className="mt-2">
                              <label className="mb-1 block text-xs font-medium text-stone-500">
                                Divisi produksi
                              </label>
                              <select
                                value={atur.divisiProduksi}
                                onChange={(e) =>
                                  setAtur({
                                    ...atur,
                                    divisiProduksi: e.target.value as "kitchen" | "bar",
                                  })
                                }
                                className={inputClass}
                                disabled={!bolehUbah}
                                aria-label="Divisi produksi"
                              >
                                <option value="kitchen">Kitchen (dapur)</option>
                                <option value="bar">Bar (minuman)</option>
                              </select>
                              <p className="mt-1 text-xs text-stone-500">
                                Hanya role divisi ini yang bisa memproduksi resep ini di
                                cabang — kitchen tak melihat resep bar, dan sebaliknya.
                              </p>
                            </div>
                          )}
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
                                kitchen/bar-nya tidak bisa memproduksi bahan ini.
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

                  {/* ============ 👨‍🍳 CARA MASAK: langkah berurutan + foto ============ */}
                  <div className="mt-4 rounded-lg border border-stone-200 p-3">
                    <div className="mb-2 text-sm font-semibold text-stone-700">
                      👨‍🍳 Cara Masak
                    </div>
                    {bolehUbah ? (
                      <>
                        <div className="space-y-3">
                          {langkah.map((l, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                                {i + 1}
                              </span>
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <textarea
                                  rows={2}
                                  value={l.teks}
                                  onChange={(e) => {
                                    const s = [...langkah];
                                    s[i] = { ...s[i], teks: e.target.value };
                                    setLangkah(s);
                                  }}
                                  maxLength={1000}
                                  placeholder={`Langkah ${i + 1} — mis. rebus air sampai mendidih…`}
                                  className={`${inputClass} resize-y`}
                                  aria-label={`Teks langkah ${i + 1}`}
                                />
                                <ImageUpload
                                  value={l.foto_url}
                                  onChange={(url) => {
                                    const s = [...langkah];
                                    s[i] = { ...s[i], foto_url: url };
                                    setLangkah(s);
                                  }}
                                  tujuan="resep"
                                  placeholder="📷"
                                />
                              </div>
                              <div className="flex shrink-0 flex-col gap-1">
                                <button
                                  type="button"
                                  disabled={i === 0}
                                  onClick={() => {
                                    const s = [...langkah];
                                    [s[i - 1], s[i]] = [s[i], s[i - 1]];
                                    setLangkah(s);
                                  }}
                                  className="rounded border border-stone-300 px-1.5 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                                  aria-label={`Naikkan langkah ${i + 1}`}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  disabled={i === langkah.length - 1}
                                  onClick={() => {
                                    const s = [...langkah];
                                    [s[i], s[i + 1]] = [s[i + 1], s[i]];
                                    setLangkah(s);
                                  }}
                                  className="rounded border border-stone-300 px-1.5 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                                  aria-label={`Turunkan langkah ${i + 1}`}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLangkah(langkah.filter((_, j) => j !== i))}
                                  className="rounded px-1.5 text-sm font-medium text-red-500 hover:underline"
                                  aria-label={`Hapus langkah ${i + 1}`}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                          {langkah.length === 0 && (
                            <div className="rounded-lg bg-stone-50 py-4 text-center text-sm text-stone-400">
                              Belum ada langkah cara masak.
                            </div>
                          )}
                        </div>
                        {langkah.length < MAKS_LANGKAH && (
                          <button
                            type="button"
                            onClick={() => setLangkah([...langkah, { teks: "", foto_url: null }])}
                            className="mt-2 text-sm font-medium text-orange-600 hover:underline"
                          >
                            + Tambah langkah
                          </button>
                        )}
                        <p className="mt-1 text-xs text-stone-400">
                          Tersimpan saat “Simpan Resep”. Foto per langkah opsional (JPEG/PNG/WebP,
                          maks 5 MB).
                        </p>
                      </>
                    ) : langkah.length === 0 ? (
                      <div className="rounded-lg bg-stone-50 py-4 text-center text-sm text-stone-400">
                        Belum ada langkah cara masak.
                      </div>
                    ) : (
                      <ol className="space-y-3">
                        {langkah.map((l, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm whitespace-pre-wrap text-stone-700">{l.teks}</p>
                              {l.foto_url && (
                                <a href={l.foto_url} target="_blank" rel="noreferrer">
                                  <img
                                    src={l.foto_url}
                                    alt={`Foto langkah ${i + 1}`}
                                    className="mt-1.5 max-h-48 rounded-lg border border-stone-200 object-contain"
                                  />
                                </a>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  {/* ============ 📷 FOTO bahan jadi & cara packing ============ */}
                  <div className="mt-4 rounded-lg border border-stone-200 p-3">
                    <div className="mb-2 text-sm font-semibold text-stone-700">📷 Foto</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          ["hasil", "Foto bahan jadi"],
                          ["packing", "Foto cara packing"],
                        ] as const
                      ).map(([kunci, label]) => (
                        <div key={kunci}>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            {label}
                          </label>
                          {bolehUbah ? (
                            <ImageUpload
                              value={foto[kunci]}
                              onChange={(url) => setFoto({ ...foto, [kunci]: url })}
                              tujuan="resep"
                              placeholder={kunci === "hasil" ? "🍲" : "📦"}
                            />
                          ) : foto[kunci] ? (
                            <a href={foto[kunci]!} target="_blank" rel="noreferrer">
                              <img
                                src={foto[kunci]!}
                                alt={label}
                                className="max-h-48 rounded-lg border border-stone-200 object-contain"
                              />
                            </a>
                          ) : (
                            <div className="rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-400">
                              Belum ada foto.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

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
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Arsipkan resep "${dipilih.nama}"? Bahan produksi ini keluar dari daftar resep, rencana belanja, dan pilihan produksi. Riwayat lama tetap tersimpan dan bisa dipulihkan dari 🗄 Arsip.`,
                            )
                          )
                            arsipkan.mutate(dipilih.id);
                        }}
                        disabled={arsipkan.isPending}
                        className="text-sm font-medium text-red-500 hover:underline"
                      >
                        🗄 Arsipkan resep
                      </button>
                    </div>
                  )}
                  <ErrorText error={simpan.error} />
                  <ErrorText error={arsipkan.error} />
                </>
              )}
            </div>
          )}
        </Card>
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
              <b>batch, harga (overhead), stok minimum, dan cara masak</b> diatur di halaman
              detail setelah bahan dibuat.
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
