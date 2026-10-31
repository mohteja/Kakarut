import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { BahanDto, KaryawanRow, MenuDto, StokAwalTersimpan } from "@kakarut/shared";
import { useAuth } from "../context/AuthContext";
import { useCabangData } from "../context/BranchContext";
import { api } from "../lib/api";
import { bacaLokal, tulisLokal } from "../lib/simpanan";

const KUNCI_TUTUP = "kakarut.panduan-awal-tutup";

/**
 * PANDUAN AWAL — kartu langkah pertama di Beranda owner/admin.
 *
 * Laporan uji 31 Okt 2026: akun Pro yang masih kosong tak diberi satu pun
 * petunjuk harus mulai dari mana. Kartu ini menyebut empat langkah yang
 * membuat kasir bisa berjualan (bahan → menu → kasir → stok awal), mencentang
 * yang sudah selesai dari data sungguhan, dan hilang sendiri begitu keempatnya
 * beres — atau saat ditutup (diingat per perusahaan di peramban ini).
 */
export function PanduanAwal() {
  const { auth } = useAuth();
  const companyId = auth?.company?.id ?? "-";
  const kunci = `${KUNCI_TUTUP}:${companyId}`;
  const [tutup, setTutup] = useState(() => bacaLokal(kunci) === "1");
  const aktif = !tutup && (auth?.user.role === "owner" || auth?.user.role === "admin");

  // Stok awal milik cabang yang sedang dikelola (sama dengan halaman Stok Awal).
  const { query: branchQuery } = useCabangData();
  const { data: bahan, error: galatBahan } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
    enabled: aktif,
  });
  const { data: menu, error: galatMenu } = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuDto[]>("/menu"),
    enabled: aktif,
  });
  const { data: karyawan, error: galatKaryawan } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<KaryawanRow[]>("/karyawan"),
    enabled: aktif,
  });
  const { data: stokAwal, error: galatStokAwal } = useQuery({
    queryKey: ["stok-awal", branchQuery],
    queryFn: () => api<StokAwalTersimpan>(`/stok/awal${branchQuery}`),
    enabled: aktif,
  });

  // Gagal dimuat ≠ "belum dikerjakan": kartu tak ditampilkan sama sekali
  // daripada mencentang langkah yang salah atau menyuruh mengulang yang sudah.
  if (galatBahan || galatMenu || galatKaryawan || galatStokAwal) return null;
  if (!aktif || !bahan || !menu || !karyawan || !stokAwal) return null;
  const langkah = [
    { selesai: bahan.length > 0, teks: "Tambah bahan baku", ke: "/bahan/baru" },
    { selesai: menu.length > 0, teks: "Buat menu & resep", ke: "/menu/baru" },
    {
      selesai: karyawan.some((k) => k.role === "cashier"),
      teks: "Tambah karyawan kasir",
      ke: "/pengaturan/karyawan",
    },
    { selesai: stokAwal.items.length > 0, teks: "Isi stok awal", ke: "/stok/awal" },
  ];
  if (langkah.every((l) => l.selesai)) return null;
  const sisa = langkah.filter((l) => !l.selesai).length;

  return (
    <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4" data-testid="panduan-awal">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-stone-800">🚀 Langkah awal</div>
          <div className="text-xs text-stone-500">{sisa} langkah lagi sampai kasir siap berjualan.</div>
        </div>
        <button
          type="button"
          onClick={() => {
            tulisLokal(kunci, "1");
            setTutup(true);
          }}
          className="text-xs text-stone-500 hover:text-stone-700"
          aria-label="Tutup panduan awal"
        >
          ✕
        </button>
      </div>
      <ol className="space-y-1.5">
        {langkah.map((l, i) => (
          <li key={l.teks} className="flex items-center gap-2 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                l.selesai ? "bg-green-600 text-white" : "bg-white text-stone-500 ring-1 ring-stone-300"
              }`}
            >
              {l.selesai ? "✓" : i + 1}
            </span>
            {l.selesai ? (
              <span className="text-stone-400 line-through">{l.teks}</span>
            ) : (
              <Link to={l.ke} className="font-medium text-orange-700 hover:underline">
                {l.teks} →
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
