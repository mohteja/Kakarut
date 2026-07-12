import { labelCabang, useCabangData } from "../context/BranchContext";

/**
 * Bilah pemilih "cabang data" — tampil hanya saat manajemen bekerja DARI
 * Kantor pada halaman yang datanya per cabang (stok, meja, kasir, dst.).
 * Kantor = pusat: bisa membuka data cabang mana pun tanpa pindah divisi.
 */
export function CabangDataBar() {
  const { id, dariKantor, opsi, pilih } = useCabangData();
  if (!dariKantor) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-stone-700">
      <span className="font-medium">🏢 Dari Kantor — data cabang:</span>
      <select
        value={id ?? ""}
        onChange={(e) => pilih(e.target.value)}
        className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
        aria-label="Pilih cabang data"
      >
        {opsi.map((b) => (
          <option key={b.id} value={b.id}>
            {labelCabang(b)}
          </option>
        ))}
      </select>
    </div>
  );
}
