import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { BahanDto, KategoriDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
import { KategoriManagerModal } from "../../components/KategoriManagerModal";
import { api } from "../../lib/api";
import { BahanEditorGrid, type BahanEditorRow } from "./BahanEditorGrid";
import { useRakSimpan } from "./useRakSimpan";

function keBaris(b: BahanDto): BahanEditorRow {
  return {
    id: b.id,
    kode: b.kode ?? "",
    nama: b.nama,
    pengadaan: b.pengadaan,
    satuan_beli: b.satuan_beli ?? "",
    harga_beli: String(b.harga_beli),
    satuan: b.satuan,
    isi: String(b.isi),
    kategori: b.kategori,
    boleh_eceran: b.boleh_eceran,
    track_stok: b.track_stok,
    stok_minimum: String(b.stok_minimum),
    min_beli: String(b.min_beli ?? 0),
    is_packaging: b.is_packaging,
    is_complement: b.is_complement,
    catatan: b.catatan ?? "",
    storage_location_id: b.storage_location_id ?? "",
  };
}

/**
 * Ubah Bahan Baku (multi-baris) — halaman tersendiri, memakai grid editor yang
 * SAMA dengan halaman Tambah (BahanEditorGrid). Menerima ?ids=a,b,c dari halaman
 * Bahan Baku lalu menyimpan PUT per bahan.
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
  const { data: kategoriList = [] } = useQuery({
    queryKey: ["kategori-bahan"],
    queryFn: () => api<KategoriDto[]>("/kategori-bahan"),
  });
  // Rak simpan (home) bahan — hook bersama dgn halaman Tambah (rak CK, atau rak
  // cabang store bila usaha 1 cabang tanpa CK). Barang tiba otomatis diletakkan
  // di rak ini.
  const rakCk = useRakSimpan();

  // Seed draft sekali dari master begitu termuat (urut sesuai ids).
  const [rows, setRows] = useState<BahanEditorRow[] | null>(null);
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

  const ubah = (i: number, patch: Partial<BahanEditorRow>) =>
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
              storage_location_id: b.storage_location_id || null,
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

          <BahanEditorGrid
            rows={rows}
            onChange={ubah}
            kategoriList={kategoriList}
            rakCk={rakCk}
            showJenis
          />

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
