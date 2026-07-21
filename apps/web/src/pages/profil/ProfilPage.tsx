import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import type { AktivitasRow, ProfilDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  inputClass,
} from "../../components/ui";
import { HapusAkunButton } from "../../components/HapusAkunButton";
import { api } from "../../lib/api";
import { formatTanggalRingkas, formatWaktu } from "../../lib/format";

const LABEL_ROLE: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  cashier: "Kasir",
};

/**
 * Profil akun sendiri — semua peran: identitas, kode karyawan + QR untuk
 * absen (ditunjukkan ke admin/kasir untuk dipindai), dan ganti password.
 */
export function ProfilPage() {
  const { data: profil, isLoading } = useQuery({
    queryKey: ["profil"],
    queryFn: () => api<ProfilDto>("/profil"),
  });
  // kegiatan terakhir akun ini (jejak log faktur: buat/ubah tahap/terima)
  const { data: aktivitas } = useQuery({
    queryKey: ["profil-aktivitas"],
    queryFn: () => api<{ rows: AktivitasRow[] }>("/profil/aktivitas"),
  });

  // QR kode karyawan (payload sama dengan QR di halaman Kelola Karyawan)
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!profil?.employee_code) return;
    QRCode.toDataURL(profil.employee_code, { margin: 1, width: 320 })
      .then(setQrUrl)
      .catch(() => setQrUrl(null));
  }, [profil?.employee_code]);

  // form ganti password
  const [lama, setLama] = useState("");
  const [baru, setBaru] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [sukses, setSukses] = useState(false);
  const ganti = useMutation({
    mutationFn: () =>
      api("/profil/password", {
        method: "POST",
        body: { password_lama: lama, password_baru: baru },
      }),
    onSuccess: () => {
      setLama("");
      setBaru("");
      setKonfirmasi("");
      setSukses(true);
    },
  });
  const tidakCocok = konfirmasi.length > 0 && baru !== konfirmasi;
  const terlaluPendek = baru.length > 0 && baru.length < 8;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSukses(false);
    if (baru.length >= 8 && baru === konfirmasi) ganti.mutate();
  }

  if (isLoading || !profil) return <Spinner />;

  return (
    <div className="max-w-xl">
      <PageTitle>👤 Profil Saya</PageTitle>

      {/* Identitas */}
      <Card className="mb-4 p-4">
        <div className="text-lg font-bold text-stone-800">{profil.nama}</div>
        <div className="text-sm text-stone-500">{profil.email}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {profil.role && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
              {LABEL_ROLE[profil.role] ?? profil.role}
            </span>
          )}
          {profil.cabang && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
              🏪 {profil.cabang}
            </span>
          )}
        </div>
      </Card>

      {/* Kode & QR absen */}
      {profil.employee_code && (
        <Card className="mb-4 p-4 text-center">
          <h2 className="mb-1 font-bold text-stone-800">QR Absen Saya</h2>
          <p className="mb-3 text-sm text-stone-500">
            Tunjukkan QR ini ke <b>admin</b> atau <b>kasir</b> untuk dipindai saat absen
            masuk/pulang. Kode karyawan di bawah juga bisa mereka ketik manual.
          </p>
          {qrUrl ? (
            <img
              src={qrUrl}
              alt={`QR absen ${profil.nama}`}
              className="mx-auto h-52 w-52 rounded-lg border border-stone-200"
            />
          ) : (
            <div className="py-14 text-sm text-stone-400">Membuat QR…</div>
          )}
          <div className="mt-3 inline-block rounded-lg bg-stone-100 px-4 py-1.5 font-mono text-xl font-bold tracking-widest text-stone-800">
            {profil.employee_code}
          </div>
        </Card>
      )}

      {/* Aktivitas terakhir (jejak kegiatan faktur) */}
      {aktivitas && aktivitas.rows.length > 0 && (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 font-bold text-stone-800">🗒 Aktivitas Saya</h2>
          <ol className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {aktivitas.rows.map((a) => (
              <li key={a.id} className="rounded-lg border border-stone-100 px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{a.jalur === "beli" ? "🛒" : "🏭"}</span>
                  <span className="font-medium text-stone-700">{a.aksi}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-stone-400">
                    {formatTanggalRingkas(a.waktu)} {formatWaktu(a.waktu)}
                  </span>
                </div>
                {(a.detail || a.cabang) && (
                  <div className="text-xs text-stone-500">
                    {a.detail}
                    {a.cabang && <span className="text-stone-400"> · {a.cabang}</span>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Ganti password */}
      <Card className="p-4">
        <h2 className="mb-2 font-bold text-stone-800">🔒 Ganti Password</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Password sekarang</label>
            <input
              type="password"
              required
              value={lama}
              onChange={(e) => setLama(e.target.value)}
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password baru</label>
            <input
              type="password"
              required
              minLength={8}
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
            {terlaluPendek && (
              <p className="mt-1 text-xs text-red-600">Minimal 8 karakter.</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Ulangi password baru</label>
            <input
              type="password"
              required
              value={konfirmasi}
              onChange={(e) => setKonfirmasi(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
            {tidakCocok && (
              <p className="mt-1 text-xs text-red-600">Password baru tidak sama.</p>
            )}
          </div>
          <ErrorText error={ganti.error} />
          {sukses && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              ✅ Password berhasil diganti — pakai password baru saat login berikutnya.
            </div>
          )}
          <button
            type="submit"
            disabled={ganti.isPending || tidakCocok || terlaluPendek}
            className={`${btnPrimary} w-full`}
          >
            {ganti.isPending ? "Menyimpan…" : "Simpan Password Baru"}
          </button>
        </form>
      </Card>

      {/* Zona bahaya: hapus akun sendiri */}
      <Card className="mt-4 border-red-200 p-4">
        <h2 className="mb-1 font-bold text-red-700">⚠ Hapus Akun</h2>
        <p className="mb-3 text-sm text-stone-500">
          Menghapus akun berarti Anda tak bisa login lagi. Owner terakhir sebuah perusahaan
          harus menyerahkan kepemilikan atau menghapus perusahaan lebih dulu.
        </p>
        <HapusAkunButton />
      </Card>
    </div>
  );
}
