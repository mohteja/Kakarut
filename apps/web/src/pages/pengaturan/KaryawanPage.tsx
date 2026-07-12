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
import { labelCabang, useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatTanggalRingkas, formatWaktu } from "../../lib/format";
import { useCompanyMode } from "../../lib/useCompanyMode";

interface Karyawan {
  user_id: string;
  nama: string;
  email: string;
  is_active: boolean;
  role: "owner" | "admin" | "cashier" | "tim";
  branch_id: string | null;
  cabang: string | null;
  employee_code: string | null;
  /** terisi = karyawan sudah diarsipkan (keluar; riwayat tetap tersimpan) */
  archived_at: string | null;
}

interface FormState {
  /** terisi = mode ubah (PATCH); kosong = tambah karyawan baru */
  id?: string;
  nama: string;
  email: string;
  /** saat ubah: kosongkan bila password tidak diganti */
  password: string;
  role: "owner" | "admin" | "cashier" | "tim";
  branch_id: string;
  is_active: boolean;
}

const labelRole = { owner: "Owner", admin: "Admin", cashier: "Kasir", tim: "Tim" } as const;
/** kasir & tim terikat ke satu cabang — lokasi kerja wajib */
const WAJIB_CABANG = new Set(["cashier", "tim"]);

export function KaryawanPage() {
  const { cabang } = useBranch();
  const { isPro } = useCompanyMode();
  const queryClient = useQueryClient();
  const { data: karyawan, isLoading } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
  });
  // arsip = karyawan yang sudah keluar; riwayatnya tetap bisa dilihat
  const { data: arsip = [] } = useQuery({
    queryKey: ["karyawan", "arsip"],
    queryFn: () => api<Karyawan[]>("/karyawan?arsip=true"),
  });
  const [tab, setTab] = useState<"aktif" | "arsip">("aktif");
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
          branch_id: WAJIB_CABANG.has(f.role) ? f.branch_id : f.branch_id || null,
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
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["karyawan"] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.id) {
      ubah.mutate({
        userId: form.id,
        body: {
          nama: form.nama,
          email: form.email,
          role: form.role,
          branch_id: WAJIB_CABANG.has(form.role) ? form.branch_id : form.branch_id || null,
          is_active: form.is_active,
          ...(form.password ? { password: form.password } : {}),
        },
      });
    } else {
      tambah.mutate(form);
    }
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          <button
            onClick={() =>
              setForm({
                nama: "",
                email: "",
                password: "",
                role: "cashier",
                branch_id: cabang[0]?.id ?? "",
                is_active: true,
              })
            }
            className={btnPrimary}
          >
            + Tambah Karyawan
          </button>
        }
      >
        Karyawan
      </PageTitle>

      {/* Karyawan berjalan vs arsip (sudah keluar — riwayat tetap tersimpan) */}
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setTab("aktif")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            tab === "aktif" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-100"
          }`}
        >
          Karyawan ({karyawan?.length ?? 0})
        </button>
        <button
          onClick={() => setTab("arsip")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            tab === "arsip" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-100"
          }`}
        >
          🗄 Arsip ({arsip.length})
        </button>
      </div>

      {tab === "arsip" ? (
        <Card className="overflow-x-auto">
          {arsip.length === 0 ? (
            <p className="p-6 text-center text-sm text-stone-400">
              Belum ada karyawan yang diarsipkan.
            </p>
          ) : (
            <table className="w-full">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={thClass}>Nama</th>
                  <th className={thClass}>Kode</th>
                  <th className={thClass}>Email</th>
                  <th className={thClass}>Peran</th>
                  <th className={thClass}>Diarsipkan</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {arsip.map((k) => (
                  <tr key={k.user_id} className="text-stone-500">
                    <td className={`${tdClass} font-medium`}>{k.nama}</td>
                    <td className={tdClass}>
                      <span className="font-mono">{k.employee_code ?? "—"}</span>
                    </td>
                    <td className={tdClass}>{k.email}</td>
                    <td className={tdClass}>{labelRole[k.role]}</td>
                    <td className={tdClass}>
                      {k.archived_at ? formatTanggalRingkas(k.archived_at) : "—"}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        <button
                          onClick={() => setAktivitasFor(k)}
                          className="text-sm font-medium text-orange-600 hover:underline"
                        >
                          Aktivitas
                        </button>
                        <button
                          onClick={() =>
                            ubah.mutate({ userId: k.user_id, body: { arsip: false } })
                          }
                          className="text-sm font-medium text-green-600 hover:underline"
                        >
                          ↩ Pulihkan
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Kode</th>
              <th className={thClass}>Email</th>
              <th className={thClass}>Peran</th>
              <th className={thClass}>Lokasi kerja</th>
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
                <td className={`${tdClass} text-right`}>
                  <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
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
                      className="text-sm font-medium text-orange-600 hover:underline"
                    >
                      Aktivitas
                    </button>
                    {/* Ganti password & status aktif juga ada di dalam form Ubah */}
                    <button
                      onClick={() =>
                        setForm({
                          id: k.user_id,
                          nama: k.nama,
                          email: k.email,
                          password: "",
                          role: k.role,
                          branch_id: k.branch_id ?? "",
                          is_active: k.is_active,
                        })
                      }
                      className="text-sm font-medium text-orange-600 hover:underline"
                    >
                      Ubah
                    </button>
                    <button
                      onClick={() =>
                        ubah.mutate({ userId: k.user_id, body: { is_active: !k.is_active } })
                      }
                      className="text-sm font-medium text-stone-500 hover:underline"
                    >
                      {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Arsipkan ${k.nama}? Karyawan keluar dari daftar & tidak bisa login/absen — riwayatnya tetap tersimpan dan bisa dipulihkan dari tab Arsip.`,
                          )
                        )
                          ubah.mutate({ userId: k.user_id, body: { arsip: true } });
                      }}
                      className="text-sm font-medium text-red-500 hover:underline"
                    >
                      Arsipkan
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      )}

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Karyawan" : "Tambah Karyawan"}
      >
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
              <label className="mb-1 block text-sm font-medium">
                Password (min 8 karakter)
                {form.id && (
                  <span className="font-normal text-stone-400">
                    {" "}
                    — kosongkan bila tidak diganti
                  </span>
                )}
              </label>
              {/* minLength diabaikan browser saat kosong & tak required — pas
                  untuk mode ubah (kosong = password tidak diganti) */}
              <input
                required={!form.id}
                minLength={8}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={form.id ? "••••••••" : undefined}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Peran</label>
                {/* Central Kitchen hanya punya SATU peran lapangan: Karyawan (tim) */}
                {cabang.find((b) => b.id === form.branch_id)?.tipe === "central_kitchen" &&
                form.role !== "owner" &&
                form.role !== "admin" ? (
                  <>
                    <select
                      value="tim"
                      onChange={() => setForm({ ...form, role: "tim" })}
                      className={inputClass}
                    >
                      <option value="tim">Karyawan (Central Kitchen)</option>
                    </select>
                    <p className="mt-1 text-xs text-stone-400">
                      Menu karyawan CK: profil, produksi bahan baku, beli bahan baku, bahan
                      baku.
                    </p>
                  </>
                ) : (
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm({ ...form, role: e.target.value as FormState["role"] })
                    }
                    className={inputClass}
                  >
                    <option value="cashier">Kasir</option>
                    <option value="tim">Tim / Karyawan</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                )}
              </div>
              {/* Mode Lite: 1 cabang — kasir otomatis ke cabang satu-satunya. */}
              {isPro && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Lokasi kerja {WAJIB_CABANG.has(form.role) ? "(wajib)" : "(opsional)"}
                  </label>
                  <select
                    value={form.branch_id}
                    onChange={(e) => {
                      const b = cabang.find((x) => x.id === e.target.value);
                      // pilih Central Kitchen → peran lapangan otomatis Karyawan (tim)
                      setForm({
                        ...form,
                        branch_id: e.target.value,
                        ...(b?.tipe === "central_kitchen" && form.role === "cashier"
                          ? { role: "tim" as const }
                          : {}),
                      });
                    }}
                    className={inputClass}
                    required={WAJIB_CABANG.has(form.role)}
                  >
                    {!WAJIB_CABANG.has(form.role) && <option value="">Semua lokasi</option>}
                    {cabang
                      .filter((b) => b.is_active)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {labelCabang(b)}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
            {form.id && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Akun aktif
                <span className="text-xs text-stone-400">
                  (nonaktif = tidak bisa login &amp; absen)
                </span>
              </label>
            )}
            <ErrorText error={form.id ? ubah.error : tambah.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button
                type="submit"
                disabled={tambah.isPending || ubah.isPending}
                className={btnPrimary}
              >
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
