import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useBranch, type Cabang } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { useCompanyMode } from "../../lib/useCompanyMode";
import { Link } from "react-router-dom";

interface FormState {
  id?: string;
  nama: string;
  alamat: string;
  telepon: string;
  tipe: "store" | "central_kitchen" | "kantor";
  /** CK pemasok (khusus store) — "" = otomatis bila CK cuma satu */
  central_kitchen_id: string;
  /** struk per cabang — alamat/telepon CABANG inilah yang tercetak */
  receipt_footer: string;
  receipt_show_alamat: boolean;
  /** titik maps + radius absen (m) — absen hanya diterima dalam radius */
  latitude: string;
  longitude: string;
  radius_absen_m: string;
}

export function CabangPage() {
  const { cabang } = useBranch();
  const { isPro } = useCompanyMode();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nama: f.nama,
        alamat: f.alamat || null,
        telepon: f.telepon || null,
        tipe: f.tipe,
        central_kitchen_id: f.tipe === "store" && f.central_kitchen_id ? f.central_kitchen_id : null,
        receipt_footer: f.receipt_footer || null,
        receipt_show_alamat: f.receipt_show_alamat,
        latitude: f.latitude ? Number(f.latitude) : null,
        longitude: f.longitude ? Number(f.longitude) : null,
        radius_absen_m: Math.max(10, Number(f.radius_absen_m) || 100),
      };
      return f.id
        ? api(`/cabang/${f.id}`, { method: "PATCH", body })
        : api("/cabang", { method: "POST", body });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["cabang"] });
    },
  });

  const toggleAktif = useMutation({
    mutationFn: (b: Cabang) =>
      api(`/cabang/${b.id}`, { method: "PATCH", body: { is_active: !b.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cabang"] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  const daftarCk = cabang.filter((b) => b.tipe === "central_kitchen" && b.is_active);
  const namaCk = new Map(cabang.map((b) => [b.id, b.nama]));

  return (
    <div className="max-w-3xl">
      <PageTitle
        aksi={
          // Lite = 1 cabang; tambah cabang butuh Pro
          isPro ? (
            <button
              onClick={() =>
                setForm({
                  nama: "",
                  alamat: "",
                  telepon: "",
                  tipe: "store",
                  central_kitchen_id: daftarCk.length === 1 ? daftarCk[0].id : "",
                  receipt_footer: "",
                  receipt_show_alamat: true,
                  latitude: "",
                  longitude: "",
                  radius_absen_m: "100",
                })
              }
              className={btnPrimary}
            >
              + Tambah Cabang
            </button>
          ) : undefined
        }
      >
        Cabang
      </PageTitle>
      {!isPro && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">
          <span>
            Mode <b>Lite</b> dibatasi 1 cabang — atur alamat &amp; struk cabang di sini.
            Butuh 🏭 Central Kitchen, cabang lain, atau 🏢 Kantor?
          </span>
          <Link
            to="/pengaturan/perusahaan"
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
          >
            ⬆ Upgrade ke Pro
          </Link>
        </div>
      )}
      <ErrorText error={toggleAktif.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Alamat</th>
              <th className={thClass}>Pemasok (CK)</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {cabang.map((b) => (
              <tr key={b.id}>
                <td className={`${tdClass} font-medium`}>
                  {b.nama}
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      b.tipe === "central_kitchen"
                        ? "bg-purple-100 text-purple-700"
                        : b.tipe === "kantor"
                          ? "bg-stone-200 text-stone-600"
                          : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {b.tipe === "central_kitchen"
                      ? "🏭 Central Kitchen"
                      : b.tipe === "kantor"
                        ? "🏢 Kantor"
                        : "🏪 Store"}
                  </span>
                </td>
                <td className={tdClass}>{b.alamat ?? "—"}</td>
                <td className={tdClass}>
                  {b.tipe === "store" ? (
                    b.central_kitchen_id ? (
                      <span className="whitespace-nowrap text-sm text-stone-600">
                        🏭 {namaCk.get(b.central_kitchen_id) ?? "?"}
                      </span>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      b.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    {b.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <button
                    onClick={() =>
                      setForm({
                        id: b.id,
                        nama: b.nama,
                        alamat: b.alamat ?? "",
                        telepon: b.telepon ?? "",
                        tipe: b.tipe,
                        central_kitchen_id: b.central_kitchen_id ?? "",
                        receipt_footer: b.receipt_footer ?? "",
                        receipt_show_alamat: b.receipt_show_alamat,
                        latitude: b.latitude != null ? String(b.latitude) : "",
                        longitude: b.longitude != null ? String(b.longitude) : "",
                        radius_absen_m: String(b.radius_absen_m ?? 100),
                      })
                    }
                    className="text-sm font-medium text-orange-600 hover:underline"
                  >
                    Ubah
                  </button>
                  <button
                    onClick={() => toggleAktif.mutate(b)}
                    className="ml-3 text-sm font-medium text-stone-500 hover:underline"
                  >
                    {b.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? "Ubah Cabang" : "Tambah Cabang"}>
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama cabang</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Alamat</label>
                <input
                  value={form.alamat}
                  onChange={(e) => setForm({ ...form, alamat: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Telepon</label>
                <input
                  value={form.telepon}
                  onChange={(e) => setForm({ ...form, telepon: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Jenis cabang</label>
              <select
                value={form.tipe}
                onChange={(e) =>
                  setForm({ ...form, tipe: e.target.value as FormState["tipe"] })
                }
                className={inputClass}
              >
                <option value="store">🏪 Store — outlet penjualan</option>
                <option value="central_kitchen">
                  🏭 Central Kitchen — memproses/produksi lalu mengirim ke store
                </option>
                <option value="kantor">
                  🏢 Kantor — lokasi kerja admin/finance (bukan tujuan kirim)
                </option>
              </select>
              <p className="mt-1 text-xs text-stone-400">
                Central Kitchen membuat faktur produksi/beli, lalu saat <b>dikirim</b> pilih
                cabang store sebagai tujuan — stok masuk di store saat diterima. Kantor hanya
                untuk penempatan karyawan &amp; absensi.
              </p>
            </div>
            {form.tipe === "store" && daftarCk.length > 0 && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Terhubung ke Central Kitchen
                </label>
                <select
                  value={
                    form.central_kitchen_id ||
                    (daftarCk.length === 1 ? daftarCk[0].id : "")
                  }
                  onChange={(e) => setForm({ ...form, central_kitchen_id: e.target.value })}
                  className={inputClass}
                  required={daftarCk.length > 1}
                >
                  {daftarCk.length > 1 && <option value="">— pilih CK pemasok —</option>}
                  {daftarCk.map((ck) => (
                    <option key={ck.id} value={ck.id}>
                      🏭 {ck.nama}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-stone-400">
                  Store terhubung ke <b>satu</b> CK pemasok — hanya CK itu yang mengirim
                  barang ke cabang ini.
                </p>
              </div>
            )}
            {/* Struk per cabang — kantor tidak berjualan, tak butuh struk */}
            {form.tipe !== "kantor" && (
              <div className="rounded-lg border border-stone-200 p-3">
                <div className="mb-2 text-sm font-semibold text-stone-700">🧾 Struk</div>
                <label className="mb-1 block text-sm font-medium">Teks footer struk</label>
                <input
                  value={form.receipt_footer}
                  onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
                  maxLength={200}
                  placeholder="mis. Terima kasih! Ikuti IG @basooopa"
                  className={inputClass}
                />
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.receipt_show_alamat}
                    onChange={(e) =>
                      setForm({ ...form, receipt_show_alamat: e.target.checked })
                    }
                  />
                  Tampilkan alamat &amp; telepon di struk
                </label>
                <p className="mt-1 text-xs text-stone-400">
                  Alamat &amp; telepon <b>cabang ini</b> yang tercetak di struk — bukan
                  alamat perusahaan.
                </p>
              </div>
            )}
            {/* Titik maps + radius absen — berlaku semua tipe (kantor pun absen) */}
            <div className="rounded-lg border border-stone-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-stone-700">📍 Lokasi &amp; radius absen</div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.geolocation?.getCurrentPosition(
                      (pos) =>
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                latitude: pos.coords.latitude.toFixed(6),
                                longitude: pos.coords.longitude.toFixed(6),
                              }
                            : f,
                        ),
                      () => alert("Gagal membaca lokasi — izinkan akses GPS di browser."),
                      { enableHighAccuracy: true, timeout: 10000 },
                    );
                  }}
                  className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
                >
                  🎯 Pakai lokasi saya
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-stone-500">Latitude</label>
                  <input
                    value={form.latitude}
                    onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                    placeholder="-6.200000"
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-stone-500">Longitude</label>
                  <input
                    value={form.longitude}
                    onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                    placeholder="106.816666"
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-stone-500">Radius (m)</label>
                  <input
                    value={form.radius_absen_m}
                    onChange={(e) => setForm({ ...form, radius_absen_m: e.target.value })}
                    type="number"
                    min={10}
                    max={10000}
                    className={inputClass}
                  />
                </div>
              </div>
              {form.latitude && form.longitude && (
                <a
                  href={`https://maps.google.com/?q=${form.latitude},${form.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs font-medium text-orange-600 hover:underline"
                >
                  🗺 Cek titik di Google Maps
                </a>
              )}
              <p className="mt-1 text-xs text-stone-400">
                Bila titik diisi, karyawan hanya bisa <b>absen dalam radius</b> ini dari
                cabang (perangkat wajib mengizinkan GPS). Kosongkan untuk absen tanpa
                pembatasan lokasi.
              </p>
            </div>
            <ErrorText error={simpan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={simpan.isPending} className={btnPrimary}>
                Simpan
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
