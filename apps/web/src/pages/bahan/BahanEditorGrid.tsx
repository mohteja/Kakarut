import type { ReactNode } from "react";
import type { KategoriDto } from "@kakarut/shared";
import { angkaDari } from "@kakarut/shared";
import { hargaPerUnit } from "@kakarut/shared";
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
  /** masa simpan (hari) setelah masuk stok — dasar exp otomatis; 0 = tak diatur */
  masa_simpan: string;
  /** lead time (hari): beli = lama pesanan datang; produksi = lama proses */
  lead_time: string;
  is_packaging: boolean;
  is_complement: boolean;
  catatan: string;
}

const cell =
  "rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none";
const thCell = "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500";
const thGrupBelanja =
  "border-l border-emerald-200 bg-emerald-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-emerald-700";
const thGrupResep =
  "border-l border-sky-200 bg-sky-50 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-sky-700";
const sepKiri = "border-l border-stone-200";
const labelHp = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-400";

/** Satu field berlabel di kartu HP. */
function FieldHp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className={labelHp}>{label}</span>
      {children}
    </div>
  );
}

/**
 * Grid editor bahan baku (belanja RAB + aturan resep + atribut), dipakai
 * BERSAMA oleh halaman Tambah & Ubah Bahan Baku. Kolom identik; perbedaan mode:
 * - `showJenis` (Ubah): tampilkan badge Jenis (beli/produksi) — hanya-baca.
 * - `onRemove` (Tambah): tampilkan kolom hapus baris (✕).
 *
 * Ada 16 kolom, artinya tabelnya butuh ~1560px. Di layar HP itu jauh di luar
 * layar dan hampir semua input tidak terjangkau, jadi di bawah `sm` setiap
 * baris dirender sebagai kartu bertumpuk. Kendali dibuat sekali lewat helper
 * di bawah supaya kedua tata letak tidak bisa berbeda perilaku — helper
 * sengaja fungsi biasa yang mengembalikan JSX (bukan komponen) agar input
 * tidak di-remount dan fokus tidak hilang saat mengetik.
 */
export function BahanEditorGrid({
  rows,
  onChange,
  onRemove,
  kategoriList,
  showJenis = false,
}: {
  rows: BahanEditorRow[];
  onChange: (i: number, patch: Partial<BahanEditorRow>) => void;
  onRemove?: (i: number) => void;
  kategoriList: KategoriDto[];
  showJenis?: boolean;
}) {
  const hpsrDari = (b: BahanEditorRow) =>
    angkaDari(b.harga_beli) > 0 && angkaDari(b.isi) > 0
      ? hargaPerUnit(angkaDari(b.harga_beli), angkaDari(b.isi))
      : null;

  const fKode = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      value={b.kode}
      onChange={(e) => onChange(i, { kode: e.target.value })}
      placeholder="otomatis"
      aria-label={`Kode baris ${i + 1}`}
      className={`${cell} ${lebar}`}
    />
  );

  const fNama = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      value={b.nama}
      onChange={(e) => onChange(i, { nama: e.target.value })}
      placeholder="Nama bahan"
      aria-label={`Nama baris ${i + 1}`}
      className={`${cell} ${lebar}`}
    />
  );

  const badgeJenis = (b: BahanEditorRow) => (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
        b.pengadaan === "beli" ? "bg-teal-100 text-teal-700" : "bg-orange-100 text-orange-700"
      }`}
    >
      {b.pengadaan === "beli" ? "Beli" : "Produksi"}
    </span>
  );

  const fSatuanBeli = (b: BahanEditorRow, i: number, lebar: string) => (
    <SatuanSelect
      value={b.satuan_beli}
      onChange={(v) => onChange(i, { satuan_beli: v })}
      bolehKosong
      selectClassName={`${cell} ${lebar}`}
      aria-label="Satuan beli"
    />
  );

  const fHargaBeli = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      value={b.harga_beli}
      onChange={(e) => onChange(i, { harga_beli: e.target.value })}
      placeholder="0"
      aria-label={`Harga beli baris ${i + 1}`}
      className={`${cell} ${lebar}`}
    />
  );

  const fSatuanResep = (b: BahanEditorRow, i: number, lebar: string) => (
    <SatuanSelect
      value={b.satuan}
      onChange={(v) => onChange(i, { satuan: v })}
      selectClassName={`${cell} ${lebar}`}
      aria-label="Satuan resep"
    />
  );

  const fKonversi = (b: BahanEditorRow, i: number, lebar: string) => (
    <div className="flex items-center gap-1 text-sm whitespace-nowrap text-stone-600">
      <span>1 {b.satuan_beli || "beli"} =</span>
      <input
        type="number"
        min="0.0001"
        step="any"
        inputMode="decimal"
        value={b.isi}
        onChange={(e) => onChange(i, { isi: e.target.value })}
        className={`${cell} ${lebar}`}
        aria-label="Konversi (satuan resep per 1 satuan beli)"
      />
      <span>{b.satuan}</span>
    </div>
  );

  const fKategori = (b: BahanEditorRow, i: number, lebar: string) => (
    <select
      value={b.kategori}
      onChange={(e) => onChange(i, { kategori: e.target.value })}
      aria-label={`Kategori baris ${i + 1}`}
      className={`${cell} ${lebar}`}
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
  );

  const fEcer = (b: BahanEditorRow, i: number) => (
    <input
      type="checkbox"
      checked={b.pengadaan === "beli" ? b.boleh_eceran : false}
      onChange={(e) => onChange(i, { boleh_eceran: e.target.checked })}
      disabled={b.pengadaan !== "beli"}
      aria-label={`Boleh eceran baris ${i + 1}`}
      title={
        b.pengadaan === "beli"
          ? "Bisa dibeli eceran (tanpa pembulatan per satuan beli)"
          : "Hanya untuk bahan jalur beli"
      }
    />
  );

  const fLacak = (b: BahanEditorRow, i: number) => (
    <input
      type="checkbox"
      checked={b.track_stok}
      onChange={(e) => onChange(i, { track_stok: e.target.checked })}
      aria-label={`Lacak stok baris ${i + 1}`}
      title="Lacak stok bahan ini"
    />
  );

  /**
   * Kemasan take away. Bukan atribut kosmetik: inilah satu-satunya sumber
   * `is_packaging`, dan seluruh aturan bawa-pulang bergantung padanya
   * (`qtyEfektif` di @kakarut/shared) — dus dihitung saat pesanan dibawa
   * pulang, dilewati saat makan di tempat. Tanpa satu pun bahan bertanda ini,
   * HPP bawa pulang sebuah menu akan sama dengan HPP dine-in dan biaya
   * dus/box tak pernah masuk laba-rugi.
   */
  const fKemasan = (b: BahanEditorRow, i: number) => (
    <input
      type="checkbox"
      checked={b.is_packaging}
      onChange={(e) => onChange(i, { is_packaging: e.target.checked })}
      aria-label={`Kemasan take away baris ${i + 1}`}
      title="Kemasan take away (dus/box/plastik) — dihitung hanya saat pesanan bawa pulang, dilewati saat makan di tempat"
    />
  );

  const fStokMin = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      value={b.stok_minimum}
      onChange={(e) => onChange(i, { stok_minimum: e.target.value })}
      className={`${cell} ${lebar}`}
      disabled={!b.track_stok}
      aria-label={`Stok minimum baris ${i + 1}`}
    />
  );

  const fMinBeli = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      value={b.pengadaan === "beli" ? b.min_beli : "0"}
      onChange={(e) => onChange(i, { min_beli: e.target.value })}
      className={`${cell} ${lebar}`}
      disabled={b.pengadaan !== "beli"}
      aria-label={`Minimal beli baris ${i + 1}`}
      title={
        b.pengadaan === "beli"
          ? `Minimal belanja (${b.satuan}); 0 = tanpa minimum`
          : "Hanya untuk bahan jalur beli"
      }
    />
  );

  const fMasaSimpan = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      type="number"
      min="0"
      step="1"
      inputMode="numeric"
      value={b.masa_simpan}
      onChange={(e) => onChange(i, { masa_simpan: e.target.value })}
      className={`${cell} ${lebar}`}
      aria-label={`Masa simpan baris ${i + 1}`}
      title="Masa simpan (hari); 0 = tak diatur (exp tidak diisi otomatis)"
    />
  );

  const fLeadTime = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      type="number"
      min="0"
      step="1"
      inputMode="numeric"
      value={b.lead_time}
      onChange={(e) => onChange(i, { lead_time: e.target.value })}
      className={`${cell} ${lebar}`}
      aria-label={`Lead time baris ${i + 1}`}
      title={
        b.pengadaan === "beli"
          ? "Lead time (hari): lama pesanan sampai barang datang"
          : "Lead time (hari): lama proses produksi"
      }
    />
  );

  const fCatatan = (b: BahanEditorRow, i: number, lebar: string) => (
    <input
      value={b.catatan}
      onChange={(e) => onChange(i, { catatan: e.target.value })}
      placeholder="—"
      aria-label={`Catatan baris ${i + 1}`}
      className={`${cell} ${lebar}`}
    />
  );

  const tombolHapus = (i: number) =>
    onRemove && (
      <button
        type="button"
        onClick={() => onRemove(i)}
        className="text-sm font-medium text-red-500 hover:underline disabled:opacity-30"
        disabled={rows.length <= 1}
        aria-label={`Hapus baris ${i + 1}`}
      >
        ✕ Hapus
      </button>
    );

  return (
    <>
      {/* HP: satu kartu per bahan — semua field tetap di dalam layar */}
      <div className="space-y-4 sm:hidden">
        {rows.map((b, i) => {
          const hpsr = hpsrDari(b);
          return (
            <div key={b.id ?? i} className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                  Bahan {i + 1}
                  {showJenis && badgeJenis(b)}
                </div>
                {tombolHapus(i)}
              </div>

              <div className="space-y-3">
                <FieldHp label="Nama *">{fNama(b, i, "w-full")}</FieldHp>
                <div className="grid grid-cols-2 gap-3">
                  <FieldHp label="Kode">{fKode(b, i, "w-full")}</FieldHp>
                  <FieldHp label="Kategori">{fKategori(b, i, "w-full")}</FieldHp>
                </div>

                <fieldset className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2">
                  <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                    🛒 Belanja (RAB)
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    <FieldHp label="Satuan beli">{fSatuanBeli(b, i, "w-full")}</FieldHp>
                    <FieldHp label="Harga beli">{fHargaBeli(b, i, "w-full")}</FieldHp>
                  </div>
                </fieldset>

                <fieldset className="rounded-lg border border-sky-200 bg-sky-50/40 p-2">
                  <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-sky-700">
                    🧪 Aturan resep
                  </legend>
                  <div className="space-y-3">
                    <FieldHp label="Satuan resep">{fSatuanResep(b, i, "w-full")}</FieldHp>
                    <FieldHp label="Konversi">{fKonversi(b, i, "w-20")}</FieldHp>
                    <div className="text-sm text-stone-600">
                      <span className={labelHp}>Harga / satuan resep</span>
                      {hpsr != null ? `Rp ${formatAngka(hpsr, 2)}/${b.satuan}` : "—"}
                    </div>
                  </div>
                </fieldset>

                <div className="grid grid-cols-2 gap-3">
                  <FieldHp label="Stok min">{fStokMin(b, i, "w-full")}</FieldHp>
                  <FieldHp label="Min beli">{fMinBeli(b, i, "w-full")}</FieldHp>
                  <FieldHp label="Masa simpan (hari)">{fMasaSimpan(b, i, "w-full")}</FieldHp>
                  <FieldHp label="Lead time (hari)">{fLeadTime(b, i, "w-full")}</FieldHp>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-stone-700">
                  <label className="flex items-center gap-2">
                    {fEcer(b, i)} Boleh ecer
                  </label>
                  <label className="flex items-center gap-2">
                    {fLacak(b, i)} Lacak stok
                  </label>
                  <label className="flex items-center gap-2">
                    {fKemasan(b, i)} 🥡 Kemasan TA
                  </label>
                </div>

                <FieldHp label="Catatan">{fCatatan(b, i, "w-full")}</FieldHp>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: grid seperti semula */}
      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm sm:block">
        <table className="w-full min-w-[1560px]">
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
              <th
                className={`${thCell} text-center`}
                rowSpan={2}
                title="Kemasan take away (dus/box/plastik) — dihitung hanya saat pesanan bawa pulang, dilewati saat makan di tempat"
              >
                🥡 Kemasan TA
              </th>
              <th className={thCell} rowSpan={2}>Stok min</th>
              <th className={thCell} rowSpan={2}>Min beli</th>
              <th
                className={thCell}
                rowSpan={2}
                title="Masa simpan (hari) setelah masuk stok — dasar tanggal exp otomatis; 0 = tak diatur"
              >
                Masa simpan (hr)
              </th>
              <th
                className={thCell}
                rowSpan={2}
                title="Lead time (hari): beli = lama pesanan datang; produksi = lama proses — pesan/buat jauh-jauh hari"
              >
                Lead time (hr)
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
              const hpsr = hpsrDari(b);
              return (
                <tr key={b.id ?? i} className="align-middle">
                  <td className="px-2 py-1.5">{fKode(b, i, "w-20")}</td>
                  <td className="px-2 py-1.5">{fNama(b, i, "w-40")}</td>
                  {showJenis && <td className="px-2 py-1.5">{badgeJenis(b)}</td>}
                  <td className={`px-2 py-1.5 ${sepKiri}`}>{fSatuanBeli(b, i, "w-24")}</td>
                  <td className="px-2 py-1.5">{fHargaBeli(b, i, "w-24")}</td>
                  <td className={`px-2 py-1.5 ${sepKiri}`}>{fSatuanResep(b, i, "w-24")}</td>
                  <td className="px-2 py-1.5">{fKonversi(b, i, "w-24")}</td>
                  <td className="px-2 py-1.5 text-right text-sm text-stone-600 whitespace-nowrap">
                    {hpsr != null ? `Rp ${formatAngka(hpsr, 2)}/${b.satuan}` : "—"}
                  </td>
                  <td className={`px-2 py-1.5 ${sepKiri}`}>{fKategori(b, i, "w-28")}</td>
                  <td className="px-2 py-1.5 text-center">{fEcer(b, i)}</td>
                  <td className="px-2 py-1.5 text-center">{fLacak(b, i)}</td>
                  <td className="px-2 py-1.5 text-center">{fKemasan(b, i)}</td>
                  <td className="px-2 py-1.5">{fStokMin(b, i, "w-20")}</td>
                  <td className="px-2 py-1.5">{fMinBeli(b, i, "w-20")}</td>
                  <td className="px-2 py-1.5">{fMasaSimpan(b, i, "w-20")}</td>
                  <td className="px-2 py-1.5">{fLeadTime(b, i, "w-20")}</td>
                  <td className="px-2 py-1.5">{fCatatan(b, i, "w-40")}</td>
                  {onRemove && (
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => onRemove(i)}
                        className="text-sm font-medium text-red-500 hover:underline disabled:opacity-30"
                        disabled={rows.length <= 1}
                        aria-label={`Hapus baris ${i + 1}`}
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
      </div>
    </>
  );
}
