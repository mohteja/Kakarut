import type { MenuDto, MenuStokDto } from "@kakarut/shared";
import { formatRupiah } from "../lib/format";

/**
 * Lambang menu tanpa foto — SATU rumah.
 *
 * Diketik terpisah di tiga tempat sampai 2026-09-03: kartu kasir, daftar menu
 * cetak (`LihatMenuPage`), dan `placeholder` kotak unggah di formulir menu.
 * Ketiganya menjanjikan hal yang sama kepada orang yang sama — "di sinilah
 * fotonya akan muncul" — jadi ketiganya harus berubah bersama-sama saat
 * lambangnya diganti. Markupnya sengaja TIDAK ikut dibagi: bentuknya memang
 * beda (kartu kasir `h-20` penuh lebar, daftar cetak `h-8 w-8`), dan memaksa
 * satu markup untuk tiga ukuran menghasilkan komponen berparameter yang lebih
 * sulit dibaca daripada tiga markup pendek.
 */
export const IKON_MENU_KOSONG = "🍜";

/**
 * KARTU MENU DI LAYAR KASIR — dan sekarang juga pratinjaunya di Menu & HPP.
 *
 * SATU komponen, dua layar, dan itu bukan kerapian melainkan syarat kebenaran.
 * Pemilik repo meminta tampilan ikon di Menu & HPP dengan tujuan yang ia sebut
 * sendiri: "cek preview foto menu di kasir". Pratinjau yang cuma MIRIP kartu
 * kasir akan menyimpang pelan-pelan, dan yang menyimpang lebih dulu justru
 * satu-satunya hal yang orang membuka halaman itu untuk memeriksanya —
 * potongan fotonya (`object-cover` pada kotak `h-20` memotong sisi panjang).
 * Pratinjau yang keliru soal potongan membuat orang mengunggah ulang foto yang
 * sebenarnya sudah benar. Maka kelas fotonya hidup di SATU tempat, dan
 * `menu-tampilan-ikon.test.ts` menolak salinan keduanya.
 *
 * `<button>`, bukan `<Link>`, walau di Menu & HPP tujuannya berpindah halaman:
 * elemen yang berbeda merender pohon dan gaya bawaan yang berbeda, dan saat
 * itu terjadi pratinjaunya berhenti setara dengan aslinya. Pemanggilnya yang
 * memutuskan apa arti "diklik".
 *
 * `stok` OPSIONAL, dan ketiadaannya disengaja. Sisa porsi adalah angka
 * PER-CABANG (`GET /menu/ketersediaan?branch_id=…`); Menu & HPP bukan layar
 * per-cabang dan tak menariknya. `StokBadge` memulangkan `null` saat porsinya
 * tak diketahui, jadi yang terjadi bukan lencana kosong melainkan tak ada
 * lencana — jauh lebih baik daripada "Sisa 0" yang dikarang untuk cabang yang
 * tak pernah dipilih siapa pun.
 */
export function KartuMenuKasir({
  menu,
  stok,
  onKlik,
}: {
  menu: MenuDto;
  stok?: MenuStokDto;
  onKlik: () => void;
}) {
  return (
    <button
      onClick={onKlik}
      className="flex flex-col rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-orange-400 hover:shadow"
    >
      {menu.image_url ? (
        <img
          src={menu.image_url}
          alt={menu.nama}
          className="mb-2 h-20 w-full rounded-lg object-cover"
        />
      ) : (
        <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg bg-orange-50 text-2xl">
          {IKON_MENU_KOSONG}
        </div>
      )}
      <div className="flex items-start gap-1.5">
        {menu.kode && (
          <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[11px] font-bold leading-tight text-orange-700">
            {menu.kode}
          </span>
        )}
        <div className="line-clamp-2 text-sm font-semibold text-stone-800">{menu.nama}</div>
      </div>
      {/* Isi menu — kasir bisa langsung menjawab "isinya apa?" */}
      {menu.deskripsi && (
        <div className="line-clamp-2 pt-0.5 text-[11px] leading-snug text-stone-500">
          {menu.deskripsi}
        </div>
      )}
      {/* Sisa porsi di bawah nama menu — kasir bisa infokan ke konsumen */}
      <div className="pt-0.5">
        <StokBadge stok={stok} />
      </div>
      <div className="mt-auto pt-1 text-sm font-bold text-orange-600">
        {formatRupiah(menu.harga_jual)}
      </div>
    </button>
  );
}

/**
 * Lencana sisa porsi. `undefined` → tak merender apa pun (lihat catatan `stok`
 * di atas); 0 atau kurang → "Habis" beserta bahan pembatasnya bila server
 * menyebutkannya, sebab "kenapa habis?" adalah pertanyaan berikutnya dan
 * jawabannya sudah ada di tangan.
 */
export function StokBadge({
  stok,
  size = "md",
}: {
  stok: MenuStokDto | undefined;
  size?: "sm" | "md";
}) {
  const porsi = stok?.porsi;
  if (porsi == null) return null;
  const kecil = size === "sm";
  const base = kecil ? "text-[9px] leading-none" : "text-[11px]";
  if (porsi <= 0) {
    // bahan pembatas = bahan resep yang saldonya 0 di cabang ini → sumber "Habis".
    const kurang = stok?.pembatas?.nama;
    return (
      <span
        className={`font-semibold text-red-600 ${base}`}
        title={kurang ? `Habis — bahan "${kurang}" kosong di cabang ini` : "Habis"}
      >
        Habis{kurang && !kecil ? ` · ${kurang}` : ""}
      </span>
    );
  }
  const warna = porsi <= 5 ? "text-orange-600" : "text-emerald-600";
  return <span className={`font-medium ${warna} ${base}`}>Sisa {porsi}</span>;
}
