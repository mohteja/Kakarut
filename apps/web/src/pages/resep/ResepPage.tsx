import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SakelarTampilan, useTampilan } from "../../components/SakelarTampilan";
import { Link, useSearchParams } from "react-router-dom";
import type {
  BahanDto,
  BahanKategori,
  BahanLangkahRow,
  BahanResepRow,
  KategoriDto,
  MenuDto,
  SatuanDto,
} from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { BahanPicker } from "../../components/BahanPicker";
import { ImageUpload } from "../../components/ImageUpload";
import { SatuanSelect } from "../../components/SatuanSelect";
import { TabelResponsif, type KolomTabel } from "../../components/TabelResponsif";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

/** Baris editor resep (bahan mentah per 1 batch bahan jadi). */
interface ResepDraft {
  ingredient_id: string;
  qty: string;
}

/** Draft satu langkah cara masak (editor lokal — id server tak dibawa). */
interface LangkahDraft {
  /**
   * Identitas SISI KLIEN saja — tak pernah ikut ke server (`simpan` me-map
   * ulang jadi `{teks, foto_url}`).
   *
   * Ada karena langkah bisa DIURUT ULANG (↑/↓) dan DIHAPUS, sementara
   * `ImageUpload` mengunggah secara asinkron. Tanpa identitas, satu-satunya
   * pegangan adalah indeks — dan indeks berpindah makna di tengah unggahan.
   */
  _id: string;
  teks: string;
  foto_url: string | null;
}

let urutLangkah = 0;
const idLangkah = () => `l${++urutLangkah}`;

/**
 * Ubah SATU langkah berdasarkan identitasnya, dari state terbaru.
 *
 * Dua hal sekaligus, dan keduanya perlu:
 * - bentuk fungsional `(prev) => …` membaca state TERBARU, bukan snapshot yang
 *   tertangkap saat render. Callback `ImageUpload` bisa mendarat detik-detik
 *   kemudian; dengan snapshot lama ia menulis ulang seluruh array dan
 *   MENGHAPUS semua yang diketik sejak unggahan dimulai.
 * - dicari lewat `_id`, bukan indeks. Menekan ↑ selagi foto diunggah menggeser
 *   arti indeks itu, jadi fotonya mendarat di langkah yang salah.
 */
function ubahLangkah(
  setLangkah: React.Dispatch<React.SetStateAction<LangkahDraft[]>>,
  id: string,
  ubah: (l: LangkahDraft) => LangkahDraft,
) {
  setLangkah((prev) => prev.map((l) => (l._id === id ? ubah(l) : l)));
}

/**
 * Form buat bahan jadi (produksi) baru — cukup kode/nama/kategori.
 * Batch, harga (overhead), dan stok minimum diatur di bawah resep.
 */
interface BahanBaruForm {
  kode: string;
  nama: string;
  kategori: BahanKategori;
}

/** Pengaturan batch & harga bahan produksi terpilih (diedit di bawah resep). */
interface PengaturanBatch {
  isi: string; // hasil per 1 batch
  satuan: string;
  overhead: string; // pengali biaya resep → harga per batch (1 = mengikuti resep)
  stokMin: string; // ambang menipis di Central Kitchen
  stokMinToko: string; // ambang menipis di toko
  /** masa simpan hasil produksi (hari) → dasar exp otomatis saat masuk stok */
  masaSimpan: string;
  /** lama proses produksi (hari) → "buat H-n" agar dibuat jauh-jauh hari */
  leadTime: string;
  /** lokasi produksi: "ck" (Central Kitchen) atau "cabang" (kitchen/bar toko) */
  produksiDi: "ck" | "cabang";
  /** divisi produksi di cabang: role kitchen atau bar yang mengerjakan */
  divisiProduksi: "kitchen" | "bar";
  /** cabang produsen saat "cabang" (kosong = semua cabang store) */
  produksiBranchIds: string[];
}

/** Filter grid resep per lokasi/divisi produksi. */
type FilterResep = "semua" | "ck" | "kitchen" | "bar";

/**
 * Bentuk daftar resep: kartu foto ("ikon") atau baris padat ("daftar").
 *
 * Disimpan per perangkat, bukan per akun: yang menentukan bentuk mana yang
 * enak dipakai adalah LAYARNYA — tablet dapur yang disentuh dengan tangan
 * berminyak butuh kartu besar, laptop kantor yang menyunting puluhan resep
 * butuh baris. Satu orang bisa memakai keduanya di hari yang sama.
 */
type TampilanResep = "ikon" | "daftar";
const KUNCI_TAMPILAN = "kakarut.resepTampilan";

const MAKS_LANGKAH = 30;

/** Badge lokasi/divisi resep — dipakai kartu grid & judul detail. */
function BadgeDivisi({ b }: { b: BahanDto }) {
  if (b.produksi_di === "cabang") {
    return (
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
          b.divisi_produksi === "bar"
            ? "bg-cyan-100 text-cyan-800"
            : "bg-amber-100 text-amber-800"
        }`}
      >
        {b.divisi_produksi === "bar" ? "🍹 Bar" : "🍳 Kitchen"}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">
      🏭 CK
    </span>
  );
}

/**
 * Kolom bentuk DAFTAR resep (tabel berkepala). Urutannya diminta pemilik repo:
 * No · Kode · Nama produk · Harga / produksi · Hasil · Satuan hasil ·
 * Harga / satuan · Bahan baku · Lokasi produksi.
 *
 * Uang hanya owner/admin: kolomnya TIDAK DIBANGUN sama sekali untuk peran lain
 * — sejalan dengan server yang sudah mengirim null (`saringBahan`).
 * `harga_per_unit` dibaca apa adanya dari DTO (dihitung server lewat
 * `hargaPerUnit`), tidak dibagi ulang di sini.
 *
 * Di luar komponen supaya bebas hook dan bisa diiris uji statis
 * (`resep-daftar-tabel.test.ts`).
 */
function kolomDaftarResep(opsi: {
  bolehUbah: boolean;
  ringkas: Record<string, number> | undefined;
}): KolomTabel<BahanDto>[] {
  const { bolehUbah, ringkas } = opsi;
  const angka = "whitespace-nowrap tabular-nums";
  return [
    {
      judul: "No",
      kanan: true,
      hp: "lewat",
      kelasJudul: "w-10",
      kelasSel: "text-stone-400 tabular-nums",
      sel: (_, i) => i + 1,
    },
    {
      judul: "Kode",
      hp: "sub",
      kelasSel: "whitespace-nowrap font-mono text-xs text-stone-500",
      sel: (b) => b.kode ?? "—",
    },
    {
      judul: "Nama produk",
      hp: "judul",
      kelasSel: "font-medium text-stone-800",
      sel: (b) => b.nama,
    },
    ...(bolehUbah
      ? [
          {
            judul: "Harga / produksi",
            kanan: true,
            kelasSel: `${angka} font-semibold text-stone-700`,
            sel: (b: BahanDto) => formatRupiah(b.harga_beli),
          },
        ]
      : []),
    {
      judul: "Hasil",
      kanan: true,
      kelasSel: angka,
      // di kartu HP kolom Satuan dilewati, jadi satuannya menempel di sini
      sel: (b) => (
        <>
          {formatAngka(b.isi)} <span className="text-stone-400 sm:hidden">{b.satuan}</span>
        </>
      ),
    },
    { judul: "Satuan hasil", hp: "lewat", kelasSel: "text-stone-600", sel: (b) => b.satuan },
    ...(bolehUbah
      ? [
          {
            judul: "Harga / satuan",
            kanan: true,
            kelasSel: angka,
            sel: (b: BahanDto) => formatRupiah(b.harga_per_unit),
          },
        ]
      : []),
    {
      judul: "Bahan baku",
      kanan: true,
      kelasSel: angka,
      sel: (b) => {
        // peta hanya berisi bahan yang PUNYA komponen — absen berarti 0 (belum
        // ada resep); null hanya selagi peta belum termuat.
        const n = ringkas ? (ringkas[b.id] ?? 0) : null;
        return <span>{n == null ? "—" : n > 0 ? formatAngka(n) : "belum ada resep"}</span>;
      },
    },
    { judul: "Lokasi produksi", hp: "sub", sel: (b) => <BadgeDivisi b={b} /> },
  ];
}

/**
 * Halaman Resep Produksi: GRID KARTU (thumbnail foto bahan jadi + badge
 * lokasi/divisi + filter chips) → klik kartu membuka DETAIL (?bahan=<id>):
 * editor resep (BOM), CARA MASAK berlangkah + foto proses, foto bahan jadi &
 * cara packing, dan pengaturan batch. Owner/admin bisa mengubah; kitchen,
 * bar, dan tim hanya melihat (resep + cara masak, tanpa harga).
 */
export function ResepPage() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const role = auth?.user.role;
  /**
   * BOLEH mengubah (peran) — TERPISAH dari SEDANG mengubah (mode layar).
   *
   * `bolehUbah` juga menjaga hal yang bukan penyuntingan: kolom uang di daftar,
   * harga per satuan di baris bahan, tab Arsip. Itu soal "boleh melihat angka
   * manajemen", bukan "boleh mengetik" — jadi keduanya tak boleh dipadatkan
   * jadi satu bendera.
   */
  const bolehUbah = role === "owner" || role === "admin";
  /*
   * KLIK RESEP = BACA SAJA, atas permintaan pemilik repo (2026-09-04).
   *
   * Sebelumnya panel detail langsung bisa diketik begitu resepnya diklik, jadi
   * satu klik nyasar di medan takaran sudah cukup mengubah HPP tanpa niat.
   * Sekarang keadaan DIAM halaman ini selalu terkunci; mengetik menuntut satu
   * tindakan sadar lebih dulu.
   */
  const [mode, setMode] = useState<"lihat" | "ubah">("lihat");
  const sedangUbah = bolehUbah && mode === "ubah";
  /*
   * Potret draf saat mode ubah DIBUKA — bukan saat draf disemai.
   *
   * Yang ingin diketahui bukan "draf ini beda dari server?" melainkan "ada yang
   * diketik SEJAK menekan Edit?". Keduanya berbeda: draf bisa saja sudah
   * berbeda dari server karena pembulatan saat disemai, dan bertanya "buang
   * perubahan?" pada orang yang tak mengubah apa pun adalah cara tercepat
   * membuat konfirmasi itu diabaikan.
   */
  const cadanganDraf = useRef<string | null>(null);
  // daftar cabang toko aktif — pilihan "cabang produsen" saat produksi di cabang
  const { cabang } = useBranch();
  const cabangStore = cabang.filter((b) => b.is_active && b.tipe === "store");

  // Bawaannya `ikon` — bentuk yang sudah ada sebelum tombol ini, jadi tak ada
  // yang berubah bagi pemakai yang tak menyentuhnya.
  const [tampilan, setTampilan] = useTampilan<TampilanResep>(
    KUNCI_TAMPILAN,
    ["ikon", "daftar"],
    "ikon",
  );

  const { data: bahan, isLoading, error: bahanGagal } = useQuery({
    queryKey: ["bahan", "ringkas"],
    queryFn: () => api<BahanDto[]>("/bahan?ringkas=1"),
  });
  const semua = bahan ?? [];
  // `lingkupPeran` (didefinisikan di bawah) dipangkas DI SUMBER, bukan di
  // penyaring grid — supaya hitungan chip, pencarian, dan terutama deep-link
  // `?bahan=<id>` ikut terbatas. Menyaring hanya di grid akan menyisakan celah:
  // menempel id resep divisi lain di URL tetap membuka detailnya.
  const produksiSemua = semua.filter((b) => b.pengadaan === "produksi");

  // Resep terarsip (bahan produksi nonaktif) — chip 🗄 Arsip, hanya owner/admin.
  const { data: arsipData } = useQuery({
    queryKey: ["bahan", "arsip"],
    enabled: bolehUbah,
    queryFn: () => api<BahanDto[]>("/bahan?arsip=1"),
  });
  const arsipProduksi = (arsipData ?? []).filter((b) => b.pengadaan === "produksi");
  const [tab, setTab] = useState<"aktif" | "arsip">("aktif");

  const [cari, setCari] = useState("");
  /**
   * LINGKUP PELAKSANA: peran yang mengerjakan produksi hanya melihat resep yang
   * MEREKA produksi — bar lihat resep bar, kitchen lihat resep kitchen, kru CK
   * lihat resep CK. Bukan sekadar filter awal: chip-nya disembunyikan supaya
   * divisi lain tak bisa dibuka sama sekali (daftar resep divisi lain hanya
   * bikin bingung dan bukan urusan mereka).
   *
   * `tim` = kru Central Kitchen — nav Resep memang hanya muncul untuk tim yang
   * ditempatkan di CK. Owner/admin TIDAK dibatasi: merekalah yang menyusun dan
   * memindahkan resep antar-divisi, jadi butuh melihat semuanya.
   */
  const lingkupPeran: FilterResep | null =
    role === "kitchen" ? "kitchen" : role === "bar" ? "bar" : role === "tim" ? "ck" : null;
  const [filter, setFilter] = useState<FilterResep>(lingkupPeran ?? "semua");
  const produksi = lingkupPeran
    ? produksiSemua.filter((b) =>
        lingkupPeran === "ck"
          ? b.produksi_di === "ck"
          : b.produksi_di === "cabang" && b.divisi_produksi === lingkupPeran,
      )
    : produksiSemua;

  // Bahan terpilih = ?bahan=<id> di URL (state persisten): kartu diklik →
  // param terpasang; ← Kembali → param dihapus. Deep-link dari Bahan Baku /
  // tautan "📖 resep" di faktur produksi langsung membuka detail.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("bahan");
  /** Potret draf sekarang — pembanding untuk "ada yang diketik?". */
  const potretDraf = () => JSON.stringify({ resep, langkah, atur, foto });
  const adaPerubahan = () =>
    cadanganDraf.current !== null && cadanganDraf.current !== potretDraf();

  const mulaiUbah = () => {
    cadanganDraf.current = potretDraf();
    setMode("ubah");
  };

  /** Kembali ke tampilan baca, draf dipulihkan ke keadaan saat Edit ditekan. */
  const kunciLagi = () => {
    const potret = cadanganDraf.current;
    if (potret) {
      const d = JSON.parse(potret) as {
        resep: ResepDraft[];
        langkah: LangkahDraft[];
        atur: PengaturanBatch | null;
        foto: { hasil: string | null; packing: string | null };
      };
      setResep(d.resep);
      setLangkah(d.langkah);
      setAtur(d.atur);
      setFoto(d.foto);
    }
    cadanganDraf.current = null;
    setMode("lihat");
  };

  /**
   * Keluar dari mode ubah — BERTANYA DULU bila memang ada yang diketik.
   *
   * Ditanyakan ke pemilik repo dan ia memilih konfirmasi: yang sudah mengetik
   * takaran sepuluh bahan tak boleh kehilangannya karena satu klik nyasar.
   * Tapi hanya bila drafnya BENAR-BENAR berubah — konfirmasi yang muncul juga
   * saat tak ada yang diubah adalah konfirmasi yang orang belajar menekan
   * "OK" tanpa membaca.
   */
  const batalUbah = () => {
    if (
      adaPerubahan() &&
      !confirm("Ada perubahan yang belum disimpan. Buang perubahan itu?")
    )
      return;
    kunciLagi();
  };

  /*
   * Pindah resep saat sedang mengubah lewat penjaga yang SAMA — kalau tidak,
   * ketikan hilang lewat pintu samping (klik baris lain) sementara pintu depan
   * (tombol Batal) menjaganya.
   */
  const bukaDetail = (id: string | null) => {
    if (mode === "ubah") {
      if (
        adaPerubahan() &&
        !confirm("Ada perubahan yang belum disimpan. Buang perubahan itu?")
      )
        return;
      cadanganDraf.current = null;
      setMode("lihat");
    }
    setSearchParams(id ? { bahan: id } : {});
  };
  const dipilih = produksi.find((b) => b.id === selectedId) ?? null;

  // Katalog menu — hanya untuk memberi tahu BERAPA menu yang HPP-nya ikut
  // bergerak bila harga bahan ini diperbarui. Owner/admin saja; peran pelaksana
  // tak menyentuh harga sehingga tak perlu request tambahan.
  const { data: menuSemua, error: menuSemuaGagal } = useQuery({
    queryKey: ["menu"],
    enabled: bolehUbah,
    queryFn: () => api<MenuDto[]>("/menu"),
  });

  // Ringkasan jumlah bahan mentah per bahan produksi (utk badge di kartu) —
  // satu request batch; bahan yang tak ada di peta berarti belum punya resep.
  const { data: ringkas } = useQuery({
    queryKey: ["resep-ringkas"],
    enabled: produksi.length > 0,
    queryFn: () => api<Record<string, number>>("/bahan/resep-ringkas"),
  });

  // Muat resep bahan terpilih. react-query membuang respons basi saat ganti
  // bahan cepat (key berubah → tak menimpa panel bahan lain).
  const {
    data: resepServer,
    isLoading: resepLoading,
    isError: resepGagal,
  } = useQuery({
    queryKey: ["bahan-resep", selectedId],
    enabled: !!selectedId,
    queryFn: () => api<BahanResepRow[]>(`/bahan/${selectedId}/resep`),
  });

  /**
   * Draft editor lokal, di-seed dari resep server SEKALI PER RESEP.
   *
   * Kuncinya `selectedId`, bukan identitas objek `resepServer`. Dulu efek ini
   * menyemai ulang tiap kali objek itu berganti — dan React Query menggantinya
   * tiap penyegaran ulang, yang terjadi begitu query basi dan jendela kembali
   * fokus (`staleTime` 10 detik). Takaran yang baru diketik lenyap balik ke
   * angka server tanpa satu pun pesan; yang mengetik baru sadar setelah
   * menyimpan resep yang tak jadi berubah.
   *
   * Berganti resep TETAP menyemai ulang — itu memang yang diinginkan, dan
   * itulah kenapa penjagaannya menyimpan `selectedId`, bukan sekadar "sudah".
   */
  const [resep, setResep] = useState<ResepDraft[]>([]);
  const resepTersemai = useRef<string | null>(null);
  useEffect(() => {
    if (!resepServer) {
      setResep([]);
      resepTersemai.current = null;
      return;
    }
    if (resepTersemai.current === selectedId) return;
    resepTersemai.current = selectedId;
    setResep(resepServer.map((r) => ({ ingredient_id: r.ingredient_id, qty: teksAngka(r.qty) })));
  }, [resepServer, selectedId]);

  // CARA MASAK: langkah berurutan + foto proses per langkah.
  const { data: langkahServer, error: langkahGagal } = useQuery({
    queryKey: ["bahan-langkah", selectedId],
    enabled: !!selectedId,
    queryFn: () => api<BahanLangkahRow[]>(`/bahan/${selectedId}/langkah`),
  });
  const [langkah, setLangkah] = useState<LangkahDraft[]>([]);
  // Sekali per resep — alasannya sama dengan draft resep di atas. Di sini
  // taruhannya lebih besar: satu langkah masak bisa beberapa kalimat, dan
  // menyemai ulang juga memberi `_id` baru sehingga fotonya ikut terlepas.
  const langkahTersemai = useRef<string | null>(null);
  useEffect(() => {
    if (langkahGagal) return; // gagal baca ≠ "resepnya tak punya langkah"
    if (!langkahServer) {
      setLangkah([]);
      langkahTersemai.current = null;
      return;
    }
    if (langkahTersemai.current === selectedId) return;
    langkahTersemai.current = selectedId;
    setLangkah(langkahServer.map((l) => ({ _id: idLangkah(), teks: l.teks, foto_url: l.foto_url })));
  }, [langkahServer, langkahGagal, selectedId]);

  // Pengaturan batch & harga + foto hasil/packing, di-seed dari bahan terpilih
  // (ikut ter-reset saat master di-refresh — pola sama dgn draft resep).
  const [atur, setAtur] = useState<PengaturanBatch | null>(null);
  const [foto, setFoto] = useState<{ hasil: string | null; packing: string | null }>({
    hasil: null,
    packing: null,
  });
  /**
   * Resep yang SEDANG dibuka, dibaca dari luar closure render.
   *
   * `foto` di-reset tiap ganti bahan (efek di bawah), sementara `ImageUpload`
   * mendarat beberapa detik kemudian. Tanpa pegangan ini, foto yang diunggah
   * untuk resep A mendarat di form resep B yang sudah terlanjur dibuka — lalu
   * ikut tersimpan ke sana. Langkah masak sudah kebal karena `_id`-nya tak
   * pernah dipakai ulang antar resep; `foto` tak punya identitas semacam itu,
   * jadi pemiliknya dicatat terpisah.
   */
  const idResepRef = useRef<string | null>(null);
  useEffect(() => {
    idResepRef.current = dipilih?.id ?? null;
  }, [dipilih]);
  // Persetujuan sadar untuk menimpa harga bahan (lihat catatan di `simpan`).
  // Sengaja kembali false tiap ganti bahan — persetujuan tidak menular.
  const [setujuHarga, setSetujuHarga] = useState(false);
  /**
   * Sekali per resep. `dipilih` dicari ulang dari daftar `bahan`, jadi objeknya
   * berganti identitas tiap daftar itu disegarkan — dan efek ini dulu ikut
   * menembak, mengembalikan isi/overhead/stok minimum yang sedang disunting ke
   * angka server. Kuncinya `dipilih?.id`, supaya berganti resep tetap menyemai.
   */
  const aturTersemai = useRef<string | null>(null);
  useEffect(() => {
    if (aturTersemai.current === (dipilih?.id ?? null)) return;
    aturTersemai.current = dipilih?.id ?? null;
    setAtur(
      dipilih
        ? {
            isi: teksAngka(dipilih.isi),
            satuan: dipilih.satuan,
            overhead: teksAngka(dipilih.overhead_x ?? 1),
            stokMin: teksAngka(dipilih.stok_minimum),
            stokMinToko: teksAngka(dipilih.stok_minimum_toko ?? 0),
            masaSimpan: teksAngka(dipilih.masa_simpan_hari ?? 0),
            leadTime: teksAngka(dipilih.lead_time_hari ?? 0),
            produksiDi: dipilih.produksi_di ?? "ck",
            divisiProduksi: dipilih.divisi_produksi ?? "kitchen",
            produksiBranchIds: dipilih.produksi_branch_ids ?? [],
          }
        : null,
    );
    setFoto({
      hasil: dipilih?.foto_hasil_url ?? null,
      packing: dipilih?.foto_packing_url ?? null,
    });
    setSetujuHarga(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dipilih]);

  // Estimasi biaya bahan per batch (takaran × harga per satuan resep) —
  // dasar harga batch: harga = biaya × overhead.
  const semuaById = new Map(semua.map((b) => [b.id, b]));
  const biayaResep = resep.reduce((a, r) => {
    const x = semuaById.get(r.ingredient_id);
    // Bahan yang harganya tak diketahui tak menyumbang biaya. Untuk peran
    // non-manajemen kuerinya bahkan tak berjalan (`enabled: bolehUbah`), jadi
    // `semua` kosong dan totalnya nol — bukan total yang diam-diam kurang.
    return a + (x && x.harga_per_unit != null ? (angkaDari(r.qty) || 0) * x.harga_per_unit : 0);
  }, 0);
  /**
   * Baris resep yang SUDAH DIISI takarannya tapi tidak akan ikut tersimpan.
   *
   * Kembaran persis dari penjaga di `MenuFormPage`: penyaring kiriman memakai
   * `angkaDari(r.qty) > 0`, jadi takaran tak terbaca dibuang di sisi klien —
   * tak pernah sampai ke server, tak pernah jadi galat, dan tombol Simpan tak
   * menahannya.
   *
   * Resep produksi (BOM) sama awetnya dengan resep menu, dengan satu tambahan
   * yang khas halaman ini: `biayaResep` di atas juga melewatkan baris itu
   * (`angkaDari(r.qty) || 0`), jadi HARGA BATCH yang ditawarkan ikut turun —
   * dan bila persetujuan harga dicentang, harga bahan hasil produksi ini
   * tersimpan lebih murah daripada kenyataannya. Satu salah ketik menggeser
   * biaya sekaligus stok.
   */
  const qtyTerbuang = resep
    .filter((r) => r.ingredient_id && r.qty.trim() !== "" && !(angkaDari(r.qty) > 0))
    .map((r) => semuaById.get(r.ingredient_id)?.nama)
    .filter((n): n is string => !!n);
  const overhead = angkaDari(atur?.overhead) > 0 ? angkaDari(atur?.overhead) : 1;
  const hargaBatch = Math.round(biayaResep * overhead * 100) / 100;
  const isiBatch = angkaDari(atur?.isi) > 0 ? angkaDari(atur?.isi) : 0;

  // Apakah menyimpan akan MENGGESER harga bahan ini? Selisih di bawah 1 rupiah
  // dianggap sama (harga tersimpan dibulatkan, biaya resep tidak).
  const hargaBerubah =
    !!dipilih && dipilih.harga_beli != null && Math.abs(hargaBatch - dipilih.harga_beli) >= 1;
  // Menu yang HPP-nya ikut bergerak bila harga bahan ini berubah — angka kasar
  // (pemakaian langsung) supaya user tahu ini bukan perubahan sepele.
  const menuTerdampak = (menuSemua ?? []).filter((m) =>
    m.komponen.some((k) => k.ingredient_id === selectedId),
  ).length;

  // Simpan resep + pengaturan + cara masak berantai: komponen → master bahan
  // (isi/harga/foto) → langkah PALING AKHIR (gagal langkah tak memblokir
  // simpan resep/harga; invalidasi onError merapikan sebagian tersimpan).
  //
  // `harga_beli` HANYA dikirim bila user mencentang persetujuan. Dulu selalu
  // dikirim, jadi menyimpan perubahan foto atau cara masak diam-diam melepas
  // kenaikan harga bahan mentah berbulan-bulan sekaligus ke HPP semua menu —
  // persis kejutan "harga menu tiba-tiba berubah" yang sulit dilacak.
  const simpan = useMutation({
    mutationFn: async () => {
      await api(`/bahan/${selectedId}/resep`, {
        method: "PUT",
        body: {
          komponen: resep
            .filter((r) => r.ingredient_id && angkaDari(r.qty) > 0)
            .map((r) => ({ ingredient_id: r.ingredient_id, qty: angkaDari(r.qty) })),
          /*
           * TAKARAN BATCH IKUT DI SINI, bukan di panggilan berikutnya.
           *
           * Biaya per satuan lahir dari PASANGAN resep ÷ `isi` × `overhead_x`.
           * Dulu keduanya terpisah: komponen di panggilan ini, takarannya di
           * `PUT /bahan/:id` sesudahnya. Panggilan kedua yang gagal menyisakan
           * resep BARU dibagi `isi` LAMA — dan itu bukan cuma masalah layar
           * ini: HPP tiap menu yang memakai bahan ini ikut keliru sampai ada
           * yang menyimpan ulang. Server menulis keduanya dalam satu transaksi.
           *
           * `harga_beli` tetap tunduk pada persetujuan yang sama seperti dulu —
           * hanya dikirim bila user mencentangnya.
           */
          ...(atur
            ? {
                atur: {
                  isi: angkaDari(atur.isi) > 0 ? angkaDari(atur.isi) : 1,
                  overhead_x: overhead,
                  ...(hargaBerubah && setujuHarga ? { harga_beli: hargaBatch } : {}),
                },
              }
            : {}),
        },
      });
      if (atur) {
        await api(`/bahan/${selectedId}`, {
          method: "PUT",
          body: {
            // `isi`, `overhead_x`, dan `harga_beli` SENGAJA tak ada di sini —
            // ketiganya sudah ditulis bersama komponennya di panggilan atas,
            // dalam satu transaksi. Mengirimnya lagi di sini tak salah secara
            // nilai, tapi mengembalikan jendela yang baru saja ditutup: kalau
            // panggilan ini gagal, tak ada lagi yang bisa membuat takaran dan
            // resep berselisih.
            satuan: atur.satuan.trim() || "pcs",
            stok_minimum: angkaDari(atur.stokMin) || 0,
            stok_minimum_toko: angkaDari(atur.stokMinToko) || 0,
            masa_simpan_hari: Math.max(0, Math.trunc(angkaDari(atur.masaSimpan) || 0)),
            lead_time_hari: Math.max(0, Math.trunc(angkaDari(atur.leadTime) || 0)),
            produksi_di: atur.produksiDi,
            // divisi hanya bermakna untuk produksi cabang — CK kembali ke default
            divisi_produksi: atur.produksiDi === "cabang" ? atur.divisiProduksi : "kitchen",
            produksi_branch_ids:
              atur.produksiDi === "cabang" ? atur.produksiBranchIds : [],
            foto_hasil_url: foto.hasil,
            foto_packing_url: foto.packing,
          },
        });
      }
      await api(`/bahan/${selectedId}/langkah`, {
        method: "PUT",
        body: {
          langkah: langkah
            .filter((l) => l.teks.trim())
            .map((l) => ({ teks: l.teks.trim(), foto_url: l.foto_url })),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["bahan-langkah", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP bisa berubah
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      /*
       * KEMBALI KE TAMPILAN BACA — pilihan pemilik repo. Simpan = selesai,
       * jadi keadaan diam halaman ini selalu terkunci dan tak ada resep yang
       * tertinggal terbuka sesudah orangnya beranjak. `cadanganDraf`
       * dikosongkan tanpa memulihkan apa pun: yang di layar sekarang justru
       * yang baru saja tersimpan.
       */
      cadanganDraf.current = null;
      setMode("lihat");
    },
    onError: () => {
      // Sebagian rantai bisa saja sudah tersimpan sebelum yang gagal — refresh.
      // Penjaga "semai sekali per resep" SENGAJA dilepas di sini: justru pada
      // jalur ini draft harus mengikuti server lagi, supaya yang terlihat adalah
      // apa yang benar-benar tersimpan, bukan ketikan yang sebagian gagal.
      resepTersemai.current = null;
      langkahTersemai.current = null;
      aturTersemai.current = null;
      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["bahan-langkah", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
    },
  });

  // Arsipkan resep = nonaktifkan bahan produksi (soft-archive). Server menolak
  // (409) bila masih dipakai menu aktif atau resep produksi lain — pesan tampil
  // lewat ErrorText di bawah tombol.
  const arsipkan = useMutation({
    mutationFn: (id: string) => api(`/bahan/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      bukaDetail(null);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
    },
  });
  const pulihkan = useMutation({
    mutationFn: (id: string) => api(`/bahan/${id}/pulihkan`, { method: "POST" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      setTab("aktif");
      bukaDetail(id);
    },
  });

  // Master satuan & kategori bahan (dropdown form buat bahan produksi)
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
  // Buat bahan produksi baru langsung dari halaman Resep — cukup kode/nama/
  // kategori; batch, harga (overhead), dan stok minimum diatur di detail resep.
  const [formBaru, setFormBaru] = useState<BahanBaruForm | null>(null);
  const buatBahan = useMutation({
    mutationFn: (f: BahanBaruForm) =>
      api<BahanDto>("/bahan", {
        method: "POST",
        body: {
          kode: f.kode.trim() || null,
          nama: f.nama.trim(),
          harga_beli: 0,
          isi: 1,
          satuan: satuanDefault,
          kategori: f.kategori,
          pengadaan: "produksi",
          track_stok: true,
          stok_minimum: 0,
        },
      }),
    onSuccess: (b) => {
      setFormBaru(null);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      bukaDetail(b.id);
    },
  });

  if (isLoading) return <Spinner />;

  const cocokFilter = (b: BahanDto) =>
    filter === "semua"
      ? true
      : filter === "ck"
        ? b.produksi_di === "ck"
        : b.produksi_di === "cabang" && b.divisi_produksi === filter;
  const daftar = produksi
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()) && cocokFilter(b))
    .sort((a, b) => a.nama.localeCompare(b.nama));
  const daftarArsip = arsipProduksi
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()))
    .sort((a, b) => a.nama.localeCompare(b.nama));
  const hitungFilter = (f: FilterResep) =>
    f === "semua"
      ? produksi.length
      : produksi.filter(
          (b) =>
            (f === "ck" && b.produksi_di === "ck") ||
            (f !== "ck" && b.produksi_di === "cabang" && b.divisi_produksi === f),
        ).length;

  const bukaFormBaru = () => setFormBaru({ kode: "", nama: "", kategori: "baso" });
  const chipCls = (aktif: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium transition ${
      aktif ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
    }`;

  return (
    <div>
      <PageTitle
        aksi={
          bolehUbah ? (
            <button onClick={bukaFormBaru} className={btnPrimary}>
              + Resep produksi
            </button>
          ) : undefined
        }
      >
        🧾 Resep Produksi
      </PageTitle>
      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        {bolehUbah ? (
          <>
            Atur bahan baku untuk memproduksi <b>1 batch</b> tiap bahan jenis produksi, plus{" "}
            <b>cara masak berlangkah + foto</b>. Dipakai untuk <b>rencana belanja bahan
            produksi</b> dan <b>pemotongan stok bahan baku otomatis</b> saat produksi selesai.
          </>
        ) : (
          <>
            Resep tiap bahan produksi: <b>bahan baku &amp; takaran</b> per <b>1 batch</b>,{" "}
            <b>cara masak</b> berlangkah dengan foto proses, foto bahan jadi, dan cara
            packing. Harga tak ditampilkan.
          </>
        )}
      </div>

      {produksi.length === 0 && arsipProduksi.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada bahan produksi.{" "}
          {bolehUbah ? (
            <button onClick={bukaFormBaru} className="font-medium text-orange-600 hover:underline">
              + Buat resep produksi
            </button>
          ) : (
            <Link to="/bahan" className="font-medium text-orange-600 hover:underline">
              Bahan Baku
            </Link>
          )}{" "}
          untuk membuat bahan yang diproduksi sendiri lalu mengatur resepnya.
        </Card>
      ) : selectedId && !dipilih ? (
        /* id di URL tak dikenal (terhapus/diarsip/tautan basi) — jangan crash */
        <Card className="p-8 text-center text-sm text-stone-500">
          Resep tidak ditemukan (mungkin sudah diarsipkan).{" "}
          <button
            onClick={() => bukaDetail(null)}
            className="font-medium text-orange-600 hover:underline"
          >
            ← Kembali ke daftar resep
          </button>
        </Card>
      ) : !selectedId ? (
        /* ============ MODE GRID: kartu resep + filter ============ */
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari resep…"
              className={`${inputClass} w-56 flex-none`}
            />
            {/* Chip divisi disembunyikan untuk peran pelaksana — daftarnya sudah
                dipangkas ke divisinya, jadi chip hanya akan menampilkan nol. */}
            {tab === "aktif" && !lingkupPeran && (
              <>
                <button onClick={() => setFilter("semua")} className={chipCls(filter === "semua")}>
                  Semua ({hitungFilter("semua")})
                </button>
                <button onClick={() => setFilter("ck")} className={chipCls(filter === "ck")}>
                  🏭 CK ({hitungFilter("ck")})
                </button>
                <button
                  onClick={() => setFilter("kitchen")}
                  className={chipCls(filter === "kitchen")}
                >
                  🍳 Kitchen ({hitungFilter("kitchen")})
                </button>
                <button onClick={() => setFilter("bar")} className={chipCls(filter === "bar")}>
                  🍹 Bar ({hitungFilter("bar")})
                </button>
              </>
            )}
            {bolehUbah && (
              <button
                onClick={() => setTab(tab === "arsip" ? "aktif" : "arsip")}
                className={chipCls(tab === "arsip")}
              >
                🗄 Arsip ({arsipProduksi.length})
              </button>
            )}
            {/* Bentuk daftar — didorong ke kanan supaya tak berebut tempat
                dengan chip divisi yang jumlahnya berubah-ubah. Sengaja TIDAK
                muncul di tab Arsip: kartu arsip sudah berbentuk baris dan
                tombol aksinya berbeda (Pulihkan), jadi tombol ini hanya akan
                menawarkan pilihan yang tak mengubah apa pun di sana. */}
            {tab !== "arsip" && (
              <SakelarTampilan
                nilai={tampilan}
                atur={setTampilan}
                opsi={[
                  { nilai: "ikon", label: "🔳 Ikon" },
                  { nilai: "daftar", label: "☰ Daftar" },
                ]}
                kelas="ml-auto"
              />
            )}
          </div>

          {tab === "arsip" && bolehUbah ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {daftarArsip.map((b) => (
                <Card key={b.id} className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-stone-600">{b.nama}</div>
                    <div className="text-xs text-stone-400">
                      batch {formatAngka(b.isi)} {b.satuan}
                    </div>
                  </div>
                  <button
                    onClick={() => pulihkan.mutate(b.id)}
                    disabled={pulihkan.isPending}
                    className="shrink-0 rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
                  >
                    ↩ Pulihkan
                  </button>
                </Card>
              ))}
              {daftarArsip.length === 0 && (
                <div className="col-span-full py-8 text-center text-sm text-stone-400">
                  {arsipProduksi.length === 0
                    ? "Belum ada resep yang diarsipkan."
                    : "Tidak ada yang cocok."}
                </div>
              )}
              <div className="col-span-full">
                <ErrorText error={pulihkan.error} />
              </div>
            </div>
          ) : tampilan === "daftar" ? (
            /* ---- BENTUK DAFTAR: tabel berkepala, satu baris per resep ---- */
            <TabelResponsif
              data={daftar}
              kunci={(b) => b.id}
              kolom={kolomDaftarResep({ bolehUbah, ringkas })}
              onKlikBaris={(b) => bukaDetail(b.id)}
              kelasBaris={() => "hover:bg-orange-50"}
              minLebar="min-w-[52rem]"
              galat={bahanGagal}
              kosong={produksi.length === 0 ? "Belum ada resep aktif." : "Tidak ada yang cocok."}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {daftar.map((b) => {
                // peta hanya berisi bahan yang PUNYA komponen — absen berarti
                // 0 (belum ada resep); null hanya selagi peta belum termuat.
                const n = ringkas ? (ringkas[b.id] ?? 0) : null;
                return (
                  <Card
                    key={b.id}
                    onClick={() => bukaDetail(b.id)}
                    className="cursor-pointer overflow-hidden text-left transition hover:border-orange-300 hover:shadow-sm"
                  >
                    <div className="flex aspect-video items-center justify-center bg-stone-100">
                      {b.foto_hasil_url ? (
                        <img
                          src={b.foto_hasil_url}
                          alt={b.nama}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-4xl" aria-hidden>
                          🍲
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-stone-800">
                          {b.nama}
                        </span>
                        <BadgeDivisi b={b} />
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-stone-500">
                        <span className="min-w-0 truncate">
                          batch {formatAngka(b.isi)} {b.satuan} ·{" "}
                          {n == null ? "—" : n > 0 ? `${n} bahan baku` : "belum ada resep"}
                        </span>
                        {/* harga hanya owner/admin — staf produksi tanpa harga */}
                        {bolehUbah && (
                          <span className="shrink-0 font-semibold text-stone-700 tabular-nums">
                            {formatRupiah(b.harga_beli)}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
              {daftar.length === 0 && (
                <div className="col-span-full py-8 text-center text-sm text-stone-400">
                  {produksi.length === 0 ? "Belum ada resep aktif." : "Tidak ada yang cocok."}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* ============ MODE DETAIL: editor/tampilan satu resep ============ */
        <Card className="p-4">
          {dipilih && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <button
                  onClick={() => bukaDetail(null)}
                  className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
                >
                  ← Kembali
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-lg font-bold text-stone-800">
                      {dipilih.nama}
                    </span>
                    <BadgeDivisi b={dipilih} />
                  </div>
                  <div className="text-sm text-stone-500">
                    Resep per 1 batch = {formatAngka(dipilih.isi)} {dipilih.satuan}
                  </div>
                </div>
              </div>

              {resepLoading ? (
                <Spinner />
              ) : resepGagal ? (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  Resep gagal dimuat.{" "}
                  <button
                    onClick={() =>
                      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] })
                    }
                    className="font-semibold underline"
                  >
                    Muat ulang
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {resep.map((r, i) => {
                      // nilai terpilih selalu punya option (walau bahan
                      // nonaktif); sisanya bahan AKTIF apa pun jenisnya —
                      // bahan baku (beli) maupun bahan produksi (resep
                      // bertingkat) — kecuali bahan ini sendiri & yang sudah
                      // dipakai di baris lain. BahanPicker memisah 2 grup.
                      const pilihan = semua.filter(
                        (x) =>
                          x.id === r.ingredient_id ||
                          (x.is_active &&
                            x.id !== dipilih.id &&
                            !resep.some((lain, j) => j !== i && lain.ingredient_id === x.id)),
                      );
                      const terpilih = semua.find((x) => x.id === r.ingredient_id);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <BahanPicker
                            bahan={pilihan}
                            value={r.ingredient_id}
                            onChange={(id) => {
                              const salinan = [...resep];
                              salinan[i] = { ...salinan[i], ingredient_id: id };
                              setResep(salinan);
                            }}
                            placeholder="— pilih bahan —"
                            className="flex-1"
                            disabled={!sedangUbah}
                          />
                          <input
                            /* Takaran resep: pecahan adalah normal ("0,5" kg)
                               dan koma adalah pemisah desimal bahasa Indonesia.
                               `type="number"` MEMBUANG koma saat diketik — "0,5"
                               tersimpan "05" (=5) tanpa `badInput`, jadi HPP
                               seluruh resep melenceng 10× tanpa tanda apa pun. */
                            type="text"
                            inputMode="decimal"
                            value={r.qty}
                            onChange={(e) => {
                              const salinan = [...resep];
                              salinan[i] = { ...salinan[i], qty: e.target.value };
                              setResep(salinan);
                            }}
                            placeholder="qty"
                            className="w-24 shrink-0 rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-orange-500 focus:outline-none"
                            disabled={!sedangUbah}
                            required
                          />
                          <span className="w-12 shrink-0 text-xs text-stone-500">
                            {terpilih?.satuan ?? ""}
                          </span>
                          {/* kolom harga (per satuan & subtotal) hanya untuk owner/admin —
                              tim cukup lihat bahan + takaran + satuan, tanpa harga */}
                          {bolehUbah && (
                            <>
                              <span className="w-28 shrink-0 text-right text-xs whitespace-nowrap text-stone-400 tabular-nums">
                                {terpilih ? `× Rp ${formatAngka(terpilih.harga_per_unit, 2)}` : ""}
                              </span>
                              <span className="w-28 shrink-0 text-right text-sm whitespace-nowrap font-medium text-stone-700 tabular-nums">
                                {terpilih && terpilih.harga_per_unit != null && angkaDari(r.qty) > 0
                                  ? formatRupiah(angkaDari(r.qty) * terpilih.harga_per_unit)
                                  : "—"}
                              </span>
                            </>
                          )}
                          <span className="w-6 shrink-0 text-center">
                            {sedangUbah && (
                              <button
                                type="button"
                                onClick={() => setResep(resep.filter((_, j) => j !== i))}
                                className="text-sm font-medium text-red-500 hover:underline"
                                aria-label="Hapus baris resep"
                              >
                                ✕
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {resep.length === 0 && (
                      <div className="rounded-lg bg-stone-50 py-6 text-center text-sm text-stone-400">
                        Belum ada bahan baku pada resep ini.
                      </div>
                    )}
                  </div>

                  {/* total biaya bahan baku hanya untuk owner/admin — tim tanpa harga */}
                  {bolehUbah && resep.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 border-t border-stone-200 pt-2">
                      <span className="flex-1 text-right text-sm font-semibold text-stone-600">
                        Total bahan baku <span className="font-normal text-stone-400">(sebelum overhead)</span>
                      </span>
                      {/* sejajar dengan kolom subtotal tiap baris */}
                      <span className="w-28 shrink-0 text-right text-sm font-bold text-stone-800 tabular-nums">
                        {formatRupiah(biayaResep)}
                      </span>
                      <span className="w-6 shrink-0" aria-hidden="true" />
                    </div>
                  )}

                  {sedangUbah && (
                    <button
                      type="button"
                      onClick={() => setResep([...resep, { ingredient_id: "", qty: "" }])}
                      className="mt-2 text-sm font-medium text-orange-600 hover:underline"
                    >
                      + Tambah bahan baku
                    </button>
                  )}

                  {/* ⚙ Batch, harga & stok minimum — diatur DI BAWAH resep
                      (bukan di modal buat bahan). Harga per batch = biaya
                      bahan resep × overhead; tersimpan saat Simpan Resep.
                      Hanya owner/admin — tim cukup lihat resep (bahan+takaran),
                      hasil per batch sudah tampil di judul di atas. */}
                  {atur && bolehUbah && (
                    <div className="mt-4 rounded-lg border border-stone-200 p-3">
                      <div className="mb-2 text-sm font-semibold text-stone-700">
                        ⚙️ Batch, harga, stok minimum &amp; masa simpan
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            1 batch menghasilkan
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={atur.isi}
                              onChange={(e) => setAtur({ ...atur, isi: e.target.value })}
                              className={inputClass}
                              disabled={!sedangUbah}
                              aria-label="Isi per batch"
                            />
                            <SatuanSelect
                              value={atur.satuan}
                              onChange={(v) => setAtur({ ...atur, satuan: v })}
                              selectClassName={`${inputClass} max-w-28`}
                              disabled={!sedangUbah}
                              aria-label="Satuan batch"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Overhead biaya (×)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={atur.overhead}
                            onChange={(e) => setAtur({ ...atur, overhead: e.target.value })}
                            className={inputClass}
                            disabled={!sedangUbah}
                            aria-label="Overhead biaya"
                          />
                          <p className="mt-1 text-xs text-stone-500">
                            <b>1</b> = harga mengikuti biaya resep; mis. <b>1,2</b> = biaya +
                            20% (gas, listrik, tenaga).
                          </p>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Stok minimum di Central Kitchen ({atur.satuan})
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={atur.stokMin}
                            onChange={(e) => setAtur({ ...atur, stokMin: e.target.value })}
                            className={inputClass}
                            disabled={!sedangUbah}
                            aria-label="Stok minimum Central Kitchen"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Stok minimum di toko ({atur.satuan})
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={atur.stokMinToko}
                            onChange={(e) =>
                              setAtur({ ...atur, stokMinToko: e.target.value })
                            }
                            className={inputClass}
                            disabled={!sedangUbah}
                            aria-label="Stok minimum toko"
                          />
                          <p className="mt-1 text-xs text-stone-500">
                            <b>0</b> = ikut nilai Central Kitchen.
                          </p>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Masa simpan (hari)
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={atur.masaSimpan}
                            onChange={(e) => setAtur({ ...atur, masaSimpan: e.target.value })}
                            className={inputClass}
                            disabled={!sedangUbah}
                            aria-label="Masa simpan hasil produksi (hari)"
                          />
                          <p className="mt-1 text-xs text-stone-500">
                            Umur hasil produksi. <b>Tanggal exp otomatis</b> = tanggal masuk stok
                            + masa simpan. <b>0</b> = tak diatur.
                          </p>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Lama produksi (hari)
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={atur.leadTime}
                            onChange={(e) => setAtur({ ...atur, leadTime: e.target.value })}
                            className={inputClass}
                            disabled={!sedangUbah}
                            aria-label="Lama produksi / lead time (hari)"
                          />
                          <p className="mt-1 text-xs text-stone-500">
                            Berapa hari proses produksi. Muncul sebagai <b>⏱ buat H-n</b> di
                            rekomendasi/permintaan agar dibuat jauh-jauh hari. <b>0</b> = tanpa info.
                          </p>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Diproduksi di
                          </label>
                          <select
                            value={atur.produksiDi}
                            onChange={(e) =>
                              setAtur({
                                ...atur,
                                produksiDi: e.target.value as "ck" | "cabang",
                              })
                            }
                            className={inputClass}
                            disabled={!sedangUbah}
                            aria-label="Lokasi produksi"
                          >
                            <option value="ck">Central Kitchen (dikirim ke cabang)</option>
                            <option value="cabang">Cabang (kitchen/bar toko)</option>
                          </select>
                          <p className="mt-1 text-xs text-stone-500">
                            <b>Cabang</b> = diproduksi peran <b>Kitchen</b> atau <b>Bar</b>{" "}
                            di cabang masing-masing; hasil langsung masuk stok cabang itu.
                          </p>
                          {atur.produksiDi === "cabang" && (
                            <div className="mt-2">
                              <label className="mb-1 block text-xs font-medium text-stone-500">
                                Divisi produksi
                              </label>
                              <select
                                value={atur.divisiProduksi}
                                onChange={(e) =>
                                  setAtur({
                                    ...atur,
                                    divisiProduksi: e.target.value as "kitchen" | "bar",
                                  })
                                }
                                className={inputClass}
                                disabled={!sedangUbah}
                                aria-label="Divisi produksi"
                              >
                                <option value="kitchen">Kitchen (dapur)</option>
                                <option value="bar">Bar (minuman)</option>
                              </select>
                              <p className="mt-1 text-xs text-stone-500">
                                Hanya role divisi ini yang bisa memproduksi resep ini di
                                cabang — kitchen tak melihat resep bar, dan sebaliknya.
                              </p>
                            </div>
                          )}
                          {atur.produksiDi === "cabang" && (
                            <div className="mt-2 rounded-lg border border-stone-200 p-2">
                              <div className="mb-1 text-xs font-medium text-stone-500">
                                Cabang produsen
                              </div>
                              {cabangStore.length === 0 ? (
                                <p className="text-xs text-stone-400">
                                  Belum ada cabang toko aktif.
                                </p>
                              ) : (
                                cabangStore.map((b) => (
                                  <label
                                    key={b.id}
                                    className="flex items-center gap-2 py-0.5 text-sm"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={atur.produksiBranchIds.includes(b.id)}
                                      disabled={!sedangUbah}
                                      onChange={(e) =>
                                        setAtur({
                                          ...atur,
                                          produksiBranchIds: e.target.checked
                                            ? [...atur.produksiBranchIds, b.id]
                                            : atur.produksiBranchIds.filter(
                                                (id) => id !== b.id,
                                              ),
                                        })
                                      }
                                    />
                                    {b.nama}
                                  </label>
                                ))
                              )}
                              <p className="mt-1 text-xs text-stone-500">
                                Kosong = <b>semua cabang</b>. Cabang di luar daftar
                                dipenuhi lewat jalur CK (produksi CK → kirim) dan
                                kitchen/bar-nya tidak bisa memproduksi bahan ini.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
                        Biaya bahan per batch <b>{formatRupiah(biayaResep)}</b> × overhead{" "}
                        <b>{formatAngka(overhead, 2)}</b> → harga per batch{" "}
                        <b>{formatRupiah(hargaBatch)}</b>
                        {isiBatch > 0 && (
                          <>
                            {" "}
                            · ≈ <b>Rp {formatAngka(hargaBatch / isiBatch, 2)}</b>/{atur.satuan}
                          </>
                        )}
                        <span className="block text-xs text-orange-700">
                          {hargaBerubah
                            ? "Harga tersimpan bahan ini BERBEDA — lihat kotak di bawah."
                            : "Sama dengan harga bahan yang tersimpan — menyimpan tidak menggesernya."}
                        </span>
                      </div>
                      {/* Menyimpan resep TIDAK boleh diam-diam menggeser harga:
                          user sering ke sini cuma untuk mengubah foto atau cara
                          masak, dan dulu setiap simpan melepas kenaikan harga
                          bahan mentah berbulan-bulan sekaligus ke HPP semua
                          menu. Perubahan harga kini harus dicentang sadar. */}
                      {hargaBerubah && dipilih && (
                        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          <div>
                            Harga batch: <b>{formatRupiah(dipilih.harga_beli)}</b> →{" "}
                            <b>{formatRupiah(hargaBatch)}</b>
                            <ErrorText error={menuSemuaGagal} />
                            {menuTerdampak > 0 && (
                              <>
                                {" "}
                                — mengubah HPP <b>{menuTerdampak} menu</b>
                              </>
                            )}
                          </div>
                          <label className="mt-1.5 flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={setujuHarga}
                              onChange={(e) => setSetujuHarga(e.target.checked)}
                              className="mt-0.5"
                            />
                            <span>
                              Perbarui juga <b>harga bahan</b> ini saat menyimpan.
                              <span className="block text-xs text-amber-700">
                                Tanpa dicentang, resep &amp; cara masak tetap tersimpan dan harga
                                bahan dibiarkan apa adanya.
                              </span>
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ============ 👨‍🍳 CARA MASAK: langkah berurutan + foto ============ */}
                  <div className="mt-4 rounded-lg border border-stone-200 p-3">
                    <div className="mb-2 text-sm font-semibold text-stone-700">
                      👨‍🍳 Cara Masak
                    </div>
                    {sedangUbah ? (
                      <>
                        <div className="space-y-3">
                          {langkah.map((l, i) => (
                            <div key={l._id} className="flex items-start gap-2">
                              <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                                {i + 1}
                              </span>
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <textarea
                                  rows={2}
                                  value={l.teks}
                                  onChange={(e) =>
                                    ubahLangkah(setLangkah, l._id, (x) => ({
                                      ...x,
                                      teks: e.target.value,
                                    }))
                                  }
                                  maxLength={1000}
                                  placeholder={`Langkah ${i + 1} — mis. rebus air sampai mendidih…`}
                                  className={`${inputClass} resize-y`}
                                  aria-label={`Teks langkah ${i + 1}`}
                                />
                                <ImageUpload
                                  value={l.foto_url}
                                  onChange={(url) =>
                                    ubahLangkah(setLangkah, l._id, (x) => ({
                                      ...x,
                                      foto_url: url,
                                    }))
                                  }
                                  tujuan="resep"
                                  placeholder="📷"
                                />
                              </div>
                              <div className="flex shrink-0 flex-col gap-1">
                                <button
                                  type="button"
                                  disabled={i === 0}
                                  onClick={() =>
                                    setLangkah((prev) => {
                                      const s = [...prev];
                                      const j = s.findIndex((x) => x._id === l._id);
                                      if (j <= 0) return prev;
                                      [s[j - 1], s[j]] = [s[j], s[j - 1]];
                                      return s;
                                    })
                                  }
                                  className="rounded border border-stone-300 px-1.5 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                                  aria-label={`Naikkan langkah ${i + 1}`}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  disabled={i === langkah.length - 1}
                                  onClick={() =>
                                    setLangkah((prev) => {
                                      const s = [...prev];
                                      const j = s.findIndex((x) => x._id === l._id);
                                      if (j < 0 || j >= s.length - 1) return prev;
                                      [s[j], s[j + 1]] = [s[j + 1], s[j]];
                                      return s;
                                    })
                                  }
                                  className="rounded border border-stone-300 px-1.5 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                                  aria-label={`Turunkan langkah ${i + 1}`}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLangkah((prev) => prev.filter((x) => x._id !== l._id))}
                                  className="rounded px-1.5 text-sm font-medium text-red-500 hover:underline"
                                  aria-label={`Hapus langkah ${i + 1}`}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                          {langkah.length === 0 && (
                            <div className="rounded-lg bg-stone-50 py-4 text-center text-sm text-stone-400">
                              Belum ada langkah cara masak.
                            </div>
                          )}
                        </div>
                        {langkah.length < MAKS_LANGKAH && (
                          <button
                            type="button"
                            onClick={() => setLangkah((prev) => [...prev, { _id: idLangkah(), teks: "", foto_url: null }])}
                            className="mt-2 text-sm font-medium text-orange-600 hover:underline"
                          >
                            + Tambah langkah
                          </button>
                        )}
                        <p className="mt-1 text-xs text-stone-400">
                          Tersimpan saat “Simpan Resep”. Foto per langkah opsional (JPEG/PNG/WebP,
                          maks 5 MB).
                        </p>
                      </>
                    ) : langkah.length === 0 ? (
                      <div className="rounded-lg bg-stone-50 py-4 text-center text-sm text-stone-400">
                        Belum ada langkah cara masak.
                      </div>
                    ) : (
                      <ol className="space-y-3">
                        {langkah.map((l, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm whitespace-pre-wrap text-stone-700">{l.teks}</p>
                              {l.foto_url && (
                                <a href={l.foto_url} target="_blank" rel="noreferrer">
                                  <img
                                    src={l.foto_url}
                                    alt={`Foto langkah ${i + 1}`}
                                    className="mt-1.5 max-h-48 rounded-lg border border-stone-200 object-contain"
                                  />
                                </a>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  {/* ============ 📷 FOTO bahan jadi & cara packing ============ */}
                  <div className="mt-4 rounded-lg border border-stone-200 p-3">
                    <div className="mb-2 text-sm font-semibold text-stone-700">📷 Foto</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          ["hasil", "Foto bahan jadi"],
                          ["packing", "Foto cara packing"],
                        ] as const
                      ).map(([kunci, label]) => (
                        <div key={kunci}>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            {label}
                          </label>
                          {sedangUbah ? (
                            <ImageUpload
                              value={foto[kunci]}
                              /*
                                Bentuk fungsional, dan pemiliknya diperiksa —
                                dua kebocoran berbeda di satu baris.

                                `{ ...foto }` menyebar snapshot saat unggahan
                                DIMULAI. Dua foto (hasil & packing) memang
                                dipilih berurutan dalam hitungan detik; yang
                                mendarat belakangan mengembalikan pasangannya
                                jadi null. Satu foto hilang tanpa tanda apa pun.

                                Pemeriksaan pemilik menjaga hal kedua: pindah
                                resep selagi mengunggah membuat fotonya mendarat
                                di form resep lain — dan ikut tersimpan ke sana.
                              */
                              onChange={(url) => {
                                const milik = dipilih?.id ?? null;
                                setFoto((prev) =>
                                  idResepRef.current === milik
                                    ? { ...prev, [kunci]: url }
                                    : prev,
                                );
                              }}
                              tujuan="resep"
                              placeholder={kunci === "hasil" ? "🍲" : "📦"}
                            />
                          ) : foto[kunci] ? (
                            <a href={foto[kunci]!} target="_blank" rel="noreferrer">
                              <img
                                src={foto[kunci]!}
                                alt={label}
                                className="max-h-48 rounded-lg border border-stone-200 object-contain"
                              />
                            </a>
                          ) : (
                            <div className="rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-400">
                              Belum ada foto.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {sedangUbah && qtyTerbuang.length > 0 && (
                    <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                      Takaran pada <b>{qtyTerbuang.join(", ")}</b> belum terbaca sebagai angka
                      lebih dari 0 — tulis seperti <b>0,25</b> atau <b>100</b>. Tanpa itu
                      bahannya tidak ikut masuk resep, dan harga batch yang ditawarkan ikut
                      kurang hitung.
                    </div>
                  )}
                  {/*
                    TOMBOL EDIT — hanya owner/admin, dan hanya saat terkunci.
                    Peran lain tak pernah melihatnya: bagi mereka halaman ini
                    memang cuma baca, dan tombol yang selalu menolak lebih buruk
                    daripada tombol yang tak ada.
                  */}
                  {bolehUbah && !sedangUbah && (
                    <div className="mt-4 flex items-center gap-3">
                      <button type="button" onClick={mulaiUbah} className={btnPrimary}>
                        ✏️ Edit resep
                      </button>
                      <span className="text-xs text-stone-400">
                        Resep dikunci supaya tak berubah karena klik yang tak disengaja.
                      </span>
                    </div>
                  )}
                  {sedangUbah && (
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        onClick={() => simpan.mutate()}
                        disabled={simpan.isPending || qtyTerbuang.length > 0}
                        className={btnPrimary}
                      >
                        Simpan Resep
                      </button>
                      <button
                        type="button"
                        onClick={batalUbah}
                        disabled={simpan.isPending}
                        className={btnSecondary}
                      >
                        Batal
                      </button>
                      {simpan.isSuccess && !simpan.isPending && (
                        <span className="text-sm font-medium text-green-600">✓ Tersimpan</span>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Arsipkan resep "${dipilih.nama}"? Bahan produksi ini keluar dari daftar resep, rencana belanja, dan pilihan produksi. Riwayat lama tetap tersimpan dan bisa dipulihkan dari 🗄 Arsip.`,
                            )
                          )
                            arsipkan.mutate(dipilih.id);
                        }}
                        disabled={arsipkan.isPending}
                        className="text-sm font-medium text-red-500 hover:underline"
                      >
                        🗄 Arsipkan resep
                      </button>
                    </div>
                  )}
                  <ErrorText error={simpan.error} />
                  <ErrorText error={arsipkan.error} />
                </>
              )}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={formBaru !== null}
        onClose={() => setFormBaru(null)}
        title="Resep produksi baru"
      >
        {formBaru && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              buatBahan.mutate(formBaru);
            }}
            className="space-y-3"
          >
            <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-stone-600">
              Bahan yang <b>diproduksi sendiri</b> (mis. baso). Cukup kode, nama, dan kategori —{" "}
              <b>batch, harga (overhead), stok minimum, dan cara masak</b> diatur di halaman
              detail setelah bahan dibuat.
            </p>
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Kode</label>
                <input
                  value={formBaru.kode}
                  onChange={(e) => setFormBaru({ ...formBaru, kode: e.target.value })}
                  className={inputClass}
                  placeholder="otomatis"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Nama</label>
                <input
                  required
                  autoFocus
                  value={formBaru.nama}
                  onChange={(e) => setFormBaru({ ...formBaru, nama: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Kategori</label>
              <select
                value={formBaru.kategori}
                onChange={(e) =>
                  setFormBaru({ ...formBaru, kategori: e.target.value as BahanKategori })
                }
                className={inputClass}
              >
                {!kategoriList?.some((k) => k.nama === formBaru.kategori) &&
                  formBaru.kategori && (
                    <option value={formBaru.kategori}>{formBaru.kategori}</option>
                  )}
                {(kategoriList ?? []).map((k) => (
                  <option key={k.id} value={k.nama}>
                    {k.nama}
                  </option>
                ))}
              </select>
            </div>
            <ErrorText error={buatBahan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setFormBaru(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={buatBahan.isPending} className={btnPrimary}>
                Simpan &amp; atur resep
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
