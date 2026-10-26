import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { ErrorText, InputPassword, inputClass } from "./ui";

/**
 * Tombol + modal "Hapus Akun" (SOFT delete). Butuh EMAIL AKUN diketik ulang
 * plus password — tombol merahnya baru menyala bila emailnya sama persis
 * (server menegakkan aturan yang sama: `DELETE /onboarding/akun`). Server
 * memblokir bila pemanggil owner terakhir sebuah perusahaan. Sukses → logout.
 * Dipakai di Profil Saya & halaman Onboarding (user tanpa perusahaan).
 */
export function HapusAkunButton() {
  const { auth, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const emailAkun = auth?.user.email ?? "";
  const emailCocok = email.trim().toLowerCase() === emailAkun.trim().toLowerCase() && emailAkun !== "";
  const siap = emailCocok && password !== "";

  const hapus = useMutation({
    mutationFn: () =>
      api("/onboarding/akun", { method: "DELETE", body: { password, email: email.trim() } }),
    onSuccess: () => {
      logout();
      window.location.href = "/login";
    },
  });

  return (
    <>
      <button
        onClick={() => {
          setPassword("");
          setEmail("");
          hapus.reset();
          setOpen(true);
        }}
        className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
      >
        Hapus Akun
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !hapus.isPending && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-stone-800">Hapus Akun</h2>
            <p className="mt-1 mb-3 text-sm text-stone-500">
              Akun Anda akan dihapus dan tidak bisa dipakai login lagi. Riwayat transaksi
              tetap tersimpan.
            </p>
            <label className="mb-1 block text-sm text-stone-700" htmlFor="hapus-email">
              Ketik email akun Anda untuk konfirmasi:{" "}
              <b className="break-all font-mono text-stone-900">{emailAkun}</b>
            </label>
            <input
              id="hapus-email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={emailAkun}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onPaste={(e) => e.preventDefault()}
              className={`${inputClass} mb-1`}
            />
            {email !== "" && !emailCocok && (
              <p className="mb-2 text-xs text-red-600">Email belum sama dengan email akun ini.</p>
            )}
            <label className="mt-2 mb-1 block text-sm text-stone-700">Password</label>
            <InputPassword
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password Anda"
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && siap) hapus.mutate();
              }}
            />
            <ErrorText error={hapus.error} />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={hapus.isPending}
                className="rounded-lg border border-stone-300 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50"
              >
                Batal
              </button>
              <button
                onClick={() => hapus.mutate()}
                disabled={!siap || hapus.isPending}
                className="rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {hapus.isPending ? "Menghapus…" : "Hapus Akun Saya"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
