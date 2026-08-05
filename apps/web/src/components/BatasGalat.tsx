import { Component, type ErrorInfo, type ReactNode } from "react";
import { LOADED_BUILD } from "../lib/api";
import { galatChunk } from "../lib/galat";

/**
 * BATAS GALAT — supaya satu render yang gagal tidak menyisakan LAYAR PUTIH.
 *
 * Tanpa batas galat, React membongkar SELURUH pohon begitu ada yang melempar
 * saat render. Yang tersisa di layar bukan pesan apa pun: benar-benar halaman
 * kosong. Tak ada tombol, tak ada kalimat, tak ada petunjuk bahwa memuat ulang
 * akan menolong — di tengah shift, di depan antrean.
 *
 * Pemicu yang paling mungkin BUKAN kode yang salah, melainkan hal yang paling
 * rutin terjadi: DEPLOY.
 *
 *   1. Seluruh halaman dimuat lewat `React.lazy` (± 50 rute), dengan nama
 *      berkas ber-hash yang berganti tiap build.
 *   2. Versi baru ter-deploy → berkas chunk lama hilang dari `dist`.
 *   3. Tab kasir yang sudah terbuka sejak awal shift masih memegang nama lama.
 *      Menekan menu yang chunk-nya belum pernah dimuat meminta berkas yang
 *      sudah tak ada.
 *   4. `app.notFound` server memulangkan shell SPA, jadi yang datang **200 +
 *      HTML** untuk sebuah module script. Peramban menolak MIME-nya.
 *   5. `import()` gagal → `React.lazy` melempar → tak ada yang menangkap →
 *      layar putih.
 *
 * `UpdatePrompt` memang sudah mendeteksi versi baru, tapi ia jalur yang SOPAN:
 * ia menawarkan, bisa ditunda ke pil kecil, dan cek berkalanya sampai 90 detik
 * terlambat. Ia tak menolong tab yang sudah terlanjur jatuh. Yang dibutuhkan
 * di sini jalur PEMULIHAN, dan keduanya memang untuk keadaan yang berbeda.
 *
 * Karena itu galat chunk ditangani lain dari galat lainnya:
 *
 *  - **Chunk gagal dimuat** → muat ulang SENDIRI, sekali. Shell HTML-nya
 *    `no-cache`, jadi muat ulang mengambil `index.html` baru berikut hash yang
 *    benar, dan aplikasinya kembali utuh tanpa kasir perlu tahu apa-apa.
 *    Dikunci lewat `sessionStorage` per build supaya TIDAK BISA jadi lingkaran
 *    muat-ulang: kalau sesudah muat ulang ia jatuh lagi, yang tampil kartu,
 *    bukan muat ulang kedua.
 *  - **Galat lain** → kartu yang menyebutkan pesannya apa adanya berikut dua
 *    jalan keluar. Memuat ulang tak akan menyembuhkan kode yang salah, jadi ia
 *    tidak dilakukan diam-diam; tapi layar tetap tak boleh kosong.
 */
const KUNCI_MUAT_ULANG = "kakarut:muat-ulang-chunk";

/** Build apa yang tab ini sudah pernah muat-ulang karena chunk hilang. */
function sudahPernahMuatUlang(): boolean {
  try {
    return sessionStorage.getItem(KUNCI_MUAT_ULANG) === (LOADED_BUILD ?? "dev");
  } catch {
    // sessionStorage diblokir (mode privat) → anggap SUDAH pernah. Sengaja
    // yang paling aman: lebih baik kartu yang bisa ditekan daripada
    // kemungkinan muat ulang berulang tanpa kunci yang menahannya.
    return true;
  }
}

function tandaiMuatUlang(): void {
  try {
    sessionStorage.setItem(KUNCI_MUAT_ULANG, LOADED_BUILD ?? "dev");
  } catch {
    /* diblokir — `sudahPernahMuatUlang` sudah memulangkan true di jalur ini */
  }
}

interface Props {
  children: ReactNode;
}
interface State {
  galat: Error | null;
  /** true saat kita sedang memuat ulang sendiri — layar menampilkan alasannya */
  memulihkan: boolean;
}

export class BatasGalat extends Component<Props, State> {
  state: State = { galat: null, memulihkan: false };

  static getDerivedStateFromError(galat: Error): Partial<State> {
    return { galat, memulihkan: galatChunk(galat) && !sudahPernahMuatUlang() };
  }

  componentDidCatch(galat: Error, info: ErrorInfo) {
    // Dicatat apa adanya: kalau ini bukan chunk, jejak komponennya satu-satunya
    // petunjuk yang tersisa buat menelusuri.
    console.error("[BatasGalat]", galat, info.componentStack);
    if (galatChunk(galat) && !sudahPernahMuatUlang()) {
      tandaiMuatUlang();
      window.location.reload();
    }
  }

  render() {
    const { galat, memulihkan } = this.state;
    if (!galat) return this.props.children;

    if (memulihkan) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-stone-50 p-6 text-center">
          <div>
            <div className="text-4xl">🔄</div>
            <p className="mt-3 text-sm font-semibold text-stone-700">
              Aplikasi baru saja diperbarui — memuat versi terbaru…
            </p>
          </div>
        </div>
      );
    }

    const chunk = galatChunk(galat);
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl">
          <div className="text-4xl">{chunk ? "🔄" : "⚠️"}</div>
          <h2 className="mt-2 text-lg font-bold text-stone-800">
            {chunk ? "Perlu dimuat ulang" : "Ada yang tidak beres di halaman ini"}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {chunk
              ? "Aplikasi sudah diperbarui di server, tapi halaman ini belum berhasil mengambil versi barunya. Muat ulang untuk melanjutkan."
              : "Halaman ini gagal ditampilkan. Transaksi yang sudah tersimpan tidak terpengaruh — yang gagal hanya tampilannya."}
          </p>
          {/* Pesan aslinya ikut ditampilkan: kalau kasir menelepon, kalimat ini
              yang membuat masalahnya bisa dikenali dari jauh. */}
          <p className="mt-3 break-words rounded-lg bg-stone-100 px-3 py-2 text-left font-mono text-xs text-stone-500">
            {galat.message || String(galat)}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-500"
            >
              🔄 Muat ulang halaman
            </button>
            <button
              onClick={() => window.location.assign("/")}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-500 hover:bg-stone-100"
            >
              Kembali ke beranda
            </button>
          </div>
        </div>
      </div>
    );
  }
}
