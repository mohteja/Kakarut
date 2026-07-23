import { labelCabang, useCabangData } from "../context/BranchContext";

/**
 * Bilah pemilih "cabang data" — tampil hanya saat manajemen bekerja DARI
 * Kantor pada halaman yang datanya per cabang (stok, meja, kasir, dst.).
 * Kantor = pusat: bisa membuka data cabang mana pun tanpa pindah divisi.
 */
export function CabangDataBar({ fokus }: { fokus?: "produksi" | "beli" } = {}) {
  const { id, dariKantor, opsi, pilih } = useCabangData(fokus);
  if (!dariKantor) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-stone-700">
      <span className="text-sm font-medium">
        🏢 Dari Kantor —{" "}
        {fokus === "produksi"
          ? "Central Kitchen"
          : fokus === "beli"
            ? "lokasi pembelian"
            : "data cabang"}
        :
      </span>
      <select
        value={id ?? ""}
        onChange={(e) => pilih(e.target.value)}
        className="h-11 min-w-[240px] flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base font-semibold text-stone-800 focus:border-orange-500 focus:outline-none sm:max-w-sm sm:flex-none"
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
