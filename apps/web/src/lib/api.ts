export interface AuthState {
  token: string;
  user: {
    sub: string;
    email: string;
    nama: string;
    is_super_admin: boolean;
    company_id: string | null;
    role: "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar" | null;
    branch_id: string | null;
  };
  company: {
    id: string;
    nama: string;
    slug: string;
    logo_url: string | null;
    pb1_enabled: boolean;
    pb1_rate: number;
    diskon_maks_persen: number;
    timezone: string;
  } | null;
  branch: { id: string; nama: string } | null;
}

/** Kunci sesi di localStorage — dipantau lintas tab (event `storage`). */
export const AUTH_STORAGE_KEY = "kakarut.auth";
const STORAGE_KEY = AUTH_STORAGE_KEY;

export function loadAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

export function saveAuth(state: AuthState | null) {
  if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  else localStorage.removeItem(STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
  opts: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const auth = loadAuth();
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

  // 401 pada endpoint selain login = sesi berakhir → paksa ke halaman login.
  // Login yang gagal harus tetap menampilkan pesan asli dari server.
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    saveAuth(null);
    window.location.href = "/login";
    throw new ApiError(401, "Sesi berakhir, silakan login ulang");
  }
  if (!res.ok) {
    let message = `Kesalahan (${res.status})`;
    let isJsonError = false;
    try {
      const data = (await res.json()) as { error?: string };
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
    throw new ApiError(res.status, message);
  }
  // request berhasil menyentuh server → pastikan overlay tertutup
  emitServerDown(false);
  return (await res.json()) as T;
}
