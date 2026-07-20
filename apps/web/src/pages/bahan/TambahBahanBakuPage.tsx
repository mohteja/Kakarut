import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { KategoriDto, SatuanDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, btnPrimary, btnSecondary } from "../../components/ui";
import { KategoriManagerModal } from "../../components/KategoriManagerModal";
import { api } from "../../lib/api";
import { BahanEditorGrid, type BahanEditorRow } from "./BahanEditorGrid";

function barisKosong(satuan: string): BahanEditorRow {
  return {
    kode: "",
    nama: "",
    pengadaan: "beli",
    satuan_beli: "",
    harga_beli: "",
    satuan,
    isi: "1",
    kategori: "lain",
    boleh_eceran: false,
    track_stok: true,
    stok_minimum: "0",
    min_beli: "0",
    is_packaging: false,
    is_complement: false,
    catatan: "",
  };
}

/**
 * Tambah Bahan Baku (multi-baris) — halaman tersendiri (jalur BELI). Memakai
 * grid editor yang SAMA dengan halaman Ubah Bahan Baku (BahanEditorGrid), jadi
 * format input tambah & edit identik. Memisahkan satuan BELI (belanja) dari
 * satuan RESEP (kerja); harga per satuan resep dihitung otomatis. Bahan
 * produksi dibuat di menu Resep.
 */
export function TambahBahanBakuPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kelolaKategori, setKelolaKategori] = useState(false);
  const { data: satuanList } = useQuery({
    queryKey: ["satuan"],
    queryFn: () => api<SatuanDto[]>("/satuan"),
  });
  const { data: kategoriList = [] } = useQuery({
    queryKey: ["kategori-bahan"],
    queryFn: () => api<KategoriDto[]>("/kategori-bahan"),
  });
  const satuanDefault = satuanList?.some((s) => s.nama === "pcs")
    ? "pcs"
    : satuanList?.[0]?.nama ?? "pcs";

  const [rows, setRows] = useState<BahanEditorRow[]>(() => [
    barisKosong("pcs"),
    barisKosong("pcs"),
    barisKosong("pcs"),
  ]);

  const ubah = (i: number, patch: Partial<BahanEditorRow>) =>
    setRows((r) => r.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const tambahBaris = () => setRows((r) => [...r, barisKosong(satuanDefault)]);
  const hapusBaris = (i: number) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r));

  // baris valid: punya nama & isi > 0 (harga boleh 0)
  const valid = rows.filter((b) => b.nama.trim() !== "" && Number(b.isi) > 0);

  const simpan = useMutation({
    mutationFn: () =>
      api<{ jumlah: number }>("/bahan/bulk", {
        method: "POST",
        body: {
          items: valid.map((b) => ({
            kode: b.kode.trim() || null,
            nama: b.nama.trim(),
            harga_beli: Number(b.harga_beli) || 0,
            isi: Number(b.isi),
            satuan: b.satuan.trim() || "pcs",
            satuan_beli: b.satuan_beli.trim() || null,
            kategori: b.kategori,
            track_stok: b.track_stok,
            stok_minimum: b.track_stok ? Number(b.stok_minimum) || 0 : 0,
            boleh_eceran: b.boleh_eceran,
            min_beli: Number(b.min_beli) || 0,
            is_packaging: b.is_packaging,
            is_complement: b.is_complement,
            catatan: b.catatan.trim() || null,
          })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      navigate("/bahan");
    },
  });

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
        Tambah Bahan Baku
      </PageTitle>
      <KategoriManagerModal
        open={kelolaKategori}
        onClose={() => setKelolaKategori(false)}
        endpoint="/kategori-bahan"
        queryKey="kategori-bahan"
        judul="Kategori Bahan Baku"
        deskripsi="Tambah/ubah kategori bahan baku. Kategori baru langsung muncul di dropdown."
      />
      <div className="mb-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <span className="text-emerald-800">
            <b>🛒 Belanja (RAB)</b> — satuan &amp; harga saat belanja di pasar (mis. garam{" "}
            <i>1 pack = Rp10.000</i>).
          </span>
          <span className="text-sky-800">
            <b>🧪 Aturan resep</b> — satuan kerja untuk resep + konversinya (<i>1 pack = 200 gram</i>{" "}
            → harga otomatis <i>Rp50/gram</i>).
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          Format input <b>sama dengan halaman Ubah Bahan Baku</b>. Harga per satuan resep dihitung
          otomatis dari konversi. Bahan <b>produksi</b> dibuat di menu Resep.
        </p>
      </div>

      <BahanEditorGrid rows={rows} onChange={ubah} onRemove={hapusBaris} kategoriList={kategoriList} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={tambahBaris} className={btnSecondary}>
          + Tambah baris
        </button>
        <div className="flex-1 text-sm text-stone-500">{valid.length} bahan siap disimpan</div>
        <button
          type="button"
          onClick={() => simpan.mutate()}
          disabled={valid.length === 0 || simpan.isPending}
          className={btnPrimary}
        >
          {simpan.isPending ? "Menyimpan…" : `Simpan semua (${valid.length})`}
        </button>
      </div>
      <div className="mt-2">
        <ErrorText error={simpan.error} />
      </div>
    </div>
  );
}
