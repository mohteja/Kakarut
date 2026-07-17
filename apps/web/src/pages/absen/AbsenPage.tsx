import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import jsQR from "jsqr";
import type { AbsenResult, AbsensiRow } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatWaktu } from "../../lib/format";

/**
 * Koordinat perangkat (GPS) — untuk validasi radius absen di server. null bila
 * GPS ditolak/timeout; server yang memutuskan wajib-tidaknya lokasi.
 */
function ambilLokasi(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}

export function AbsenPage() {
  const { branchQuery } = useBranch();
  const queryClient = useQueryClient();
  const [kode, setKode] = useState("");
  const [hasil, setHasil] = useState<AbsenResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [kameraError, setKameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const hasilTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: daftar = [] } = useQuery({
    queryKey: ["absensi", branchQuery],
    queryFn: () => api<AbsensiRow[]>(`/absensi${branchQuery}`),
    refetchInterval: 60_000,
  });

  const absen = useMutation({
    mutationFn: async (k: string) => {
      const lokasi = await ambilLokasi();
      return api<AbsenResult>(`/absensi${branchQuery}`, {
        method: "POST",
        body: { kode: k, lat: lokasi?.lat ?? null, lng: lokasi?.lng ?? null },
      });
    },
    onSuccess: (data) => {
      setHasil(data);
      setKode("");
      queryClient.invalidateQueries({ queryKey: ["absensi"] });
      // bersihkan kartu hasil setelah beberapa detik agar siap untuk karyawan berikutnya
      if (hasilTimer.current) clearTimeout(hasilTimer.current);
      hasilTimer.current = setTimeout(() => setHasil(null), 6000);
    },
  });

  function stopScan() {
    scanningRef.current = false;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    setScanning(false);
  }

  async function startScan() {
    setKameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setKameraError("Kamera tidak didukung di perangkat/browser ini. Ketik kode saja.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);
      scanningRef.current = true;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setKameraError("Tidak bisa mengakses kamera (izin ditolak?). Ketik kode karyawan saja.");
      stopScan();
    }
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!scanningRef.current || !video || !canvas) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx && w > 0 && h > 0) {
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const found = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
        const teks = found?.data?.trim();
        if (teks) {
          stopScan();
          setKode(teks);
          absen.mutate(teks);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  // hentikan kamera & timer saat komponen dilepas
  useEffect(() => {
    return () => {
      stopScan();
      if (hasilTimer.current) clearTimeout(hasilTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = kode.trim();
    if (k) absen.mutate(k);
  }

  const masuk = hasil?.tipe === "masuk";

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle>🖐 Absen Karyawan</PageTitle>
      <p className="mb-4 text-sm text-stone-500">
        <b>Scan QR</b> karyawan (dari halaman Profil mereka) atau ketik <b>kode karyawan</b> untuk
        mencatat absen. Sistem otomatis mencatat <b>masuk</b> atau <b>pulang</b> sesuai urutan hari
        ini. Stasiun ini dioperasikan admin/kasir.
      </p>

      {/* Kartu hasil absen — besar & jelas untuk konfirmasi cepat */}
      {hasil && (
        <div
          className={`mb-4 rounded-2xl p-5 text-center shadow-sm ${
            masuk ? "bg-green-50 ring-1 ring-green-200" : "bg-blue-50 ring-1 ring-blue-200"
          }`}
        >
          <div className="text-4xl">{masuk ? "✅" : "👋"}</div>
          <div className="mt-1 text-xl font-bold text-stone-800">
            {masuk ? "Selamat datang" : "Sampai jumpa"}, {hasil.nama}!
          </div>
          <div className={`mt-1 text-lg font-semibold ${masuk ? "text-green-700" : "text-blue-700"}`}>
            {masuk ? "Masuk" : "Pulang"} pukul {formatWaktu(hasil.waktu)}
          </div>
          <div className="mt-0.5 text-xs text-stone-500">
            {hasil.employee_code} · {hasil.branch_nama}
          </div>
        </div>
      )}

      <Card className="p-5">
        {/* Preview kamera — <video> SELALU ter-mount agar videoRef sudah ada saat
            startScan menetapkan srcObject (elemen kondisional belum ada saat itu). */}
        <div className={scanning ? "space-y-3" : "hidden"}>
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              className="mx-auto max-h-72 w-full object-contain"
              muted
              playsInline
            />
            <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/70" />
          </div>
          <p className="text-center text-sm text-stone-500">Arahkan QR karyawan ke kamera…</p>
          <button onClick={stopScan} className={`${btnSecondary} w-full`}>
            Batal Scan
          </button>
        </div>
        {!scanning && (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              autoFocus
              value={kode}
              onChange={(e) => setKode(e.target.value.toUpperCase())}
              placeholder="Kode karyawan (8 digit)"
              inputMode="numeric"
              className={`${inputClass} text-center text-2xl font-bold tracking-widest`}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <ErrorText error={absen.error} />
            {kameraError && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {kameraError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void startScan()} className={btnSecondary}>
                📷 Scan QR
              </button>
              <button type="submit" disabled={!kode.trim() || absen.isPending} className={btnPrimary}>
                {absen.isPending ? "Memproses…" : "Absen"}
              </button>
            </div>
          </form>
        )}
      </Card>
      {/* canvas tersembunyi untuk sampling frame kamera */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Daftar absensi hari ini di cabang */}
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-400">
          Absensi hari ini
        </h2>
        <Card className="overflow-x-auto">
          {daftar.length === 0 ? (
            <div className="p-6 text-center text-sm text-stone-400">Belum ada yang absen hari ini.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold text-stone-600">Karyawan</th>
                  <th className="px-3 py-2 font-semibold text-stone-600">Masuk</th>
                  <th className="px-3 py-2 font-semibold text-stone-600">Pulang</th>
                  <th className="px-3 py-2 font-semibold text-stone-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {daftar.map((r) => (
                  <tr key={r.user_id}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-stone-800">{r.nama}</span>
                      {r.employee_code && (
                        <span className="ml-1.5 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-500">
                          {r.employee_code}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-700">{r.masuk ? formatWaktu(r.masuk) : "—"}</td>
                    <td className="px-3 py-2 text-stone-700">{r.keluar ? formatWaktu(r.keluar) : "—"}</td>
                    <td className="px-3 py-2">
                      {r.keluar ? (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
                          Sudah pulang
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          Hadir
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
