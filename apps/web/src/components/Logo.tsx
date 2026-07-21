/**
 * Logo Terakasir — memakai berkas asli (`/logo.png`, kotak gradien hijau + bentuk
 * geometris putih). Dipakai ulang di Login, Signup, Onboarding, dan sidebar.
 * `className` mengatur ukuran (mis. "h-14 w-14"); `rounded` menambah sudut
 * membulat (default) — matikan bila pembungkusnya sudah `overflow-hidden`.
 */
export function Logo({ className = "h-12 w-12", rounded = true }: { className?: string; rounded?: boolean }) {
  return (
    <img
      src="/logo.png"
      alt="Terakasir"
      className={`${className} object-contain${rounded ? " rounded-xl" : ""}`}
    />
  );
}
