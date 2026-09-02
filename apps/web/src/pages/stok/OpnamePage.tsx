import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { OpnameRingkasan, PenyimpananDto, StokRowDto } from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
import { ImageUpload } from "../../components/ImageUpload";
import {
  ErrorText,
  SpinnerAtauGalat,
  btnPrimary,
  btnSecondary,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../../lib/format";
import { uuidV4 } from "../../lib/idempoten";

/**
 * Stock opname bahan baku — alur bertahap:
 *   1. pilih LOKASI (tempat penyimpanan) yang akan diopname,
 *   2. pilih PRODUK mana saja yang dihitung,
 *   3. baru mulai PENGECEKAN (hitung fisik vs sistem, simpan).
 * Tampilan padat multi-kolom di layar lebar agar satu halaman muat banyak.
 */
type Langkah = "lokasi" | "produk" | "hitung";
const BUCKET_SEMUA = "__semua__";
const BUCKET_TANPA = "__tanpa__";

export function OpnamePage() {
  const { auth } = useAuth();
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Peran terikat cabang (kasir, tim & kitchen) hanya melihat/opname tempat
  // yang ditugaskan padanya (atau terbuka) — owner/admin bebas.
  const terikat =
    auth?.user.role === "cashier" ||
    auth?.user.role === "tim" ||
    auth?.user.role === "kitchen" ||
    auth?.user.role === "bar";

  const { data: stok, isLoading: stokLoading, error: gagalStok } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  const {
    data: tempatList = [],
    isLoading: tempatLoading,
    error: gagalTempat,
  } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  const memuat = stokLoading || tempatLoading;
  /**
   * KOSONG ≠ TAK TERBACA — dan tak ada layar yang lebih buruk untuk keliru
   * soal ini. Ini layar penghitungan stok fisik.
   *
   * Bacaan yang gagal berakhir `isLoading === false` DAN `data === undefined`,
   * jadi `memuat` bernilai false dan dua kalimat di bawah muncul sebagai
   * kesimpulan:
   *
   *   "Belum ada tempat penyimpanan yang bisa Anda opname."  ← rak tak terbaca
   *   "Tidak ada bahan di lokasi ini."                       ← stok tak terbaca
   *
   * Keduanya menyuruh petugas pulang: tak ada rak yang jadi tanggung jawabnya,
   * atau raknya memang kosong. Padahal yang gagal cuma bacaannya, dan
   * hitungan hari itu tak pernah terjadi — tanpa satu pun tanda di layar
   * maupun di riwayat.
   */
  const gagalMuat = gagalStok ?? gagalTempat;

  const [langkah, setLangkah] = useState<Langkah>("lokasi");
  const [bucket, setBucket] = useState<string | null>(null);
  const [dipilih, setDipilih] = useState<Record<string, boolean>>({});
  const [fisik, setFisik] = useState<Record<string, string>>({});
  // Bukti foto + alasan per bahan berselisih (dilampirkan saat pengecekan).
  const [fotoSelisih, setFotoSelisih] = useState<Record<string, string>>({});
  const [alasanSelisih, setAlasanSelisih] = useState<Record<string, string>>({});
  const [cari, setCari] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [hasil, setHasil] = useState<OpnameRingkasan | null>(null);
  // nomor sesi (SO-0001) dari respons simpan — tampil di layar sukses
  const [nomorSesi, setNomorSesi] = useState<string | null>(null);

  // Nama CABANG TARGET opname harus tampak: owner dari Kantor menulis ke
  // cabang data terpilih — salah cabang tidak boleh terjadi diam-diam.
  const { cabang } = useBranch();
  const namaCabang =
    cabang.find((b) => b.id === branchId)?.nama ??
    auth?.branch?.nama ??
    auth?.company?.nama ??
    "Cabang";
  const myId = auth?.user.sub;

  const petugasByLoc = useMemo(() => {
    const m = new Map<string, PenyimpananDto["petugas"]>();
    for (const t of tempatList) m.set(t.id, t.petugas);
    return m;
  }, [tempatList]);

  // tempat yang boleh diopname oleh user ini (kasir/tim dibatasi petugas).
  // Hanya petugas yang masih ANGGOTA AKTIF yang dihitung — penugasan basi
  // (akun diarsip/dihapus/dibuat ulang) tidak boleh mengunci rak diam-diam.
  const tempatBoleh = useMemo(() => {
    if (!terikat) return tempatList;
    return tempatList.filter((t) => {
      const p = t.petugas.filter((x) => x.aktif !== false);
      return p.length === 0 || p.some((x) => x.user_id === myId);
    });
  }, [tempatList, terikat, myId]);

  // seluruh bahan yang boleh dilihat user (petugas terpasang membatasi kasir/tim)
  const stokBoleh = useMemo(() => {
    return (stok ?? []).filter((s) => {
      if (!terikat || !s.tempat_id) return true;
      const p = (petugasByLoc.get(s.tempat_id) ?? []).filter((x) => x.aktif !== false);
      return p.length === 0 || p.some((x) => x.user_id === myId);
    });
  }, [stok, terikat, petugasByLoc, myId]);

  function itemsDiBucket(b: string): StokRowDto[] {
    return stokBoleh.filter((s) =>
      b === BUCKET_SEMUA
        ? true
        : b === BUCKET_TANPA
          ? s.tempat_id === null
          : s.tempat_id === b,
    );
  }

  const adaTanpaTempat = stokBoleh.some((s) => s.tempat_id === null);

  // daftar bahan pada bucket terpilih (untuk langkah produk & hitung)
  const bucketItems = useMemo(
    () => (bucket ? itemsDiBucket(bucket) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, stokBoleh],
  );
  const bucketNama =
    bucket === BUCKET_SEMUA
      ? "Semua tempat"
      : bucket === BUCKET_TANPA
        ? "Tanpa tempat"
        : (tempatList.find((t) => t.id === bucket)?.nama ?? "Lokasi");
  const petugasBucket =
    bucket && bucket !== BUCKET_SEMUA && bucket !== BUCKET_TANPA
      ? (petugasByLoc.get(bucket) ?? [])
      : null;

  function bukaBucket(b: string) {
    // Hitungan BARU = kejadian baru: kuncinya dicabut supaya kiriman berikutnya
    // tak dianggap ulangan dari sesi sebelumnya (lihat `refSesi`).
    refSesi.current = null;
    setBucket(b);
    // default: semua produk di lokasi ini tercentang (deselect yang tak perlu)
    const sel: Record<string, boolean> = {};
    for (const s of itemsDiBucket(b)) sel[s.ingredient_id] = true;
    setDipilih(sel);
    setFisik({});
    setFotoSelisih({});
    setAlasanSelisih({});
    setCari("");
    setLangkah("produk");
  }

  // produk terpilih (untuk langkah hitung)
  const produkTerpilih = bucketItems.filter((s) => dipilih[s.ingredient_id]);
  const jumlahPilih = produkTerpilih.length;
  const tampilProduk = bucketItems.filter((s) =>
    s.nama.toLowerCase().includes(cari.toLowerCase()),
  );
  const semuaTercentang = tampilProduk.length > 0 && tampilProduk.every((s) => dipilih[s.ingredient_id]);
  const diisi = produkTerpilih.filter(
    (s) => fisik[s.ingredient_id] !== undefined && fisik[s.ingredient_id] !== "",
  );
  const terisi = diisi.length;
  // Isian yang TERISI tapi tak terbaca sebagai angka. Tanpa pagar ini ia lolos
  // penyaring `!== ""`, jadi NaN, lalu `JSON.stringify` mengubahnya jadi `null`
  // dan server membalas galat validasi yang tak menyebut baris mana. Opname
  // menulis penyesuaian stok sungguhan — lebih baik ditahan di sini, dengan
  // nama bahannya disebut.
  const salahKetik = diisi.filter((s) => Number.isNaN(angkaDari(fisik[s.ingredient_id])));
  /**
   * Hitungan fisik yang MINUS. Terjadi di lapangan (2026-09-02, 54 kali dalam
   * 29 menit dari dua akun): saldo sistem beberapa bahan sudah minus (mis.
   * nata de coco −100), tombol "= sistem" menyalin angka itu apa adanya, dan
   * server — yang benar — menolak `qty: minimal 0` sambil menyebut
   * `items[26]`, indeks yang tak bisa dicocokkan siapa pun dengan bahan. Rak
   * tak pernah berisi −100; hitungan fisik paling sedikit 0, dan selisih dari
   * buku yang minus memang selisih yang menunggu ACC. Ditahan di sini dengan
   * NAMA bahannya, sebelum satu byte pun dikirim.
   */
  const negatif = diisi.filter((s) => {
    const n = angkaDari(fisik[s.ingredient_id]);
    return !Number.isNaN(n) && n < 0;
  });

  /**
   * Kunci idempotensi SATU SESI penghitungan, bertahan melintasi percobaan
   * ulang.
   *
   * Jaringan yang putus SESUDAH server menyimpan tapi SEBELUM balasannya
   * sampai membuat mutasi ini gagal — lembar konfirmasinya tetap terbuka
   * (`onSuccess` tak jalan) dengan tombol Simpan yang hidup lagi, dan yang
   * menekan ulang tak punya cara tahu hitungannya sudah tercatat. Sesi kedua
   * lalu lahir dengan angka yang sama persis.
   *
   * Nilai stoknya memang tak ikut salah — opname adalah baseline MUTLAK, bukan
   * selisih, jadi dua baseline identik mendarat di angka yang sama. Yang rusak
   * jejaknya: Riwayat Opname memuat dua sesi kembar, dan owner harus meng-ACC
   * dua kali untuk satu penghitungan yang sama. Di layar yang justru dipakai
   * memeriksa kejujuran stok, riwayat kembar itu sendiri jadi pertanyaan.
   *
   * Dibuang saat sesinya benar-benar selesai (`onSuccess`) dan saat petugas
   * kembali memilih lokasi/produk — hitungan BARU harus jadi kejadian baru.
   * Bandingkan `RefundPanel`, yang mencabut kuncinya tiap porsi berubah:
   * aturannya sama — kunci mengikat ISI, bukan umur komponen.
   */
  const refSesi = useRef<string | null>(null);

  const simpan = useMutation({
    mutationFn: () => {
      const items = produkTerpilih
        .filter((s) => fisik[s.ingredient_id] !== undefined && fisik[s.ingredient_id] !== "")
        .map((s) => {
          const sel = angkaDari(fisik[s.ingredient_id]) - s.saldo;
          const ada = Math.abs(sel) > 1e-9;
          return {
            ingredient_id: s.ingredient_id,
            qty: angkaDari(fisik[s.ingredient_id]),
            // bukti + alasan hanya untuk baris berselisih
            foto_url: ada ? (fotoSelisih[s.ingredient_id] ?? null) : null,
            alasan: ada ? (alasanSelisih[s.ingredient_id]?.trim() || null) : null,
          };
        });
      return api<{ ringkasan: OpnameRingkasan; session_id: string; nomor: string | null }>("/stok/opname", {
        method: "POST",
        body: {
          ...(!terikat && branchId ? { branch_id: branchId } : {}),
          client_ref: (refSesi.current ??= uuidV4()),
          items,
          catatan: `Opname ${bucketNama}`,
        },
      });
    },
    onSuccess: (data) => {
      setKonfirmasi(false);
      setHasil(data.ringkasan);
      setNomorSesi(data.nomor ?? null);
      setFisik({});
      setFotoSelisih({});
      setAlasanSelisih({});
      setDipilih({});
      setBucket(null);
      setLangkah("lokasi");
      refSesi.current = null;
      // Baris BERSELISIH menunggu ACC (belum mengubah saldo), tapi baris yang
      // COCOK masuk langsung `disetujui` — dan itu sudah cukup menggeser
      // keluaran `/stok/fifo` (baris 'opname' baru di rentetan event) maupun
      // `/stok/exp` (baseline opname terakhir bergeser). Sesinya juga muncul
      // di Riwayat Opname.
      for (const k of ["stok", "kartu-stok", "stok-exp", "stok-fifo", "opname-riwayat"]) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
    },
  });

  function selisihDari(s: StokRowDto): number | null {
    const v = fisik[s.ingredient_id];
    if (v === undefined || v === "") return null;
    return angkaDari(v) - s.saldo;
  }

  // Baris berselisih yang belum dilampiri bukti foto — memblokir Simpan.
  const selisihTanpaFoto = produkTerpilih.filter((s) => {
    const sel = selisihDari(s);
    return sel !== null && Math.abs(sel) > 1e-9 && !fotoSelisih[s.ingredient_id];
  });

  function kembali() {
    if (langkah === "hitung") setLangkah("produk");
    else if (langkah === "produk") setLangkah("lokasi");
    else navigate("/");
  }

  const subJudul =
    langkah === "lokasi"
      ? "Pilih tempat penyimpanan"
      : langkah === "produk"
        ? `${bucketNama} · ${jumlahPilih} produk dipilih`
        : `${bucketNama} · ${terisi} dari ${jumlahPilih} dihitung`;

  return (
    <div className="flex min-h-screen flex-col bg-stone-100">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 shadow-sm">
        <button onClick={kembali} className="text-2xl text-stone-500" aria-label="Kembali">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-stone-800">
            Stok Opname — {auth?.branch?.nama ?? namaCabang}
          </div>
          <div className="truncate text-xs text-stone-500">
            {formatTanggal(hariIniWIB())} · {subJudul}
          </div>
        </div>
        <Link to="/stok/opname/riwayat" className={`${btnSecondary} shrink-0`}>
          🕑
        </Link>
      </header>

      {/* Langkah indikator */}
      <div className="flex items-center gap-1 border-b border-stone-200 bg-white px-4 py-2 text-xs font-medium">
        <StepChip n={1} label="Lokasi" aktif={langkah === "lokasi"} selesai={langkah !== "lokasi"} />
        <span className="text-stone-300">→</span>
        <StepChip n={2} label="Produk" aktif={langkah === "produk"} selesai={langkah === "hitung"} />
        <span className="text-stone-300">→</span>
        <StepChip n={3} label="Pengecekan" aktif={langkah === "hitung"} selesai={false} />
      </div>

      {/* ---------- LANGKAH 1: pilih lokasi ---------- */}
      {langkah === "lokasi" && (memuat || gagalMuat) && (
        <div className="flex flex-1 items-center justify-center p-6 py-20">
          <SpinnerAtauGalat error={gagalMuat} apa="Daftar rak & stok cabang" />
        </div>
      )}
      {/* Langkah 2 tak perlu penjaga sendiri: satu-satunya jalan ke sana lewat
          langkah 1, yang kini tertahan selama bacaannya gagal. */}
      {langkah === "lokasi" && !memuat && !gagalMuat && (
        <main className="flex-1 p-3 pb-8">
          <p className="mb-3 text-sm text-stone-500">
            Pilih dulu tempat penyimpanan yang akan diopname. Anda lalu memilih produk mana
            saja yang dihitung.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {tempatBoleh.map((t) => {
              const n = itemsDiBucket(t.id).length;
              return (
                <LokasiCard
                  key={t.id}
                  nama={t.nama}
                  jumlah={n}
                  petugas={t.petugas.map((p) => p.nama)}
                  onClick={() => bukaBucket(t.id)}
                />
              );
            })}
            {adaTanpaTempat && (
              <LokasiCard
                nama="Tanpa tempat"
                jumlah={itemsDiBucket(BUCKET_TANPA).length}
                petugas={[]}
                onClick={() => bukaBucket(BUCKET_TANPA)}
              />
            )}
            {!terikat && (
              <LokasiCard
                nama="Semua tempat"
                jumlah={stokBoleh.length}
                petugas={[]}
                catatan="Opname seluruh bahan sekaligus"
                onClick={() => bukaBucket(BUCKET_SEMUA)}
              />
            )}
          </div>
          {tempatBoleh.length === 0 && !adaTanpaTempat && (
            <div className="py-10 text-center text-sm text-stone-400">
              Belum ada tempat penyimpanan yang bisa Anda opname.
            </div>
          )}
        </main>
      )}

      {/* ---------- LANGKAH 2: pilih produk ---------- */}
      {langkah === "produk" && (
        <>
          <div className="sticky top-[97px] z-10 space-y-2 border-b border-stone-200 bg-white px-4 py-2">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari bahan…"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
            />
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 font-medium text-stone-600">
                <input
                  type="checkbox"
                  checked={semuaTercentang}
                  onChange={(e) => {
                    const next = { ...dipilih };
                    for (const s of tampilProduk) next[s.ingredient_id] = e.target.checked;
                    setDipilih(next);
                  }}
                  className="h-4 w-4"
                />
                Pilih semua
              </label>
              <span className="text-stone-500">{jumlahPilih} dipilih</span>
            </div>
            {petugasBucket !== null && (
              <div className="text-xs text-stone-500">
                👤 Petugas opname:{" "}
                {petugasBucket.length === 0 ? (
                  <span className="text-stone-400">semua boleh (belum diatur)</span>
                ) : (
                  <span className="font-medium text-stone-600">
                    {petugasBucket.map((p) => p.nama).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
          <main className="flex-1 p-3 pb-28">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tampilProduk.map((s) => {
                const on = !!dipilih[s.ingredient_id];
                return (
                  <button
                    key={s.ingredient_id}
                    onClick={() => setDipilih({ ...dipilih, [s.ingredient_id]: !on })}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left ${
                      on ? "border-orange-500 bg-orange-50" : "border-stone-200 bg-white"
                    }`}
                  >
                    <input type="checkbox" checked={on} readOnly className="h-5 w-5 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-stone-800">{s.nama}</div>
                      {/* saldo sistem SENGAJA tidak ditampilkan saat pilih produk —
                          baru muncul di langkah pengecekan agar hitung fisik jujur */}
                      <div className="text-sm text-stone-400">{s.satuan}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {tampilProduk.length === 0 && (
              <div className="py-10 text-center text-sm text-stone-400">
                {cari ? `Bahan "${cari}" tidak ditemukan.` : "Tidak ada bahan di lokasi ini."}
              </div>
            )}
          </main>
          <div className="fixed inset-x-0 bottom-0 flex gap-2 border-t border-stone-200 bg-white p-3">
            <button onClick={() => setLangkah("lokasi")} className={`${btnSecondary} shrink-0`}>
              ← Lokasi
            </button>
            <button
              onClick={() => setLangkah("hitung")}
              disabled={jumlahPilih === 0}
              className={`${btnPrimary} flex-1 py-3 text-base`}
            >
              Mulai Pengecekan ({jumlahPilih} produk)
            </button>
          </div>
        </>
      )}

      {/* ---------- LANGKAH 3: pengecekan (hitung fisik) ---------- */}
      {langkah === "hitung" && (
        <>
          <div className="sticky top-[97px] z-10 border-b border-stone-200 bg-white px-4 py-2 text-xs text-stone-500">
            Isi stok fisik tiap produk. Produk yang dikosongkan tidak dihitung. Bila ada
            selisih, lampirkan <b>bukti foto</b> (+ alasan opsional) — selisih menunggu ACC
            owner/admin.
          </div>
          <main className="flex-1 p-3 pb-28">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {produkTerpilih.map((s) => {
                const selisih = selisihDari(s);
                return (
                  <div key={s.ingredient_id} className="rounded-xl border border-stone-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-stone-800">{s.nama}</div>
                        <div className="text-sm text-stone-500">
                          Sistem: <b className="text-stone-700">{formatAngka(s.saldo)} {s.satuan}</b>
                        </div>
                        {s.saldo < 0 && (
                          <div className="mt-0.5 text-xs text-amber-700">
                            Saldo sistem minus — isi hitungan fisik yang sebenarnya (paling sedikit
                            0); selisihnya akan menunggu ACC.
                          </div>
                        )}
                      </div>
                      {selisih !== null &&
                        (Math.abs(selisih) < 1e-9 ? (
                          <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                            Cocok
                          </span>
                        ) : selisih > 0 ? (
                          <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                            Lebih {formatAngka(selisih)}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                            Kurang {formatAngka(-selisih)}
                          </span>
                        ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={fisik[s.ingredient_id] ?? ""}
                        onChange={(e) => setFisik({ ...fisik, [s.ingredient_id]: e.target.value })}
                        placeholder="Stok fisik…"
                        className="h-12 flex-1 rounded-lg border border-stone-300 px-3 text-lg font-semibold focus:border-orange-500 focus:outline-none"
                      />
                      <button
                        // Saldo sistem yang MINUS tak pernah ada di rak: "sama dengan
                        // sistem" untuk buku −100 adalah 0, bukan −100 yang pasti ditolak.
                        onClick={() =>
                          setFisik({ ...fisik, [s.ingredient_id]: teksAngka(Math.max(0, s.saldo)) })
                        }
                        className="h-12 shrink-0 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-600"
                        title="Isi sama dengan sistem"
                      >
                        = sistem
                      </button>
                    </div>
                    {/* Ada selisih → wajib lampirkan bukti foto (untuk ACC admin)
                        + alasan opsional. Baris cocok tidak butuh apa-apa. */}
                    {selisih !== null && Math.abs(selisih) >= 1e-9 && (
                      <div className="mt-3 space-y-2 rounded-lg bg-amber-50 p-3">
                        <div className="text-xs font-semibold text-amber-800">
                          Selisih perlu bukti — dilampirkan untuk ACC owner/admin
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-stone-600">
                            Bukti foto <span className="text-red-500">*wajib</span>
                          </div>
                          <ImageUpload
                            value={fotoSelisih[s.ingredient_id] ?? null}
                            onChange={(u) =>
                              setFotoSelisih((prev) => {
                                const next = { ...prev };
                                if (u) next[s.ingredient_id] = u;
                                else delete next[s.ingredient_id];
                                return next;
                              })
                            }
                            tujuan="bukti"
                            placeholder="📷"
                          />
                        </div>
                        <input
                          value={alasanSelisih[s.ingredient_id] ?? ""}
                          onChange={(e) =>
                            setAlasanSelisih({ ...alasanSelisih, [s.ingredient_id]: e.target.value })
                          }
                          placeholder="Alasan selisih (opsional) — mis. tumpah, rusak"
                          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </main>
          <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
            {salahKetik.length > 0 && (
              <div className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-center text-xs font-medium text-red-800">
                Angka tidak terbaca pada{" "}
                <b>{salahKetik.map((s) => s.nama).join(", ")}</b> — tulis seperti{" "}
                <b>470</b> atau <b>1,5</b>.
              </div>
            )}
            {negatif.length > 0 && (
              <div className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-center text-xs font-medium text-red-800">
                Stok fisik tidak boleh minus pada{" "}
                <b>{negatif.map((s) => s.nama).join(", ")}</b> — isi hitungan yang sebenarnya
                (paling sedikit <b>0</b>). Saldo sistem yang minus adalah selisih yang menunggu
                ACC, bukan angka rak.
              </div>
            )}
            {selisihTanpaFoto.length > 0 && (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-center text-xs font-medium text-amber-800">
                Lampirkan bukti foto untuk {selisihTanpaFoto.length} selisih sebelum menyimpan.
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setLangkah("produk")} className={`${btnSecondary} shrink-0`}>
                ← Produk
              </button>
              <button
                onClick={() => setKonfirmasi(true)}
                disabled={
                  terisi === 0 ||
                  salahKetik.length > 0 ||
                  negatif.length > 0 ||
                  selisihTanpaFoto.length > 0
                }
                className={`${btnPrimary} flex-1 py-3 text-base`}
              >
                Simpan Opname ({terisi} dihitung)
              </button>
            </div>
          </div>
        </>
      )}

      {/* Sheet konfirmasi */}
      {konfirmasi && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setKonfirmasi(false)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold text-stone-800">Konfirmasi Opname</h2>
            <p className="mb-3 text-sm text-stone-600">
              {terisi} bahan akan disesuaikan ke stok fisik. Bahan yang tidak diisi tidak
              berubah. Selisih akan tercatat di riwayat.
            </p>
            <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              {produkTerpilih
                .filter((s) => fisik[s.ingredient_id] !== undefined && fisik[s.ingredient_id] !== "")
                .map((s) => {
                  const sel = selisihDari(s)!;
                  return (
                    <div key={s.ingredient_id} className="flex justify-between text-sm">
                      <span className="text-stone-700">{s.nama}</span>
                      <span
                        className={
                          Math.abs(sel) < 1e-9
                            ? "text-green-600"
                            : sel > 0
                              ? "text-yellow-700"
                              : "text-red-600"
                        }
                      >
                        {formatAngka(s.saldo)} → {formatAngka(angkaDari(fisik[s.ingredient_id]))}
                        {Math.abs(sel) >= 1e-9 && ` (${sel > 0 ? "+" : ""}${formatAngka(sel)})`}
                      </span>
                    </div>
                  );
                })}
            </div>
            <ErrorText error={simpan.error} />
            <div className="flex gap-2">
              <button onClick={() => setKonfirmasi(false)} className={`${btnSecondary} flex-1`}>
                Batal
              </button>
              <button
                onClick={() => simpan.mutate()}
                disabled={simpan.isPending}
                className={`${btnPrimary} flex-1`}
              >
                {simpan.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet hasil */}
      {hasil && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="mt-2 text-lg font-bold text-stone-800">Opname Tersimpan</h2>
            {nomorSesi && (
              <div className="mt-1 inline-block rounded-md bg-orange-100 px-2 py-0.5 font-mono text-sm font-bold text-orange-800">
                {nomorSesi}
              </div>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-2xl font-bold text-green-600">{hasil.cocok}</div>
                <div className="text-stone-500">Cocok</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-700">{hasil.lebih}</div>
                <div className="text-stone-500">Lebih</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{hasil.kurang}</div>
                <div className="text-stone-500">Kurang</div>
              </div>
            </div>
            {hasil.lebih + hasil.kurang > 0 && (
              <div className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-left text-sm text-blue-800">
                Ada <b>{hasil.lebih + hasil.kurang} selisih</b>. <b>Stok belum berubah</b> —
                menunggu <b>ACC owner/admin</b> di Riwayat Opname. Setelah di-ACC, stok baru
                disesuaikan ke hitungan fisik.
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setHasil(null)} className={`${btnSecondary} flex-1`}>
                Opname Lagi
              </button>
              <button
                onClick={() => navigate("/stok/opname/riwayat")}
                className={`${btnPrimary} flex-1`}
              >
                Lihat Riwayat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepChip({ n, label, aktif, selesai }: { n: number; label: string; aktif: boolean; selesai: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
        aktif
          ? "bg-orange-600 text-white"
          : selesai
            ? "bg-green-100 text-green-700"
            : "bg-stone-100 text-stone-500"
      }`}
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/30 text-[10px] font-bold">
        {selesai ? "✓" : n}
      </span>
      {label}
    </span>
  );
}

function LokasiCard({
  nama,
  jumlah,
  petugas,
  catatan,
  onClick,
}: {
  nama: string;
  jumlah: number;
  petugas: string[];
  catatan?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left transition hover:border-orange-400 hover:bg-orange-50"
    >
      <div className="min-w-0">
        <div className="truncate text-base font-bold text-stone-800">📦 {nama}</div>
        <div className="text-sm text-stone-500">{jumlah} bahan</div>
        {catatan && <div className="text-xs text-stone-400">{catatan}</div>}
        {petugas.length > 0 && (
          <div className="mt-0.5 truncate text-xs text-stone-400">👤 {petugas.join(", ")}</div>
        )}
      </div>
      <span className="shrink-0 text-2xl text-stone-300">›</span>
    </button>
  );
}
