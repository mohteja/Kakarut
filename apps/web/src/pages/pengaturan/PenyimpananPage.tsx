import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import type { BahanDto, PenyimpananDto, PerlengkapanMasterRow } from "@kakarut/shared";
import {
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { api } from "../../lib/api";

interface FormState {
  id?: string;
  nama: string;
  catatan: string;
}

interface KaryawanRow {
  user_id: string;
  nama: string;
  email: string;
  role: "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar";
  is_active: boolean;
  branch_id: string | null;
  cabang: string | null;
}

const roleLabel = (r: string) =>
  r === "owner"
    ? "Owner"
    : r === "admin"
      ? "Admin"
      : r === "tim"
        ? "Tim"
        : r === "kitchen"
          ? "Kitchen"
          : r === "bar"
            ? "Bar"
            : "Kasir";

/** Pilih akun yang boleh opname di sebuah tempat penyimpanan. */
function PetugasModal({ tempat, onClose }: { tempat: PenyimpananDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: karyawan = [] } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<KaryawanRow[]>("/karyawan"),
  });
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tempat.petugas.map((p) => p.user_id)),
  );

  const simpan = useMutation({
    mutationFn: () =>
      api(`/penyimpanan/${tempat.id}/petugas`, {
        method: "PUT",
        body: { user_ids: [...selected] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["penyimpanan"] });
      onClose();
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // owner/admin (bebas cabang) + kasir/tim yang cabangnya = cabang tempat ini
  const daftar = karyawan.filter(
    (k) =>
      k.is_active &&
      (k.role === "owner" || k.role === "admin" || k.branch_id === tempat.branch_id),
  );

  return (
    <Modal open onClose={onClose} title={`Petugas Opname — ${tempat.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Pilih akun yang boleh melakukan stock opname di tempat ini. <b>Kosong = semua boleh</b>{" "}
          (yang boleh opname di cabang). Owner/admin selalu bisa.
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {daftar.length === 0 && (
            <div className="py-4 text-center text-sm text-stone-400">Belum ada karyawan.</div>
          )}
          {daftar.map((k) => (
            <label
              key={k.user_id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${
                selected.has(k.user_id) ? "border-orange-500 bg-orange-50" : "border-stone-200"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(k.user_id)}
                onChange={() => toggle(k.user_id)}
              />
              <span className="min-w-0">
                <span className="font-medium">{k.nama}</span>
                <span className="ml-2 rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
                  {roleLabel(k.role)}
                </span>
                {k.cabang && <span className="block text-xs text-stone-400">{k.cabang}</span>}
              </span>
            </label>
          ))}
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button onClick={() => simpan.mutate()} disabled={simpan.isPending} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan Petugas"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

type JenisRak = "bahan" | "perlengkapan";
interface RakItem {
  id: string;
  nama: string;
  kode?: string | null;
  label?: string | null;
}

/**
 * Pilih BANYAK item (bahan baku ATAU perlengkapan) yang disimpan di sebuah rak
 * cabang — satu tabel yang sama untuk keduanya. Untuk bahan baku juga dipakai
 * sebagai rak default (auto-file saat kiriman dari CK diterima). Satu item
 * maksimal di satu rak per cabang.
 */
function IsiRakModal({
  tempat,
  jenis,
  onClose,
}: {
  tempat: PenyimpananDto;
  jenis: JenisRak;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isBahan = jenis === "bahan";
  const { data: bahan = [], isLoading: loadBahan } = useQuery({
    queryKey: ["bahan", "ringkas"],
    queryFn: () => api<BahanDto[]>("/bahan?ringkas=1"),
    enabled: isBahan,
  });
  const { data: perlengkapan = [], isLoading: loadPerl } = useQuery({
    queryKey: ["perlengkapan", "master"],
    queryFn: () => api<PerlengkapanMasterRow[]>("/perlengkapan/master"),
    enabled: !isBahan,
  });
  const { data: terpasang, isLoading: loadAsg } = useQuery({
    queryKey: ["penyimpanan-bahan", tempat.id],
    queryFn: () =>
      api<{
        ingredient_ids: string[];
        terpakai_lain: string[];
        supply_ids: string[];
        supply_terpakai_lain: string[];
      }>(`/penyimpanan/${tempat.id}/bahan`),
  });

  const items: RakItem[] = isBahan
    ? bahan.map((b) => ({
        id: b.id,
        nama: b.nama,
        kode: b.kode,
        label: b.pengadaan === "produksi" ? "Produksi" : "Beli",
      }))
    : perlengkapan.map((s) => ({ id: s.id, nama: s.nama, label: s.kategori }));
  const terpasangIds = isBahan ? terpasang?.ingredient_ids : terpasang?.supply_ids;
  const terpakaiLainArr = isBahan ? terpasang?.terpakai_lain : terpasang?.supply_terpakai_lain;

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [cari, setCari] = useState("");
  // seed pilihan sekali dari data server
  const sel = selected ?? new Set(terpasangIds ?? []);
  // item yang sudah di rak LAIN pada cabang ini — disembunyikan (1 item = 1 rak per cabang)
  const terpakaiLain = useMemo(() => new Set(terpakaiLainArr ?? []), [terpakaiLainArr]);

  const simpan = useMutation({
    mutationFn: () =>
      api(`/penyimpanan/${tempat.id}/bahan`, {
        method: "PUT",
        body: isBahan ? { ingredient_ids: [...sel] } : { supply_ids: [...sel] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["penyimpanan"] });
      queryClient.invalidateQueries({ queryKey: ["penyimpanan-bahan", tempat.id] });
      /**
       * Daftar MASTER ikut disegarkan — dan justru itu yang paling lama basi.
       *
       * Rak yang ditugaskan di sini muncul sebagai chip `rak_lokasi` di daftar
       * Bahan Baku dan daftar Perlengkapan; server menyusunnya dari
       * `storage_location_ingredients`, tabel yang PUT di atas inilah yang
       * menulisnya. Tapi kedua daftar itu berkunci MASTER (`bahan`,
       * `perlengkapan-master`) yang sengaja ber-`staleTime` 5 menit, jadi tanpa
       * invalidasi eksplisit chipnya menampilkan rak LAMA selama itu.
       *
       * Yang membuatnya menyesatkan: tooltip chip di Bahan Baku berbunyi
       * "(atur di Tempat Penyimpanan)" — ia menunjuk layar ini, layar yang
       * barusan dipakai orang itu. Ia kembali untuk memeriksa hasilnya dan
       * menemukan angka lama, lalu menugaskan ulang.
       *
       * `["perlengkapan"]` (daftar stok per cabang) sudah benar sejak dulu dan
       * tetap dipertahankan — ia memakai `r.rak` untuk pengelompokan opname;
       * yang kurang justru daftar masternya.
       */
      queryClient.invalidateQueries({ queryKey: [isBahan ? "bahan" : "perlengkapan-master"] });
      if (!isBahan) queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
      onClose();
    },
  });

  function toggle(id: string) {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const tampil = useMemo(
    () =>
      items.filter(
        (b) =>
          !terpakaiLain.has(b.id) &&
          (b.nama.toLowerCase().includes(cari.toLowerCase()) ||
            (b.kode ?? "").toLowerCase().includes(cari.toLowerCase())),
      ),
    [items, cari, terpakaiLain],
  );
  const jenisTeks = isBahan ? "bahan" : "perlengkapan";

  return (
    <Modal
      open
      onClose={onClose}
      title={`${isBahan ? "Bahan Baku" : "Perlengkapan"} di ${tempat.nama}`}
      lebar="max-w-lg"
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Pilih {jenisTeks} yang <b>disimpan di rak ini</b>.{" "}
          {isBahan
            ? "Saat kiriman dari CK diterima di cabang, bahan-bahan ini otomatis diletakkan di sini (stok & opname per rak jadi benar)."
            : "Info lokasi ini tampil di daftar Perlengkapan (“disimpan di mana”)."}{" "}
          Satu {jenisTeks} hanya di satu rak per cabang.
        </div>
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder={`Cari ${jenisTeks}…`}
          className={inputClass}
        />
        <div className="text-xs text-stone-500">
          {sel.size} {jenisTeks} dipilih
          {terpakaiLain.size > 0 && (
            <span className="ml-2 text-stone-400">
              · {terpakaiLain.size} {jenisTeks} sudah di rak lain (disembunyikan)
            </span>
          )}
        </div>
        {loadAsg || (isBahan ? loadBahan : loadPerl) ? (
          <Spinner />
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {tampil.length === 0 && (
              <div className="py-4 text-center text-sm text-stone-400">
                Tidak ada {jenisTeks} yang cocok.
              </div>
            )}
            {tampil.map((b) => (
              <label
                key={b.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${
                  sel.has(b.id) ? "border-orange-500 bg-orange-50" : "border-stone-200"
                }`}
              >
                <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />
                <span className="min-w-0">
                  <span className="font-medium">{b.nama}</span>
                  {b.kode && (
                    <span className="ml-2 font-mono text-xs text-stone-400">{b.kode}</span>
                  )}
                  {b.label && (
                    <span className="ml-2 rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                      {b.label}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button onClick={() => simpan.mutate()} disabled={simpan.isPending} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Tempat penyimpanan per cabang (freezer, chiller, gudang, dst). */
export function PenyimpananPage() {
  // Tempat penyimpanan fisik per cabang — dari Kantor pilih cabangnya.
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const { data: tempat, isLoading } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  const [form, setForm] = useState<FormState | null>(null);
  const [petugas, setPetugas] = useState<PenyimpananDto | null>(null);
  const [isiRak, setIsiRak] = useState<{ tempat: PenyimpananDto; jenis: JenisRak } | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nama: f.nama,
        catatan: f.catatan || null,
        ...(branchId ? { branch_id: branchId } : {}),
      };
      return f.id
        ? api(`/penyimpanan/${f.id}`, {
            method: "PATCH",
            body: { nama: f.nama, catatan: f.catatan || null },
          })
        : api("/penyimpanan", { method: "POST", body });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["penyimpanan"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (t: PenyimpananDto) =>
      api(`/penyimpanan/${t.id}`, { method: "PATCH", body: { is_active: !t.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["penyimpanan"] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <CabangDataBar />
      <PageTitle
        aksi={
          <button onClick={() => setForm({ nama: "", catatan: "" })} className={btnPrimary}>
            + Tambah Tempat
          </button>
        }
      >
        Tempat Penyimpanan ({tempat?.length ?? 0})
      </PageTitle>
      <div className="mb-3 text-sm text-stone-500">
        Per cabang — tempat stok masuk disimpan. Pilih <b>Bahan Baku</b> yang disimpan di tiap
        rak: saat kiriman dari CK <b>diterima di cabang</b>, bahan otomatis diletakkan di rak itu
        (stok &amp; opname per rak jadi benar). Atur <b>Petugas</b> untuk membatasi siapa yang
        boleh stock opname (kosong = semua boleh; owner/admin selalu bisa).{" "}
        <span className="text-stone-400">
          Rak simpan di CK diatur langsung di form Bahan Baku.
        </span>
      </div>
      <ErrorText error={toggle.error} />

      <TabelResponsif
        data={tempat ?? []}
        kunci={(t) => t.id}
        kosong="Belum ada tempat penyimpanan di cabang ini."
        kolom={[
          {
            judul: "Nama",
            hp: "judul",
            kelasSel: "font-medium",
            sel: (t) => (
              <>
                {t.nama}
                {t.catatan && (
                  <span className="block text-xs font-normal text-stone-400">{t.catatan}</span>
                )}
              </>
            ),
          },
          {
            judul: "Bahan Baku",
            sel: (t) => (
              <button
                onClick={() => setIsiRak({ tempat: t, jenis: "bahan" })}
                title="Pilih bahan baku yang disimpan di rak ini (rak default saat kiriman diterima)"
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                  t.jumlah_bahan > 0
                    ? "border-amber-200 bg-amber-50 text-amber-800 hover:border-orange-400"
                    : "border-dashed border-stone-300 text-stone-500 hover:border-orange-400 hover:text-orange-600"
                }`}
              >
                {t.jumlah_bahan > 0 ? `🥫 ${t.jumlah_bahan} bahan` : "+ Pilih bahan"}
              </button>
            ),
          },
          {
            judul: "Perlengkapan",
            sel: (t) => (
              <button
                onClick={() => setIsiRak({ tempat: t, jenis: "perlengkapan" })}
                title="Pilih perlengkapan yang disimpan di rak ini"
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                  t.jumlah_perlengkapan > 0
                    ? "border-sky-200 bg-sky-50 text-sky-800 hover:border-orange-400"
                    : "border-dashed border-stone-300 text-stone-500 hover:border-orange-400 hover:text-orange-600"
                }`}
              >
                {t.jumlah_perlengkapan > 0
                  ? `🧰 ${t.jumlah_perlengkapan} perlengkapan`
                  : "+ Pilih perlengkapan"}
              </button>
            ),
          },
          {
            judul: "Petugas Opname",
            sel: (t) => (
              <>
                {t.petugas.length === 0 ? (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                    Semua boleh
                  </span>
                ) : (
                  <span className="text-sm text-stone-700">
                    {/* petugas basi (bukan anggota aktif — akun diarsip/dihapus/
                        dibuat ulang) DIABAIKAN pembatasan: coret + ⚠ agar
                        owner sadar harus menugaskan ulang akun barunya */}
                    {t.petugas.map((p, i) => (
                      <span key={p.user_id}>
                        {i > 0 && ", "}
                        {p.aktif === false ? (
                          <span
                            className="text-stone-400 line-through"
                            title="Bukan anggota aktif lagi (akun diarsip/dihapus/dibuat ulang) — tidak dihitung sebagai pembatasan. Tugaskan ulang akun yang benar."
                          >
                            {p.nama}⚠
                          </span>
                        ) : (
                          p.nama
                        )}
                      </span>
                    ))}
                  </span>
                )}
                {t.petugas.length > 0 && t.petugas.every((p) => p.aktif === false) && (
                  <div className="mt-0.5 text-[11px] text-amber-600">
                    Semua petugas sudah bukan anggota aktif — rak terbuka utk semua.
                  </div>
                )}
              </>
            ),
          },
          {
            judul: "Status",
            sel: (t) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  t.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                }`}
              >
                {t.is_active ? "Aktif" : "Nonaktif"}
              </span>
            ),
          },
          {
            hp: "aksi",
            kelasSel: "whitespace-nowrap text-right",
            sel: (t) => (
              <>
                <button
                  onClick={() => setPetugas(t)}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  Petugas
                </button>
                <button
                  onClick={() => setForm({ id: t.id, nama: t.nama, catatan: t.catatan ?? "" })}
                  className="ml-3 text-sm font-medium text-orange-600 hover:underline"
                >
                  Ubah
                </button>
                <button
                  onClick={() => toggle.mutate(t)}
                  className="ml-3 text-sm font-medium text-stone-500 hover:underline"
                >
                  {t.is_active ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </>
            ),
          },
        ]}
      />

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Tempat Penyimpanan" : "Tambah Tempat Penyimpanan"}
      >
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama tempat</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
                placeholder="mis. Freezer 1, Chiller, Gudang Kering"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Catatan</label>
              <input
                value={form.catatan}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                className={inputClass}
              />
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

      {petugas && <PetugasModal tempat={petugas} onClose={() => setPetugas(null)} />}
      {isiRak && (
        <IsiRakModal
          key={`${isiRak.tempat.id}-${isiRak.jenis}`}
          tempat={isiRak.tempat}
          jenis={isiRak.jenis}
          onClose={() => setIsiRak(null)}
        />
      )}
    </div>
  );
}
