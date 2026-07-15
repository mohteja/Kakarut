import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { hargaPerUnit, type BahanKategori, type KategoriDto, type SatuanDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, btnPrimary, btnSecondary } from "../../components/ui";
import { KategoriManagerModal } from "../../components/KategoriManagerModal";
import { api } from "../../lib/api";
import { formatAngka } from "../../lib/format";

/** Satu baris input bahan baku (nilai numerik sebagai string sampai disimpan). */
interface Baris {
  kode: string;
  nama: string;
  satuan_beli: string;
  harga_beli: string;
  satuan: string; // satuan resep/kerja
  isi: string; // satuan resep per 1 satuan beli
  kategori: BahanKategori;
  boleh_eceran: boolean;
  track_stok: boolean;
  stok_minimum: string;
}

const cell = "rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none";
const thCell = "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500";
// Judul grup dua panel: belanja (RAB) vs aturan resep — biar form seperti sketsa.
const thGrupBelanja =
  "border-l border-emerald-200 bg-emerald-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-emerald-700";
const thGrupResep =
  "border-l border-sky-200 bg-sky-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-sky-700";
const sepKiri = "border-l border-stone-200"; // pemisah vertikal antar-zona di badan tabel

function barisKosong(satuan: string): Baris {
  return {
    kode: "",
    nama: "",
    satuan_beli: "",
    harga_beli: "",
    satuan,
    isi: "1",
    kategori: "lain",
    boleh_eceran: false,
    track_stok: true,
    stok_minimum: "0",
  };
}

/**
 * Tambah Bahan Baku (multi-baris) — halaman tersendiri, bukan modal. Owner/admin
 * memasukkan banyak bahan sekaligus (jalur BELI). Memisahkan satuan BELI (mis.
 * dus, untuk belanja) dari satuan RESEP (mis. ml, satuan kerja); harga per
 * satuan resep dihitung otomatis = harga beli ÷ isi. Bahan produksi di menu Resep.
 */
export function TambahBahanBakuPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kelolaKategori, setKelolaKategori] = useState(false);
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

  const [rows, setRows] = useState<Baris[]>(() => [
    barisKosong("pcs"),
    barisKosong("pcs"),
    barisKosong("pcs"),
  ]);

  const ubah = (i: number, patch: Partial<Baris>) =>
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
            stok_minimum: Number(b.stok_minimum) || 0,
            boleh_eceran: b.boleh_eceran,
          })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      navigate("/bahan");
    },
  });

  const satuanOptions = (nilai: string) => (
    <>
      {!satuanList?.some((s) => s.nama === nilai) && nilai && <option value={nilai}>{nilai}</option>}
      {(satuanList ?? []).map((s) => (
        <option key={s.id} value={s.nama}>
          {s.nama}
        </option>
      ))}
    </>
  );

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
          Harga per satuan resep dihitung otomatis dari konversi. Bahan <b>produksi</b> dibuat di
          menu Resep.
        </p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[1260px]">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thCell} rowSpan={2}>Kode</th>
              <th className={thCell} rowSpan={2}>Nama *</th>
              <th className={thGrupBelanja} colSpan={2}>🛒 Belanja (RAB)</th>
              <th className={thGrupResep} colSpan={3}>🧪 Aturan resep</th>
              <th className={`${thCell} ${sepKiri}`} rowSpan={2}>Kategori</th>
              <th className={`${thCell} text-center`} rowSpan={2}>Ecer</th>
              <th className={`${thCell} text-center`} rowSpan={2}>Lacak</th>
              <th className={thCell} rowSpan={2}>Stok min</th>
              <th className="px-2 py-2" rowSpan={2}></th>
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
              return (
                <tr key={i} className="align-middle">
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
                  <td className={`px-2 py-1.5 ${sepKiri}`}>
                    <select
                      value={b.satuan_beli}
                      onChange={(e) => ubah(i, { satuan_beli: e.target.value })}
                      className={`${cell} w-24`}
                    >
                      <option value="">—</option>
                      {satuanOptions(b.satuan_beli)}
                    </select>
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
                    <select
                      value={b.satuan}
                      onChange={(e) => ubah(i, { satuan: e.target.value })}
                      className={`${cell} w-24`}
                    >
                      {satuanOptions(b.satuan)}
                    </select>
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
                      onChange={(e) => ubah(i, { kategori: e.target.value as BahanKategori })}
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
                      checked={b.boleh_eceran}
                      onChange={(e) => ubah(i, { boleh_eceran: e.target.checked })}
                      title="Bisa dibeli eceran (tanpa pembulatan per satuan beli)"
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
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => hapusBaris(i)}
                      className="text-sm font-medium text-red-500 hover:underline disabled:opacity-30"
                      disabled={rows.length <= 1}
                      aria-label="Hapus baris"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

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
