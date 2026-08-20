import { angkaDari, teksAngka } from "@kakarut/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ImageUpload } from "../../components/ImageUpload";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  SpinnerAtauGalat,
  btnPrimary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";

interface Company {
  id: string;
  nama: string;
  alamat: string | null;
  telepon: string | null;
  logoUrl: string | null;
  pb1Enabled: boolean;
  pb1Rate: number;
  diskonMaksPersen: number;
  blokirJualMinus: boolean;
  plan: string;
  mode: "lite" | "pro";
  receiptFooter: string | null;
  receiptShowAlamat: boolean;
  metodeHpp: "average" | "fifo";
  foodCostMaks: number;
}

/** Kartu Mode Lite/Pro: penjelasan + tombol upgrade (modal) / turun ke Lite. */
function KartuMode({ company }: { company: Company }) {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const [konfirmasiPro, setKonfirmasiPro] = useState(false);
  const isOwner = auth?.user.role === "owner";
  const isPro = company.mode === "pro";
  const cabangAktif = cabang.filter((b) => b.is_active).length;

  const ubahMode = useMutation({
    mutationFn: (mode: "lite" | "pro") =>
      api("/company/mode", { method: "POST", body: { mode } }),
    onSuccess: () => {
      setKonfirmasiPro(false);
      queryClient.invalidateQueries({ queryKey: ["company"] });
      queryClient.invalidateQueries({ queryKey: ["cabang"] });
    },
  });

  return (
    <Card className="mb-4 space-y-3 p-5">
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
            isPro ? "bg-purple-600 text-white" : "bg-stone-200 text-stone-700"
          }`}
        >
          {isPro ? "PRO" : "LITE"}
        </span>
        <div className="text-sm font-semibold text-stone-800">Mode aplikasi</div>
      </div>
      <p className="text-sm text-stone-600">
        {isPro ? (
          <>
            Mode <b>Pro</b> untuk usaha multi-lokasi: 🏭 Central Kitchen memproduksi &amp;
            mengirim ke 🏪 cabang store, plus 🏢 Kantor sebagai lokasi kerja admin/finance.
            Karyawan ditempatkan sesuai lokasi kerjanya dan menu bisa dibatasi per lokasi.
          </>
        ) : (
          <>
            Mode <b>Lite</b> untuk usaha 1 cabang — semua fitur kasir, stok, produksi, dan
            laporan aktif tanpa pengaturan multi-lokasi.
          </>
        )}
      </p>
      {isOwner ? (
        isPro ? (
          <div>
            <button
              onClick={() => ubahMode.mutate("lite")}
              disabled={cabangAktif > 1 || ubahMode.isPending}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ubahMode.isPending ? "Memproses…" : "⬇ Turun ke Lite"}
            </button>
            {cabangAktif > 1 && (
              <p className="mt-1 text-xs text-stone-500">
                Nonaktifkan cabang lain dulu (tersisa 1 cabang aktif) untuk turun ke Lite.
              </p>
            )}
          </div>
        ) : (
          <button onClick={() => setKonfirmasiPro(true)} className={btnPrimary}>
            ⬆ Upgrade ke Pro (multi-lokasi)
          </button>
        )
      ) : (
        <p className="text-xs text-stone-500">Hanya owner yang dapat mengubah mode.</p>
      )}
      <ErrorText error={ubahMode.error} />

      {konfirmasiPro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-2 text-lg font-bold text-stone-800">Upgrade ke Pro?</h3>
            <p className="mb-3 text-sm text-stone-600">
              Lokasi default akan dibuat otomatis (cabang Anda sekarang tetap menjadi store
              pertama):
            </p>
            <ul className="mb-4 space-y-1 text-sm text-stone-700">
              <li>🏭 <b>Central Kitchen</b> — memproses/produksi lalu mengirim ke store</li>
              <li>🏪 <b>Cabang 2</b> — outlet penjualan kedua (dengan meja bawaan)</li>
              <li>🏢 <b>Kantor</b> — lokasi kerja admin/finance (bukan tujuan kirim)</li>
            </ul>
            <p className="mb-4 text-xs text-stone-500">
              Nama, alamat, dan status tiap lokasi bisa diubah kapan saja di menu Cabang.
            </p>
            <ErrorText error={ubahMode.error} />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setKonfirmasiPro(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                Batal
              </button>
              <button
                onClick={() => ubahMode.mutate("pro")}
                disabled={ubahMode.isPending}
                className={btnPrimary}
              >
                {ubahMode.isPending ? "Memproses…" : "Ya, upgrade ke Pro"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export function PerusahaanPage() {
  const queryClient = useQueryClient();
  const { data: company, isLoading, error: errorCompany } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<Company>("/company"),
  });

  const [nama, setNama] = useState("");
  const [alamat, setAlamat] = useState("");
  const [telepon, setTelepon] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pb1Enabled, setPb1Enabled] = useState(false);
  const [pb1Rate, setPb1Rate] = useState("10");
  const [diskonMaksPersen, setDiskonMaksPersen] = useState("100");
  const [blokirJualMinus, setBlokirJualMinus] = useState(false);
  const [metodeHpp, setMetodeHpp] = useState<"average" | "fifo">("average");
  const [foodCostMaks, setFoodCostMaks] = useState("40");

  /**
   * Semai SEKALI. `["company"]` disegarkan ulang saat jendela kembali fokus
   * (dan langsung saat kartu Mode di atas meng-invalidate-nya sesudah upgrade),
   * dan tiap penyegaran menimpa apa yang sedang diketik owner — alamat, telepon,
   * tarif PB1 — tanpa jejak. Sesudah Simpan berhasil, isi form memang sudah
   * sama dengan server, jadi tak ada yang perlu disemai ulang.
   */
  const tersemai = useRef(false);
  useEffect(() => {
    if (!company || tersemai.current) return;
    tersemai.current = true;
    setNama(company.nama);
    setAlamat(company.alamat ?? "");
    setTelepon(company.telepon ?? "");
    setLogoUrl(company.logoUrl);
    setPb1Enabled(company.pb1Enabled);
    setPb1Rate(teksAngka(company.pb1Rate));
    setDiskonMaksPersen(teksAngka(company.diskonMaksPersen));
    setBlokirJualMinus(company.blokirJualMinus ?? false);
    setMetodeHpp(company.metodeHpp ?? "average");
    setFoodCostMaks(teksAngka(company.foodCostMaks ?? 40));
  }, [company]);

  /**
   * Persentase yang TERISI tapi tak terbaca sebagai angka.
   *
   * Ketiga kotak di bawah memakai `angkaDari(x) || 0` — bentuk yang dilarang
   * terang-terangan oleh docstring `angkaDari`: "Sengaja TIDAK memulangkan 0:
   * 0 adalah angka yang sah dan bermakna, dan menjadikannya nilai kegagalan
   * membuat salah ketik tak bisa dibedakan dari 'memang nol'." Di sini nol
   * memang sah untuk ketiganya, jadi larangan itu berlaku persis.
   *
   * Ketikan yang sangat wajar di kotak berlabel "%" — "10%", "10 %", "10,5%" —
   * semuanya NaN, lalu jatuh ke 0 tanpa satu pun tanda. Akibat per kolom:
   *
   * - `pb1_rate` yang paling sunyi: `pb1_enabled` tetap menyala, tapi
   *   `hitungPb1(subtotal, 0)` memulangkan 0, jadi struk tetap mencetak baris
   *   PB1 sebesar Rp 0 dan pajaknya berhenti dipungut pada SETIAP penjualan
   *   sesudahnya — sampai ada yang membuka halaman ini lagi dan sadar.
   * - `diskon_maks_persen` 0 membuat server menolak diskon apa pun di atas
   *   0,5% (`penjualan/service.ts`), jadi kasir mendadak tak bisa memberi
   *   diskon sama sekali.
   * - `food_cost_maks` 0 menandai SEMUA menu merah sekaligus.
   *
   * Kotak yang dikosongkan sengaja dibiarkan berarti 0 — mengosongkan sebuah
   * persentase adalah tindakan yang jelas, dan itu perilaku yang sudah ada.
   * Yang ditahan hanya kotak yang berisi sesuatu yang tak terbaca.
   */
  const persenSalahKetik = (
    [
      ["Tarif PB1", pb1Rate],
      ["Diskon maksimal kasir", diskonMaksPersen],
      ["Ambang food cost sehat", foodCostMaks],
    ] as const
  )
    .filter(([, v]) => v.trim() !== "" && Number.isNaN(angkaDari(v)))
    .map(([label]) => label);

  const simpan = useMutation({
    mutationFn: () =>
      api("/company", {
        method: "PATCH",
        body: {
          nama,
          alamat: alamat || null,
          telepon: telepon || null,
          logo_url: logoUrl,
          pb1_enabled: pb1Enabled,
          pb1_rate: Math.min(100, Math.max(0, angkaDari(pb1Rate) || 0)),
          diskon_maks_persen: Math.min(100, Math.max(0, angkaDari(diskonMaksPersen) || 0)),
          blokir_jual_minus: blokirJualMinus,
          metode_hpp: metodeHpp,
          food_cost_maks: Math.min(100, Math.max(0, angkaDari(foodCostMaks) || 0)),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company"] });
      queryClient.invalidateQueries({ queryKey: ["me"] }); // PB1 dipakai kasir
    },
  });

  if (!company) return <SpinnerAtauGalat error={errorCompany} apa="Data perusahaan" />;

  return (
    <div className="max-w-2xl">
      <PageTitle>Pengaturan Perusahaan</PageTitle>
      <KartuMode company={company} />
      <Card className="space-y-4 p-5">
        <div className="text-sm text-stone-500">
          Paket langganan: <span className="font-semibold uppercase">{company.plan}</span>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Nama perusahaan</label>
          <input value={nama} onChange={(e) => setNama(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Alamat</label>
          <input value={alamat} onChange={(e) => setAlamat(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Telepon</label>
          <input value={telepon} onChange={(e) => setTelepon(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Logo</label>
          <ImageUpload value={logoUrl} onChange={setLogoUrl} tujuan="logo" placeholder="🏪" />
        </div>
        {/* Pengaturan STRUK pindah ke halaman Cabang — struk memakai alamat/
            telepon & footer per cabang; di sini hanya identitas global. */}
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
          🧾 Pengaturan <b>struk</b> (footer &amp; alamat yang tercetak) kini diatur{" "}
          <b>per cabang</b> di menu <b>Cabang</b> — alamat &amp; telepon di atas hanya
          identitas holding/global.
        </p>
        <div className="rounded-lg border border-stone-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={pb1Enabled}
              onChange={(e) => setPb1Enabled(e.target.checked)}
            />
            Aktifkan PB1 (pajak restoran) pada transaksi
          </label>
          {pb1Enabled && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              Tarif:
              <input
                /* Persen bertitik-koma: "12,5" pada `type="number"` jadi
                   "125", dan "0,5" jadi "5" — yang kedua LOLOS zod server
                   (0..100) jadi tarif 0,5% diam-diam tersimpan 5%. */
                type="text"
                inputMode="decimal"
                value={pb1Rate}
                onChange={(e) => setPb1Rate(e.target.value)}
                className="w-20 rounded-lg border border-stone-300 px-2 py-1 text-right"
              />
              %
            </div>
          )}
        </div>

        <div className="rounded-lg border border-stone-200 p-3">
          <label className="mb-1 block text-sm font-medium">Batas maksimal diskon kasir (%)</label>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="text"
              inputMode="decimal"
              value={diskonMaksPersen}
              onChange={(e) => setDiskonMaksPersen(e.target.value)}
              className="w-24 rounded-lg border border-stone-300 px-2 py-1 text-right"
            />
            %
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Diskon terbesar yang boleh diberikan <b>kasir</b> per transaksi. <b>100</b> = bebas,
            <b> 0</b> = kasir tak boleh memberi diskon. Owner &amp; admin selalu bebas.
          </p>
        </div>

        <div className="rounded-lg border border-stone-200 p-3">
          <label className="flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={blokirJualMinus}
              onChange={(e) => setBlokirJualMinus(e.target.checked)}
              className="mt-0.5"
            />
            <span>Tolak pesanan yang melebihi stok</span>
          </label>
          <p className="mt-1 text-xs text-stone-500">
            Bawaannya <b>mati</b>: pesanan tetap diterima walau bahannya kurang, dan saldo stok
            boleh minus. Menyalakannya membuat pesanan ditolak saat bahannya tak cukup, dengan
            menyebut bahan mana dan berapa kurangnya.
          </p>
          {/*
            Diberi tahu SEBELUM dinyalakan, bukan sesudah kasir tertahan di
            depan tamu. Bahan bersaldo minus itu keadaan lazim pada data lama,
            dan menu yang memakainya akan langsung berhenti bisa dijual.
          */}
          <p className="mt-1 text-xs text-amber-700">
            ⚠ Bahan yang saldonya <b>sudah minus</b> ikut ditolak. Beresi dulu lewat Stock Opname
            atau Penerimaan Barang sebelum menyalakan ini.
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Yang diperiksa adalah saat <b>memesan</b> — penjualan langsung dan penambahan item ke
            Open Bill. Membayar bill yang sudah dipesan tetap boleh (makanannya sudah dimasak), dan
            transaksi offline yang baru tersinkron tetap diterima (sudah terjadi di lapangan).
          </p>
        </div>

        <div className="rounded-lg border border-stone-200 p-3">
          <label className="mb-1 block text-sm font-medium">Ambang food cost sehat (%)</label>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="text"
              inputMode="decimal"
              value={foodCostMaks}
              onChange={(e) => setFoodCostMaks(e.target.value)}
              className="w-24 rounded-lg border border-stone-300 px-2 py-1 text-right"
            />
            %
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Menu dengan food cost di atas angka ini ditandai <b>merah</b> di daftar Menu dan
            muncul di halaman <b>Analisis Harga</b>. HPP dihitung dari harga bahan terkini, jadi
            menu bisa melewati ambang tanpa harga jualnya diubah.
          </p>
        </div>

        <div className="rounded-lg border border-stone-200 p-3">
          <label className="mb-1 block text-sm font-medium">
            Metode biaya persediaan (kartu bahan)
          </label>
          <select
            value={metodeHpp}
            onChange={(e) => setMetodeHpp(e.target.value as "average" | "fifo")}
            className={`${inputClass} max-w-xs`}
          >
            <option value="average">Rata-rata bergerak (Average)</option>
            <option value="fifo">FIFO (masuk pertama, keluar pertama)</option>
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Cara membebankan biaya tiap pemakaian stok di <b>kartu persediaan</b> per bahan (buka
            lewat <b>Bahan Baku</b> → klik nama barang). <b>Average</b> memakai harga rata-rata
            seluruh sisa stok saat barang keluar; <b>FIFO</b> memakai harga lot yang keluar. Barang
            fisiknya selalu keluar dari lot terlama, apa pun pilihan ini.
          </p>
          <p className="mt-1 rounded bg-stone-50 px-2 py-1 text-xs text-stone-500">
            Catatan: <b>HPP di Laporan laba-rugi tidak memakai setelan ini.</b> HPP tiap transaksi
            dikunci saat pembayaran dari <b>resep × harga acuan bahan</b> saat itu, sehingga laporan
            lama tidak berubah kalau setelan ini diganti.
          </p>
        </div>
        {persenSalahKetik.length > 0 && (
          <p className="text-sm text-red-600">
            Angka tidak terbaca pada <b>{persenSalahKetik.join(", ")}</b> — tulis angkanya saja
            tanpa tanda persen (mis. <b>10</b> atau <b>10,5</b>). Dibiarkan begitu, nilainya
            tersimpan sebagai <b>0</b>.
          </p>
        )}
        <ErrorText error={simpan.error} />
        <button
          onClick={() => simpan.mutate()}
          disabled={simpan.isPending || persenSalahKetik.length > 0}
          className={btnPrimary}
        >
          {simpan.isPending ? "Menyimpan…" : "Simpan"}
        </button>
        {simpan.isSuccess && <span className="ml-3 text-sm text-green-600">Tersimpan ✓</span>}
      </Card>
    </div>
  );
}
