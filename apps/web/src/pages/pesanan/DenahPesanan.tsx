import {
  dibatalkanDapur,
  labelAntrean,
  menitMenungguTertua,
  pesananTerlambat,
  type MejaDto,
  type PesananRow,
  type RuanganDto,
} from "@kakarut/shared";

/**
 * PAPAN PESANAN SEBAGAI DENAH (permintaan pemilik 2026-11-11): pesanan
 * ditaruh di meja asalnya, di dalam ruangannya — tata letak yang sama dengan
 * Pengaturan → Meja. "Kasir & Take Away" menumpuk semua pesanan bawa pulang
 * sebagai chip nomor antrean (TA-1, TA-2, …).
 *
 * Kotak meja merah berkedip bila ada pesanannya yang lewat tenggat.
 */
export function DenahPesanan({
  pesanan,
  meja,
  ruangan,
  sekarang,
  onBukaMeja,
  onBukaPesanan,
}: {
  /** pesanan yang tampil (sudah tersaring) */
  pesanan: PesananRow[];
  meja: MejaDto[];
  ruangan: RuanganDto[];
  sekarang: number;
  onBukaMeja: (mejaId: string) => void;
  onBukaPesanan: (p: PesananRow) => void;
}) {
  const perMeja = new Map<string, PesananRow[]>();
  for (const p of pesanan) {
    if (!p.meja_id) continue;
    const arr = perMeja.get(p.meja_id) ?? [];
    arr.push(p);
    perMeja.set(p.meja_id, arr);
  }
  const terlambat = (p: PesananRow) =>
    !dibatalkanDapur(p.status) && p.status !== "selesai" && pesananTerlambat(p.items, sekarang);
  const tampilMeja = meja.filter((m) => m.is_active || m.tipe === "takeaway" || perMeja.has(m.id));

  return (
    <div
      data-testid="denah-pesanan"
      className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-stone-200 bg-[linear-gradient(#f5f5f4_1px,transparent_1px),linear-gradient(90deg,#f5f5f4_1px,transparent_1px)] bg-[length:24px_24px] bg-stone-50"
    >
      {ruangan.map((r) => (
        <div
          key={r.id}
          className="pointer-events-none absolute rounded-lg border-2 border-stone-300 bg-white/60"
          style={{ left: `${r.pos_x}%`, top: `${r.pos_y}%`, width: `${r.lebar}%`, height: `${r.tinggi}%` }}
        >
          <span className="absolute left-1.5 top-1 text-[11px] font-bold uppercase tracking-wide text-stone-500">
            {r.nama}
          </span>
        </div>
      ))}
      {tampilMeja.map((m) => {
        const daftar = perMeja.get(m.id) ?? [];
        const hidup = daftar.filter((p) => !dibatalkanDapur(p.status));
        const jalan = hidup.filter((p) => p.status !== "selesai");
        const lama = daftar.some(terlambat);
        const takeaway = m.tipe === "takeaway";
        const menit = Math.max(0, ...jalan.map((p) => menitMenungguTertua(p.items, sekarang) ?? 0));
        const warna = lama
          ? "kedip-alarm border-2"
          : jalan.length > 0
            ? "border-orange-400 bg-orange-50 text-orange-900"
            : hidup.length > 0
              ? "border-green-400 bg-green-50 text-green-800"
              : "border-stone-300 bg-white text-stone-400";
        return (
          <div
            key={m.id}
            role="button"
            tabIndex={0}
            data-testid={takeaway ? "denah-kasir-take-away" : "denah-meja-pesanan"}
            data-terlambat={lama ? "ya" : undefined}
            onClick={() => daftar.length > 0 && onBukaMeja(m.id)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && daftar.length > 0) onBukaMeja(m.id);
            }}
            style={{ left: `${m.pos_x}%`, top: `${m.pos_y}%` }}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 select-none flex-col items-center rounded-lg border px-2.5 py-1.5 text-center text-xs font-semibold shadow-sm ${
              takeaway ? "min-w-[7rem] max-w-[46%]" : "min-w-[4.5rem] max-w-[30%]"
            } ${daftar.length > 0 ? "cursor-pointer hover:shadow-md" : ""} ${warna}`}
          >
            <span className="truncate">{takeaway ? `🧾 ${m.nama}` : m.nama}</span>
            {takeaway ? (
              daftar.length > 0 ? (
                <div className="mt-1 flex flex-wrap justify-center gap-1">
                  {daftar.map((p) => (
                    <button
                      key={`${p.jenis}:${p.id}`}
                      type="button"
                      data-testid="chip-antrean"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBukaPesanan(p);
                      }}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        terlambat(p)
                          ? "bg-red-600 text-white"
                          : p.status === "selesai"
                            ? "bg-green-100 text-green-700"
                            : dibatalkanDapur(p.status)
                              ? "bg-stone-100 text-stone-400 line-through"
                              : "bg-orange-600 text-white"
                      }`}
                    >
                      🥡 {labelAntrean(p.nomor_antrean) ?? p.nomor ?? "?"}
                      {p.customer ? ` · ${p.customer}` : ""}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[10px] font-medium opacity-70">tak ada take away</span>
              )
            ) : daftar.length > 0 ? (
              <span className="text-[10px] font-medium">
                {jalan.length > 0
                  ? `${lama ? "🚨" : "⏱"} ${menit} mnt${daftar.length > 1 ? ` · ${daftar.length} pesanan` : ""}`
                  : hidup.length > 0
                    ? "✅ selesai"
                    : "✖ batal"}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Pesanan yang tak punya tempat di denah — tanpa meja, atau mejanya sudah dihapus. */
export function pesananTanpaMeja(pesanan: PesananRow[], meja: MejaDto[]): PesananRow[] {
  const ada = new Set(meja.map((m) => m.id));
  return pesanan.filter((p) => !p.meja_id || !ada.has(p.meja_id));
}
