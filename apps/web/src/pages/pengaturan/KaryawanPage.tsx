import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  InputPassword,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import type { AktivitasRow, KaryawanTempatDto, UndanganKaryawanRow } from "@kakarut/shared";
import { labelCabang, useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatTanggalRingkas, formatWaktu } from "../../lib/format";
import { useCompanyMode } from "../../lib/useCompanyMode";
import { AreaCetak } from "../../components/AreaCetak";

interface Karyawan {
  user_id: string;
  nama: string;
  email: string;
  is_active: boolean;
  role: "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar";
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
  role: "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar";
  branch_id: string;
}

const labelRole = {
  owner: "Owner",
  admin: "Admin",
  cashier: "Kasir",
  tim: "Tim",
  kitchen: "Kitchen",
  bar: "Bar",
} as const;
/** kasir, tim, kitchen & bar terikat ke satu cabang — lokasi kerja wajib */
const WAJIB_CABANG = new Set(["cashier", "tim", "kitchen", "bar"]);

/**
 * Dropdown aksi per baris — semua aksi selain QR dikumpulkan di sini agar
 * tidak terpencet sembarangan (terutama di layar HP).
 */
function AksiMenu({
  items,
}: {
  items: { label: string; warna?: string; onClick: () => void }[];
}) {
  // Posisi fixed dihitung dari tombol: menu tidak terpotong scroll container
  // tabel (Card overflow-x-auto memotong dropdown absolute biasa).
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(
    null,
  );
  return (
    <div className="inline-block text-left">
      <button
        onClick={(e) => {
          if (pos) return setPos(null);
          const r = e.currentTarget.getBoundingClientRect();
          const right = window.innerWidth - r.right;
          // dekat dasar layar → menu membuka ke atas agar tetap terlihat
          setPos(
            r.bottom + 170 > window.innerHeight
              ? { bottom: window.innerHeight - r.top + 4, right }
              : { top: r.bottom + 4, right },
          );
        }}
        aria-label="Aksi"
        className="rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-medium text-stone-600 hover:bg-stone-100"
      >
        ⋯ Aksi
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setPos(null)} aria-hidden />
          <div
            className="fixed z-20 w-44 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
            style={pos}
          >
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  setPos(null);
                  it.onClick();
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-stone-50 ${
                  it.warna ?? "text-stone-700"
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Tugaskan tempat penyimpanan yang jadi tanggung jawab stock opname seorang
 * karyawan (kasir/tim). Menulis ke tabel petugas yang sama dengan halaman
 * Tempat Penyimpanan → konsisten dua arah.
 */
function TempatSOModal({ karyawan, onClose }: { karyawan: Karyawan; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error: tempatGagal } = useQuery({
    queryKey: ["karyawan-tempat", karyawan.user_id],
    queryFn: () => api<KaryawanTempatDto>(`/karyawan/${karyawan.user_id}/tempat`),
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  /**
   * Semai SEKALI (`selected === null` = belum tersemai).
   *
   * Tanpa penjagaan itu, tiap `data` baru menimpa centangan yang sedang dipilih.
   * React Query menyegarkan ulang begitu query basi dan jendela kembali fokus —
   * `staleTime` kunci ini 10 detik, jadi berpindah aplikasi sebentar (hal biasa
   * di kasir) sudah cukup: centangan balik ke keadaan server, tombol Simpan
   * tetap menyimpan, dan yang tersimpan adalah tugas LAMA. Tak ada pesan galat.
   *
   * Dua modal saudaranya yang menulis tabel petugas yang sama sudah kebal —
   * `PetugasModal` menyemai lewat penginisialisasi `useState`, `BahanModal`
   * lewat `selected ?? data`. Hanya yang ini memakai efek yang menembak ulang.
   */
  useEffect(() => {
    if (data && selected === null) setSelected(new Set(data.assigned));
  }, [data, selected]);

  const simpan = useMutation({
    mutationFn: () =>
      api(`/karyawan/${karyawan.user_id}/tempat`, {
        method: "PUT",
        body: { tempat_ids: [...(selected ?? [])] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["penyimpanan"] });
      queryClient.invalidateQueries({ queryKey: ["karyawan-tempat", karyawan.user_id] });
      onClose();
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal open onClose={onClose} title={`🗃 Tempat SO — ${karyawan.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Pilih tempat penyimpanan di <b>{karyawan.cabang ?? "cabang"}</b> yang jadi tugas stock
          opname karyawan ini. <b>Kosong = ia boleh opname tempat yang belum ada petugasnya.</b>
        </div>
        {isLoading || selected === null ? (
          <div className="py-8 text-center">
            <Spinner />
          </div>
        ) : tempatGagal ? (
          <ErrorText error={tempatGagal} />
        ) : (data?.tersedia.length ?? 0) === 0 ? (
          <div className="py-6 text-center text-sm text-stone-400">
            Belum ada tempat penyimpanan di cabang ini.
          </div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {data!.tersedia.map((t) => (
              <label
                key={t.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${
                  selected.has(t.id) ? "border-orange-500 bg-orange-50" : "border-stone-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span className="font-medium">{t.nama}</span>
              </label>
            ))}
          </div>
        )}
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={simpan.isPending || selected === null}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "Simpan Tugas SO"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function KaryawanPage() {
  const { cabang } = useBranch();
  const { isPro } = useCompanyMode();
  // Admin selalu berlokasi di Kantor (pusat) — lokasi kerjanya dikunci ke sini.
  const kantorId = cabang.find((b) => b.is_active && b.tipe === "kantor")?.id ?? "";
  // Default lokasi non-admin (store pertama) — dipakai saat peran beralih dari
  // admin agar tak menyisakan Kantor terpilih untuk kasir/tim.
  const storeDefault = cabang.find((b) => b.is_active && b.tipe === "store")?.id ?? "";
  const queryClient = useQueryClient();
  const { data: karyawan, isLoading, error: gagalMuat } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
  });
  // arsip = karyawan yang sudah keluar; riwayatnya tetap bisa dilihat
  const { data: arsip = [], error: arsipGagal } = useQuery({
    queryKey: ["karyawan", "arsip"],
    queryFn: () => api<Karyawan[]>("/karyawan?arsip=true"),
  });
  // undangan pending (alur "menunggu diundang") + form undang via email
  const { data: undangan = [], error: undanganGagal } = useQuery({
    queryKey: ["undangan"],
    queryFn: () => api<UndanganKaryawanRow[]>("/karyawan/undangan"),
  });
  const [tab, setTab] = useState<"aktif" | "arsip">("aktif");
  const [form, setForm] = useState<FormState | null>(null);
  const [undangForm, setUndangForm] = useState<{
    email: string;
    role: FormState["role"];
    branch_id: string;
  } | null>(null);
  // Modal QR karyawan (untuk absensi) + data URL QR yang digenerate
  const [qrFor, setQrFor] = useState<Karyawan | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  // Modal riwayat kegiatan seorang karyawan (log faktur yang ia lakukan)
  const [aktivitasFor, setAktivitasFor] = useState<Karyawan | null>(null);
  // Modal penugasan tempat SO (petugas opname) seorang karyawan kasir/tim
  const [tempatFor, setTempatFor] = useState<Karyawan | null>(null);
  const { data: aktivitas, error: aktivitasGagal } = useQuery({
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

  const undang = useMutation({
    mutationFn: (f: { email: string; role: FormState["role"]; branch_id: string }) =>
      api("/karyawan/undang", {
        method: "POST",
        body: {
          email: f.email,
          role: f.role,
          branch_id: WAJIB_CABANG.has(f.role) ? f.branch_id : f.branch_id || null,
        },
      }),
    onSuccess: () => {
      setUndangForm(null);
      queryClient.invalidateQueries({ queryKey: ["undangan"] });
    },
  });

  const batalUndangan = useMutation({
    mutationFn: (id: string) => api(`/karyawan/undangan/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["undangan"] }),
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
          <div className="flex gap-2">
            <button
              onClick={() =>
                setUndangForm({ email: "", role: "cashier", branch_id: storeDefault })
              }
              className={btnSecondary}
            >
              📨 Undang
            </button>
            <button
              onClick={() =>
                setForm({
                  nama: "",
                  email: "",
                  password: "",
                  role: "cashier",
                  branch_id: cabang[0]?.id ?? "",
                })
              }
              className={btnPrimary}
            >
              + Tambah Karyawan
            </button>
          </div>
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
          🗄 Arsip ({arsipGagal ? "!" : arsip.length})
        </button>
      </div>

      {tab === "arsip" ? (
        <TabelResponsif
          data={arsip}
          kunci={(k) => k.user_id}
          kosong="Belum ada karyawan yang diarsipkan."
          kelasBaris={() => "text-stone-500"}
          kolom={[
            { judul: "Nama", hp: "judul", kelasSel: "font-medium", sel: (k) => k.nama },
            {
              judul: "Kode",
              hp: "sub",
              sel: (k) => <span className="font-mono">{k.employee_code ?? "—"}</span>,
            },
            { judul: "Email", sel: (k) => k.email },
            { judul: "Peran", sel: (k) => labelRole[k.role] },
            {
              judul: "Diarsipkan",
              sel: (k) => (k.archived_at ? formatTanggalRingkas(k.archived_at) : "—"),
            },
            {
              hp: "aksi",
              kelasSel: "text-right",
              sel: (k) => (
                <AksiMenu
                  items={[
                    { label: "🗒 Aktivitas", onClick: () => setAktivitasFor(k) },
                    {
                      label: "↩ Pulihkan (aktifkan)",
                      warna: "text-green-600",
                      onClick: () => ubah.mutate({ userId: k.user_id, body: { arsip: false } }),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      ) : (
        <TabelResponsif
          data={karyawan ?? []}
          kunci={(k) => k.user_id}
          kosong="Belum ada karyawan."
          galat={gagalMuat}
          kolom={[
            { judul: "Nama", hp: "judul", kelasSel: "font-medium", sel: (k) => k.nama },
            {
              judul: "Kode",
              hp: "sub",
              sel: (k) => (
                <span className="font-mono font-semibold text-stone-700">
                  {k.employee_code ?? "—"}
                </span>
              ),
            },
            { judul: "Email", sel: (k) => k.email },
            { judul: "Peran", sel: (k) => labelRole[k.role] },
            { judul: "Lokasi kerja", sel: (k) => k.cabang ?? "Semua" },
            {
              hp: "aksi",
              kelasSel: "text-right",
              sel: (k) => (
                // QR sering dipakai → tetap terlihat; aksi lain masuk dropdown
                // agar tidak terpencet sembarangan
                <div className="flex items-center justify-end gap-2">
                  {k.employee_code && (
                    <button
                      onClick={() => setQrFor(k)}
                      className="rounded-lg border border-orange-200 px-2.5 py-1 text-sm font-medium text-orange-600 hover:bg-orange-50"
                    >
                      QR
                    </button>
                  )}
                  <AksiMenu
                    items={[
                      { label: "🗒 Aktivitas", onClick: () => setAktivitasFor(k) },
                      // Tempat SO hanya untuk peran terikat cabang (kasir/tim)
                      ...(WAJIB_CABANG.has(k.role)
                        ? [{ label: "🗃 Tempat SO", onClick: () => setTempatFor(k) }]
                        : []),
                      {
                        label: "✏️ Ubah",
                        onClick: () =>
                          setForm({
                            id: k.user_id,
                            nama: k.nama,
                            email: k.email,
                            password: "",
                            role: k.role,
                            // Admin selalu dikunci ke Kantor (pusat) bila ada.
                            branch_id:
                              k.role === "admin" && kantorId ? kantorId : (k.branch_id ?? ""),
                          }),
                      },
                      {
                        label: "🗄 Arsipkan (nonaktif)",
                        warna: "text-red-600",
                        onClick: () => {
                          if (
                            confirm(
                              `Arsipkan ${k.nama}? Karyawan nonaktif — keluar dari daftar & tidak bisa login/absen. Riwayatnya tetap tersimpan dan bisa dipulihkan dari tab Arsip.`,
                            )
                          )
                            ubah.mutate({ userId: k.user_id, body: { arsip: true } });
                        },
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Undangan yang masih menunggu diterima (alur "menunggu diundang") */}
      <ErrorText error={undanganGagal} />
      {tab === "aktif" && undangan.length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="mb-1 font-bold text-stone-800">📨 Undangan Tertunda ({undangan.length})</h2>
          <p className="mb-3 text-sm text-stone-500">
            Menunggu orang ini mendaftar / menerima undangan. Saat diterima, ia otomatis jadi
            karyawan.
          </p>
          <div className="space-y-2">
            {undangan.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 p-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-stone-800">{u.email}</div>
                  <div className="text-xs text-stone-500">
                    {labelRole[u.role]}
                    {u.cabang_nama ? ` · 🏪 ${u.cabang_nama}` : ""} ·{" "}
                    {formatTanggalRingkas(u.diundang_pada)}
                  </div>
                </div>
                <button
                  onClick={() => batalUndangan.mutate(u.id)}
                  disabled={batalUndangan.isPending}
                  className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Batalkan
                </button>
              </div>
            ))}
          </div>
          {/*
            "Batalkan" adalah SATU-SATUNYA aksi di kartu ini, dan galatnya dulu
            tak dirender di mana pun. Gagal membatalkan tak mengubah apa pun:
            barisnya tetap (daftar hanya di-invalidate `onSuccess`), tombolnya
            hidup lagi, tanpa satu kata pun — jadi orang menekannya berulang
            kali sambil mengira undangannya bandel.
          */}
          <ErrorText error={batalUndangan.error} />
        </Card>
      )}

      {/* Modal undang via email (tanpa buat password — mereka set sendiri saat daftar) */}
      <Modal
        open={undangForm !== null}
        onClose={() => setUndangForm(null)}
        title="Undang Karyawan via Email"
      >
        {undangForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (undangForm.email) undang.mutate(undangForm);
            }}
            className="space-y-3"
          >
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Undang lewat email. Bila email sudah punya akun → langsung bisa terima; bila belum →
              undangan menunggu sampai ia mendaftar. Tak perlu buat password.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                required
                type="email"
                value={undangForm.email}
                onChange={(e) => setUndangForm({ ...undangForm, email: e.target.value })}
                placeholder="calon@email.com"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Peran</label>
                <select
                  value={undangForm.role}
                  onChange={(e) => {
                    const r = e.target.value as FormState["role"];
                    // Kitchen wajib cabang store — bila pilihan lokasi lama
                    // bukan store, kembalikan ke store pertama.
                    const lokasiStore = cabang.find(
                      (b) => b.id === undangForm.branch_id && b.tipe === "store",
                    );
                    setUndangForm({
                      ...undangForm,
                      role: r,
                      branch_id:
                        r === "admin" && kantorId
                          ? kantorId
                          : r === "kitchen" || r === "bar"
                            ? (lokasiStore?.id ?? storeDefault)
                            : undangForm.branch_id || storeDefault,
                    });
                  }}
                  className={inputClass}
                >
                  <option value="cashier">Kasir</option>
                  <option value="tim">Tim / Karyawan</option>
                  <option value="kitchen">Kitchen</option>
                  <option value="bar">Bar</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              {isPro && undangForm.role !== "admin" && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Lokasi kerja {WAJIB_CABANG.has(undangForm.role) ? "(wajib)" : "(opsional)"}
                  </label>
                  <select
                    value={undangForm.branch_id}
                    onChange={(e) => setUndangForm({ ...undangForm, branch_id: e.target.value })}
                    className={inputClass}
                    required={WAJIB_CABANG.has(undangForm.role)}
                  >
                    {!WAJIB_CABANG.has(undangForm.role) && <option value="">Semua lokasi</option>}
                    {cabang
                      .filter(
                        (b) =>
                          b.is_active &&
                          b.tipe !== "kantor" &&
                          // kitchen & bar hanya boleh ditempatkan di cabang store
                          ((undangForm.role !== "kitchen" && undangForm.role !== "bar") ||
                            b.tipe === "store"),
                      )
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {labelCabang(b)}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
            <ErrorText error={undang.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setUndangForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={undang.isPending} className={btnPrimary}>
                {undang.isPending ? "Mengirim…" : "Kirim Undangan"}
              </button>
            </div>
          </form>
        )}
      </Modal>

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
              <InputPassword
                required={!form.id}
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={form.id ? "••••••••" : undefined}
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
                    onChange={(e) => {
                      const r = e.target.value as FormState["role"];
                      // Admin dikunci ke Kantor (pusat) bila tersedia; saat pindah
                      // dari admin, lepas kunci Kantor agar peran lain memilih
                      // lokasi sendiri (bukan Kantor yang tak punya POS/stok).
                      // Kitchen/Bar wajib cabang STORE — lokasi non-store dialihkan.
                      const lokasi = cabang.find((x) => x.id === form.branch_id);
                      const branchPatch =
                        r === "admin" && kantorId
                          ? { branch_id: kantorId }
                          : (r === "kitchen" || r === "bar") && lokasi?.tipe !== "store"
                            ? { branch_id: storeDefault }
                            : kantorId && form.branch_id === kantorId
                              ? { branch_id: storeDefault }
                              : {};
                      setForm({ ...form, role: r, ...branchPatch });
                    }}
                    className={inputClass}
                  >
                    <option value="cashier">Kasir</option>
                    <option value="tim">Tim / Karyawan</option>
                    <option value="kitchen">Kitchen</option>
                    <option value="bar">Bar</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                )}
              </div>
              {/* Mode Lite: 1 cabang — kasir otomatis ke cabang satu-satunya. */}
              {isPro && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Lokasi kerja{" "}
                    {form.role === "admin" && kantorId
                      ? "(Kantor)"
                      : WAJIB_CABANG.has(form.role)
                        ? "(wajib)"
                        : "(opsional)"}
                  </label>
                  {form.role === "admin" && kantorId ? (
                    // Admin selalu di Kantor — lokasi terkunci, bukan dropdown.
                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                      🏢 Kantor
                    </div>
                  ) : (
                    <select
                      value={form.branch_id}
                      onChange={(e) => {
                        const b = cabang.find((x) => x.id === e.target.value);
                        // pilih Central Kitchen → peran lapangan otomatis Karyawan
                        // (tim) — berlaku juga bila peran sebelumnya kitchen/bar.
                        setForm({
                          ...form,
                          branch_id: e.target.value,
                          ...(b?.tipe === "central_kitchen" &&
                          (form.role === "cashier" ||
                            form.role === "kitchen" ||
                            form.role === "bar")
                            ? { role: "tim" as const }
                            : {}),
                        });
                      }}
                      className={inputClass}
                      required={WAJIB_CABANG.has(form.role)}
                    >
                      {!WAJIB_CABANG.has(form.role) && <option value="">Semua lokasi</option>}
                      {cabang
                        .filter(
                          (b) =>
                            b.is_active &&
                            // kitchen & bar hanya boleh ditempatkan di cabang store
                            ((form.role !== "kitchen" && form.role !== "bar") ||
                              b.tipe === "store"),
                        )
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {labelCabang(b)}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}
            </div>
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

      {/* Modal penugasan tempat SO (petugas opname) karyawan kasir/tim */}
      {tempatFor && (
        <TempatSOModal karyawan={tempatFor} onClose={() => setTempatFor(null)} />
      )}

      {/* Modal riwayat kegiatan seorang karyawan (jejak log faktur) */}
      <Modal
        open={aktivitasFor !== null}
        onClose={() => setAktivitasFor(null)}
        title={`🗒 Aktivitas — ${aktivitasFor?.nama ?? ""}`}
      >
        {aktivitasGagal ? (
          <ErrorText error={aktivitasGagal} />
        ) : aktivitas && aktivitas.rows.length > 0 ? (
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
        <AreaCetak id="qr-print">
          <div className="text-center">
            <img src={qrUrl} alt="" className="mx-auto" style={{ width: "60mm", height: "60mm" }} />
            <div className="mt-2 text-xl font-bold">{qrFor.nama}</div>
            <div className="font-mono text-2xl font-bold tracking-widest">{qrFor.employee_code}</div>
          </div>
        </AreaCetak>
      )}
    </div>
  );
}
