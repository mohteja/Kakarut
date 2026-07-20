import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import jsQR from "jsqr";
import { jarakMeter, type AbsenResult, type AbsensiRow } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, type Cabang } from "../../context/BranchContext";
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

/**
 * Deteksi radius cabang secara langsung: pantau GPS perangkat, hitung jarak ke
 * titik cabang. Dipakai layar absen (tim & kasir) agar tahu apakah sudah dalam
 * radius sebelum menekan tombol absen.
 */
type RadiusStatus =
  | { mode: "off" }
  | { mode: "denied"; radius: number }
  | { mode: "pending"; radius: number }
  | { mode: "in" | "out"; jarak: number; radius: number };

function useRadiusStatus(branch?: Cabang): RadiusStatus {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [denied, setDenied] = useState(false);
  const lat = branch?.latitude ?? null;
  const lng = branch?.longitude ?? null;
  useEffect(() => {
    setPos(null);
    setDenied(false);
    if (lat == null || lng == null || !navigator.geolocation) {
      if (lat != null && lng != null) setDenied(!navigator.geolocation);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setDenied(false);
      },
      () => setDenied(true),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [lat, lng]);

  if (lat == null || lng == null) return { mode: "off" };
  const radius = branch!.radius_absen_m;
  if (denied) return { mode: "denied", radius };
  if (!pos) return { mode: "pending", radius };
  const jarak = Math.round(jarakMeter(pos.lat, pos.lng, lat, lng));
  return { mode: jarak <= radius ? "in" : "out", jarak, radius };
}

function RadiusPanel({ branch }: { branch?: Cabang }) {
  const s = useRadiusStatus(branch);
  const nama = branch?.nama ?? "cabang";
  const box = (cls: string, isi: ReactNode) => (
    <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${cls}`}>{isi}</div>
  );
  if (s.mode === "off")
    return box(
      "bg-stone-50 text-stone-500",
      <>📍 {nama}: titik lokasi belum diatur — absen diterima tanpa batas lokasi.</>,
    );
  if (s.mode === "denied")
    return box(
      "bg-amber-50 text-amber-800",
      <>
        📍 <b>GPS belum aktif/diizinkan.</b> Izinkan akses lokasi di perangkat — absen di{" "}
        {nama} dibatasi radius <b>{s.radius} m</b>.
      </>,
    );
  if (s.mode === "pending")
    return box("bg-blue-50 text-blue-800", <>📍 Membaca lokasi… (radius {s.radius} m di {nama})</>);
  if (s.mode === "in")
    return box(
      "bg-green-50 font-medium text-green-800 ring-1 ring-green-200",
      <>
        ✅ Dalam radius {nama} — jarak <b>{s.jarak} m</b> (maks {s.radius} m). Siap absen.
      </>,
    );
  return box(
    "bg-red-50 font-medium text-red-700 ring-1 ring-red-200",
    <>
      🚫 Di luar radius {nama} — jarak <b>{s.jarak} m</b> (maks {s.radius} m). Dekati lokasi
      cabang dulu.
    </>,
  );
}

/** Kamera mati / memindai QR / mengambil swafoto. */
type Mode = "idle" | "scan" | "capture";

export function AbsenPage() {
  const { auth } = useAuth();
  const role = auth?.user.role;
  const isTim = role === "tim";
  // Stasiun pindai (memindai/ketik kode karyawan lain) hanya admin/kasir.
  const bisaStasiun = role === "owner" || role === "admin" || role === "cashier";
  const { branchQuery, branchId, cabang } = useBranch();
  const branch = cabang.find((b) => b.id === branchId);

  const queryClient = useQueryClient();
  const [kode, setKode] = useState("");
  const [hasil, setHasil] = useState<AbsenResult | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [kameraError, setKameraError] = useState<string | null>(null);
  // Kamera swafoto sedang untuk absen SENDIRI atau untuk kode manual (operator)?
  const captureForRef = useRef<"self" | "manual">("self");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef<Mode>("idle");
  const hasilTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: daftar = [] } = useQuery({
    queryKey: ["absensi", branchQuery],
    queryFn: () => api<AbsensiRow[]>(`/absensi${branchQuery}`),
    refetchInterval: 60_000,
  });

  // Absen: unggah foto bukti → dapat URL → catat absen. kode=null → absen
  // SENDIRI (POST /absensi/saya); kode terisi → stasiun (POST /absensi).
  const absen = useMutation({
    mutationFn: async ({ blob, kode }: { blob: Blob; kode: string | null }) => {
      const fd = new FormData();
      fd.append("file", blob, "absen.jpg");
      const { url } = await api<{ url: string }>(`/upload?tujuan=bukti`, {
        method: "POST",
        formData: fd,
      });
      const lokasi = await ambilLokasi();
      const body = { foto_url: url, lat: lokasi?.lat ?? null, lng: lokasi?.lng ?? null };
      return kode
        ? api<AbsenResult>(`/absensi${branchQuery}`, { method: "POST", body: { ...body, kode } })
        : api<AbsenResult>(`/absensi/saya${branchQuery}`, { method: "POST", body });
    },
    onSuccess: (data) => {
      setHasil(data);
      setKode("");
      queryClient.invalidateQueries({ queryKey: ["absensi"] });
      if (hasilTimer.current) clearTimeout(hasilTimer.current);
      hasilTimer.current = setTimeout(() => setHasil(null), 6000);
    },
  });

  function stopCamera() {
    modeRef.current = "idle";
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    setMode("idle");
  }

  async function startCamera(next: "scan" | "capture") {
    setKameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setKameraError("Kamera tidak didukung di perangkat/browser ini.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // scan QR pakai kamera belakang; swafoto pakai kamera depan
        video: { facingMode: next === "scan" ? "environment" : "user" },
        audio: false,
      });
      streamRef.current = stream;
      setMode(next);
      modeRef.current = next;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();
      if (next === "scan") rafRef.current = requestAnimationFrame(tick);
    } catch {
      setKameraError("Tidak bisa mengakses kamera (izin ditolak?).");
      stopCamera();
    }
  }

  function grabFrame(): Promise<Blob | null> {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return Promise.resolve(null);
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return Promise.resolve(null);
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7));
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (modeRef.current !== "scan" || !video || !canvas) return;
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
          // frame QR ini SEKALIGUS jadi foto bukti (capture saat scan)
          canvas.toBlob(
            (blob) => {
              stopCamera();
              setKode(teks);
              if (blob) absen.mutate({ blob, kode: teks });
              else setKameraError("Gagal mengambil foto, coba lagi.");
            },
            "image/jpeg",
            0.7,
          );
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  // Konfirmasi ambil foto swafoto → kirim absen (self atau kode manual).
  async function konfirmFoto() {
    const blob = await grabFrame();
    if (!blob) {
      setKameraError("Gagal mengambil foto, coba lagi.");
      return;
    }
    const target = captureForRef.current;
    if (target === "manual" && !kode.trim()) {
      setKameraError("Kode karyawan kosong.");
      return;
    }
    stopCamera();
    absen.mutate({ blob, kode: target === "manual" ? kode.trim() : null });
  }

  useEffect(() => {
    return () => {
      stopCamera();
      if (hasilTimer.current) clearTimeout(hasilTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter pada input kode (operator) → buka kamera swafoto (foto wajib dulu).
  function onSubmitKode(e: FormEvent) {
    e.preventDefault();
    if (kode.trim()) {
      captureForRef.current = "manual";
      void startCamera("capture");
    }
  }

  function mulaiAbsenSaya() {
    captureForRef.current = "self";
    void startCamera("capture");
  }

  const masuk = hasil?.tipe === "masuk";

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle>🖐 Absen Karyawan</PageTitle>

      {/* Deteksi radius cabang — untuk tim maupun kasir */}
      <RadiusPanel branch={branch} />

      {/* Kartu hasil absen */}
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
            {hasil.jarak_m != null && <> · {hasil.jarak_m} m dari cabang</>}
          </div>
          {hasil.foto_url && (
            <img
              src={hasil.foto_url}
              alt="Foto absen"
              className="mx-auto mt-3 h-28 w-28 rounded-xl object-cover shadow ring-2 ring-white"
            />
          )}
        </div>
      )}

      {/* Preview kamera (self/scan/manual) — <video> selalu ter-mount */}
      <Card className={mode !== "idle" ? "space-y-3 p-5" : "hidden"}>
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="mx-auto max-h-72 w-full object-contain" muted playsInline />
          {mode === "scan" && (
            <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/70" />
          )}
        </div>
        <p className="text-center text-sm text-stone-500">
          {mode === "scan"
            ? "Arahkan QR karyawan ke kamera…"
            : "Posisikan wajah, lalu ambil foto untuk menyimpan absen."}
        </p>
        {mode === "capture" ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={stopCamera} className={btnSecondary}>
              Batal
            </button>
            <button
              type="button"
              onClick={() => void konfirmFoto()}
              disabled={absen.isPending}
              className={btnPrimary}
            >
              {absen.isPending ? "Memproses…" : "📸 Ambil Foto & Absen"}
            </button>
          </div>
        ) : (
          <button type="button" onClick={stopCamera} className={`${btnSecondary} w-full`}>
            Batal Scan
          </button>
        )}
      </Card>

      {/* ---- ABSEN SENDIRI (semua peran) ---- */}
      {mode === "idle" && (
        <Card className="mb-4 p-5 text-center">
          <div className="text-sm text-stone-500">
            Tekan untuk mencatat kehadiran Anda sendiri — ambil <b>swafoto</b> + lokasi otomatis
            terkirim. Sistem menentukan <b>masuk</b>/<b>pulang</b> sesuai urutan hari ini.
          </div>
          <ErrorText error={absen.error} />
          {kameraError && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {kameraError}
            </div>
          )}
          <button
            onClick={mulaiAbsenSaya}
            disabled={absen.isPending}
            className={`${btnPrimary} mt-3 w-full py-3 text-base`}
          >
            📸 Absen Sekarang (swafoto)
          </button>
        </Card>
      )}

      {/* ---- STASIUN PINDAI (admin/kasir): scan/ketik kode karyawan lain ---- */}
      {mode === "idle" && bisaStasiun && (
        <Card className="p-5">
          <div className="mb-3 text-sm font-semibold text-stone-700">
            🧑‍💼 Stasiun pindai karyawan
          </div>
          <form onSubmit={onSubmitKode} className="space-y-3">
            <input
              value={kode}
              onChange={(e) => setKode(e.target.value.toUpperCase())}
              placeholder="Kode karyawan (8 digit)"
              inputMode="numeric"
              className={`${inputClass} text-center text-2xl font-bold tracking-widest`}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <p className="text-center text-xs text-stone-400">
              📸 Absen wajib disertai foto sebagai bukti kehadiran.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void startCamera("scan")} className={btnSecondary}>
                📷 Scan QR
              </button>
              <button type="submit" disabled={!kode.trim() || absen.isPending} className={btnPrimary}>
                📸 Foto & Absen
              </button>
            </div>
          </form>
        </Card>
      )}

      {isTim && mode === "idle" && (
        <p className="mt-3 text-center text-xs text-stone-400">
          Kode QR Anda ada di halaman <b>Profil Saya</b> — bisa juga dipindai kasir.
        </p>
      )}

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
                  <th className="px-3 py-2 font-semibold text-stone-600">Foto</th>
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
                      <div className="flex gap-1">
                        {r.foto_masuk && (
                          <a href={r.foto_masuk} target="_blank" rel="noreferrer" title="Foto masuk">
                            <img
                              src={r.foto_masuk}
                              alt="masuk"
                              className="h-8 w-8 rounded object-cover ring-1 ring-green-200"
                            />
                          </a>
                        )}
                        {r.foto_keluar && (
                          <a href={r.foto_keluar} target="_blank" rel="noreferrer" title="Foto pulang">
                            <img
                              src={r.foto_keluar}
                              alt="pulang"
                              className="h-8 w-8 rounded object-cover ring-1 ring-blue-200"
                            />
                          </a>
                        )}
                        {!r.foto_masuk && !r.foto_keluar && <span className="text-stone-300">—</span>}
                      </div>
                    </td>
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
