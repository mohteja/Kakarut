import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { rapikanRuangan, ruanganUntukTitik, type MejaDto, type MejaTipe, type RuanganDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { CabangDataBar } from "../../components/CabangDataBar";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { galatTerbaru } from "../../lib/galat";
import { formatWaktu } from "../../lib/format";
import {
  KosongkanMejaModal,
  kelasStatus,
  labelStatus,
  useMejaStatus,
} from "./MejaStatusPanel";

interface FormState {
  id?: string;
  nama: string;
  tipe: MejaTipe;
}

type Pos = Record<string, { x: number; y: number }>;
/** Kotak ruangan lokal selama menata (persen kanvas). */
type Kotak = Record<string, { pos_x: number; pos_y: number; lebar: number; tinggi: number }>;
const kotakDari = (r: RuanganDto) => ({ pos_x: r.pos_x, pos_y: r.pos_y, lebar: r.lebar, tinggi: r.tinggi });

const clamp = (v: number) => Math.max(4, Math.min(96, Math.round(v)));

/**
 * Meja per cabang — denah + status isi/kosong. Dua mode terpisah:
 *  - "view": melihat denah, status okupansi, dan membereskan meja. TERBUKA
 *    untuk seluruh peran cabang: waiter (tim), dapur, bar, dan kasir sama-sama
 *    perlu tahu meja mana yang kosong.
 *  - "edit": masuk lewat "Tambah Meja"/"Atur Denah" — HANYA owner/admin/kasir.
 *    Di sini boleh menambah, ubah, hapus, dan menyeret tata letak.
 *
 * Pembatasan mode edit BUKAN cuma kosmetik: sebelum ini modul meja di server
 * tak punya gerbang peran sama sekali, jadi siapa pun yang punya membership
 * bisa menghapus meja lewat API. Gerbangnya sekarang ada di server; tombolnya
 * disembunyikan di sini supaya layarnya jujur, bukan supaya aman.
 *
 * Tata letak di kiri, daftar meja di kanan (desktop); di mobile denah di atas,
 * daftar di bawah.
 */
export function MejaPage() {
  // Meja fisik per cabang — dari Kantor pilih cabang yang mejanya diatur.
  const { query: branchQuery, id: branchId } = useCabangData();
  const { auth } = useAuth();
  const peran = auth?.user.role;
  /** Master meja = owner/admin/kasir. Sama persis dengan gerbang server. */
  const bolehAtur = peran === "owner" || peran === "admin" || peran === "cashier";
  /** Membereskan meja = + tim (permintaan owner: "tim ataupun kasir"). */
  const bolehKosongkan = bolehAtur || peran === "tim";
  const queryClient = useQueryClient();
  const { data: meja, isLoading, error: gagalMeja } = useQuery({
    queryKey: ["meja", branchQuery],
    queryFn: () => api<MejaDto[]>(`/meja${branchQuery}`),
  });
  // `error` WAJIB dibaca. Okupansi adalah satu-satunya isi halaman ini yang
  // tak bisa diperiksa ulang dengan mata dari layar — jumlah meja terlihat,
  // siapa yang menunggak bayar tidak. Bacaan yang gagal tanpa tanda apa pun
  // membuat denah tampak menjawab pertanyaannya padahal tidak.
  const { data: statusList = [], error: statusGagal } = useMejaStatus(branchQuery);
  const statusById = new Map(statusList.map((s) => [s.meja_id, s]));
  const [kosongkanId, setKosongkanId] = useState<string | null>(null);
  const kosongkanTarget = statusList.find((s) => s.meja_id === kosongkanId) ?? null;
  // null = belum diketahui. Angka 0 saat bacaannya gagal adalah klaim "tidak
  // ada meja terisi", dan itu justru kebalikan dari yang sedang terjadi.
  const jumlahIsi = statusGagal ? null : statusList.filter((s) => s.status === "isi").length;

  // RUANGAN denah (permintaan pemilik 2026-11-11): diatur DULU, lalu meja
  // diletakkan di dalamnya. Keanggotaan meja dihitung server saat disimpan.
  const { data: ruanganList, error: gagalRuangan } = useQuery({
    queryKey: ["meja-ruangan", branchQuery],
    queryFn: () => api<RuanganDto[]>(`/meja/ruangan${branchQuery}`),
  });
  const [kotak, setKotak] = useState<Kotak>({});
  /** Langkah mode edit: 1. ruangan, 2. meja. */
  const [langkah, setLangkah] = useState<"ruangan" | "meja">("ruangan");
  const [formRuangan, setFormRuangan] = useState<{ id?: string; nama: string } | null>(null);
  const dragRuang = useRef<{
    id: string;
    jenis: "geser" | "ukur";
    x0: number;
    y0: number;
    awal: Kotak[string];
    mejaIkut: { id: string; x: number; y: number }[];
  } | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [form, setForm] = useState<FormState | null>(null);
  const [pos, setPos] = useState<Pos>({});
  const [dirty, setDirty] = useState(false);
  const editingRef = useRef(false);
  const dragId = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const editing = mode === "edit";

  // Seed posisi lokal dari server. Saat mode edit, gabungkan agar seretan yang
  // belum disimpan tidak terhapus ketika data di-refetch (mis. setelah tambah);
  // saat view selalu ikuti kebenaran server.
  useEffect(() => {
    if (!meja) return;
    if (editingRef.current) {
      setPos((prev) => {
        const next: Pos = {};
        for (const m of meja) next[m.id] = prev[m.id] ?? { x: m.pos_x, y: m.pos_y };
        return next;
      });
    } else {
      setPos(Object.fromEntries(meja.map((m) => [m.id, { x: m.pos_x, y: m.pos_y }])));
      setDirty(false);
    }
  }, [meja]);

  // Seed kotak ruangan lokal — pola yang sama dengan posisi meja di atas.
  useEffect(() => {
    if (!ruanganList) return;
    if (editingRef.current) {
      setKotak((prev) => Object.fromEntries(ruanganList.map((r) => [r.id, prev[r.id] ?? kotakDari(r)])));
    } else {
      setKotak(Object.fromEntries(ruanganList.map((r) => [r.id, kotakDari(r)])));
    }
  }, [ruanganList]);

  function masukEdit() {
    // penjaga keras, bukan cuma menyembunyikan tombol — supaya perubahan
    // tampilan di kemudian hari tak diam-diam membuka mode edit ke semua peran
    if (!bolehAtur) return;
    editingRef.current = true;
    setLangkah("ruangan");
    setMode("edit");
  }

  function keluarKeView() {
    editingRef.current = false;
    setForm(null);
    setMode("view");
  }

  function batal() {
    // buang seretan yang belum disimpan, kembali ke kebenaran server
    if (meja) setPos(Object.fromEntries(meja.map((m) => [m.id, { x: m.pos_x, y: m.pos_y }])));
    if (ruanganList) setKotak(Object.fromEntries(ruanganList.map((r) => [r.id, kotakDari(r)])));
    setDirty(false);
    keluarKeView();
  }

  const simpan = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api(`/meja/${f.id}`, { method: "PATCH", body: { nama: f.nama } })
        : api("/meja", {
            method: "POST",
            body: { nama: f.nama, tipe: f.tipe, ...(branchId ? { branch_id: branchId } : {}) },
          }),
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["meja"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (m: MejaDto) =>
      api(`/meja/${m.id}`, { method: "PATCH", body: { is_active: !m.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meja"] }),
  });

  const hapus = useMutation({
    mutationFn: (m: MejaDto) => api(`/meja/${m.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meja"] }),
  });

  /*
   * `PUT /meja/tata-letak` juga ber-`resolveBranchId`, dan kegagalannya di sini
   * TAK BERWARNA MERAH sama sekali: tanpa `branch_id` server memindahkan meja
   * di cabang PERTAMA (`WHERE meja.branch_id = branchId` tak cocok satu pun id
   * yang dikirim → nol baris berubah), lalu **membalas 200** berisi daftar meja
   * cabang pertama. Terukur: memindahkan satu meja cabang kedua ke (7,9) →
   * HTTP 200, balasannya 7 meja cabang LAIN, dan mejanya tetap di (0,0).
   * Dengan `branch_id`: 200 dan posisinya benar-benar (7,9).
   */
  const simpanTataLetak = useMutation({
    mutationFn: () =>
      api(`/meja/tata-letak${branchQuery}`, {
        method: "PUT",
        body: {
          items: (meja ?? []).map((m) => ({
            id: m.id,
            pos_x: pos[m.id]?.x ?? m.pos_x,
            pos_y: pos[m.id]?.y ?? m.pos_y,
          })),
          ruangan: (ruanganList ?? []).map((r) => ({ id: r.id, ...(kotak[r.id] ?? kotakDari(r)) })),
        },
      }),
    onSuccess: () => {
      setDirty(false);
      keluarKeView();
      queryClient.invalidateQueries({ queryKey: ["meja"] });
      queryClient.invalidateQueries({ queryKey: ["meja-ruangan"] });
    },
  });

  /*
   * Ruangan baru langsung tersimpan (perlu id untuk dipindah & diukur); posisi
   * & ukurannya ikut tata letak saat "Simpan". Ubah nama & hapus juga langsung.
   */
  const simpanRuangan = useMutation({
    mutationFn: (f: { id?: string; nama: string }) =>
      f.id
        ? api(`/meja/ruangan/${f.id}${branchQuery}`, { method: "PATCH", body: { nama: f.nama } })
        : api("/meja/ruangan", {
            method: "POST",
            body: {
              nama: f.nama,
              ...(branchId ? { branch_id: branchId } : {}),
              // Ruangan baru diletakkan berjejer supaya tak menumpuk.
              pos_x: Math.min(55, 5 + ((ruanganList?.length ?? 0) % 3) * 32),
              pos_y: Math.min(55, 5 + Math.floor((ruanganList?.length ?? 0) / 3) * 32),
              lebar: 30,
              tinggi: 30,
            },
          }),
    onSuccess: () => {
      setFormRuangan(null);
      queryClient.invalidateQueries({ queryKey: ["meja-ruangan"] });
    },
  });
  const hapusRuangan = useMutation({
    mutationFn: (r: RuanganDto) => api(`/meja/ruangan/${r.id}${branchQuery}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meja-ruangan"] });
      queryClient.invalidateQueries({ queryKey: ["meja"] });
    },
  });

  // ── Seret ruangan: badan = geser (meja di dalamnya ikut), sudut = ukur ──
  function persenDari(e: PointerEvent<HTMLDivElement>) {
    const rc = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rc.left) / rc.width) * 100, y: ((e.clientY - rc.top) / rc.height) * 100 };
  }
  function mulaiRuang(e: PointerEvent<HTMLDivElement>, id: string, jenis: "geser" | "ukur") {
    if (!editing || langkah !== "ruangan" || !canvasRef.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = persenDari(e);
    const awal = kotak[id];
    const daftarKotak = (ruanganList ?? []).map((r) => ({ id: r.id, ...(kotak[r.id] ?? kotakDari(r)) }));
    const mejaIkut =
      jenis === "geser"
        ? (meja ?? [])
            .map((m) => ({ id: m.id, ...(pos[m.id] ?? { x: m.pos_x, y: m.pos_y }) }))
            .filter((m) => ruanganUntukTitik(m.x, m.y, daftarKotak) === id)
        : [];
    dragRuang.current = { id, jenis, x0: p.x, y0: p.y, awal, mejaIkut };
  }
  function geserRuang(e: PointerEvent<HTMLDivElement>) {
    const d = dragRuang.current;
    if (!d || !canvasRef.current) return;
    const p = persenDari(e);
    const dx = p.x - d.x0;
    const dy = p.y - d.y0;
    const baru = rapikanRuangan(
      d.jenis === "geser"
        ? { ...d.awal, pos_x: d.awal.pos_x + dx, pos_y: d.awal.pos_y + dy }
        : { ...d.awal, lebar: d.awal.lebar + dx, tinggi: d.awal.tinggi + dy },
    );
    setKotak((k) => ({ ...k, [d.id]: baru }));
    if (d.jenis === "geser" && d.mejaIkut.length > 0) {
      const gx = baru.pos_x - d.awal.pos_x;
      const gy = baru.pos_y - d.awal.pos_y;
      setPos((pp) => ({
        ...pp,
        ...Object.fromEntries(d.mejaIkut.map((m) => [m.id, { x: clamp(m.x + gx), y: clamp(m.y + gy) }])),
      }));
    }
    setDirty(true);
  }
  function selesaiRuang(e: PointerEvent<HTMLDivElement>) {
    if (!dragRuang.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRuang.current = null;
  }

  function simpanSelesai() {
    if (dirty) simpanTataLetak.mutate();
    else keluarKeView();
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>, id: string) {
    if (!editing || langkah !== "meja") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragId.current = id;
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>, id: string) {
    if (dragId.current !== id || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 100);
    const y = clamp(((e.clientY - r.top) / r.height) * 100);
    setPos((p) => ({ ...p, [id]: { x, y } }));
    setDirty(true);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>, id: string) {
    if (dragId.current === id) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      dragId.current = null;
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  if (isLoading) return <Spinner />;
  // GAGAL MEMUAT ≠ BELUM ADA MEJA. Denah kosong di bawah mengajak menekan
  // "+ Tambah Meja" — dan meja ganda bukan sekadar baris berlebih: kasir lalu
  // memilih meja yang salah dari dua yang bernama sama, dan status isi/kosong
  // di layar tak lagi cocok dengan ruangan.
  if (gagalMeja) {
    return (
      <div className="max-w-5xl">
        <ErrorText error={gagalMeja} />
        <div className="mt-2 text-sm text-stone-500">
          Denah meja tidak bisa dimuat, jadi kosongnya <b>bukan</b> berarti cabang ini belum
          punya meja. Muat ulang sebelum menambah, supaya tak jadi ganda.
        </div>
      </div>
    );
  }

  const list = meja ?? [];
  const ruanganNama = new Map((ruanganList ?? []).map((r) => [r.id, r.nama]));

  return (
    <div className="max-w-5xl">
      <CabangDataBar />
      <PageTitle
        aksi={
          editing ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={batal} className={btnSecondary}>
                Batal
              </button>
              <button
                type="button"
                onClick={simpanSelesai}
                disabled={simpanTataLetak.isPending}
                className={btnPrimary}
              >
                {simpanTataLetak.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          ) : bolehAtur ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={masukEdit} className={btnSecondary}>
                ✏️ Atur Denah
              </button>
              <button
                type="button"
                onClick={() => {
                  masukEdit();
                  setLangkah("meja");
                  setForm({ nama: "", tipe: "dine_in" });
                }}
                className={btnPrimary}
              >
                + Tambah Meja
              </button>
            </div>
          ) : null
        }
      >
        Meja ({list.length}
        {jumlahIsi === null ? " · status tak diketahui" : jumlahIsi > 0 ? ` · ${jumlahIsi} terisi` : ""})
      </PageTitle>

      {statusGagal && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <b>Status meja gagal dimuat.</b> Denah di bawah menampilkan meja abu-abu karena
          okupansinya <b>tidak diketahui</b> — jangan dibaca sebagai meja kosong. Muat ulang
          halaman untuk mencoba lagi.
          {statusGagal instanceof Error ? ` (${statusGagal.message})` : ""}
        </div>
      )}

      {editing ? (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            {(["ruangan", "meja"] as const).map((l, i) => (
              <button
                key={l}
                type="button"
                data-testid={`langkah-${l}`}
                onClick={() => setLangkah(l)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
                  langkah === l ? "bg-orange-600 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200"
                }`}
              >
                {i + 1}. {l === "ruangan" ? "Atur Ruangan" : "Atur Meja"}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
            {langkah === "ruangan" ? (
              <>
                <b>Langkah 1 — ruangan.</b> Tambah ruangan (mis. AC, Kipas, Teras), <b>seret</b> untuk
                memindahkan, dan tarik <b>sudut kanan bawah</b> untuk memanjangkan / melebarkan sesuai
                perkiraan ruangannya. Meja di dalam ruangan ikut pindah.
              </>
            ) : (
              <>
                <b>Langkah 2 — meja.</b> Tambah / ubah / hapus meja dan <b>seret</b> tiap meja ke dalam
                ruangannya. Meja otomatis masuk ruangan tempat ia diletakkan.
              </>
            )}{" "}
            Tekan <b>Simpan</b> untuk menyimpan tata letak.
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
          <b className="text-red-700">Merah</b> = ada pesanan belum dibayar ·{" "}
          <b className="text-amber-700">Kuning</b> = sudah bayar tapi tamu masih duduk ·{" "}
          <b className="text-green-700">Hijau</b> = siap ditempati ·{" "}
          <b className="text-stone-600">Abu-abu</b> = statusnya belum diketahui (bukan kosong).
          Meja tetap terisi setelah dibayar — tekan <b>Kosongkan</b> saat tamunya benar-benar
          pergi. Meja <b>Kasir &amp; Take Away</b> (wajib satu, letakkan di posisi kasir) menampung
          semua pesanan bawa pulang, jadi tidak punya status.
        </div>
      )}

      <ErrorText error={galatTerbaru(toggle, hapus, simpanTataLetak, hapusRuangan) ?? gagalRuangan} />

      {/* Desktop: denah (kiri) + daftar (kanan). Mobile: denah atas, daftar bawah. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        {/* Denah — kiri */}
        <Card className="p-3 md:flex-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-stone-700">Denah Ruangan</span>
            {editing && dirty && (
              <span className="text-xs font-medium text-orange-600">Perubahan belum disimpan</span>
            )}
          </div>
          <div
            ref={canvasRef}
            className={`relative mt-1 aspect-[4/3] w-full touch-none overflow-hidden rounded-lg border border-dashed border-stone-300 bg-[linear-gradient(#f5f5f4_1px,transparent_1px),linear-gradient(90deg,#f5f5f4_1px,transparent_1px)] bg-[length:24px_24px] bg-stone-50`}
          >
            {(ruanganList ?? []).map((ru) => {
              const k = kotak[ru.id] ?? kotakDari(ru);
              const aktif = editing && langkah === "ruangan";
              return (
                <div
                  key={ru.id}
                  data-testid="ruangan-denah"
                  onPointerDown={(e) => mulaiRuang(e, ru.id, "geser")}
                  onPointerMove={geserRuang}
                  onPointerUp={selesaiRuang}
                  style={{ left: `${k.pos_x}%`, top: `${k.pos_y}%`, width: `${k.lebar}%`, height: `${k.tinggi}%` }}
                  className={`absolute touch-none select-none rounded-lg border-2 ${
                    aktif
                      ? "cursor-move border-orange-400 bg-orange-50/70"
                      : "pointer-events-none border-stone-300 bg-white/60"
                  }`}
                >
                  <span className="absolute left-1.5 top-1 text-[11px] font-bold uppercase tracking-wide text-stone-500">
                    {ru.nama}
                  </span>
                  {aktif && (
                    <div
                      data-testid="ruangan-pegangan"
                      onPointerDown={(e) => mulaiRuang(e, ru.id, "ukur")}
                      onPointerMove={geserRuang}
                      onPointerUp={selesaiRuang}
                      title="Tarik untuk memanjangkan / melebarkan"
                      className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-orange-500 shadow"
                    />
                  )}
                </div>
              );
            })}
            {list.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-stone-400">
                {editing ? 'Belum ada meja. Tekan "+ Tambah Meja".' : "Belum ada meja di cabang ini."}
              </div>
            )}
            {list.map((m) => {
              const p = pos[m.id] ?? { x: m.pos_x, y: m.pos_y };
              const takeaway = m.tipe === "takeaway";
              const st = statusById.get(m.id);
              // Saat menata denah, warna okupansi justru mengganggu — yang
              // dicari mata adalah posisi, bukan siapa yang sedang duduk.
              const warna =
                takeaway || editing
                  ? takeaway
                    ? "border-amber-400 bg-amber-100 text-amber-800"
                    : "border-blue-300 bg-blue-100 text-blue-800"
                  : kelasStatus(st);
              return (
                <div
                  key={m.id}
                  onPointerDown={(e) => onPointerDown(e, m.id)}
                  onPointerMove={(e) => onPointerMove(e, m.id)}
                  onPointerUp={(e) => onPointerUp(e, m.id)}
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  className={`absolute flex max-w-[42%] -translate-x-1/2 -translate-y-1/2 touch-none select-none flex-col items-center justify-center rounded-lg border px-3 py-2 text-center text-xs font-semibold shadow-sm ${
                    editing && langkah === "meja" ? "cursor-grab active:cursor-grabbing" : ""
                  } ${editing && langkah === "ruangan" ? "pointer-events-none opacity-50" : ""} ${m.is_active || takeaway ? warna : "border-stone-300 bg-stone-100 text-stone-400"}`}
                >
                  <span>{takeaway ? `🥡 ${m.nama}` : m.nama}</span>
                  {!takeaway && !editing && st && st.status === "isi" && (
                    <span className="text-[10px] font-medium opacity-80">{labelStatus(st)}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-stone-400">
            {editing
              ? langkah === "ruangan"
                ? 'Tip: seret ruangan untuk memindahkan, tarik sudut oranye untuk mengubah ukuran, lalu tekan "Simpan".'
                : 'Tip: seret meja ke dalam ruangannya, lalu tekan "Simpan".'
              : "🟥 belum bayar · 🟨 sudah bayar, masih duduk · 🟩 siap ditempati · 🥡 ruang tunggu."}
          </div>
        </Card>

        {/* Langkah 1: daftar ruangan — kanan */}
        {editing && langkah === "ruangan" ? (
        <Card className="md:w-80 md:shrink-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
            <span className="text-sm font-semibold text-stone-700">Daftar Ruangan</span>
            <button
              type="button"
              onClick={() => setFormRuangan({ nama: "" })}
              className="text-sm font-medium text-orange-600 hover:underline"
              data-testid="tambah-ruangan"
            >
              + Tambah Ruangan
            </button>
          </div>
          <div className="divide-y divide-stone-100">
            {(ruanganList ?? []).length === 0 && (
              <div className="p-6 text-center text-sm text-stone-400">
                Belum ada ruangan. Tambah ruangan dulu, lalu atur mejanya.
              </div>
            )}
            {(ruanganList ?? []).map((ru) => (
              <div key={ru.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <div className="font-medium text-stone-800">{ru.nama}</div>
                  <div className="text-xs text-stone-500">
                    {list.filter((m) => m.ruangan_id === ru.id).length} meja
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormRuangan({ id: ru.id, nama: ru.nama })}
                    className="font-medium text-orange-600 hover:underline"
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Hapus ruangan "${ru.nama}"? Mejanya tidak ikut terhapus.`)) hapusRuangan.mutate(ru);
                    }}
                    className="font-medium text-red-600 hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-100 p-3">
            <button type="button" onClick={() => setLangkah("meja")} className={`${btnPrimary} w-full`}>
              Lanjut: Atur Meja →
            </button>
          </div>
        </Card>
        ) : (
        /* Daftar meja — kanan */
        <Card className="md:w-80 md:shrink-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
            <span className="text-sm font-semibold text-stone-700">Daftar Meja</span>
            {editing && (
              <button
                type="button"
                onClick={() => setForm({ nama: "", tipe: "dine_in" })}
                className="text-sm font-medium text-orange-600 hover:underline"
              >
                + Tambah
              </button>
            )}
          </div>
          <div className="divide-y divide-stone-100">
            {list.length === 0 && (
              <div className="p-6 text-center text-sm text-stone-400">
                Belum ada meja di cabang ini.
              </div>
            )}
            {list.map((m) => {
              const st = statusById.get(m.id);
              return (
              <div key={m.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-stone-800">{m.nama}</span>
                    {m.ruangan_id && ruanganNama.get(m.ruangan_id) && (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                        {ruanganNama.get(m.ruangan_id)}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.tipe === "takeaway"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {m.tipe === "takeaway" ? "🧾 Kasir & take away" : "Dine-in"}
                    </span>
                    {!m.is_active && (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                        Nonaktif
                      </span>
                    )}
                    {st && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${kelasStatus(st)}`}
                      >
                        {labelStatus(st)}
                      </span>
                    )}
                  </div>
                  {st?.dikosongkan_pada && st.status === "kosong" && (
                    <div className="mt-0.5 text-xs text-stone-400">
                      Dibereskan {formatWaktu(st.dikosongkan_pada)}
                      {st.dikosongkan_oleh ? ` oleh ${st.dikosongkan_oleh}` : ""}
                    </div>
                  )}
                </div>
                {!editing && st?.status === "isi" && bolehKosongkan && (
                  <button
                    type="button"
                    onClick={() => setKosongkanId(m.id)}
                    className="shrink-0 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                  >
                    ✓ Kosongkan
                  </button>
                )}
                {editing && (
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setForm({ id: m.id, nama: m.nama, tipe: m.tipe })}
                      className="font-medium text-orange-600 hover:underline"
                    >
                      Ubah
                    </button>
                    {/* Kasir & Take Away WAJIB ada: tak bisa dinonaktifkan/dihapus. */}
                    {(m.tipe !== "takeaway" || !m.is_active) && (
                      <button
                        type="button"
                        onClick={() => toggle.mutate(m)}
                        className="font-medium text-stone-500 hover:underline"
                      >
                        {m.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    )}
                    {m.tipe !== "takeaway" && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Hapus meja "${m.nama}"?`)) hapus.mutate(m);
                        }}
                        className="font-medium text-red-600 hover:underline"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </Card>
        )}
      </div>

      {kosongkanTarget && (
        <KosongkanMejaModal
          meja={kosongkanTarget}
          branchQuery={branchQuery}
          onClose={() => setKosongkanId(null)}
        />
      )}

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Meja" : "Tambah Meja"}
      >
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama / nomor meja</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
                placeholder="mis. Meja 1, VIP 2, Teras 3"
              />
            </div>
            {/* Jenis tak lagi dipilih: meja baru selalu dine-in — "Kasir & Take
                Away" sudah dibuat otomatis dan wajib tepat satu per cabang. */}
            <ErrorText error={simpan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={simpan.isPending} className={btnPrimary}>
                {simpan.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={formRuangan !== null}
        onClose={() => setFormRuangan(null)}
        title={formRuangan?.id ? "Ubah Ruangan" : "Tambah Ruangan"}
      >
        {formRuangan && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              simpanRuangan.mutate(formRuangan);
            }}
            className="space-y-3"
          >
            <div>
              <label className="mb-1 block text-sm font-medium">Nama ruangan</label>
              <input
                required
                maxLength={40}
                value={formRuangan.nama}
                onChange={(e) => setFormRuangan({ ...formRuangan, nama: e.target.value })}
                className={inputClass}
                placeholder="mis. AC, Kipas, Tengah, Teras"
                aria-label="Nama ruangan"
              />
            </div>
            <ErrorText error={simpanRuangan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setFormRuangan(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={simpanRuangan.isPending} className={btnPrimary}>
                {simpanRuangan.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
