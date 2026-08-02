import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PerlengkapanRowDto } from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
import { ErrorText, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../../lib/format";

/**
 * Opname perlengkapan mobile-first — alur bertahap sama dgn opname bahan baku:
 *   1. pilih RAK (tempat penyimpanan) yang akan diopname,
 *   2. pilih PRODUK mana saja yang dihitung,
 *   3. baru mulai PENGECEKAN (hitung fisik; selisih menunggu ACC owner/admin).
 * Tampilan padat multi-kolom di layar lebar.
 */
type Langkah = "lokasi" | "produk" | "hitung";
const BUCKET_SEMUA = "__semua__";
const BUCKET_TANPA = "__tanpa__";

export function OpnamePerlengkapanPage() {
  const { auth } = useAuth();
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: rows = [], isLoading: memuat } = useQuery({
    queryKey: ["perlengkapan", branchQuery],
    queryFn: () => api<PerlengkapanRowDto[]>(`/perlengkapan${branchQuery}`),
  });

  const [langkah, setLangkah] = useState<Langkah>("lokasi");
  const [bucket, setBucket] = useState<string | null>(null);
  const [dipilih, setDipilih] = useState<Record<string, boolean>>({});
  const [fisik, setFisik] = useState<Record<string, string>>({});
  const [cari, setCari] = useState("");
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [hasil, setHasil] = useState<{ nomor: string | null; jumlah_selisih: number } | null>(
    null,
  );

  // Nama CABANG TARGET opname harus tampak: owner dari Kantor menulis ke
  // cabang data terpilih — salah cabang tidak boleh terjadi diam-diam.
  const { cabang } = useBranch();
  const namaCabang =
    cabang.find((b) => b.id === branchId)?.nama ??
    auth?.branch?.nama ??
    auth?.company?.nama ??
    "Cabang";

  const rakList = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.rak) m.set(r.rak.id, r.rak.nama);
    return [...m.entries()]
      .map(([id, nama]) => ({ id, nama }))
      .sort((a, b) => a.nama.localeCompare(b.nama));
  }, [rows]);
  const adaTanpaRak = rows.some((r) => !r.rak);

  function itemsDiBucket(b: string): PerlengkapanRowDto[] {
    return rows.filter((r) =>
      b === BUCKET_SEMUA ? true : b === BUCKET_TANPA ? !r.rak : r.rak?.id === b,
    );
  }

  const bucketItems = useMemo(
    () => (bucket ? itemsDiBucket(bucket) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, rows],
  );
  const bucketNama =
    bucket === BUCKET_SEMUA
      ? "Semua rak"
      : bucket === BUCKET_TANPA
        ? "Tanpa rak"
        : (rakList.find((t) => t.id === bucket)?.nama ?? "Rak");

  function bukaBucket(b: string) {
    setBucket(b);
    const sel: Record<string, boolean> = {};
    for (const r of itemsDiBucket(b)) sel[r.id] = true;
    setDipilih(sel);
    setFisik({});
    setCari("");
    setLangkah("produk");
  }

  const produkTerpilih = bucketItems.filter((r) => dipilih[r.id]);
  const jumlahPilih = produkTerpilih.length;
  const tampilProduk = bucketItems.filter((r) =>
    r.nama.toLowerCase().includes(cari.toLowerCase()),
  );
  const semuaTercentang = tampilProduk.length > 0 && tampilProduk.every((r) => dipilih[r.id]);
  const terisi = produkTerpilih.filter((r) => fisik[r.id] !== undefined && fisik[r.id] !== "").length;
  /**
   * Angka yang tak terbaca DITAHAN DI SINI, bukan dibiarkan ke server.
   *
   * Alasannya sudah ditulis di `OpnamePage` — kembarannya untuk bahan baku —
   * dan berlaku sama persis di sini: penyaringnya cuma `!== ""`, jadi salah
   * ketik lolos jadi NaN, `JSON.stringify` mengubahnya jadi `null`, dan zod
   * server (`qty_fisik: z.number()`) membalas galat yang menyebut INDEKS
   * larik, bukan nama barangnya. Pada opname berisi puluhan baris, satu salah
   * ketik menolak seluruh kiriman tanpa memberi tahu baris mana.
   *
   * Yang menulis penjaga itu memikirkannya untuk bahan baku dan tak menyeberang
   * ke perlengkapan; halamannya berpasangan, jadi penjaganya ikut berpasangan.
   */
  const salahKetik = produkTerpilih.filter(
    (r) =>
      fisik[r.id] !== undefined && fisik[r.id] !== "" && Number.isNaN(angkaDari(fisik[r.id])),
  );

  const simpan = useMutation({
    mutationFn: () => {
      const items = produkTerpilih
        .filter((r) => fisik[r.id] !== undefined && fisik[r.id] !== "")
        .map((r) => ({ supply_id: r.id, qty_fisik: angkaDari(fisik[r.id]) }));
      return api<{ session_id: string | null; nomor: string | null; jumlah_selisih: number }>(
        `/perlengkapan/opname${branchQuery}`,
        { method: "POST", body: { items, catatan: catatan.trim() || null } },
      );
    },
    onSuccess: (d) => {
      setKonfirmasi(false);
      setHasil({ nomor: d.nomor, jumlah_selisih: d.jumlah_selisih });
      setFisik({});
      setDipilih({});
      setBucket(null);
      setCatatan("");
      setLangkah("lokasi");
      queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
    },
  });

  function selisihDari(r: PerlengkapanRowDto): number | null {
    const v = fisik[r.id];
    if (v === undefined || v === "") return null;
    return angkaDari(v) - r.saldo;
  }

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
            🧰 Opname Perlengkapan — {namaCabang}
          </div>
          <div className="truncate text-xs text-stone-500">
            {formatTanggal(hariIniWIB())} · {subJudul}
          </div>
        </div>
        <Link
          to="/stok/opname/riwayat?tab=perlengkapan"
          className={`${btnSecondary} shrink-0`}
          title="Riwayat opname perlengkapan (status ACC)"
        >
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

      {/* ---------- LANGKAH 1: pilih rak ---------- */}
      {langkah === "lokasi" && memuat && (
        <div className="flex flex-1 items-center justify-center py-20">
          <Spinner />
        </div>
      )}
      {langkah === "lokasi" && !memuat && (
        <main className="flex-1 p-3 pb-8">
          <p className="mb-3 text-sm text-stone-500">
            Pilih dulu rak/tempat penyimpanan yang akan diopname, lalu pilih produk mana saja
            yang dihitung.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rakList.map((t) => (
              <LokasiCard
                key={t.id}
                nama={t.nama}
                jumlah={itemsDiBucket(t.id).length}
                onClick={() => bukaBucket(t.id)}
              />
            ))}
            {adaTanpaRak && (
              <LokasiCard
                nama="Tanpa rak"
                jumlah={itemsDiBucket(BUCKET_TANPA).length}
                onClick={() => bukaBucket(BUCKET_TANPA)}
              />
            )}
            <LokasiCard
              nama="Semua rak"
              jumlah={rows.length}
              catatan="Opname seluruh perlengkapan sekaligus"
              onClick={() => bukaBucket(BUCKET_SEMUA)}
            />
          </div>
          {rows.length === 0 && (
            <div className="py-10 text-center text-sm text-stone-400">
              Belum ada perlengkapan terdaftar.
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
              placeholder="Cari perlengkapan…"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
            />
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 font-medium text-stone-600">
                <input
                  type="checkbox"
                  checked={semuaTercentang}
                  onChange={(e) => {
                    const next = { ...dipilih };
                    for (const r of tampilProduk) next[r.id] = e.target.checked;
                    setDipilih(next);
                  }}
                  className="h-4 w-4"
                />
                Pilih semua
              </label>
              <span className="text-stone-500">{jumlahPilih} dipilih</span>
            </div>
          </div>
          <main className="flex-1 p-3 pb-28">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tampilProduk.map((r) => {
                const on = !!dipilih[r.id];
                return (
                  <button
                    key={r.id}
                    onClick={() => setDipilih({ ...dipilih, [r.id]: !on })}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left ${
                      on ? "border-orange-500 bg-orange-50" : "border-stone-200 bg-white"
                    }`}
                  >
                    <input type="checkbox" checked={on} readOnly className="h-5 w-5 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-stone-800">{r.nama}</div>
                      {/* saldo sistem SENGAJA tidak ditampilkan saat pilih produk —
                          baru muncul di langkah pengecekan agar hitung fisik jujur */}
                      <div className="text-sm text-stone-400">{r.satuan}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {tampilProduk.length === 0 && (
              <div className="py-10 text-center text-sm text-stone-400">
                {cari
                  ? `Perlengkapan "${cari}" tidak ditemukan.`
                  : "Tidak ada perlengkapan di rak ini."}
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

      {/* ---------- LANGKAH 3: pengecekan ---------- */}
      {langkah === "hitung" && (
        <>
          <div className="sticky top-[97px] z-10 border-b border-stone-200 bg-white px-4 py-2 text-xs text-stone-500">
            Pemakaian perlengkapan dicatat lewat opname ini. Kosongkan produk yang tidak
            dihitung — selisih menunggu ACC owner/admin.
          </div>
          <main className="flex-1 p-3 pb-28">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {produkTerpilih.map((r) => {
                const selisih = selisihDari(r);
                return (
                  <div key={r.id} className="rounded-xl border border-stone-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-stone-800">{r.nama}</div>
                        <div className="text-sm text-stone-500">
                          Sistem:{" "}
                          <b className="text-stone-700">
                            {formatAngka(r.saldo)} {r.satuan}
                          </b>
                        </div>
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
                        value={fisik[r.id] ?? ""}
                        onChange={(e) => setFisik({ ...fisik, [r.id]: e.target.value })}
                        placeholder="Stok fisik…"
                        className="h-12 flex-1 rounded-lg border border-stone-300 px-3 text-lg font-semibold focus:border-orange-500 focus:outline-none"
                      />
                      <button
                        onClick={() => setFisik({ ...fisik, [r.id]: teksAngka(r.saldo) })}
                        className="h-12 shrink-0 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-600"
                        title="Isi sama dengan sistem"
                      >
                        = sistem
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </main>
          <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
            {salahKetik.length > 0 && (
              <div className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-center text-xs font-medium text-red-800">
                Angka tidak terbaca pada <b>{salahKetik.map((r) => r.nama).join(", ")}</b> — tulis
                seperti <b>470</b> atau <b>1,5</b>.
              </div>
            )}
            <div className="flex gap-2">
            <button onClick={() => setLangkah("produk")} className={`${btnSecondary} shrink-0`}>
              ← Produk
            </button>
            <button
              onClick={() => setKonfirmasi(true)}
              disabled={terisi === 0 || salahKetik.length > 0}
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
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setKonfirmasi(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold text-stone-800">Konfirmasi Opname</h2>
            <p className="mb-3 text-sm text-stone-600">
              {terisi} perlengkapan dihitung. Selisih TIDAK langsung mengubah stok —
              menunggu ACC owner/admin.
            </p>
            <div className="mb-3 max-h-64 space-y-1 overflow-y-auto">
              {produkTerpilih
                .filter((r) => fisik[r.id] !== undefined && fisik[r.id] !== "")
                .map((r) => {
                  const sel = selisihDari(r)!;
                  return (
                    <div key={r.id} className="flex justify-between text-sm">
                      <span className="text-stone-700">{r.nama}</span>
                      <span
                        className={
                          Math.abs(sel) < 1e-9
                            ? "text-green-600"
                            : sel > 0
                              ? "text-yellow-700"
                              : "text-red-600"
                        }
                      >
                        {formatAngka(r.saldo)} → {formatAngka(angkaDari(fisik[r.id]))}
                        {Math.abs(sel) >= 1e-9 && ` (${sel > 0 ? "+" : ""}${formatAngka(sel)})`}
                      </span>
                    </div>
                  );
                })}
            </div>
            <label className="mb-3 block text-sm">
              Catatan (opsional)
              <input
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
              />
            </label>
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
            {hasil.nomor && (
              <div className="mt-1 inline-block rounded-md bg-orange-100 px-2 py-0.5 font-mono text-sm font-bold text-orange-800">
                {hasil.nomor}
              </div>
            )}
            {hasil.jumlah_selisih === 0 ? (
              <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-left text-sm text-green-800">
                Semua sesuai sistem — tidak ada selisih, stok tidak berubah.
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-left text-sm text-blue-800">
                Ada <b>{hasil.jumlah_selisih} selisih</b>. <b>Stok belum berubah</b> —
                menunggu <b>ACC owner/admin</b> (lihat tombol <b>🕑 Riwayat</b> di atas).
                Setelah di-ACC, stok disesuaikan ke hitungan fisik.
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Link
                to="/stok/opname/riwayat?tab=perlengkapan"
                className={`${btnSecondary} flex-1 text-center`}
              >
                🕑 Lihat Riwayat
              </Link>
              <button onClick={() => setHasil(null)} className={`${btnPrimary} flex-1`}>
                Opname Lagi
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
  catatan,
  onClick,
}: {
  nama: string;
  jumlah: number;
  catatan?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left transition hover:border-orange-400 hover:bg-orange-50"
    >
      <div className="min-w-0">
        <div className="truncate text-base font-bold text-stone-800">🧰 {nama}</div>
        <div className="text-sm text-stone-500">{jumlah} perlengkapan</div>
        {catatan && <div className="text-xs text-stone-400">{catatan}</div>}
      </div>
      <span className="shrink-0 text-2xl text-stone-300">›</span>
    </button>
  );
}
