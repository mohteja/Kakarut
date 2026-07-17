import { useEffect, useRef, useState } from "react";
import type { BahanDto } from "@kakarut/shared";
import { formatAngka } from "../lib/format";
import { inputClass } from "./ui";

interface BahanPickerProps {
  /** pilihan bahan (pemanggil boleh pra-filter, mis. resep = beli saja) */
  bahan: BahanDto[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** kelas untuk pembungkus (mis. "flex-1") */
  className?: string;
  /** label saat value terisi tapi bahannya tak ada di daftar (nonaktif) */
  nonaktifLabel?: string;
}

function labelBahan(b: BahanDto): string {
  return `${b.nama} — Rp ${formatAngka(b.harga_per_unit, 2)}/${b.satuan}`;
}

/**
 * Pemilih bahan yang bisa DICARI dan DIKELOMPOKKAN (Produksi sendiri vs Bahan
 * baku) — pengganti <select> polos di form Menu & Resep agar mudah menemukan
 * bahan saat daftarnya panjang. Cocokkan nama atau kode.
 */
export function BahanPicker({
  bahan,
  value,
  onChange,
  placeholder = "— pilih bahan —",
  disabled,
  className,
  nonaktifLabel = "(bahan nonaktif)",
}: BahanPickerProps) {
  const [open, setOpen] = useState(false);
  const [cari, setCari] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const terpilih = bahan.find((b) => b.id === value);

  const q = cari.trim().toLowerCase();
  const cocok = (b: BahanDto) =>
    !q || b.nama.toLowerCase().includes(q) || (b.kode ?? "").toLowerCase().includes(q);
  const urut = (a: BahanDto, b: BahanDto) => a.nama.localeCompare(b.nama);
  const produksi = bahan.filter((b) => b.pengadaan === "produksi" && cocok(b)).sort(urut);
  const bakuBeli = bahan.filter((b) => b.pengadaan === "beli" && cocok(b)).sort(urut);
  const adaHasil = produksi.length + bakuBeli.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      clearTimeout(t);
    };
  }, [open]);

  const pilih = (id: string) => {
    onChange(id);
    setOpen(false);
    setCari("");
  };

  const grup = (judul: string, ikon: string, list: BahanDto[]) =>
    list.length === 0 ? null : (
      <div>
        <div className="bg-stone-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
          {ikon} {judul} ({list.length})
        </div>
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pilih(b.id)}
            className={`block w-full px-3 py-2 text-left text-sm hover:bg-orange-50 ${
              b.id === value ? "bg-orange-100 font-medium" : ""
            }`}
          >
            {b.nama}
            <span className="ml-1 text-xs text-stone-400">
              Rp {formatAngka(b.harga_per_unit, 2)}/{b.satuan}
            </span>
          </button>
        ))}
      </div>
    );

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex w-full items-center justify-between text-left ${
          disabled ? "cursor-not-allowed opacity-60" : ""
        }`}
      >
        <span className={terpilih ? "truncate" : "truncate text-stone-400"}>
          {terpilih ? labelBahan(terpilih) : value ? nonaktifLabel : placeholder}
        </span>
        <span className="ml-2 shrink-0 text-stone-400">▾</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          <div className="sticky top-0 border-b border-stone-100 bg-white p-2">
            <input
              ref={inputRef}
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter") {
                  e.preventDefault();
                  const pertama = produksi[0] ?? bakuBeli[0];
                  if (pertama) pilih(pertama.id);
                }
              }}
              placeholder="Cari bahan…"
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
              aria-label="Cari bahan"
            />
          </div>
          {grup("Produksi sendiri", "🏭", produksi)}
          {grup("Bahan baku", "🛒", bakuBeli)}
          {!adaHasil && (
            <div className="px-3 py-4 text-center text-sm text-stone-400">
              Tidak ada bahan yang cocok.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
