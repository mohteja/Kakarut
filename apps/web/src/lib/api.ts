export interface AuthState {
  token: string;
  user: {
    sub: string;
    email: string;
    nama: string;
    is_super_admin: boolean;
    company_id: string | null;
    role: "owner" | "admin" | "cashier" | null;
    branch_id: string | null;
  };
  company: {
    id: string;
    nama: string;
    slug: string;
    logo_url: string | null;
    pb1_enabled: boolean;
    pb1_rate: number;
    timezone: string;
  } | null;
  branch: { id: string; nama: string } | null;
}

const STORAGE_KEY = "kakarut.auth";

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

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const auth = loadAuth();
  const headers: Record<string, string> = {};
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });

  // 401 pada endpoint selain login = sesi berakhir → paksa ke halaman login.
  // Login yang gagal harus tetap menampilkan pesan asli dari server.
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    saveAuth(null);
    window.location.href = "/login";
    throw new ApiError(401, "Sesi berakhir, silakan login ulang");
  }
  if (!res.ok) {
    let message = `Kesalahan (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* bukan JSON */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}
