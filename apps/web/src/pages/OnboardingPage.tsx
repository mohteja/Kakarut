import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { saveAuth, type AuthState } from "../lib/api";
import {
  JENIS_USAHA,
  PROFIL_USAHA,
  ZONA_BAWAAN,
  ZONA_WAKTU,
  validasiProfilUsaha,
  type BuatPerusahaanBody,
  type JenisUsaha,
  type OnboardingStatus,
  type UserRole,
  type ZonaWaktu,
} from "@kakarut/shared";
import { HapusAkunButton } from "../components/HapusAkunButton";
import { unggahGambar } from "../components/ImageUpload";
import { Logo } from "../components/Logo";
import { ErrorText, SpinnerAtauGalat, btnPrimary, btnSecondary, inputClass } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { galatTerbaru } from "../lib/galat";
import { alasanTolak } from "../lib/unggah";

const LABEL_ROLE: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Admin",
  cashier: "Kasir",
  tim: "Tim",
  kitchen: "Kitchen",
  bar: "Bar",
};

/** Seberapa sering halaman tunggu menanyakan undangan baru ke server. */
const JEDA_CEK_UNDANGAN_MS = 10_000;

type Langkah = "pilih" | "tunggu" | "buat";

/**
 * HALAMAN WELCOME — satu-satunya layar akun yang BELUM punya perusahaan.
 *
 * Daftar tak pernah membuatkan perusahaan. Di sini orangnya memilih:
 *   1. "Saya karyawan" → menunggu owner menambahkan emailnya. Halaman ini
 *      menanyakan undangan baru tiap 10 detik, jadi begitu owner menekan
 *      Tambah/Undang, kartu undangan muncul sendiri — tinggal Terima.
 *   2. "Saya pemilik usaha" → mengisi PROFIL USAHA (nama, jenis, alamat,
 *      telepon, zona waktu, logo) lalu jadi owner.
 *
 * Undangan yang sudah menunggu selalu tampil paling atas, di langkah mana pun:
 * orang yang diundang tak perlu tahu harus memilih apa dulu.
 *
 * Setelah salah satu berhasil, sesi diganti (setSession) → App mengarahkan ke
 * beranda perusahaan.
 */
export function OnboardingPage() {
  const { auth, logout, setSession } = useAuth();
  const [langkah, setLangkah] = useState<Langkah>("pilih");
  const { data, error: statusGagal, refetch } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => api<OnboardingStatus>("/onboarding/status"),
    // Hanya saat menunggu: halaman pilih & form tak perlu berdenyut.
    refetchInterval: langkah === "tunggu" ? JEDA_CEK_UNDANGAN_MS : false,
    refetchOnWindowFocus: true,
  });

  const terima = useMutation({
    mutationFn: (id: string) =>
      api<AuthState>(`/onboarding/undangan/${id}/terima`, { method: "POST" }),
    onSuccess: (sesi) => setSession(sesi),
  });

  const tolak = useMutation({
    mutationFn: (id: string) => api(`/onboarding/undangan/${id}/tolak`, { method: "POST" }),
    onSuccess: () => refetch(),
  });

  return (
    <div className="min-h-screen bg-stone-100 px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-5">
        <div className="text-center">
          <Logo className="mx-auto h-16 w-16 shadow-lg" />
          <h1 className="mt-3 text-2xl font-bold text-stone-800">Selamat datang di Terakasir</h1>
          <p className="text-sm text-stone-500">
            Halo <b>{auth?.user.nama}</b> — akun Anda belum terhubung ke perusahaan.
          </p>
        </div>

        {/* Layar ini satu-satunya yang dilihat akun tanpa perusahaan: tak ada
            nav, tak ada halaman lain. Spinner abadi di sini bukan sekadar
            mengganggu — ia mengunci orang di luar aplikasi pada langkah
            pertama, tanpa kalimat apa pun dan tanpa tombol apa pun. Karena
            itu tombol coba-lagi wajib, bukan pemanis. */}
        {!data ? (
          <SpinnerAtauGalat
            error={statusGagal}
            apa="Status undangan"
            onCoba={() => void refetch()}
          />
        ) : (
          <>
            {/* Undangan yang menunggu */}
            {data.undangan.length > 0 && (
              <div
                className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm"
                data-testid="kartu-undangan"
              >
                <h2 className="mb-1 text-lg font-bold text-stone-800">📨 Undangan untuk Anda</h2>
                <p className="mb-3 text-sm text-stone-500">
                  Anda diundang bergabung ke perusahaan berikut. Terima untuk mulai bekerja.
                </p>
                <div className="space-y-2">
                  {data.undangan.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-stone-800">{u.company_nama}</div>
                        <div className="text-xs text-stone-500">
                          Sebagai <b>{LABEL_ROLE[u.role]}</b>
                          {u.cabang_nama ? ` · 🏪 ${u.cabang_nama}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => tolak.mutate(u.id)}
                          disabled={tolak.isPending || terima.isPending}
                          className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-stone-500 hover:bg-stone-50"
                        >
                          Tolak
                        </button>
                        <button
                          onClick={() => terima.mutate(u.id)}
                          disabled={terima.isPending || tolak.isPending}
                          className={`${btnPrimary} px-3 py-1.5 text-xs`}
                        >
                          {terima.isPending ? "Memproses…" : "Terima"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {/*
                  DUA tombol, satu tempat galat. `Tolak` dan `Terima` bersebelahan
                  di dalam kartu undangan yang sama, tapi dulu hanya `terima.error`
                  yang dirender: menolak undangan yang gagal tak mengubah apa pun
                  di layar. Di layar ini pengguna belum punya perusahaan, belum
                  punya navigasi, dan tak punya jalan lain untuk mencoba.

                  `galatTerbaru` memulangkan galat aksi yang PALING BARU ditekan —
                  bukan yang pertama truthy — jadi menolak lalu berhasil menerima
                  tidak meninggalkan spanduk merah dari percobaan sebelumnya.
                */}
                <ErrorText error={galatTerbaru(terima, tolak)} />
              </div>
            )}

            {langkah === "pilih" && <LangkahPilih onPilih={setLangkah} />}
            {langkah === "tunggu" && (
              <LangkahTunggu email={data.email} onKembali={() => setLangkah("pilih")} />
            )}
            {langkah === "buat" && (
              <FormProfilUsaha onKembali={() => setLangkah("pilih")} onSelesai={setSession} />
            )}
          </>
        )}

        <div className="flex items-center justify-between border-t border-stone-200 pt-4">
          <button onClick={logout} className={btnSecondary}>
            Keluar
          </button>
          <HapusAkunButton />
        </div>
      </div>
    </div>
  );
}

function LangkahPilih({ onPilih }: { onPilih: (l: Langkah) => void }) {
  const kartu =
    "flex w-full items-start gap-3 rounded-2xl border-2 border-stone-200 bg-white p-5 text-left shadow-sm transition hover:border-orange-400 hover:bg-orange-50";
  return (
    <div className="space-y-3">
      <p className="text-center text-sm font-semibold text-stone-600">Bagaimana Anda memakai Terakasir?</p>
      <button type="button" onClick={() => onPilih("tunggu")} className={kartu}>
        <span className="text-3xl">👥</span>
        <span>
          <span className="block text-base font-bold text-stone-800">Saya karyawan</span>
          <span className="block text-sm text-stone-500">
            Tunggu owner usaha tempat Anda bekerja menambahkan Anda sebagai tim.
          </span>
        </span>
      </button>
      <button type="button" onClick={() => onPilih("buat")} className={kartu}>
        <span className="text-3xl">🏢</span>
        <span>
          <span className="block text-base font-bold text-stone-800">Saya pemilik usaha</span>
          <span className="block text-sm text-stone-500">
            Buat perusahaan dengan profil usaha Anda — Anda otomatis jadi <b>owner</b>.
          </span>
        </span>
      </button>
    </div>
  );
}

function LangkahTunggu({ email, onKembali }: { email: string; onKembali: () => void }) {
  const [tersalin, setTersalin] = useState(false);
  useEffect(() => {
    if (!tersalin) return;
    const t = setTimeout(() => setTersalin(false), 2000);
    return () => clearTimeout(t);
  }, [tersalin]);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" data-testid="langkah-tunggu">
      <h2 className="mb-1 text-lg font-bold text-stone-800">👥 Menunggu ditambahkan owner</h2>
      <p className="text-sm text-stone-500">
        Minta owner usaha Anda membuka <b>Pengaturan → Karyawan</b> lalu menambahkan email ini:
      </p>
      <div className="mt-3 flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-lg bg-stone-100 px-3 py-2 font-mono text-sm text-stone-800">
          {email}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(email).then(() => setTersalin(true));
          }}
          className={`${btnSecondary} shrink-0 px-3 py-2 text-sm`}
        >
          {tersalin ? "✓ Tersalin" : "Salin"}
        </button>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        Halaman ini memeriksa sendiri — undangan akan muncul di atas begitu owner menambahkan Anda.
      </div>
      <button type="button" onClick={onKembali} className="mt-4 text-sm font-semibold text-stone-500 hover:text-stone-700">
        ← Kembali
      </button>
    </div>
  );
}

function FormProfilUsaha({
  onKembali,
  onSelesai,
}: {
  onKembali: () => void;
  onSelesai: (sesi: AuthState) => void;
}) {
  const [nama, setNama] = useState("");
  const [jenis, setJenis] = useState<JenisUsaha | "">("");
  const [alamat, setAlamat] = useState("");
  const [telepon, setTelepon] = useState("");
  const [zona, setZona] = useState<ZonaWaktu>(ZONA_BAWAAN);
  const [logo, setLogo] = useState<File | null>(null);
  const [pratinjau, setPratinjau] = useState<string | null>(null);
  const [galatLogo, setGalatLogo] = useState<string | null>(null);
  const [sudahKirim, setSudahKirim] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!logo) return setPratinjau(null);
    const url = URL.createObjectURL(logo);
    setPratinjau(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const masalah = validasiProfilUsaha({ nama, jenis_usaha: jenis, alamat, telepon });

  const buat = useMutation({
    mutationFn: async (): Promise<AuthState> => {
      const body: BuatPerusahaanBody = {
        nama: nama.trim(),
        jenis_usaha: jenis as JenisUsaha,
        alamat: alamat.trim(),
        telepon: telepon.trim(),
        timezone: zona,
      };
      const sesi = await api<AuthState>("/onboarding/perusahaan", { method: "POST", body });
      if (!logo || !sesi.company) return sesi;
      /*
       * LOGO SESUDAH PERUSAHAAN ADA — `/upload` adalah rute tenant, jadi ia
       * butuh token yang sudah berperusahaan. Token baru disimpan dulu
       * (`api()` membaca token dari penyimpanan), baru sesi dipasang ke React
       * setelah logo selesai: memasangnya lebih awal membuat App langsung
       * berpindah halaman dan pengunggahan berjalan tanpa layar.
       *
       * Gagal unggah TIDAK menggagalkan perusahaan yang sudah jadi — logonya
       * bisa diunggah ulang di Pengaturan → Perusahaan.
       */
      saveAuth(sesi);
      try {
        const url = await unggahGambar(logo, "logo");
        await api("/company", { method: "PATCH", body: { logo_url: url } });
        return { ...sesi, company: { ...sesi.company, logo_url: url } };
      } catch (e) {
        console.warn("Logo gagal diunggah saat membuat perusahaan:", e);
        window.alert(
          "Perusahaan sudah dibuat, tapi logo gagal diunggah. Unggah ulang di Pengaturan → Perusahaan.",
        );
        return sesi;
      }
    },
    onSuccess: (sesi) => {
      // `setSession` membersihkan seluruh cache, tapi penulis `company` tetap
      // menyebut kuncinya sendiri (`kunci-master-invalidasi`).
      queryClient.invalidateQueries({ queryKey: ["company"] });
      onSelesai(sesi);
    },
  });

  function onKirim(e: FormEvent) {
    e.preventDefault();
    setSudahKirim(true);
    if (!masalah) buat.mutate();
  }

  const label = "mb-1 block text-sm font-semibold text-stone-700";

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" data-testid="form-profil-usaha">
      <h2 className="mb-1 text-lg font-bold text-stone-800">🏢 Profil usaha</h2>
      <p className="mb-4 text-sm text-stone-500">
        Alamat & nomor telepon langsung tercetak di kepala struk. Semua bisa diubah nanti kecuali zona waktu.
      </p>
      <form onSubmit={onKirim} className="space-y-4">
        <div>
          <label className={label} htmlFor="pu-nama">
            Nama usaha
          </label>
          <input
            id="pu-nama"
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            maxLength={PROFIL_USAHA.namaMaks}
            placeholder="mis. Warung Baso Sedap"
            className={inputClass}
          />
        </div>

        <div>
          <span className={label}>Jenis usaha</span>
          <div className="grid grid-cols-2 gap-2">
            {JENIS_USAHA.map((j) => (
              <button
                key={j.kode}
                type="button"
                onClick={() => setJenis(j.kode)}
                aria-pressed={jenis === j.kode}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  jenis === j.kode
                    ? "border-orange-500 bg-orange-50 font-semibold text-orange-800"
                    : "border-stone-200 text-stone-700 hover:bg-stone-50"
                }`}
              >
                {j.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={label} htmlFor="pu-alamat">
            Alamat
          </label>
          <textarea
            id="pu-alamat"
            value={alamat}
            onChange={(e) => setAlamat(e.target.value)}
            maxLength={PROFIL_USAHA.alamatMaks}
            rows={2}
            placeholder="Jalan, nomor, kelurahan, kota"
            className={inputClass}
          />
        </div>

        <div>
          <label className={label} htmlFor="pu-telepon">
            No. HP / telepon usaha
          </label>
          <input
            id="pu-telepon"
            value={telepon}
            onChange={(e) => setTelepon(e.target.value)}
            inputMode="tel"
            placeholder="mis. 0812 3456 7890"
            className={inputClass}
          />
        </div>

        <div>
          <label className={label} htmlFor="pu-zona">
            Zona waktu
          </label>
          <select
            id="pu-zona"
            value={zona}
            onChange={(e) => setZona(e.target.value as ZonaWaktu)}
            className={inputClass}
          >
            {ZONA_WAKTU.map((z) => (
              <option key={z.kode} value={z.kode}>
                {z.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Menentukan kapan "hari ini" berganti di laporan & struk. <b>Tidak bisa diubah</b> setelah perusahaan dibuat.
          </p>
        </div>

        <div>
          <span className={label}>
            Logo <span className="font-normal text-stone-400">(opsional)</span>
          </span>
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50 text-2xl">
              {pratinjau ? <img src={pratinjau} alt="Pratinjau logo" className="h-full w-full object-cover" /> : "🏪"}
            </div>
            <div className="space-y-1">
              <label className={`${btnSecondary} inline-block cursor-pointer px-3 py-1.5 text-sm`}>
                {logo ? "Ganti logo" : "Pilih logo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (!f) return;
                    const tolak = alasanTolak(f);
                    setGalatLogo(tolak);
                    if (!tolak) setLogo(f);
                  }}
                />
              </label>
              {logo && (
                <button type="button" onClick={() => setLogo(null)} className="ml-2 text-xs text-stone-500 underline">
                  Hapus
                </button>
              )}
              <div className="text-xs text-stone-400">JPEG/PNG/WebP, maks 5 MB</div>
            </div>
          </div>
          {galatLogo && <p className="mt-1 text-xs text-red-600">{galatLogo}</p>}
        </div>

        {sudahKirim && masalah && <ErrorText error={masalah} />}
        <ErrorText error={buat.error} />
        <button type="submit" disabled={buat.isPending} className={`${btnPrimary} w-full`}>
          {buat.isPending ? "Membuat…" : "Buat Perusahaan"}
        </button>
      </form>
      <button type="button" onClick={onKembali} className="mt-4 text-sm font-semibold text-stone-500 hover:text-stone-700">
        ← Kembali
      </button>
    </div>
  );
}
