import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { AuthState } from "../lib/api";
import type { OnboardingStatus, UserRole } from "@kakarut/shared";
import { HapusAkunButton } from "../components/HapusAkunButton";
import { Logo } from "../components/Logo";
import { ErrorText, Spinner, btnPrimary, btnSecondary, inputClass } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

const LABEL_ROLE: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Admin",
  cashier: "Kasir",
  tim: "Tim",
};

/**
 * Landing untuk user TANPA perusahaan: (1) terima undangan yang menunggu, atau
 * (2) buat perusahaan sendiri (jadi owner). Setelah salah satu berhasil, sesi
 * diganti (setSession) → App mengarahkan ke beranda perusahaan.
 */
export function OnboardingPage() {
  const { auth, logout, setSession } = useAuth();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => api<OnboardingStatus>("/onboarding/status"),
  });

  const [namaUsaha, setNamaUsaha] = useState("");

  const buatPerusahaan = useMutation({
    mutationFn: () =>
      api<AuthState>("/onboarding/perusahaan", { method: "POST", body: { nama: namaUsaha.trim() } }),
    onSuccess: (sesi) => setSession(sesi),
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

  function onBuat(e: FormEvent) {
    e.preventDefault();
    if (namaUsaha.trim()) buatPerusahaan.mutate();
  }

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

        {isLoading || !data ? (
          <Spinner />
        ) : (
          <>
            {/* Undangan yang menunggu */}
            {data.undangan.length > 0 && (
              <div className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
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
                <ErrorText error={terima.error} />
              </div>
            )}

            {/* Buat perusahaan sendiri */}
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-bold text-stone-800">🏢 Buat Perusahaan</h2>
              <p className="mb-3 text-sm text-stone-500">
                Punya usaha sendiri? Buat perusahaan dan Anda otomatis jadi <b>owner</b>.
              </p>
              <form onSubmit={onBuat} className="space-y-3">
                <input
                  value={namaUsaha}
                  onChange={(e) => setNamaUsaha(e.target.value)}
                  placeholder="Nama usaha (mis. Warung Baso Sedap)"
                  className={inputClass}
                />
                <ErrorText error={buatPerusahaan.error} />
                <button
                  type="submit"
                  disabled={!namaUsaha.trim() || buatPerusahaan.isPending}
                  className={`${btnPrimary} w-full`}
                >
                  {buatPerusahaan.isPending ? "Membuat…" : "Buat Perusahaan"}
                </button>
              </form>
            </div>

            {/* Menunggu diundang */}
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 p-4 text-center text-sm text-stone-500">
              Atau <b>menunggu diundang</b>: minta owner perusahaan mengundang email Anda
              <div className="mt-1 inline-block rounded-md bg-stone-100 px-2 py-0.5 font-mono text-stone-700">
                {data.email}
              </div>
            </div>
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
