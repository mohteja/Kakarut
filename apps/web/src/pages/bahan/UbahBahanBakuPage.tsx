import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { hargaPerUnit, type BahanDto, type KategoriDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
import { KategoriManagerModal } from "../../components/KategoriManagerModal";
import { SatuanSelect } from "../../components/SatuanSelect";
import { api } from "../../lib/api";
import { formatAngka } from "../../lib/format";

/** Satu baris ubah bahan (nilai numerik sebagai string sampai disimpan). */
interface BarisUbah {
  id: string;
  kode: string;
  nama: string;
  satuan_beli: string;
  harga_beli: string;
  satuan: string; // satuan resep/kerja
  isi: string; // satuan resep per 1 satuan beli
  kategori: string;
  pengadaan: "produksi" | "beli";
  boleh_eceran: boolean;
  track_stok: boolean;
  stok_minimum: string;
  min_beli: string;
  is_packaging: boolean;
  is_complement: boolean;
  catatan: string;
}

const cell = "rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none";
const thCell = "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500";
// Judul grup dua panel — sama dengan halaman Tambah Bahan Baku.
const thGrupBelanja =
  "border-l border-emerald-200 bg-emerald-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-emerald-700";
const thGrupResep =
  "border-l border-sky-200 bg-sky-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-sky-700";
const sepKiri = "border-l border-stone-200";

function keBaris(b: BahanDto): BarisUbah {
  return {
    id: b.id,
    kode: b.kode ?? "",
    nama: b.nama,
    satuan_beli: b.satuan_beli ?? "",
    harga_beli: String(b.harga_beli),
    satuan: b.satuan,
    isi: String(b.isi),
    kategori: b.kategori,
    pengadaan: b.pengadaan,
    boleh_eceran: b.boleh_eceran,
    track_stok: b.track_stok,
    stok_minimum: String(b.stok_minimum),
    min_beli: String(b.min_beli ?? 0),
    is_packaging: b.is_packaging,
    is_complement: b.is_complement,
    catatan: b.catatan ?? "",
  };
}

/**
 * Ubah Bahan Baku (multi-baris) — halaman tersendiri (bukan modal), tata letak
 * sama dengan Tambah Bahan Baku. Menerima ?ids=a,b,c dari halaman Bahan Baku
 * (satu baris "Ubah" atau banyak lewat checkbox) lalu menyimpan PUT per bahan.
 */
export function UbahBahanBakuPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const [kelolaKategori, setKelolaKategori] = useState(false);

  const { data: bahan, isLoading } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  const { data: kategoriList } = useQuery({
    queryKey: ["kategori-bahan"],
    queryFn: () => api<KategoriDto[]>("/kategori-bahan"),
  });

  // Seed draft sekali dari master begitu termuat (urut sesuai ids).
  const [rows, setRows] = useState<BarisUbah[] | null>(null);
  // Bahan produksi yang dilewati (diedit lewat halaman Resep, bukan grid ini).
  const [dilewatiProduksi, setDilewatiProduksi] = useState(0);
  useEffect(() => {
    if (rows === null && bahan) {
      const byId = new Map(bahan.map((b) => [b.id, b]));
      const dipilih = ids.map((id) => byId.get(id)).filter((b): b is BahanDto => !!b);
      // Grid ini hanya untuk bahan BELI. Bahan produksi biaya/HPP-nya dari resep
      // + overhead, jadi diedit di halaman Resep — dilewati di sini.
      setRows(dipilih.filter((b) => b.pengadaan === "beli").map(keBaris));
      setDilewatiProduksi(dipilih.filter((b) => b.pengadaan === "produksi").length);
    }
  }, [bahan, ids, rows]);

  const ubah = (i: number, patch: Partial<BarisUbah>) =>
    setRows((r) => (r ? r.map((b, j) => (j === i ? { ...b, ...patch } : b)) : r));

  const invalid = (rows ?? []).filter((b) => b.nama.trim() === "" || !(Number(b.isi) > 0));

  const simpan = useMutation({
    mutationFn: async () => {
      const hasil = await Promise.allSettled(
        (rows ?? []).map((b) =>
          api<BahanDto>(`/bahan/${b.id}`, {
            method: "PUT",
            body: {
              kode: b.kode.trim() || null,
              nama: b.nama.trim(),
              harga_beli: Number(b.harga_beli) || 0,
              isi: Number(b.isi),
              satuan: b.satuan.trim() || "pcs",
              satuan_beli: b.satuan_beli.trim() || null,
              kategori: b.kategori,
              track_stok: b.track_stok,
              stok_minimum: b.track_stok ? Number(b.stok_minimum) || 0 : 0,
              catatan: b.catatan.trim() || null,
              is_packaging: b.is_packaging,
              is_complement: b.is_complement,
              // eceran & minimal belanja hanya relevan utk jalur beli
              boleh_eceran: b.pengadaan === "beli" ? b.boleh_eceran : false,
              min_beli: b.pengadaan === "beli" ? Number(b.min_beli) || 0 : 0,
            },
          }),
        ),
      );
      const gagal = hasil
        .map((h, i) => ({ h, nama: rows![i].nama }))
        .filter((x) => x.h.status === "rejected");
      if (gagal.length > 0) {
        const pertama = (gagal[0].h as PromiseRejectedResult).reason as Error;
        throw new Error(
          `${gagal.length} dari ${hasil.length} bahan gagal disimpan (${gagal
            .map((g) => g.nama)
            .join(", ")}): ${pertama?.message ?? "kesalahan tidak dikenal"}`,
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP berubah
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      navigate("/bahan");
    },
    onError: () => {
      // sebagian bisa saja sudah tersimpan — refresh master agar tak basi
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  if (isLoading || rows === null) return <Spinner />;

  return (
    <div>
      <PageTitle
        aksi={
          <div className="flex items-center gap-2">
            <button onClick={() => setKelolaKategori(true)} className={btnSecondary}>
              🏷 Kategori
            </button>
            <button onClick={() => navigate("/bahan")} className={btnSecondary}>
              ← Kembali
            </button>
          </div>
        }
      >
        Ubah Bahan Baku ({rows.length})
      </PageTitle>
      <KategoriManagerModal
        open={kelolaKategori}
        onClose={() => setKelolaKategori(false)}
        endpoint="/kategori-bahan"
        queryKey="kategori-bahan"
        judul="Kategori Bahan Baku"
        deskripsi="Tambah/ubah kategori bahan baku. Kategori baru langsung muncul di dropdown."
      />

      {dilewatiProduksi > 0 && (
        <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800">
          {dilewatiProduksi} bahan produksi dilewati — biaya/HPP-nya dihitung dari resep, jadi
          diubah di{" "}
          <button
            onClick={() => navigate("/resep")}
            className="font-semibold underline hover:text-orange-900"
          >
            halaman Resep
          </button>
          .
        </div>
      )}
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Tidak ada bahan yang dipilih.{" "}
          <button
            onClick={() => navigate("/bahan")}
            className="font-medium text-orange-600 hover:underline"
          >
            Kembali ke Bahan Baku
          </button>{" "}
          lalu centang bahan yang ingin diubah.
        </Card>
      ) : (
        <>
          <div className="mb-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <span className="text-emerald-800">
                <b>🛒 Belanja (RAB)</b> — satuan &amp; harga saat belanja di pasar.
              </span>
              <span className="text-sky-800">
                <b>🧪 Aturan resep</b> — satuan kerja + konversi → harga per satuan resep
                otomatis.
              </span>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              Perubahan berlaku ke semua resep &amp; HPP yang memakai bahan ini.
            </p>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[1690px]">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={thCell} rowSpan={2}>Kode</th>
                  <th className={thCell} rowSpan={2}>Nama *</th>
                  <th className={thCell} rowSpan={2}>Jenis</th>
                  <th className={thGrupBelanja} colSpan={2}>🛒 Belanja (RAB)</th>
                  <th className={thGrupResep} colSpan={3}>🧪 Aturan resep</th>
                  <th className={`${thCell} ${sepKiri}`} rowSpan={2}>Kategori</th>
                  <th className={`${thCell} text-center`} rowSpan={2}>Ecer</th>
                  <th className={`${thCell} text-center`} rowSpan={2}>Lacak</th>
                  <th className={thCell} rowSpan={2}>Stok min</th>
                  <th className={thCell} rowSpan={2}>Min beli</th>
                  <th className={`${thCell} text-center`} rowSpan={2} title="Kemasan take-away">
                    TA
                  </th>
                  <th
                    className={`${thCell} text-center`}
                    rowSpan={2}
                    title="Complement (×0.5 dine-in)"
                  >
                    Comp
                  </th>
                  <th className={thCell} rowSpan={2}>Catatan</th>
                </tr>
                <tr>
                  <th className={`${thCell} border-l border-emerald-200`}>Satuan beli</th>
                  <th className={thCell}>Harga beli</th>
                  <th className={`${thCell} border-l border-sky-200`}>Satuan resep</th>
                  <th className={thCell}>Konversi</th>
                  <th className={`${thCell} text-right`}>Harga/satuan resep</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((b, i) => {
                  const hpsr =
                    Number(b.harga_beli) > 0 && Number(b.isi) > 0
                      ? hargaPerUnit(Number(b.harga_beli), Number(b.isi))
                      : null;
                  const beli = b.pengadaan === "beli";
                  return (
                    <tr key={b.id} className="align-middle">
                      <td className="px-2 py-1.5">
                        <input
                          value={b.kode}
                          onChange={(e) => ubah(i, { kode: e.target.value })}
                          placeholder="otomatis"
                          className={`${cell} w-20`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={b.nama}
                          onChange={(e) => ubah(i, { nama: e.target.value })}
                          placeholder="Nama bahan"
                          className={`${cell} w-40`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                            beli ? "bg-teal-100 text-teal-700" : "bg-orange-100 text-orange-700"
                          }`}
                        >
                          {beli ? "Beli" : "Produksi"}
                        </span>
                      </td>
                      <td className={`px-2 py-1.5 ${sepKiri}`}>
                        <SatuanSelect
                          value={b.satuan_beli}
                          onChange={(v) => ubah(i, { satuan_beli: v })}
                          bolehKosong
                          selectClassName={`${cell} w-24`}
                          aria-label="Satuan beli"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={b.harga_beli}
                          onChange={(e) => ubah(i, { harga_beli: e.target.value })}
                          placeholder="0"
                          className={`${cell} w-24`}
                        />
                      </td>
                      <td className={`px-2 py-1.5 ${sepKiri}`}>
                        <SatuanSelect
                          value={b.satuan}
                          onChange={(v) => ubah(i, { satuan: v })}
                          selectClassName={`${cell} w-24`}
                          aria-label="Satuan resep"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1 text-sm whitespace-nowrap text-stone-600">
                          <span>1 {b.satuan_beli || "beli"} =</span>
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={b.isi}
                            onChange={(e) => ubah(i, { isi: e.target.value })}
                            className={`${cell} w-24`}
                            aria-label="Konversi (satuan resep per 1 satuan beli)"
                          />
                          <span>{b.satuan}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right text-sm text-stone-600 whitespace-nowrap">
                        {hpsr != null ? `Rp ${formatAngka(hpsr, 2)}/${b.satuan}` : "—"}
                      </td>
                      <td className={`px-2 py-1.5 ${sepKiri}`}>
                        <select
                          value={b.kategori}
                          onChange={(e) => ubah(i, { kategori: e.target.value })}
                          className={`${cell} w-28`}
                        >
                          {!kategoriList?.some((k) => k.nama === b.kategori) && b.kategori && (
                            <option value={b.kategori}>{b.kategori}</option>
                          )}
                          {(kategoriList ?? []).map((k) => (
                            <option key={k.id} value={k.nama}>
                              {k.nama}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={beli ? b.boleh_eceran : false}
                          onChange={(e) => ubah(i, { boleh_eceran: e.target.checked })}
                          disabled={!beli}
                          title={
                            beli
                              ? "Bisa dibeli eceran (tanpa pembulatan per satuan beli)"
                              : "Hanya untuk bahan jalur beli"
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={b.track_stok}
                          onChange={(e) => ubah(i, { track_stok: e.target.checked })}
                          title="Lacak stok bahan ini"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={b.stok_minimum}
                          onChange={(e) => ubah(i, { stok_minimum: e.target.value })}
                          className={`${cell} w-20`}
                          disabled={!b.track_stok}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={beli ? b.min_beli : "0"}
                          onChange={(e) => ubah(i, { min_beli: e.target.value })}
                          className={`${cell} w-20`}
                          disabled={!beli}
                          title={
                            beli
                              ? `Minimal belanja (${b.satuan}); 0 = tanpa minimum`
                              : "Hanya untuk bahan jalur beli"
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={b.is_packaging}
                          onChange={(e) => ubah(i, { is_packaging: e.target.checked })}
                          title="Kemasan take-away"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={b.is_complement}
                          onChange={(e) => ubah(i, { is_complement: e.target.checked })}
                          title="Complement (×0.5 dine-in)"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={b.catatan}
                          onChange={(e) => ubah(i, { catatan: e.target.value })}
                          placeholder="—"
                          className={`${cell} w-40`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 text-sm text-stone-500">
              {invalid.length > 0
                ? `${invalid.length} baris belum valid (nama wajib, konversi > 0)`
                : `${rows.length} bahan siap disimpan`}
            </div>
            <button type="button" onClick={() => navigate("/bahan")} className={btnSecondary}>
              Batal
            </button>
            <button
              type="button"
              onClick={() => simpan.mutate()}
              disabled={rows.length === 0 || invalid.length > 0 || simpan.isPending}
              className={btnPrimary}
            >
              {simpan.isPending ? "Menyimpan…" : `Simpan semua (${rows.length})`}
            </button>
          </div>
          <div className="mt-2">
            <ErrorText error={simpan.error} />
          </div>
        </>
      )}
    </div>
  );
}
