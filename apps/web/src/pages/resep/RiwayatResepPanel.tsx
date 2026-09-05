import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { JejakBahanDto, JejakBahanRow, JenisJejakBahan } from "@kakarut/shared";
import { ErrorText, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

/**
 * RIWAYAT RESEP & HARGA — panel di bawah resep, di kedua mode.
 *
 * Lahir dari satu pertanyaan yang tak terjawab di layar ini: kotak persetujuan
 * harga berbunyi "Rp 60.570 → Rp 50.350", dan tak ada apa pun yang menerangkan
 * dari mana Rp 60.570 datang atau kapan biaya resepnya bergeser. Yang paling
 * sering menggesernya bukan orang yang membuka layar ini, melainkan satu bahan
 * penyusun yang harganya berubah di tempat lain — laporan harga nota, impor
 * daftar harga supplier, atau suntingan manual di halaman Bahan.
 *
 * DI KEDUA MODE, dan itu bagian dari permintaannya: riwayat yang cuma muncul
 * saat mengedit tak bisa dipakai untuk MEMUTUSKAN apakah perlu mengedit.
 */

const LABEL_JENIS: Record<JenisJejakBahan, { ikon: string; teks: string; gaya: string }> = {
  buat: { ikon: "🆕", teks: "Dibuat", gaya: "bg-stone-100 text-stone-600" },
  resep: { ikon: "📝", teks: "Resep", gaya: "bg-blue-100 text-blue-700" },
  harga_sendiri: { ikon: "🏷", teks: "Harga bahan ini", gaya: "bg-amber-100 text-amber-800" },
  harga_bahan: { ikon: "🧮", teks: "Harga penyusun", gaya: "bg-violet-100 text-violet-700" },
};

/**
 * Dari pintu mana — ditulis HANYA saat menambah keterangan.
 *
 * "resep" pada baris berjenis `resep` cuma mengulang lencana di sebelahnya, dan
 * kalimat yang mengulang dirinya sendiri membuat orang berhenti membacanya.
 */
const LABEL_SEBAB: Record<string, string> = {
  manual: "diubah manual",
  impor: "dari impor CSV",
  laporan_harga: "dari laporan harga nota",
  resep: "saat menyimpan resep",
};

/** "Rp 12.000 → Rp 12.500" bila keduanya ada; null bila tak ada yang bergerak. */
function panah(lama: number | null, baru: number | null): string | null {
  if (lama == null && baru == null) return null;
  if (lama == null) return formatRupiah(baru);
  if (baru == null) return formatRupiah(lama);
  if (Math.abs(lama - baru) < 0.005) return null;
  return `${formatRupiah(lama)} → ${formatRupiah(baru)}`;
}

function BarisJejak({ r }: { r: JejakBahanRow }) {
  const label = LABEL_JENIS[r.jenis] ?? {
    ikon: "•",
    teks: r.jenis,
    gaya: "bg-stone-100 text-stone-600",
  };
  const harga = panah(r.harga_lama, r.harga_baru);
  const biaya = panah(r.biaya_lama, r.biaya_baru);
  // Lencana sudah menyebut jenisnya; sebab hanya ditulis bila ia menambah
  // sesuatu yang belum terbaca dari lencana itu.
  const sebab = r.jenis === "resep" ? null : LABEL_SEBAB[r.sebab];
  return (
    <li className="border-t border-stone-100 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
        <span className={`rounded px-1.5 py-0.5 font-medium ${label.gaya}`}>
          {label.ikon} {label.teks}
        </span>
        <span>
          {formatTanggalRingkas(r.created_at)} · {formatWaktu(r.created_at)}
        </span>
        {r.oleh && <span>· {r.oleh}</span>}
        {sebab && <span>· {sebab}</span>}
      </div>
      <div className="mt-1 text-sm text-stone-700">{r.detail}</div>
      {(harga || biaya) && (
        <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs">
          {harga && (
            <span className="text-amber-800">
              Harga tersimpan <b>{harga}</b>
            </span>
          )}
          {biaya && (
            <span className="text-violet-800">
              Biaya per batch <b>{biaya}</b>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function RiwayatResepPanel({
  ingredientId,
  bolehLihat,
}: {
  ingredientId: string;
  /**
   * owner/admin saja — keputusan pemilik, dan sejalan dengan layar yang
   * memuatnya: angka biaya di halaman Resep memang sudah ditahan dari
   * tim/kitchen/bar, dan riwayat yang menyebut rupiah di tiap barisnya
   * membuka kembali persis yang ditutup di sana. Rutenya `requireRole` juga —
   * ini penjaga kedua, bukan satu-satunya.
   */
  bolehLihat: boolean;
}) {
  const [buka, setBuka] = useState(true);
  const {
    data,
    isLoading,
    error: gagalMuat,
  } = useQuery({
    queryKey: ["riwayat-resep", ingredientId],
    queryFn: () => api<JejakBahanDto>(`/bahan/${ingredientId}/riwayat-resep`),
    enabled: bolehLihat && buka,
  });
  if (!bolehLihat) return null;
  return (
    <div className="mt-4 rounded-lg border border-stone-200 p-3">
      <button
        type="button"
        onClick={() => setBuka((v) => !v)}
        aria-expanded={buka}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-stone-700"
      >
        <span>🕘 Riwayat resep &amp; harga</span>
        <span className="text-xs font-normal text-stone-400">{buka ? "Sembunyikan" : "Lihat"}</span>
      </button>
      {buka && (
        <div className="mt-2">
          {/*
            Urutan penting: GAGAL diperiksa SEBELUM kosong. Daftar yang gagal
            dimuat dan daftar yang memang kosong terlihat sama persis, dan
            "belum ada perubahan tercatat" di atas bacaan yang gagal terbaca
            sebagai jaminan bahwa resep ini tak pernah disentuh siapa pun.
          */}
          {gagalMuat ? (
            <ErrorText error={gagalMuat} />
          ) : isLoading ? (
            <Spinner />
          ) : (data?.rows.length ?? 0) === 0 ? (
            <p className="text-sm text-stone-400">
              Belum ada perubahan tercatat. Riwayat mulai dikumpulkan sejak fitur ini
              tayang — perubahan yang lebih tua tidak pernah tersimpan di mana pun, jadi
              tak bisa ditampilkan surut.
            </p>
          ) : (
            <>
              <ul>
                {data!.rows.map((r) => (
                  <BarisJejak key={r.id} r={r} />
                ))}
              </ul>
              {data!.terpotong && (
                <p className="mt-2 text-xs text-stone-400">
                  Menampilkan {data!.rows.length} perubahan terbaru — masih ada yang lebih
                  lama.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
