import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SakelarTampilan, useTampilan } from "../../components/SakelarTampilan";
import { Link, useNavigate } from "react-router-dom";
import type { MenuDto } from "@kakarut/shared";
import {
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { IKON_MENU_KOSONG, KartuMenuKasir } from "../../components/KartuMenuKasir";
import { KategoriManagerModal } from "../../components/KategoriManagerModal";
import { labelCabang, opsiLokasiMenu, useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatRupiah } from "../../lib/format";

/**
 * Bentuk daftar Menu & HPP: tabel angka ("daftar") atau kartu foto ("ikon").
 *
 * Diminta pemilik repo 2026-09-03 dengan tujuan yang ia sebut sendiri — "cek
 * preview foto menu di kasir". Kartunya karena itu BUKAN kartu baru melainkan
 * `KartuMenuKasir` yang sama persis dipakai layar kasir; alasan lengkapnya
 * ditulis di komponen itu.
 *
 * BAWAANNYA `daftar`, dan itu disengaja: tabel adalah bentuk yang sudah ada
 * hari ini, jadi tak ada layar siapa pun yang berubah tanpa ia menekan
 * tombolnya. (`ResepPage` memakai penalaran yang sama untuk bawaannya
 * sendiri — di sana yang lebih dulu ada justru bentuk ikon.)
 *
 * Disimpan per PERANGKAT, bukan per akun: yang menentukan bentuk mana yang
 * berguna adalah layarnya dan pekerjaan hari itu — memeriksa foto menuntut
 * kartu, menyetel harga menuntut baris angka. Satu orang memakai keduanya.
 */
type TampilanMenu = "ikon" | "daftar";
const KUNCI_TAMPILAN = "kakarut.menuTampilan";

/**
 * Food cost dinilai terhadap AMBANG perusahaan (Pengaturan → Perusahaan),
 * bukan angka mati. HPP dihitung live dari harga bahan, jadi menu bisa jatuh
 * ke atas ambang tanpa ada yang mengubah harga jualnya — kalau itu terjadi,
 * tanda ⚠ di sini yang pertama memberi tahu.
 */
function FoodCost({ persen, maks }: { persen: number | null; maks: number }) {
  // null = biaya ditahan server untuk peran ini. Halaman ini memang
  // isManajemen, jadi hari ini tak terjangkau — tapi "—" adalah jawaban yang
  // benar, dan 0% akan terbaca sebagai food cost sempurna.
  if (persen == null) return <span className="text-stone-400">—</span>;
  const lewat = persen > maks;
  const warna = lewat
    ? "text-red-600"
    : persen > maks * 0.85
      ? "text-yellow-600"
      : "text-green-600";
  return (
    <span className={`font-semibold ${warna}`} title={lewat ? `Ambang ${maks}%` : undefined}>
      {lewat && "⚠ "}
      {persen.toFixed(1)}%
    </span>
  );
}

export function MenuListPage() {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const namaCabang = new Map(cabang.map((b) => [b.id, b.nama]));
  const { data: menus, isLoading, error: gagalMuat } = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuDto[]>("/menu"),
  });
  const { data: company } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<{ foodCostMaks: number }>("/company"),
  });
  const foodCostMaks = company?.foodCostMaks ?? 40;

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/menu/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu"] }),
  });

  const navigate = useNavigate();
  const [tampilan, setTampilan] = useTampilan<TampilanMenu>(
    KUNCI_TAMPILAN,
    ["ikon", "daftar"],
    "daftar",
  );
  const [kelolaKategori, setKelolaKategori] = useState(false);
  // Saring "yang fotonya belum ada" — lihat chip di baris bentuk tampilan.
  const [hanyaTanpaFoto, setHanyaTanpaFoto] = useState(false);
  // Lihat menu yang diatur untuk cabang tertentu — tanpa baris pembatasan
  // (branch_ids kosong) berarti tampil di semua lokasi.
  const [lokasi, setLokasi] = useState<string>("all");
  const [cari, setCari] = useState("");
  const [filterKat, setFilterKat] = useState("");
  // Central Kitchen TIDAK berjualan, jadi tak pernah bisa jadi lokasi menu —
  // aturannya tinggal satu rumah, `opsiLokasiMenu`. Baris ini dulu berbunyi
  // `tipe !== "kantor"`, sisa dari sebelum aturan store-only, dan karenanya
  // menawarkan 🏭 Central Kitchen di pemilih "Tampil di lokasi". Memilihnya
  // hanya menyisakan menu ber-`branch_ids` KOSONG — "tanpa pembatasan lokasi"
  // yang terbaca operator sebagai "dijual di Central Kitchen".
  const lokasiOpsi = opsiLokasiMenu(cabang);

  if (isLoading) return <Spinner />;

  const semua = menus ?? [];
  // Chip kategori mengikuti urutan katalog (bukan alfabet) supaya sejajar
  // dengan urutan grup di bawahnya. Diambil dari SELURUH menu, jadi daftar
  // chip tidak menyusut saat mengetik di kotak cari.
  const kategoriList = [...new Set(semua.map((m) => m.kategori))];
  const q = cari.trim().toLowerCase();

  const tampil = semua
    .filter((m) =>
      lokasi === "all" ? true : m.branch_ids.length === 0 || m.branch_ids.includes(lokasi),
    )
    .filter((m) => (filterKat ? m.kategori === filterKat : true))
    .filter((m) =>
      q === ""
        ? true
        : m.nama.toLowerCase().includes(q) || (m.kode ?? "").toLowerCase().includes(q),
    )
    .filter((m) => (hanyaTanpaFoto ? m.image_url == null : true));

  // kelompokkan per kategori mengikuti urutan katalog
  const grup = new Map<string, MenuDto[]>();
  for (const m of tampil) {
    const list = grup.get(m.kategori) ?? [];
    list.push(m);
    grup.set(m.kategori, list);
  }
  const disaring = tampil.length !== semua.length;
  /*
   * Berapa menu yang fotonya belum ada. Dihitung dari himpunan yang lolos
   * saringan LAIN (lokasi/kategori/cari) tapi TIDAK dari saringan foto itu
   * sendiri — kalau ikut, angkanya membeku begitu chipnya ditekan dan chip
   * yang menyala berhenti bisa mengatakan berapa yang tersisa.
   *
   * Dari himpunan tersaring, bukan seluruh katalog, sebab chip ini pintu
   * KERJA: janjinya "klik untuk mengerjakan yang bolong", dan angka yang lebih
   * besar daripada yang bisa dibuka tombolnya adalah janji yang tak ditepati.
   * Penyempitannya sendiri sudah diucapkan judul halaman ("N dari M").
   */
  const tanpaFoto = semua
    .filter((m) =>
      lokasi === "all" ? true : m.branch_ids.length === 0 || m.branch_ids.includes(lokasi),
    )
    .filter((m) => (filterKat ? m.kategori === filterKat : true))
    .filter((m) =>
      q === ""
        ? true
        : m.nama.toLowerCase().includes(q) || (m.kode ?? "").toLowerCase().includes(q),
    )
    .filter((m) => m.image_url == null).length;

  return (
    <div>
      <PageTitle
        aksi={
          <div className="flex items-center gap-2">
            <Link to="/menu/analisis" className={btnSecondary}>
              📊 Analisis Harga
            </Link>
            <button onClick={() => setKelolaKategori(true)} className={btnSecondary}>
              🏷 Kategori
            </button>
            <Link to="/menu/baru" className={btnPrimary}>
              + Tambah Menu
            </Link>
          </div>
        }
      >
        Menu &amp; HPP ({tampil.length}
        {disaring ? ` dari ${semua.length}` : ""})
      </PageTitle>
      <KategoriManagerModal
        open={kelolaKategori}
        onClose={() => setKelolaKategori(false)}
        endpoint="/kategori"
        queryKey="kategori"
        judul="Kategori Menu"
        deskripsi="Kategori untuk mengelompokkan menu. Kategori yang masih dipakai menu tidak bisa dihapus."
      />
      {/* Cari + filter kategori */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="🔍 Cari menu / kode…"
          aria-label="Cari menu"
          className={`${inputClass} max-w-72`}
        />
        {kategoriList.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setFilterKat("")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filterKat === ""
                  ? "bg-orange-600 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              Semua
            </button>
            {kategoriList.map((k) => (
              <button
                key={k}
                onClick={() => setFilterKat(filterKat === k ? "" : k)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  filterKat === k
                    ? "bg-orange-600 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bentuk daftar + pintu "yang fotonya belum ada". Keduanya DI LUAR
          percabangan bentuk: keduanya sifat katalognya, bukan sifat
          tampilannya. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SakelarTampilan
          nilai={tampilan}
          atur={setTampilan}
          opsi={[
            { nilai: "ikon", label: "🔳 Ikon" },
            { nilai: "daftar", label: "☰ Daftar" },
          ]}
        />
        {tampilan === "ikon" && (
          <span className="text-xs text-stone-400">
            Kartunya SAMA PERSIS dengan yang dilihat kasir — termasuk potongan fotonya.
          </span>
        )}
        {/* TIDAK dirender saat bacaannya GAGAL: "0 tanpa foto" di atas daftar
            yang gagal dimuat terbaca sebagai "semua menu sudah berfoto" — jauh
            lebih percaya diri daripada layar kosong di bawahnya, dan salah.
            Aturannya sudah ditulis panjang di `nilai-stok.test.ts`. */}
        {!gagalMuat && (tanpaFoto > 0 || hanyaTanpaFoto) && (
          <button
            onClick={() => setHanyaTanpaFoto((v) => !v)}
            aria-pressed={hanyaTanpaFoto}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              hanyaTanpaFoto
                ? "bg-amber-600 text-white"
                : "bg-amber-100 text-amber-700 hover:bg-amber-200"
            }`}
          >
            {IKON_MENU_KOSONG} {tanpaFoto} tanpa foto
          </button>
        )}
      </div>

      {lokasiOpsi.length > 1 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-stone-600">
          <span>Tampil di lokasi:</span>
          <select
            value={lokasi}
            onChange={(e) => setLokasi(e.target.value)}
            aria-label="Tampil di lokasi"
            className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            <option value="all">Semua lokasi</option>
            {lokasiOpsi.map((b) => (
              <option key={b.id} value={b.id}>
                {labelCabang(b)}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorText error={hapus.error} />

      {tampil.length === 0 && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-stone-400">
          {/*
            GAGAL MEMUAT ≠ BELUM ADA MENU. "Belum ada menu." adalah pernyataan
            tentang katalog, dan halaman ini pintu utama untuk MENAMBAH menu —
            menu ganda lalu ikut ke layar kasir sebagai dua tombol yang sama.
          */}
          {gagalMuat
            ? "Daftar menu gagal dimuat — kosongnya bukan berarti katalognya kosong. Muat ulang dulu."
            : semua.length === 0
            ? "Belum ada menu."
            : `Tidak ada menu yang cocok${q ? ` dengan "${cari.trim()}"` : ""}${
                filterKat ? ` di kategori "${filterKat}"` : ""
              }.`}
        </div>
      )}

      {[...grup.entries()].map(([kategori, list]) => (
        <div key={kategori} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold text-stone-700">{kategori}</h2>
          {tampilan === "ikon" ? (
            /* Grid mengikuti kasir (2 → 3 → 4 kolom): yang harus sama bukan
               cuma kartunya melainkan LEBARNYA, sebab lebar kartu itulah yang
               menentukan bagaimana `object-cover` memotong fotonya. */
            <div className="grid auto-rows-min grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {list.map((m) => (
                <KartuMenuKasir
                  key={m.id}
                  menu={m}
                  onKlik={() => navigate(`/menu/${m.id}/edit`)}
                />
              ))}
            </div>
          ) : (
          <>
          {/* SATU tabel per kategori, ditumpuk — jadi lebar kolomnya harus
              TETAP dan sama di semua tabel (`tetap` + `kelasJudul` w-*), atau
              kepala "HPP" tiap kategori berdiri di x yang berbeda. Kolom
              "Menu" tanpa lebar: ia yang menampung sisanya. */}
          <TabelResponsif
            data={list}
            kunci={(m) => m.id}
            kosong="Belum ada menu di kategori ini."
            tetap
            minLebar="min-w-[76rem]"
            kolom={[
              {
                judul: "Kode",
                hp: "sub",
                kelasJudul: "w-20",
                sel: (m) =>
                  m.kode ? (
                    <span className="inline-block rounded bg-stone-100 px-2 py-0.5 font-mono text-xs font-semibold text-stone-600">
                      {m.kode}
                    </span>
                  ) : (
                    <span className="text-stone-300">—</span>
                  ),
              },
              {
                judul: "Menu",
                hp: "judul",
                kelasSel: "font-medium",
                sel: (m) => (
                  <>
                    {m.nama}
                    {m.tipe === "paket" && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        Paket · dasar: {m.base_menu_nama}
                      </span>
                    )}
                    {m.branch_ids.length > 0 && (
                      <span
                        className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700"
                        title={m.branch_ids.map((bid) => namaCabang.get(bid) ?? "?").join(", ")}
                      >
                        📍 {m.branch_ids.map((bid) => namaCabang.get(bid) ?? "?").join(", ")}
                      </span>
                    )}
                  </>
                ),
              },
              { judul: "HPP", kanan: true, kelasJudul: "w-28", sel: (m) => formatRupiah(m.hpp) },
              {
                judul: "HPP Dine-in",
                kanan: true,
                // turunan HPP: hanya berguna berdampingan dengan kolom lain
                hp: "lewat",
                kelasJudul: "w-32",
                kelasSel: "text-stone-400",
                sel: (m) => formatRupiah(m.hpp_dine_in),
              },
              {
                judul: "Markup",
                kanan: true,
                hp: "lewat",
                kelasJudul: "w-20",
                sel: (m) => (m.tipe === "paket" ? `dasar ×${m.base_mult}` : `×${m.mult}`),
              },
              {
                judul: "Harga Saran",
                kanan: true,
                hp: "lewat",
                kelasJudul: "w-32",
                sel: (m) => formatRupiah(m.harga_saran),
              },
              {
                judul: "Saran Bulat",
                kanan: true,
                hp: "lewat",
                kelasJudul: "w-32",
                sel: (m) => formatRupiah(m.harga_jual_bulat),
              },
              {
                judul: "Harga Jual",
                kanan: true,
                kelasJudul: "w-32",
                kelasSel: "font-bold",
                sel: (m) => formatRupiah(m.harga_jual),
              },
              {
                judul: "Food Cost",
                kanan: true,
                kelasJudul: "w-28",
                sel: (m) => <FoodCost persen={m.food_cost_persen} maks={foodCostMaks} />,
              },
              {
                hp: "aksi",
                kelasJudul: "w-28",
                kelasSel: "whitespace-nowrap text-right",
                sel: (m) => (
                  <>
                    <Link
                      to={`/menu/${m.id}/edit`}
                      className="text-sm font-medium text-orange-600 hover:underline"
                    >
                      Ubah
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm(`Nonaktifkan menu "${m.nama}"?`)) hapus.mutate(m.id);
                      }}
                      className="ml-3 text-sm font-medium text-red-500 hover:underline"
                    >
                      Hapus
                    </button>
                  </>
                ),
              },
            ]}
          />
          </>
          )}
        </div>
      ))}
    </div>
  );
}
