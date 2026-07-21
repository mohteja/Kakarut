/**
 * Logo Kakarut — bentuk geometris (tiga "layar" putih + menara tengah) di atas
 * kotak gradien hijau. SVG inline agar tajam di segala ukuran & bisa dipakai
 * ulang (login, sidebar, dsb). `className` mengatur ukuran (mis. "h-14 w-14").
 */
export function Logo({ className = "h-12 w-12", rounded = true }: { className?: string; rounded?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Kakarut"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="kakarutLogoBg" x1="0" y1="0" x2="1" y2="0.55">
          <stop offset="0" stopColor="#0a7a0e" />
          <stop offset="1" stopColor="#8ec400" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx={rounded ? 22 : 0} fill="url(#kakarutLogoBg)" />
      <g fill="#ffffff">
        <path d="M18,19 L18,46 L35,46 Z" />
        <path d="M45,19 L62,46 L57,46 L57,85 L45,85 Z" />
        <path d="M72,19 L72,46 L89,46 Z" />
      </g>
    </svg>
  );
}
