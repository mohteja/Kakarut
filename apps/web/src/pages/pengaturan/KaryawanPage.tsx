import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import type { AktivitasRow } from "@kakarut/shared";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatTanggalRingkas, formatWaktu } from "../../lib/format";

interface Karyawan {
  user_id: string;
  nama: string;
  email: string;
  is_active: boolean;
  role: "owner" | "admin" | "cashier";
  branch_id: string | null;
  cabang: string | null;
  employee_code: string | null;
}

interface FormState {
  nama: string;
  email: string;
  password: string;
  role: "owner" | "admin" | "cashier";
  branch_id: string;
}

const labelRole = { owner: "Owner", admin: "Admin", cashier: "Kasir" } as const;

export function KaryawanPage() {
  const { cabang } = useBranch();
  const queryClient = useQueryClient();
  const { data: karyawan, isLoading } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
  });
  const [form, setForm] = useState<FormState | null>(null);
  // Modal QR karyawan (untuk absensi) + data URL QR yang digenerate
  const [qrFor, setQrFor] = useState<Karyawan | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  // Modal riwayat kegiatan seorang karyawan (log faktur yang ia lakukan)
  const [aktivitasFor, setAktivitasFor] = useState<Karyawan | null>(null);
  const { data: aktivitas } = useQuery({
    queryKey: ["karyawan-aktivitas", aktivitasFor?.user_id],
    queryFn: () =>
      api<{ rows: AktivitasRow[] }>(`/karyawan/${aktivitasFor!.user_id}/aktivitas`),
    enabled: aktivitasFor !== null,
  });

  useEffect(() => {
    let batal = false;
    if (qrFor?.employee_code) {
      setQrUrl(null);
      QRCode.toDataURL(qrFor.employee_code, { margin: 1, width: 320 })
        .then((url) => {
          if (!batal) setQrUrl(url);
        })
        .catch(() => {
          if (!batal) setQrUrl(null);
        });
    } else {
      setQrUrl(null);
    }
    return () => {
      batal = true;
    };
  }, [qrFor]);

  const tambah = useMutation({
    mutationFn: (f: FormState) =>
      api("/karyawan", {
        method: "POST",
        body: {
          nama: f.nama,
          email: f.email,
          password: f.password,
          role: f.role,
          branch_id: f.role === "cashier" ? f.branch_id : f.branch_id || null,
        },
      }),
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["karyawan"] });
    },
  });

  const ubah = useMutation({
    mutationFn: (p: { userId: string; body: Record<string, unknown> }) =>
      api(`/karyawan/${p.userId}`, { method: "PATCH", body: p.body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["karyawan"] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) tambah.mutate(form);
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          <button
            onClick={() =>
              setForm({ nama: "", email: "", password: "", role: "cashier", branch_id: cabang[0]?.id ?? "" })
            }
            className={btnPrimary}
          >
            + Tambah Karyawan
          </button>
        }
      >
        Karyawan
      </PageTitle>
      <ErrorText error={ubah.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Kode</th>
              <th className={thClass}>Email</th>
              <th className={thClass}>Peran</th>
              <th className={thClass}>Cabang</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(karyawan ?? []).map((k) => (
              <tr key={k.user_id}>
                <td className={`${tdClass} font-medium`}>{k.nama}</td>
                <td className={tdClass}>
                  <span className="font-mono font-semibold text-stone-700">
                    {k.employee_code ?? "—"}
                  </span>
                </td>
                <td className={tdClass}>{k.email}</td>
                <td className={tdClass}>{labelRole[k.role]}</td>
                <td className={tdClass}>{k.cabang ?? "Semua"}</td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      k.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    {k.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  {k.employee_code && (
                    <button
                      onClick={() => setQrFor(k)}
                      className="text-sm font-medium text-orange-600 hover:underline"
                    >
                      QR
                    </button>
                  )}
                  <button
                    onClick={() => setAktivitasFor(k)}
                    className="ml-3 text-sm font-medium text-orange-600 hover:underline"
                  >
                    Aktivitas
                  </button>
                  <button
                    onClick={() => {
                      const pw = prompt(`Password baru untuk ${k.nama} (min 8 karakter):`);
                      if (pw) ubah.mutate({ userId: k.user_id, body: { password: pw } });
                    }}
                    className="ml-3 text-sm font-medium text-orange-600 hover:underline"
                  >
                    Reset Password
                  </button>
                  <button
                    onClick={() =>
                      ubah.mutate({ userId: k.user_id, body: { is_active: !k.is_active } })
                    }
                    className="ml-3 text-sm font-medium text-stone-500 hover:underline"
                  >
                    {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={form !== null} onClose={() => setForm(null)} title="Tambah Karyawan">
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password (min 8 karakter)</label>
              <input
                required
                minLength={8}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Peran</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as FormState["role"] })}
                  className={inputClass}
                >
                  <option value="cashier">Kasir</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Cabang {form.role === "cashier" ? "(wajib)" : "(opsional)"}
                </label>
                <select
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                  className={inputClass}
                  required={form.role === "cashier"}
                >
                  {form.role !== "cashier" && <option value="">Semua cabang</option>}
                  {cabang.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nama}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ErrorText error={tambah.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={tambah.isPending} className={btnPrimary}>
                Simpan
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal QR karyawan (untuk absensi) */}
      <Modal open={qrFor !== null} onClose={() => setQrFor(null)} title="QR Absensi Karyawan">
        {qrFor && (
          <div className="space-y-3 text-center">
            <div className="text-lg font-bold text-stone-800">{qrFor.nama}</div>
            {qrUrl ? (
              <img src={qrUrl} alt={`QR ${qrFor.nama}`} className="mx-auto h-56 w-56" />
            ) : (
              <div className="py-16 text-sm text-stone-400">Membuat QR…</div>
            )}
            <div className="font-mono text-2xl font-bold tracking-widest text-stone-800">
              {qrFor.employee_code}
            </div>
            <p className="text-xs text-stone-500">
              Karyawan memindai QR ini (atau mengetik kodenya) di halaman <b>Absen</b> untuk mencatat
              masuk/pulang.
            </p>
            <div className="flex justify-center gap-2 print:hidden">
              <button onClick={() => setQrFor(null)} className={btnSecondary}>
                Tutup
              </button>
              <button onClick={() => window.print()} disabled={!qrUrl} className={btnPrimary}>
                🖨 Cetak QR
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal riwayat kegiatan seorang karyawan (jejak log faktur) */}
      <Modal
        open={aktivitasFor !== null}
        onClose={() => setAktivitasFor(null)}
        title={`🗒 Aktivitas — ${aktivitasFor?.nama ?? ""}`}
      >
        {aktivitas && aktivitas.rows.length > 0 ? (
          <ol className="max-h-96 space-y-1.5 overflow-y-auto text-sm">
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
        ) : (
          <div className="py-8 text-center text-sm text-stone-400">
            Belum ada kegiatan tercatat untuk karyawan ini.
          </div>
        )}
      </Modal>

      {/* Kontainer khusus cetak — hanya QR + identitas yang tampil saat window.print() */}
      {qrFor && qrUrl && (
        <div id="qr-print" className="hidden print:block">
          <div className="text-center">
            <img src={qrUrl} alt="" className="mx-auto" style={{ width: "60mm", height: "60mm" }} />
            <div className="mt-2 text-xl font-bold">{qrFor.nama}</div>
            <div className="font-mono text-2xl font-bold tracking-widest">{qrFor.employee_code}</div>
          </div>
        </div>
      )}
    </div>
  );
}
