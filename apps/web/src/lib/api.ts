import type { SesiLogin } from "@kakarut/shared";
import { bacaLokal, hapusLokal, tulisLokal } from "./simpanan";
import { NILAI_SESI_BERAKHIR, PARAM_SESI } from "./pesan-sesi";
import { tokenSudahMati } from "./umurToken";

/**
 * Sesi = `SesiLogin` milik kontrak (Lampiran A). Sampai 2026-09-05 bentuknya
 * diketik ulang di sini — dan versi ini TAK punya `blokir_jual_minus` yang
 * server kirim sejak lama.
 */
export type AuthState = SesiLogin;

/** Kunci sesi di localStorage — dipantau lintas tab (event `storage`). */
export const AUTH_STORAGE_KEY = "kakarut.auth";
const STORAGE_KEY = AUTH_STORAGE_KEY;

/**
 * `try`/`catch` di sini SAJA tidak cukup, dan itu sebabnya sesi lewat
 * `bacaLokal`/`tulisLokal` yang punya cadangan memori.
 *
 * `api()` di bawah mengambil tokennya dari `loadAuth()` — jadi PENYIMPANAN,
 * bukan state React, yang menjadi sumber kebenaran sesi. Pada perangkat yang
 * `localStorage`-nya diblokir, sekadar menelan galat tulisnya hanya mengubah
 * bentuk kegagalannya: login berhasil di server, tokennya tak pernah
 * tersimpan, permintaan berikutnya berangkat tanpa `Authorization`, 401,
 * dilempar balik ke /login. Kasir berputar di layar login yang menerima
 * passwordnya dengan benar tiap kali.
 *
 * Dengan cadangan memori, sesi tetap hidup selama tab ini terbuka. Ia memang
 * tak selamat dari muat ulang — itu batas yang jujur dan tak terhindarkan
 * kalau perangkatnya menolak menyimpan apa pun.
 */
export function loadAuth(): AuthState | null {
  try {
    const raw = bacaLokal(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    // Isi rusak/separuh tertulis — bukan kegagalan penyimpanan (itu sudah
    // ditangani `bacaLokal`), melainkan JSON yang tak bisa diurai.
    return null;
  }
}

export function saveAuth(state: AuthState | null) {
  if (state) {
    tulisLokal(STORAGE_KEY, JSON.stringify(state));
    // Sesi baru dipasang → palang sesi-mati dibuka lagi. Tanpa ini, masuk
    // ulang di tab yang sama (tanpa muat ulang) mewarisi palang dari sesi
    // sebelumnya dan kematian berikutnya lewat tanpa satu kalimat pun.
    sesiMatiSudahDiumumkan = false;
  } else hapusLokal(STORAGE_KEY);
}

/**
 * SELISIH JAM SERVER, dipelajari dari header `Date` tiap balasan.
 *
 * Gerbang umur token membandingkan `exp` dengan jam — dan jam perangkat bisa
 * meleset, terutama pada tablet murah yang dipakai sepanjang hari. Selisihnya
 * DISIMPAN supaya muat-ulang pagi hari (tepat saat sesi semalam mati) sudah
 * tahu jam server sebelum permintaan pertamanya berangkat; tanpa itu gerbangnya
 * baru bekerja setelah satu balasan diterima, padahal keempat belas permintaan
 * berangkat serentak sebelum balasan mana pun tiba.
 *
 * Selisih yang basi (jam perangkat diperbaiki di antara dua sesi) menyembuhkan
 * dirinya sendiri: balasan berikutnya menimpanya, dan balasan LOGIN termasuk —
 * jadi sesi baru selalu dinilai dengan selisih yang segar. Itu yang menutup
 * kemungkinan terburuknya, yaitu berputar di layar login.
 */
const KUNCI_SELISIH_JAM = "kakarut.selisihJam";
let selisihJamMs = (() => {
  const n = Number(bacaLokal(KUNCI_SELISIH_JAM));
  return Number.isFinite(n) ? n : 0;
})();

export function catatJamServer(headerDate: string | null): void {
  if (!headerDate) return;
  const server = Date.parse(headerDate);
  if (!Number.isFinite(server)) return;
  selisihJamMs = server - Date.now();
  tulisLokal(KUNCI_SELISIH_JAM, String(selisihJamMs));
}

/** Perkiraan jam SERVER sekarang, dalam milidetik epoch. */
export function waktuServerKira(): number {
  return Date.now() + selisihJamMs;
}

/**
 * Satu sesi yang mati = satu pengumuman, bukan satu per permintaan.
 * Bentuknya meniru `updateSudahDiberitahu` di bawah, yang sudah memakai palang
 * sekali-jalan untuk alasan yang sama persis.
 */
let sesiMatiSudahDiumumkan = false;

/**
 * Bersihkan sesi lalu antar ke layar login dengan SEBABNYA. Dipanggil dari dua
 * tempat: gerbang umur token (sebelum permintaan berangkat) dan penanganan 401
 * (kalau server yang lebih dulu tahu — token dicabut, bukan kedaluwarsa).
 */
function umumkanSesiMati(): void {
  saveAuth(null);
  if (sesiMatiSudahDiumumkan) return;
  sesiMatiSudahDiumumkan = true;
  window.location.href = `/login?${PARAM_SESI}=${NILAI_SESI_BERAKHIR}`;
}

/**
 * Jalur di bawah `/auth/` yang MEMBAWA SESI. Di server hanya `/auth/me` yang
 * dipasangi `requireAuth`; `/login`, `/register`, `/forgot-password`,
 * `/reset-password`, `/verify-email`, `/resend-verification`, dan `/guest`
 * publik — token mati di sana diabaikan, tak pernah melahirkan 401.
 *
 * Menggerbanginya bukan sekadar mubazir, melainkan berbahaya: orang yang
 * tokennya mati DAN sedang berusaha memulihkan aksesnya justru yang paling
 * butuh pintu-pintu itu terbuka. Dipasangkan uji yang membaca daftar
 * `requireAuth` di sumber server, supaya rute ber-sesi baru di bawah `/auth/`
 * tak bisa lahir tanpa daftar ini ikut ditinjau.
 */
const JALUR_AUTH_BERSESI = new Set(["/auth/me"]);

function digerbangiUmurToken(path: string): boolean {
  const bersih = path.split("?")[0];
  return !bersih.startsWith("/auth/") || JALUR_AUTH_BERSESI.has(bersih);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Badan JSON galat apa adanya, bila ada. Beberapa endpoint menyertakan
     * `kode` yang bisa dibaca mesin (mis. `"bill_berjalan"`) supaya klien tak
     * perlu mencocokkan teks bahasa Indonesia untuk memutuskan langkah
     * berikutnya — teksnya bisa berubah kapan saja.
     */
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Event global status server (dipakai overlay "server sedang diperbarui"). */
export const SERVER_STATUS_EVENT = "kakarut:server-status";
function emitServerDown(down: boolean) {
  window.dispatchEvent(new CustomEvent(SERVER_STATUS_EVENT, { detail: { down } }));
}

/** Event: versi frontend baru sudah ter-deploy (build server ≠ build tab ini). */
export const UPDATE_AVAILABLE_EVENT = "kakarut:update-available";
/** Build id yang dimuat tab ini (disuntik server ke <meta>); null di dev tanpa dist. */
export const LOADED_BUILD =
  typeof document !== "undefined"
    ? (document.querySelector('meta[name="kakarut-build"]')?.getAttribute("content") ?? null)
    : null;
let updateSudahDiberitahu = false;
/**
 * Bandingkan build server (dari header X-Kakarut-Build atau /api/health) dengan
 * build yang dimuat tab ini. Berbeda → picu event pembaruan (sekali saja).
 */
export function periksaBuildServer(buildServer: string | null | undefined): void {
  if (!buildServer || !LOADED_BUILD || updateSudahDiberitahu) return;
  if (buildServer !== LOADED_BUILD) {
    updateSudahDiberitahu = true;
    window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT));
  }
}

export async function api<T = unknown>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    formData?: FormData;
    /**
     * Dipanggil dengan header respons pada jawaban yang berhasil.
     *
     * Ada karena `GET /sampah` memulangkan LARIK TELANJANG yang kini
     * berlangit-langit: bentuknya tak boleh berubah (build ponsel lama
     * membacanya `as List`), jadi penanda pemotongannya tinggal di header
     * `X-Kakarut-Terpotong`. Yang butuh tahu memintanya; yang tidak, tak
     * berubah sama sekali.
     */
    bacaHeader?: (h: Headers) => void;
  } = {},
): Promise<T> {
  const auth = loadAuth();

  // GERBANG UMUR TOKEN — satu-satunya titik yang masih bisa memotong ledakannya.
  // Lihat `lib/umurToken.ts` untuk alasan lengkapnya: saat sesi mati, seluruh
  // kueri yang terpasang berangkat dalam SATU momen, jadi apa pun yang
  // dikerjakan saat balasan pertama tiba sudah terlambat untuk tiga belas
  // sisanya. Yang tak terbaca dianggap masih hidup — server tetap otoritasnya.
  if (digerbangiUmurToken(path)) {
    // Sudah diumumkan mati → halaman sedang berpindah ke /login, dan apa pun
    // yang berangkat sekarang tak akan pernah dibaca siapa pun. Ini termasuk
    // permintaan TANPA token: begitu `saveAuth(null)` jalan, kueri yang tersisa
    // di tick yang sama berangkat telanjang dan dibalas "Perlu login (token
    // tidak ada)" — kelas pesan lain, baris log yang sama sia-sianya. Terlihat
    // saat gerbang penuh dijalankan: satu `/cabang` masih lolos sesudah tiga
    // belas lainnya tertahan.
    if (sesiMatiSudahDiumumkan) {
      throw new ApiError(401, "Sesi berakhir, silakan login ulang");
    }
    if (auth?.token && tokenSudahMati(auth.token, waktuServerKira())) {
      umumkanSesiMati();
      throw new ApiError(401, "Sesi berakhir, silakan login ulang");
    }
  }

  const headers: Record<string, string> = {};
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    // gagal jaringan → server tak terjangkau (mis. sedang re-deploy)
    emitServerDown(true);
    throw new ApiError(0, "Tidak dapat terhubung ke server. Mungkin sedang diperbarui.");
  }

  // Deteksi versi frontend baru pada tiap respons (header build id server).
  periksaBuildServer(res.headers.get("X-Kakarut-Build"));
  // Jam server ikut dipungut di titik yang sama — headernya sudah ada di tiap
  // balasan, jadi tak ada permintaan tambahan untuk mengetahuinya.
  catatJamServer(res.headers.get("Date"));

  // 401 pada endpoint selain login = sesi berakhir → paksa ke halaman login.
  // Login yang gagal harus tetap menampilkan pesan asli dari server.
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    umumkanSesiMati();
    // SEBABNYA IKUT: `throw` di bawah tak pernah dibaca siapa pun (dokumennya
    // sudah dibuang oleh perpindahan), jadi kalimatnya diucapkan halaman
    // login lewat query — lihat `lib/pesan-sesi.ts`.
    throw new ApiError(401, "Sesi berakhir, silakan login ulang");
  }
  if (!res.ok) {
    let message = `Kesalahan (${res.status})`;
    let isJsonError = false;
    let badan: Record<string, unknown> | undefined;
    try {
      const data = (await res.json()) as { error?: string };
      badan = data as Record<string, unknown>;
      if (data.error) {
        message = data.error;
        isJsonError = true;
      }
    } catch {
      /* bukan JSON */
    }
    // 404/5xx yang BUKAN respons JSON aplikasi = kemungkinan dari proxy saat
    // container down (re-deploy). Tandai server sedang bermasalah → overlay.
    if (!isJsonError && (res.status === 404 || res.status >= 500)) {
      emitServerDown(true);
    }
    throw new ApiError(res.status, message, badan);
  }
  /*
   * Badan dibaca DULU, overlay ditutup SESUDAHNYA.
   *
   * `res.ok` cuma berarti statusnya 2xx — belum berarti yang datang adalah
   * jawaban aplikasi ini. Kasus nyatanya: reverse-proxy yang melayani shell
   * SPA (`index.html`) untuk path tak dikenal membalas **200 + HTML** saat
   * `/api/*` salah rute atau sedang re-deploy. Bentuk itu justru yang paling
   * mirip "server sedang diperbarui".
   *
   * Dulu `emitServerDown(false)` dipanggil sebelum `res.json()`, jadi respons
   * seperti itu MENUTUP overlay "server sedang diperbarui" lebih dulu, lalu
   * melempar `SyntaxError` mentah ("Unexpected token '<'"). Satu jalur yang
   * ada persis untuk mengabari pengguna bahwa server sedang tak bisa dipakai,
   * malah menyatakan semuanya baik-baik saja tepat ketika ia menerima sesuatu
   * yang tak ia mengerti — dan menggantinya dengan pesan yang tak berarti
   * apa-apa bagi pemakainya.
   *
   * Sekarang gagal-parse diperlakukan sama dengan server tak terjangkau:
   * overlay dinyalakan, pesannya sama dengan jalur gagal jaringan.
   */
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    emitServerDown(true);
    throw new ApiError(0, "Tidak dapat terhubung ke server. Mungkin sedang diperbarui.");
  }
  // request benar-benar dijawab aplikasi → pastikan overlay tertutup
  emitServerDown(false);
  opts.bacaHeader?.(res.headers);
  return data;
}

/**
 * PEMBACA `X-Kakarut-Terpotong`, SATU RUMAH — bukan disalin per layar.
 *
 * Delapan layar memerlukan bentuk yang persis sama: baca headernya, dan
 * anggap "tak terpotong" bila nilainya bukan angka positif. Disalin, ia
 * pelan-pelan berbeda — dan salah satu salinannya juga melanggar aturan
 * rumah "jangan `Number()` mentah di layar" (`angka-input.test.ts`), yang
 * memang benar: `Number()` di sebuah `.tsx` hampir selalu berarti isian
 * pengguna sedang diurai tanpa penjaga. Di sini ia bukan isian melainkan
 * header dari server sendiri, dan penjagaannya ditulis satu kali.
 *
 * `null` berarti "tak dipotong"; angka berarti "sekian yang ditampilkan, dan
 * masih ada sisanya".
 */
export function bacaTerpotong(set: (n: number | null) => void) {
  return (h: Headers) => {
    const n = Number(h.get("X-Kakarut-Terpotong"));
    set(Number.isFinite(n) && n > 0 ? n : null);
  };
}
