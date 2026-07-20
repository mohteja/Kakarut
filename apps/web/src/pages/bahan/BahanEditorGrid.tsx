import type { KategoriDto } from "@kakarut/shared";
import { hargaPerUnit } from "@kakarut/shared";
import { Card } from "../../components/ui";
import { SatuanSelect } from "../../components/SatuanSelect";
import { formatAngka } from "../../lib/format";

/**
 * Satu baris editor bahan baku (nilai numerik sebagai string sampai disimpan).
 * Bentuk yang SAMA dipakai halaman Tambah & Ubah — agar tak ada beda format.
 * `id` hanya terisi di mode Ubah; `pengadaan` menentukan enable/disable field
 * khusus jalur beli (eceran, min beli).
 */
export interface BahanEditorRow {
  id?: string;
  kode: string;
  nama: string;
  pengadaan: "produksi" | "beli";
  satuan_beli: string;
  harga_beli: string;
  satuan: string; // satuan resep/kerja
  isi: string; // satuan resep per 1 satuan beli
  kategori: string;
  boleh_eceran: boolean;
  track_stok: boolean;
  stok_minimum: string;
  min_beli: string;
  is_packaging: boolean;
  is_complement: boolean;
  catatan: string;
  /** rak simpan default (home) di CK; "" = di CK tanpa tempat */
  storage_location_id: string;
}

const cell =
  "rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none";
const thCell = "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500";
const thGrupBelanja =
  "border-l border-emerald-200 bg-emerald-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-emerald-700";
const thGrupResep =
  "border-l border-sky-200 bg-sky-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-sky-700";
const sepKiri = "border-l border-stone-200";

/**
 * Grid editor bahan baku (belanja RAB + aturan resep + atribut), dipakai
 * BERSAMA oleh halaman Tambah & Ubah Bahan Baku. Kolom identik; perbedaan mode:
 * - `showJenis` (Ubah): tampilkan badge Jenis (beli/produksi) — hanya-baca.
 * - `onRemove` (Tambah): tampilkan kolom hapus baris (✕).
 */
export function BahanEditorGrid({
  rows,
  onChange,
  onRemove,
  kategoriList,
  rakCk,
  showJenis = false,
}: {
  rows: BahanEditorRow[];
  onChange: (i: number, patch: Partial<BahanEditorRow>) => void;
  onRemove?: (i: number) => void;
  kategoriList: KategoriDto[];
  rakCk: { id: string; nama: string }[];
  showJenis?: boolean;
}) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[1600px]">
        <thead className="border-b border-stone-200 bg-stone-50">
          <tr>
            <th className={thCell} rowSpan={2}>Kode</th>
            <th className={thCell} rowSpan={2}>Nama *</th>
            {showJenis && (
              <th className={thCell} rowSpan={2}>Jenis</th>
            )}
            <th className={thGrupBelanja} colSpan={2}>🛒 Belanja (RAB)</th>
            <th className={thGrupResep} colSpan={3}>🧪 Aturan resep</th>
            <th className={`${thCell} ${sepKiri}`} rowSpan={2}>Kategori</th>
            <th className={`${thCell} text-center`} rowSpan={2}>Ecer</th>
            <th className={`${thCell} text-center`} rowSpan={2}>Lacak</th>
            <th className={thCell} rowSpan={2}>Stok min</th>
            <th className={thCell} rowSpan={2}>Min beli</th>
            <th className={thCell} rowSpan={2} title="Rak simpan default di Central Kitchen">
              Rak (CK)
            </th>
            <th className={`${thCell} text-center`} rowSpan={2} title="Kemasan take-away">
              TA
            </th>
            <th className={`${thCell} text-center`} rowSpan={2} title="Complement (×0.5 dine-in)">
              Comp
            </th>
            <th className={thCell} rowSpan={2}>Catatan</th>
            {onRemove && <th className="px-2 py-2" rowSpan={2}></th>}
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
              <tr key={b.id ?? i} className="align-middle">
                <td className="px-2 py-1.5">
                  <input
                    value={b.kode}
                    onChange={(e) => onChange(i, { kode: e.target.value })}
                    placeholder="otomatis"
                    className={`${cell} w-20`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={b.nama}
                    onChange={(e) => onChange(i, { nama: e.target.value })}
                    placeholder="Nama bahan"
                    className={`${cell} w-40`}
                  />
                </td>
                {showJenis && (
                  <td className="px-2 py-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                        beli ? "bg-teal-100 text-teal-700" : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {beli ? "Beli" : "Produksi"}
                    </span>
                  </td>
                )}
                <td className={`px-2 py-1.5 ${sepKiri}`}>
                  <SatuanSelect
                    value={b.satuan_beli}
                    onChange={(v) => onChange(i, { satuan_beli: v })}
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
                    onChange={(e) => onChange(i, { harga_beli: e.target.value })}
                    placeholder="0"
                    className={`${cell} w-24`}
                  />
                </td>
                <td className={`px-2 py-1.5 ${sepKiri}`}>
                  <SatuanSelect
                    value={b.satuan}
                    onChange={(v) => onChange(i, { satuan: v })}
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
                      onChange={(e) => onChange(i, { isi: e.target.value })}
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
                    onChange={(e) => onChange(i, { kategori: e.target.value })}
                    className={`${cell} w-28`}
                  >
                    {!kategoriList.some((k) => k.nama === b.kategori) && b.kategori && (
                      <option value={b.kategori}>{b.kategori}</option>
                    )}
                    {kategoriList.map((k) => (
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
                    onChange={(e) => onChange(i, { boleh_eceran: e.target.checked })}
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
                    onChange={(e) => onChange(i, { track_stok: e.target.checked })}
                    title="Lacak stok bahan ini"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={b.stok_minimum}
                    onChange={(e) => onChange(i, { stok_minimum: e.target.value })}
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
                    onChange={(e) => onChange(i, { min_beli: e.target.value })}
                    className={`${cell} w-20`}
                    disabled={!beli}
                    title={
                      beli
                        ? `Minimal belanja (${b.satuan}); 0 = tanpa minimum`
                        : "Hanya untuk bahan jalur beli"
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={b.storage_location_id}
                    onChange={(e) => onChange(i, { storage_location_id: e.target.value })}
                    className={`${cell} w-32`}
                    disabled={rakCk.length === 0}
                    title={
                      rakCk.length === 0
                        ? "Belum ada rak di Central Kitchen (atur di Pengaturan → Penyimpanan)"
                        : "Rak simpan default di CK — barang tiba otomatis diletakkan di sini"
                    }
                  >
                    <option value="">Tanpa tempat</option>
                    {b.storage_location_id &&
                      !rakCk.some((r) => r.id === b.storage_location_id) && (
                        <option value={b.storage_location_id}>(rak tersimpan)</option>
                      )}
                    {rakCk.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nama}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={b.is_packaging}
                    onChange={(e) => onChange(i, { is_packaging: e.target.checked })}
                    title="Kemasan take-away"
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={b.is_complement}
                    onChange={(e) => onChange(i, { is_complement: e.target.checked })}
                    title="Complement (×0.5 dine-in)"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={b.catatan}
                    onChange={(e) => onChange(i, { catatan: e.target.value })}
                    placeholder="—"
                    className={`${cell} w-40`}
                  />
                </td>
                {onRemove && (
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onRemove(i)}
                      className="text-sm font-medium text-red-500 hover:underline disabled:opacity-30"
                      disabled={rows.length <= 1}
                      aria-label="Hapus baris"
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
