import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { SmtpEncryption, SmtpSettingsDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { api } from "../../lib/api";

interface FormState {
  host: string;
  port: string;
  username: string;
  password: string;
  encryption: SmtpEncryption;
  sender_name: string;
  sender_email: string;
}

/**
 * Pengaturan email (SMTP) tingkat platform (super admin). Dipakai untuk email
 * sistem: reset password (termasuk user tanpa perusahaan) & undangan. Bila
 * kosong, sistem pakai Resend (bila RESEND_API_KEY diatur) atau tak mengirim.
 */
export function SmtpPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-smtp"],
    queryFn: () => api<SmtpSettingsDto>("/admin/sistem/smtp"),
  });

  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    if (data && form === null) {
      setForm({
        host: data.host ?? "",
        port: String(data.port ?? 587),
        username: data.username ?? "",
        password: "",
        encryption: data.encryption,
        sender_name: data.sender_name ?? "",
        sender_email: data.sender_email ?? "",
      });
    }
  }, [data, form]);

  const simpan = useMutation({
    mutationFn: (f: FormState) =>
      api<SmtpSettingsDto>("/admin/sistem/smtp", {
        method: "PUT",
        body: {
          host: f.host || null,
          port: Number(f.port) || 587,
          username: f.username || null,
          ...(f.password ? { password: f.password } : {}),
          encryption: f.encryption,
          sender_name: f.sender_name || null,
          sender_email: f.sender_email || null,
        },
      }),
    onSuccess: () => {
      setForm((prev) => (prev ? { ...prev, password: "" } : prev));
      qc.invalidateQueries({ queryKey: ["admin-smtp"] });
    },
  });

  const testKoneksi = useMutation({
    mutationFn: () => api<{ ok: boolean }>("/admin/sistem/smtp/test", { method: "POST" }),
  });
  const testEmail = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; to: string; provider: string }>("/admin/sistem/smtp/test-email", {
        method: "POST",
        body: {},
      }),
  });

  if (isLoading || !data || !form) return <Spinner />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  return (
    <div className="max-w-2xl">
      <PageTitle>✉️ Pengaturan Email (SMTP)</PageTitle>
      <p className="mb-4 text-sm text-stone-500">
        Konfigurasi server SMTP untuk email sistem (reset password &amp; undangan karyawan). Jika
        kosong, sistem memakai Resend (bila diatur di server) atau email tidak terkirim.
      </p>

      {/* Status */}
      {data.configured ? (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <div className="font-semibold text-green-800">✓ Email siap dikirim</div>
          <div className="text-sm text-green-700">
            Penyedia aktif:{" "}
            <b>{data.provider === "smtp" ? "SMTP Anda" : data.provider === "resend" ? "Resend" : "—"}</b>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="font-semibold text-amber-800">Email belum dikonfigurasi</div>
          <div className="text-sm text-amber-700">
            Reset password &amp; undangan belum bisa terkirim via email. Isi SMTP di bawah.
          </div>
        </div>
      )}

      {/* Form */}
      <Card className="p-5">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium">SMTP Host</label>
              <input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="smtp.gmail.com"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                placeholder="587"
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Username</label>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="akun@gmail.com"
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={data.has_password ? "•••••••• (tersimpan)" : "App Password"}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Enkripsi</label>
            <select
              value={form.encryption}
              onChange={(e) => setForm({ ...form, encryption: e.target.value as SmtpEncryption })}
              className={inputClass}
            >
              <option value="starttls">STARTTLS (Port 587)</option>
              <option value="ssl">SSL/TLS (Port 465)</option>
              <option value="none">Tanpa enkripsi</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama Pengirim</label>
              <input
                value={form.sender_name}
                onChange={(e) => setForm({ ...form, sender_name: e.target.value })}
                placeholder="Kakarut"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email Pengirim</label>
              <input
                type="email"
                value={form.sender_email}
                onChange={(e) => setForm({ ...form, sender_email: e.target.value })}
                placeholder="noreply@usaha.com"
                className={inputClass}
              />
            </div>
          </div>

          <ErrorText error={simpan.error} />
          {simpan.isSuccess && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              ✅ Pengaturan tersimpan.
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={simpan.isPending} className={btnPrimary}>
              {simpan.isPending ? "Menyimpan…" : "Simpan"}
            </button>
            <button
              type="button"
              onClick={() => testKoneksi.mutate()}
              disabled={testKoneksi.isPending}
              className={btnSecondary}
            >
              {testKoneksi.isPending ? "Menguji…" : "🔌 Test Koneksi"}
            </button>
            <button
              type="button"
              onClick={() => testEmail.mutate()}
              disabled={testEmail.isPending}
              className={btnSecondary}
            >
              {testEmail.isPending ? "Mengirim…" : "✈ Kirim Test Email"}
            </button>
          </div>
          {testKoneksi.isSuccess && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              ✅ Koneksi SMTP berhasil.
            </div>
          )}
          <ErrorText error={testKoneksi.error} />
          {testEmail.isSuccess && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              ✅ Test email terkirim ke {testEmail.data.to} (via {testEmail.data.provider}).
            </div>
          )}
          <ErrorText error={testEmail.error} />
        </form>
      </Card>

      {/* Panduan */}
      <Card className="mt-4 p-4">
        <h2 className="mb-2 font-bold text-stone-800">📖 Panduan Konfigurasi</h2>
        <dl className="space-y-1.5 text-sm">
          {[
            ["Gmail", "smtp.gmail.com · Port 587 (STARTTLS) atau 465 (SSL) · pakai App Password"],
            ["Outlook", "smtp.office365.com · Port 587 (STARTTLS)"],
            ["Zoho", "smtp.zoho.com · Port 587 (STARTTLS) atau 465 (SSL)"],
            ["Custom", "Hubungi penyedia hosting/email Anda untuk detail SMTP"],
          ].map(([nama, detail]) => (
            <div key={nama} className="flex gap-2">
              <dt className="w-20 shrink-0 font-semibold text-stone-600">{nama}:</dt>
              <dd className="text-stone-500">{detail}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
