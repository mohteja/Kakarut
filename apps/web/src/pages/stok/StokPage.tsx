import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { qtyTeks, ringkasNilaiStok } from "@kakarut/shared";
import type {
  ExpLotRow,
  MenuDto,
  MenuStokDto,
  NilaiStokRingkas,
  PenyimpananDto,
  StokRowDto,
} from "@kakarut/shared";

/** Ringkasan kosong — dipakai selagi `GET /stok/nilai` belum tiba. */
const KOSONG_NILAI: NilaiStokRingkas = {
  nilai: 0,
  bahan_bernilai: 0,
  minus_bahan: 0,
  minus_nilai: 0,
  tanpa_harga_bahan: 0,
};
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  StatCard,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { CabangDataBar } from "../../components/CabangDataBar";
import { CatatWasteModal } from "./CatatWasteModal";
import { StokPerlengkapanTab } from "./StokPerlengkapanTab";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import {
  formatAngka,
  formatRupiah,
  labelTahapPembelian,
  labelTahapProduksi,
} from "../../lib/format";

export function StokPage() {
  const { auth } = useAuth();
  // Stok bersifat fisik per cabang — dari Kantor pilih cabang datanya.
  const { id: dataId, query: branchQuery } = useCabangData();
  const { cabang } = useBranch();
  // Jenis lokasi data terpilih menentukan stok apa yang relevan:
  //  - store          → simpan bahan + jual menu (Stok Bahan + Stok Menu)
  //  - central_kitchen → produksi bahan, TIDAK jual menu (Stok Bahan saja)
  //  - kantor          → kantor tak menyimpan stok fisik (tak ada keduanya)
  const selTipe = cabang.find((b) => b.id === dataId)?.tipe;
  const isKantorData = selTipe === "kantor";
  const bolehStokMenu = selTipe !== "central_kitchen" && selTipe !== "kantor";
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  // Dua tampilan: stok BAHAN (baris per bahan baku) & stok MENU (sisa porsi
  // per menu, diturunkan dari saldo bahan — selalu berkorelasi otomatis).
  const [tab, setTab] = useState<"bahan" | "menu" | "perlengkapan">("bahan");
  // Pindah ke tab bahan bila Stok Menu tak relevan (CK/kantor) supaya tak
  // menampilkan tab kosong saat lokasi data berganti.
  useEffect(() => {
    if (tab === "menu" && !bolehStokMenu) setTab("bahan");
  }, [tab, bolehStokMenu]);

  const { data: stok, isLoading, error: stokGagal } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  // Sisa porsi per menu — query key sama dengan kasir agar cache berbagi.
  const { data: ketersediaan = [], error: porsiGagal } = useQuery({
    queryKey: ["menu-ketersediaan", branchQuery],
    queryFn: () => api<MenuStokDto[]>(`/menu/ketersediaan${branchQuery}`),
    enabled: tab === "menu",
  });
  const { data: menus = [], error: menuGagal } = useQuery({
    queryKey: ["menu", branchQuery],
    queryFn: () => api<MenuDto[]>(`/menu${branchQuery}`),
    enabled: tab === "menu",
  });
  const { data: tempatList = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  // PERINGATAN EXP: lot hampir/lewat tanggal kedaluwarsa (7 hari ke depan)
  const { data: expLots = [], error: expGagal } = useQuery({
    queryKey: ["stok-exp", branchQuery],
    queryFn: () =>
      api<ExpLotRow[]>(`/stok/exp${branchQuery ? `${branchQuery}&hari=7` : "?hari=7"}`),
    enabled: !isKantorData,
  });
  const [bukaExp, setBukaExp] = useState(false);
  const [wasteLot, setWasteLot] = useState<ExpLotRow | null>(null);
  // sisa hari exp TERDEKAT per bahan → badge per baris tabel
  const expByIng = new Map<string, number>();
  for (const l of expLots) {
    const ada = expByIng.get(l.ingredient_id);
    if (ada == null || l.sisa_hari < ada) expByIng.set(l.ingredient_id, l.sisa_hari);
  }
  const adaLewat = expLots.some((l) => l.sisa_hari < 0);

  const [cari, setCari] = useState("");
  const [filterTempat, setFilterTempat] = useState<string>("semua");

  const tampil = (stok ?? [])
    .filter((s) => s.nama.toLowerCase().includes(cari.toLowerCase()))
    .filter((s) =>
      filterTempat === "semua"
        ? true
        : filterTempat === "tanpa"
          ? s.tempat_id === null
          : s.tempat_id === filterTempat,
    );

  // NILAI RUPIAH STOK — dihitung atas baris yang SEDANG TAMPIL, bukan seluruh
  // daftar, supaya angkanya selalu bisa dicocokkan sendiri dengan tabel di
  // bawahnya. Filter yang aktif disebutkan eksplisit di kartunya (lihat
  // `terfilter`); ringkasan yang diam-diam ikut menyempit adalah ringkasan yang
  // salah dibaca sebagai total.
  const terfilter = cari.trim() !== "" || filterTempat !== "semua";
  /*
   * Bila server MENAHAN harga per bahan (peran non-manajemen —
   * `bolehLihatBiaya`), totalnya tak bisa disusun dari baris: yang tersisa
   * cuma agregat `GET /stok/nilai`, dihitung server SEBELUM harganya ditahan.
   * Konsekuensinya jujur dan disebut di layar: angkanya SELURUH cabang, tak
   * ikut menyempit saat kotak cari terisi.
   */
  const hargaDitahan = (stok ?? []).some((r) => r.harga_per_unit == null);
  const { data: nilaiServer } = useQuery({
    queryKey: ["stok-nilai", branchQuery],
    queryFn: () => api<NilaiStokRingkas>(`/stok/nilai${branchQuery}`),
    enabled: hargaDitahan,
  });
  const nilai = hargaDitahan ? (nilaiServer ?? KOSONG_NILAI) : ringkasNilaiStok(tampil);
  const nilaiSemua = hargaDitahan ? (nilaiServer ?? KOSONG_NILAI) : ringkasNilaiStok(stok ?? []);

  // Stok Menu: gabungkan katalog menu aktif dengan sisa porsi + bahan pembatas
  const porsiByMenu = new Map(ketersediaan.map((k) => [k.menu_id, k]));
  const menuTampil = menus
    .filter(
      (m) =>
        m.nama.toLowerCase().includes(cari.toLowerCase()) ||
        (m.kode?.toLowerCase().includes(cari.toLowerCase()) ?? false),
    )
    .map((m) => ({ menu: m, stok: porsiByMenu.get(m.id) }))
    .sort((a, b) => {
      const pa = a.stok?.porsi ?? Number.POSITIVE_INFINITY;
      const pb = b.stok?.porsi ?? Number.POSITIVE_INFINITY;
      return pa - pb; // porsi paling sedikit di atas (paling butuh perhatian)
    });

  return (
    <div>
      <CabangDataBar />
      <PageTitle
        aksi={
          !isKantorData && tab !== "menu" ? (
            <div className="flex flex-wrap gap-2">
              {/* ACC/Tolak selisih kini per produk di dalam Riwayat Stock Opname. */}
              {tab === "bahan" && (
                <Link to="/stok/opname/riwayat" className={btnSecondary}>
                  🕑 Riwayat
                </Link>
              )}
              {/* Stok Awal = saldo pembuka stok yang sudah ada (onboarding) */}
              {tab === "bahan" && isManajemen && (
                <Link to="/stok/awal" className={btnSecondary}>
                  📦 Stok Awal
                </Link>
              )}
              {/* DUA jalur opname terpisah — bahan baku vs perlengkapan; keduanya
                  dilakukan staf cabang & CK dari halaman Stok ini */}
              <Link
                to="/stok/opname"
                className={tab === "bahan" ? btnPrimary : btnSecondary}
              >
                📋 Opname Bahan Baku
              </Link>
              <Link
                to="/stok/opname-perlengkapan"
                className={tab === "perlengkapan" ? btnPrimary : btnSecondary}
              >
                🧰 Opname Perlengkapan
              </Link>
            </div>
          ) : undefined
        }
      >
        {isKantorData
          ? "Stok"
          : tab === "bahan"
            ? "Stok Bahan"
            : tab === "perlengkapan"
              ? "Stok Perlengkapan"
              : "Stok Menu"}
      </PageTitle>

      {/* Kantor tak menyimpan stok fisik — arahkan ke lokasi yang menyimpan */}
      {isKantorData && (
        <Card className="p-6 text-center text-sm text-stone-500">
          🏢 <b>Kantor</b> tidak menyimpan stok. Pilih cabang <b>store</b> (menyimpan bahan &
          menjual menu) atau <b>Central Kitchen</b> (menyimpan bahan produksi) di pemilih
          <b> "Dari Kantor — data cabang"</b> di atas.
        </Card>
      )}

      {/* Tab: stok per bahan baku vs sisa porsi per menu. Stok Menu hanya untuk
          store (menu dijual di store; CK memproduksi bahan, tak menjual menu). */}
      {!isKantorData && (
        <div className="mb-3 flex overflow-hidden rounded-lg border border-stone-300 text-sm w-fit">
          <button
            type="button"
            onClick={() => setTab("bahan")}
            className={`px-3 py-1.5 font-medium ${
              tab === "bahan" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            🥩 Stok Bahan
          </button>
          {bolehStokMenu && (
            <button
              type="button"
              onClick={() => setTab("menu")}
              className={`px-3 py-1.5 font-medium ${
                tab === "menu" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              🍜 Stok Menu
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab("perlengkapan")}
            className={`px-3 py-1.5 font-medium ${
              tab === "perlengkapan" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            🧰 Perlengkapan
          </button>
        </div>
      )}

      {isKantorData ? null : tab === "menu" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari menu / kode…"
              className={`${inputClass} max-w-56`}
            />
            <span className="text-xs text-stone-400">
              Sisa porsi dihitung otomatis dari saldo stok bahan (resep per porsi).
            </span>
          </div>
          {/*
            Kaidah yang sama dengan tab Bahan di bawah — GAGAL MEMUAT ≠ TIDAK
            ADA — tapi di sini bentuk bohongnya lebih parah dari sekadar layar
            kosong. Dua permintaan yang BERBEDA menyusun tabel ini:

              /menu              → daftar menunya
              /menu/ketersediaan → sisa porsi per menu (agregat mahal)

            Gagal yang kedua saja sudah cukup, dan itu justru yang paling
            mungkin gagal duluan. Porsi yang tak ketemu jatuh ke `null`, dan
            `null` di kolom ini SUDAH punya arti lain: "menu ini tak dibatasi
            bahan apa pun" → dirender "∞" dengan status "tak terbatas". Jadi
            layar yang tak berhasil membaca stok justru berkata SETIAP menu
            bisa dijual tanpa batas — bacaan paling menenangkan yang mungkin,
            tepat ketika ia tak tahu apa-apa.
          */}
          {menuGagal && (
            <Card className="mb-3 p-4">
              <ErrorText error={menuGagal} />
              <div className="mt-2 text-sm text-stone-500">
                Daftar menu tidak bisa dimuat — layar kosong di bawah <b>bukan</b> berarti tak
                ada menu aktif.
              </div>
            </Card>
          )}
          {!menuGagal && porsiGagal && (
            <Card className="mb-3 p-4">
              <ErrorText error={porsiGagal} />
              <div className="mt-2 text-sm text-stone-500">
                Sisa porsi tidak bisa dihitung — kolom <b>Sisa Porsi</b> di bawah ditampilkan
                <b> "?"</b>, bukan "∞". Menu yang sebenarnya sudah habis bahannya tetap
                terlihat bisa dijual sampai halaman ini berhasil dimuat ulang.
              </div>
            </Card>
          )}
          <TabelResponsif
            data={menuTampil}
            kunci={({ menu: m }) => m.id}
            kosong={
              menuGagal
                ? "Data tidak dapat dimuat — bukan berarti kosong."
                : cari
                  ? `Menu "${cari}" tidak ditemukan.`
                  : "Belum ada menu aktif."
            }
            kolom={[
              {
                judul: "Kode",
                hp: "sub",
                sel: ({ menu: m }) =>
                  m.kode ? (
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-700">
                      {m.kode}
                    </span>
                  ) : (
                    "—"
                  ),
              },
              { judul: "Menu", hp: "judul", kelasSel: "font-medium", sel: ({ menu: m }) => m.nama },
              {
                judul: "Kategori",
                kelasSel: "text-stone-500",
                sel: ({ menu: m }) => m.kategori,
              },
              {
                judul: "Harga",
                kanan: true,
                sel: ({ menu: m }) => formatRupiah(m.harga_jual),
              },
              {
                judul: "Sisa Porsi",
                kanan: true,
                kelasSel: "text-lg font-bold",
                sel: ({ stok: st }) => {
                  const porsi = st?.porsi ?? null;
                  // "?" saat bacaannya gagal — "∞" berarti "memang tak
                  // dibatasi bahan", pernyataan yang tak boleh dikarang.
                  return (
                    <span
                      className={`text-lg font-bold ${porsiGagal ? "text-stone-400" : ""}`}
                      title={porsiGagal ? "Sisa porsi tidak terbaca" : undefined}
                    >
                      {porsiGagal ? "?" : porsi == null ? "∞" : formatAngka(porsi)}
                    </span>
                  );
                },
              },
              {
                judul: "Bahan Pembatas",
                kelasSel: "text-stone-600",
                sel: ({ stok: st }) =>
                  porsiGagal ? (
                    <span className="text-stone-400">tidak terbaca</span>
                  ) : st?.pembatas ? (
                    <span
                      title={`${formatAngka(st.pembatas.qty_per_porsi)} ${st.pembatas.satuan}/porsi`}
                    >
                      {st.pembatas.nama}
                      <span className="ml-1 text-xs text-stone-400">
                        (sisa {formatAngka(st.pembatas.saldo)} {st.pembatas.satuan})
                      </span>
                    </span>
                  ) : (
                    <span className="text-stone-400">tidak dibatasi bahan</span>
                  ),
              },
              {
                judul: "Status",
                sel: ({ stok: st }) => {
                  const porsi = st?.porsi ?? null;
                  const status =
                    porsi == null ? null : porsi <= 0 ? "habis" : porsi <= 5 ? "menipis" : "aman";
                  if (porsiGagal)
                    return (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
                        tak terbaca
                      </span>
                    );
                  return status ? (
                    <StatusBadge status={status} />
                  ) : (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
                      tak terbatas
                    </span>
                  );
                },
              },
            ]}
          />
        </>
      ) : tab === "perlengkapan" ? (
        <StokPerlengkapanTab
          branchQuery={branchQuery}
          dataId={dataId}
          isManajemen={isManajemen}
          cari={cari}
          setCari={setCari}
        />
      ) : isLoading ? (
        <Spinner />
      ) : (
        <>
      {/*
        RINGKASAN NILAI STOK — modal yang mengendap di rak, dalam rupiah.
        Tabel di bawah punya puluhan baris qty dan tak satu pun angka rupiah,
        jadi sebelum ini "berapa nilai stok saya" cuma bisa dijawab dengan
        mengalikan sendiri baris demi baris.

        TIDAK dirender saat `stokGagal`: `tampil` kosong karena bacaannya gagal,
        dan kartu yang tetap muncul akan menuliskan "Rp 0" — pernyataan yang
        jauh lebih percaya diri daripada tabel kosong di bawahnya, dan salah.

        Kartu kedua & ketiga hanya muncul bila memang ada perkaranya. Keduanya
        menyebut apa yang TIDAK ikut dijumlahkan; tanpa itu totalnya tampak
        lengkap padahal ia sengaja melewatkan sesuatu.
      */}
      {!stokGagal && (stok?.length ?? 0) > 0 && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={terfilter && !hargaDitahan ? "Nilai Stok (terfilter)" : "Nilai Stok"}
            value={formatRupiah(nilai.nilai)}
            warna="text-orange-600"
            sub={
              <>
                {nilai.bahan_bernilai} bahan · dinilai dengan harga beli terkini
                {terfilter && !hargaDitahan && (
                  <> · seluruh bahan {formatRupiah(nilaiSemua.nilai)}</>
                )}
                {hargaDitahan && <> · seluruh cabang (harga per bahan tak ditampilkan)</>}
              </>
            }
          />
          {nilai.minus_bahan > 0 && (
            <StatCard
              label="Saldo Minus"
              value={`${nilai.minus_bahan} bahan`}
              warna="text-red-600"
              sub={
                <>
                  tidak ikut dinilai — barangnya kemungkinan ada, penerimaannya yang
                  belum tercatat (setara {formatRupiah(nilai.minus_nilai)})
                </>
              }
            />
          )}
          {nilai.tanpa_harga_bahan > 0 && (
            <StatCard
              label="Belum Berharga"
              value={`${nilai.tanpa_harga_bahan} bahan`}
              warna="text-stone-600"
              sub="harga belinya masih 0 — nilainya belum masuk total di sebelah"
            />
          )}
        </div>
      )}

      {/*
        Peringatan exp yang gagal dimuat MENGHILANG tanpa bekas, dan hilangnya
        spanduk itu sendiri sebuah pernyataan: "tak ada yang mau kedaluwarsa".
        Bahan yang lewat tanggal tetap lewat tanggal walau layarnya diam.
      */}
      {expGagal && (
        <div className="mb-3 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-600">
          ⏳ Peringatan kedaluwarsa tidak bisa dimuat — <b>bukan</b> berarti tak ada bahan yang
          mendekati tanggalnya. Periksa lot manual atau muat ulang halaman ini.
        </div>
      )}
      {/* PERINGATAN EXP: lot hampir/lewat kedaluwarsa → daftar + Catat waste.
          Aproksimasi: qty = saat lot masuk (ledger agregat, bukan sisa lot). */}
      {expLots.length > 0 && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            adaLewat ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <button
            type="button"
            onClick={() => setBukaExp((v) => !v)}
            className={`flex w-full items-center justify-between font-semibold ${
              adaLewat ? "text-red-800" : "text-amber-800"
            }`}
          >
            <span>
              ⏳ {expLots.length} lot bahan {adaLewat ? "lewat/hampir" : "hampir"} kedaluwarsa
              (≤ 7 hari)
            </span>
            <span>{bukaExp ? "▴" : "▾"}</span>
          </button>
          {bukaExp && (
            <div className="mt-2 space-y-1.5">
              {expLots.map((l) => (
                <div
                  key={l.production_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5"
                >
                  <div className="min-w-0 text-xs text-stone-700">
                    <b>{l.nama}</b> · masuk {formatAngka(l.qty_masuk)} {l.satuan}
                    {l.nomor && <> · {l.nomor}</>}
                    {l.tempat && <> · 🗄 {l.tempat}</>}
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        l.sisa_hari < 0
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {l.sisa_hari < 0
                        ? `❌ lewat ${-l.sisa_hari} hr (exp ${l.exp_date})`
                        : l.sisa_hari === 0
                          ? "⚠ exp HARI INI"
                          : `⚠ exp ${l.sisa_hari} hr lagi (${l.exp_date})`}
                    </span>
                    <div className="text-[10px] text-stone-400">
                      qty saat masuk — saldo bahan kini {formatAngka(l.saldo)} {l.satuan}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWasteLot(l)}
                    disabled={l.saldo <= 0}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                    title={
                      l.saldo <= 0
                        ? "Saldo bahan sudah 0 — tidak ada yang bisa di-waste"
                        : "Catat waste (masuk alur ACC Riwayat SO)"
                    }
                  >
                    🗑 Catat waste
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan…"
          className={`${inputClass} max-w-56`}
        />
        <select
          value={filterTempat}
          onChange={(e) => setFilterTempat(e.target.value)}
          className={`${inputClass} max-w-56`}
          aria-label="Filter tempat penyimpanan"
        >
          <option value="semua">Semua tempat penyimpanan</option>
          {tempatList.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nama}
            </option>
          ))}
          <option value="tanpa">Tanpa tempat</option>
        </select>
        {filterTempat !== "semua" && (
          <button
            onClick={() => setFilterTempat("semua")}
            className="text-sm font-medium text-orange-600 hover:underline"
          >
            Reset filter
          </button>
        )}
      </div>

      {/*
        GAGAL MEMUAT ≠ TIDAK ADA BAHAN. Tanpa ini keduanya menghasilkan kalimat
        yang sama: "Belum ada bahan yang melacak stok di lokasi ini." Halaman
        inilah tempat peringatan stok menipis dibaca — layar kosong yang
        sebenarnya galat membuat pemilik menyimpulkan tak ada yang perlu
        dibeli. Server MATI sudah punya overlay; yang lolos diam-diam adalah
        penolakan biasa seperti hak akses cabang.
      */}
      {stokGagal && (
        <Card className="mb-3 p-4">
          <ErrorText error={stokGagal} />
          <div className="mt-2 text-sm text-stone-500">
            Saldo stok tidak bisa dimuat — daftar di bawah <b>bukan</b> berarti kosong, dan
            peringatan stok menipis tidak bisa dipercaya sampai halaman ini berhasil dimuat ulang.
          </div>
        </Card>
      )}
      <TabelResponsif
        data={tampil}
        kunci={(s) => s.ingredient_id}
        kosong={
          stokGagal
            ? "Data tidak dapat dimuat — bukan berarti kosong."
            : "Belum ada bahan yang melacak stok di lokasi ini."
        }
        kolom={[
          {
            judul: "Bahan",
            hp: "judul",
            kelasSel: "font-medium",
            sel: (s) => (
              <>
                {s.nama}
                {s.produksi_berjalan && (
                  <span
                    className="ml-2 whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800"
                    title={`Direncanakan ${formatAngka(s.produksi_berjalan.rencana)} · Dikerjakan ${formatAngka(s.produksi_berjalan.dikerjakan)} · Menunggu konfirmasi ${formatAngka(s.produksi_berjalan.menunggu)}`}
                  >
                    🏭 +{formatAngka(s.produksi_berjalan.qty)} ·{" "}
                    {labelTahapProduksi(s.produksi_berjalan)}
                  </span>
                )}
                {s.pembelian_berjalan && (
                  <span
                    className="ml-2 whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
                    title={`RAB ${formatAngka(s.pembelian_berjalan.rencana)} · Diproses ${formatAngka(s.pembelian_berjalan.dikerjakan)} · Dikirim ${formatAngka(s.pembelian_berjalan.menunggu)}`}
                  >
                    🛒 +{formatAngka(s.pembelian_berjalan.qty)} ·{" "}
                    {labelTahapPembelian(s.pembelian_berjalan)}
                  </span>
                )}
                {expByIng.has(s.ingredient_id) && (
                  <span
                    className={`ml-2 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                      expByIng.get(s.ingredient_id)! < 0
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-800"
                    }`}
                    title="Ada lot bahan ini yang hampir/lewat tanggal kedaluwarsa — lihat peringatan di atas"
                  >
                    {expByIng.get(s.ingredient_id)! < 0
                      ? "⏳ lewat exp"
                      : `⏳ exp ${expByIng.get(s.ingredient_id)} hr`}
                  </span>
                )}
              </>
            ),
          },
          { judul: "Tempat", kelasSel: "text-stone-500", sel: (s) => s.tempat ?? "—" },
          { judul: "Stok Awal", kanan: true, sel: (s) => formatAngka(s.stok_awal) },
          {
            judul: "Masuk",
            kanan: true,
            kelasJudul: "",
            sel: (s) => (
              <span className="text-green-700">
                {s.produksi > 0 ? `+${formatAngka(s.produksi)}` : "—"}
              </span>
            ),
          },
          {
            judul: "Terpakai",
            kanan: true,
            sel: (s) => (
              <span className="text-red-600">
                {s.terpakai > 0 ? `−${formatAngka(s.terpakai)}` : "—"}
              </span>
            ),
          },
          {
            /*
             * SATUAN DITEMPELKAN DI SALDO — sekali per baris, bukan di keempat
             * kolom angkanya.
             *
             * Keempat kolom (Stok Awal, Masuk, Terpakai, Saldo) memakai satuan
             * yang SAMA, jadi menuliskannya empat kali cuma menggandakan
             * kebisingan tanpa menambah keterangan. Ditempelkan di Saldo karena
             * itu angka yang menjawab pertanyaannya: berapa yang saya punya.
             *
             * Polanya menyalin tab PERLENGKAPAN di halaman yang sama, yang
             * sudah begini sejak awal — tab Stok Bahan yang tertinggal, dan
             * bedanya cukup untuk membuat yang membacanya bertanya "ini
             * satuannya apa".
             */
            judul: "Saldo",
            kanan: true,
            sel: (s) => {
              const q = qtyTeks({
                qty: s.saldo,
                satuan: s.satuan,
                isi: s.isi,
                satuanBeli: s.satuan_beli,
              });
              return (
                <span>
                  <span className="whitespace-nowrap">
                    <span className="font-bold">{formatAngka(s.saldo)}</span>{" "}
                    <span className="font-normal text-stone-500">{s.satuan}</span>
                  </span>
                  {/*
                    Padanan kemasan hanya muncul bila bahan ini memang dibeli
                    per kemasan (`isi > 1` + satuan beli terisi). Itu yang
                    menjembatani dua satuan yang selama ini tak pernah bertemu
                    di satu layar: belanja memakai "dus", stok memakai "pcs".
                  */}
                  {q.setara && s.saldo !== 0 && (
                    <div className="whitespace-nowrap text-xs font-normal text-stone-400">
                      {q.setara}
                    </div>
                  )}
                </span>
              );
            },
          },
          { judul: "Status", sel: (s) => <StatusBadge status={s.status} /> },
          {
            hp: "aksi",
            kelasSel: "whitespace-nowrap text-right",
            sel: (s) => (
              <a
                href={`/stok/kartu/${s.ingredient_id}${branchQuery}`}
                target="_blank"
                rel="noopener"
                className="text-sm font-medium text-orange-600 hover:underline"
                title="Buka kartu stok di tab baru"
              >
                📄 Kartu
              </a>
            ),
          },
        ]}
      />
        </>
      )}

      {wasteLot && (
        <CatatWasteModal lot={wasteLot} branchId={dataId} onClose={() => setWasteLot(null)} />
      )}
    </div>
  );
}
