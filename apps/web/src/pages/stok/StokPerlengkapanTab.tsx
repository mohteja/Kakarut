import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { angkaDari, teksAngka, saldoDiRak, adaDiJalan, kekuranganKeMinimum } from "@kakarut/shared";
import { useState } from "react";
import type {
  BelanjaPerlengkapanDto,
  KirimanPerlengkapanDto,
  OpnamePerlengkapanDetail,
  OpnamePerlengkapanSesiRow,
  PerlengkapanRowDto,
} from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatWaktu } from "../../lib/format";
import { KartuPerlengkapanModal } from "../perlengkapan/KartuPerlengkapanModal";

/** Label aturan konsumsi: "⏱ 1 sachet / hari", "✋ manual (stock opname)". */
function labelAturan(r: PerlengkapanRowDto): string | null {
  if (!r.aturan) return null;
  if (r.aturan.metode === "manual") return "✋ manual (stock opname)";
  const per = r.aturan.per_hari === 1 ? "hari" : `${r.aturan.per_hari} hari`;
  const teks = `⏱ ${formatAngka(r.aturan.qty)} ${r.satuan} / ${per}`;
  return r.aturan.aktif ? teks : `${teks} (nonaktif)`;
}

type ModalState =
  | { jenis: "masuk" | "kartu" | "minta"; item: PerlengkapanRowDto }
  | { jenis: "stok-awal" }
  | { jenis: "riwayat-opname" }
  | null;

/**
 * Tab Perlengkapan pada halaman Stok: SELURUH operasi stok perlengkapan ada
 * di sini (saldo, stok awal, stok masuk, kartu, minta ke CK, terima kiriman,
 * riwayat opname + ACC) — halaman Perlengkapan di Manajemen hanya master
 * (nama, harga, aturan konsumsi), seperti Bahan Baku.
 */
export function StokPerlengkapanTab({
  branchQuery,
  dataId,
  isManajemen,
  cari,
  setCari,
}: {
  branchQuery: string;
  dataId: string | null;
  isManajemen: boolean;
  cari: string;
  setCari: (v: string) => void;
}) {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState>(null);

  const { data: rows, isLoading, error: gagalRows } = useQuery({
    queryKey: ["perlengkapan", branchQuery],
    queryFn: () => api<PerlengkapanRowDto[]>(`/perlengkapan${branchQuery}`),
  });
  const { data: belanja } = useQuery({
    queryKey: ["perlengkapan-belanja", branchQuery],
    queryFn: () => api<BelanjaPerlengkapanDto>(`/perlengkapan/belanja${branchQuery}`),
    enabled: isManajemen,
  });
  const { data: kiriman = [] } = useQuery({
    queryKey: ["perlengkapan-kiriman", branchQuery],
    queryFn: () => api<KirimanPerlengkapanDto[]>(`/perlengkapan/kiriman${branchQuery}`),
  });
  // kiriman MASUK yang menunggu diterima cabang ini (stok belum pindah)
  const kirimanMasuk = kiriman.filter((k) => k.status === "dikirim");

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-belanja"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-kiriman"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-opname"] });
    queryClient.invalidateQueries({ queryKey: ["kartu-perlengkapan"] });
    // Halaman MASTER Perlengkapan menampilkan sebaran saldo per cabang, jadi
    // tiap mutasi di sini mengubah angkanya. Kuncinya HARUS disebut sendiri:
    // pencocokan awalan TanStack Query membandingkan elemen pertama secara
    // utuh, sehingga ["perlengkapan"] di atas tidak pernah mengenai
    // ["perlengkapan-master"] — keduanya kunci berbeda, bukan induk & anak.
    // Kunci ini pula yang ber-staleTime 5 menit (lihat KUNCI_MASTER di
    // main.tsx), jadi tanpa baris ini saldonya basi bukan 10 detik tapi lima
    // menit penuh.
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-master"] });
  };

  const terima = useMutation({
    mutationFn: (id: string) =>
      api(`/perlengkapan/kiriman/${id}/terima${branchQuery}`, { method: "POST" }),
    onSuccess: segarkan,
  });

  const tampil = (rows ?? []).filter((r) =>
    r.nama.toLowerCase().includes(cari.toLowerCase()),
  );

  return (
    <>
      {/* Kiriman CK → cabang yang MENUNGGU diterima (stok belum pindah) */}
      {kirimanMasuk.length > 0 && (
        <Card className="mb-3 border-blue-200 bg-blue-50/50 px-4 py-3">
          <div className="mb-2 text-sm font-semibold text-blue-900">
            🚚 Kiriman perlengkapan menunggu ({kirimanMasuk.length})
          </div>
          <div className="space-y-1.5">
            {kirimanMasuk.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-2 text-sm">
                {k.nomor && (
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {k.nomor}
                  </span>
                )}
                <span className="text-stone-700">
                  {k.item.nama} · <b>{formatAngka(k.qty)} {k.item.satuan}</b>
                </span>
                <span className="text-xs text-stone-500">
                  {k.dari_cabang} → {k.ke_cabang}
                </span>
                {dataId === k.ke_branch_id ? (
                  <button
                    onClick={() => terima.mutate(k.id)}
                    disabled={terima.isPending}
                    className="ml-auto rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    ✔ Terima
                  </button>
                ) : (
                  <span className="ml-auto text-xs text-stone-400">menunggu diterima cabang</span>
                )}
              </div>
            ))}
          </div>
          <ErrorText error={terima.error} />
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari perlengkapan…"
          className={`${inputClass} max-w-56`}
        />
        <button onClick={() => setModal({ jenis: "riwayat-opname" })} className={btnSecondary}>
          🗂 Riwayat Opname
        </button>
        {isManajemen && (
          <button onClick={() => setModal({ jenis: "stok-awal" })} className={btnSecondary}>
            📦 Stok Awal
          </button>
        )}
        {isManajemen && belanja && (
          <div className="ml-auto rounded-lg bg-stone-100 px-3 py-1.5 text-sm text-stone-700">
            🛒 Belanja bulan ini: <b>{formatRupiah(belanja.total)}</b>
          </div>
        )}
      </div>
      <div className="mb-3 text-xs text-stone-400">
        Pemakaian dicatat lewat <b>🧰 Opname Perlengkapan</b>. Stok ≤ minimum: di CK{" "}
        <b>beli lagi</b> (Stok Masuk); di cabang <b>minta ke CK</b> bila stok CK ada.
      </div>

      {/*
        KOSONG ≠ TAK TERBACA. Bacaan yang gagal berakhir `isLoading === false`
        DAN `data === undefined`, jadi tabelnya kosong dan barisnya berbunyi
        "Belum ada perlengkapan — daftarkan item di Manajemen → Perlengkapan":
        menyatakan cabang ini belum punya perlengkapan sama sekali, lalu
        menyuruh mendaftarkan ulang yang sudah terdaftar.
      */}
      {isLoading ? (
        <Spinner />
      ) : gagalRows ? (
        <Card className="border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-bold text-amber-900">
            ⚠ Daftar perlengkapan <b>tidak terbaca</b>
          </div>
          <ErrorText error={gagalRows} />
          <div className="mt-1 text-sm text-amber-900">
            Ini <b>bukan</b> berarti belum ada perlengkapan terdaftar — jangan mendaftarkan
            ulang sebelum daftarnya terbaca.
          </div>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={thClass}>Perlengkapan</th>
                <th className={`${thClass} text-right`}>Saldo</th>
                <th className={`${thClass} text-right`}>Stok Minimum</th>
                <th className={thClass}>Aturan Konsumsi</th>
                <th className={thClass}>Status</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {tampil.map((r) => (
                <tr key={r.id} className="hover:bg-stone-50">
                  <td className={`${tdClass} font-medium`}>
                    {r.nama}
                    {r.catatan && (
                      <span className="ml-2 text-xs font-normal text-stone-400">{r.catatan}</span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right font-bold`}>
                    {formatAngka(r.saldo)}{" "}
                    <span className="font-normal text-stone-500">{r.satuan}</span>
                  </td>
                  <td className={`${tdClass} text-right text-stone-500`}>
                    {r.stok_minimum > 0 ? formatAngka(r.stok_minimum) : "—"}
                  </td>
                  <td className={`${tdClass} text-stone-600`}>
                    {labelAturan(r) ?? <span className="text-stone-400">—</span>}
                  </td>
                  <td className={tdClass}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {isManajemen && (
                        <button
                          onClick={() => setModal({ jenis: "masuk", item: r })}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          📦 Stok Masuk
                        </button>
                      )}
                      {/* stok ≤ minimum: di cabang → minta ke CK bila CK punya stok;
                          di CK sendiri → beli lagi lewat Stok Masuk */}
                      {r.saldo_ck != null && r.saldo_ck > 0 && (
                        <button
                          onClick={() => setModal({ jenis: "minta", item: r })}
                          className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                            r.status !== "aman"
                              ? "bg-blue-600 text-white hover:bg-blue-700"
                              : "border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          }`}
                        >
                          📥 Minta ke CK
                        </button>
                      )}
                      {r.status !== "aman" && r.saldo_ck != null && r.saldo_ck <= 0 && (
                        <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                          ⚠ stok CK kosong
                        </span>
                      )}
                      {r.status !== "aman" && r.saldo_ck == null && isManajemen && (
                        <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                          🛒 ≤ minimum — beli lagi
                        </span>
                      )}
                      <button
                        onClick={() => setModal({ jenis: "kartu", item: r })}
                        className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                      >
                        📒 Kartu
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {tampil.length === 0 && (
                <tr>
                  <td colSpan={6} className={`${tdClass} py-8 text-center text-stone-400`}>
                    {cari
                      ? `Perlengkapan "${cari}" tidak ditemukan.`
                      : "Belum ada perlengkapan — daftarkan item di Manajemen → Perlengkapan."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {modal?.jenis === "masuk" && (
        <MasukModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "minta" && (
        <MintaModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "kartu" && (
        <KartuPerlengkapanModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.jenis === "stok-awal" && (
        <StokAwalModal
          rows={rows ?? []}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "riwayat-opname" && (
        <RiwayatOpnameModal
          branchQuery={branchQuery}
          isManajemen={isManajemen}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
    </>
  );
}

/** Stok awal perlengkapan: set saldo pembuka per item (kosongkan = lewati). */
function StokAwalModal({
  rows,
  branchQuery,
  onClose,
  onSukses,
}: {
  rows: PerlengkapanRowDto[];
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const items = rows
    .filter((r) => qty[r.id] !== undefined && qty[r.id] !== "")
    .map((r) => ({ supply_id: r.id, qty: angkaDari(qty[r.id]) }));
  /**
   * Sama seperti `StokAwalPage` untuk bahan baku: angka yang tak terbaca
   * ditahan di sini. Penyaring di atas cuma `!== ""`, jadi salah ketik lolos
   * jadi NaN, `JSON.stringify` mengubahnya jadi `null`, dan zod server
   * (`qty: z.number()`) menolak SELURUH kiriman dengan galat yang menyebut
   * indeks larik — bukan nama perlengkapannya.
   */
  const salahKetik = rows.filter(
    (r) => qty[r.id] !== undefined && qty[r.id] !== "" && Number.isNaN(angkaDari(qty[r.id])),
  );
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/stok-awal${branchQuery}`, { method: "POST", body: { items } }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="📦 Stok Awal Perlengkapan" lebar="max-w-2xl">
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Isi jumlah perlengkapan yang <b>sudah ada</b> di cabang ini (kosongkan yang tidak
          diatur). Saldo langsung disesuaikan — tercatat sebagai koreksi "Stok awal".
        </div>
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-stone-200">
                <th className={thClass}>Perlengkapan</th>
                <th className={`${thClass} text-right`}>Saldo sekarang</th>
                <th className={`${thClass} w-32`}>Stok awal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100">
                  <td className={tdClass}>
                    {r.nama} <span className="text-xs text-stone-400">({r.satuan})</span>
                  </td>
                  {/* Angka RAK, bukan angka buku: barang yang sudah berangkat ke
                      cabang masih ada di `saldo` tapi raknya sudah kosong.
                      Server membandingkan angka yang sama (lihat POST
                      /perlengkapan/stok-awal); menampilkan saldo penuh di sini
                      akan menyuruh orang "mengoreksi" barang yang cuma sedang
                      di jalan — dan koreksinya memotongnya untuk kedua kali. */}
                  <td className={`${tdClass} text-right`}>
                    {formatAngka(saldoDiRak(r))}
                    {adaDiJalan(r) && (
                      <div className="text-xs text-stone-400">
                        {formatAngka(r.dalam_jalan)} di jalan
                      </div>
                    )}
                  </td>
                  <td className={tdClass}>
                    <input
                      type="text"
                      inputMode="decimal"
                      step="any"
                      value={qty[r.id] ?? ""}
                      onChange={(e) => setQty((p) => ({ ...p, [r.id]: e.target.value }))}
                      className={inputClass}
                      placeholder="—"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {salahKetik.length > 0 && (
          <div className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800">
            Angka tidak terbaca pada <b>{salahKetik.map((r) => r.nama).join(", ")}</b> — tulis
            seperti <b>470</b> atau <b>1,5</b>.
          </div>
        )}
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={items.length === 0 || salahKetik.length > 0 || kirim.isPending}
            className={btnPrimary}
          >
            📦 Simpan Stok Awal ({items.length} item)
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MasukModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [qty, setQty] = useState("");
  const [totalHarga, setTotalHarga] = useState("");
  const [catatan, setCatatan] = useState("");
  // harga default = qty × harga beli item (bisa ditimpa manual)
  const perkiraan = angkaDari(qty) > 0 && item.harga_beli > 0 ? angkaDari(qty) * item.harga_beli : null;
  /**
   * Harga yang TERISI tapi tak terbaca sebagai angka ≥ 0.
   *
   * Qty sudah dijaga tombol di bawah; kolom harga di sebelahnya tidak — dan di
   * sini salah ketik bukan sekadar tak tercatat, ia LEBIH BURUK daripada
   * mengosongkan kotaknya. Kosong mengirim `perkiraan` (qty × harga beli), satu
   * angka nyata. Salah ketik menghasilkan NaN, `JSON.stringify` mengubahnya jadi
   * `null`, zod (`total_harga: z.number().min(0).nullish()`) menerimanya, lalu
   * server menulis `totalHarga: body.total_harga ?? null` apa adanya.
   *
   * Hasilnya barang masuk ke stok TANPA biaya sama sekali: saldo naik, uangnya
   * tak pernah muncul di total belanja perlengkapan. Yang mengetik "50 rb"
   * justru membukukan nol, sementara yang tak mengetik apa pun membukukan
   * perkiraan yang benar.
   *
   * `trim()` dipakai di kedua sisi supaya spasi belaka tetap berarti "kosong" —
   * kalau hanya penjaganya yang trim, ketikan " " lolos ke muatan lalu jadi
   * NaN lagi. Pola & alasannya sama dengan `salahKetik` di StokAwalModal
   * beberapa puluh baris di atas, dan `hargaSalahKetik` di BeliPerlengkapanPage.
   */
  const hargaSalahKetik = totalHarga.trim() !== "" && !(angkaDari(totalHarga) >= 0);
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/masuk${branchQuery}`, {
        method: "POST",
        body: {
          qty: angkaDari(qty),
          total_harga: totalHarga.trim() !== "" ? angkaDari(totalHarga) : perkiraan,
          catatan: catatan.trim() || null,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Stok Masuk — ${item.nama}`}>
      <div className="space-y-3">
        <label className="block text-sm">
          Jumlah masuk ({item.satuan})
          <input
            type="text"
            inputMode="decimal" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="block text-sm">
          Total harga (Rp{perkiraan != null ? ` — perkiraan ${formatRupiah(perkiraan)}` : ", opsional"})
          <input
            type="text"
            inputMode="decimal"
            value={totalHarga}
            onChange={(e) => setTotalHarga(e.target.value)}
            className={inputClass}
            placeholder={perkiraan != null ? teksAngka(perkiraan) : "0"}
          />
        </label>
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} placeholder="mis. beli di toko grosir" />
        </label>
        {hargaSalahKetik && (
          <p className="text-sm text-red-600">
            Total harga tidak terbaca sebagai angka — tulis angkanya saja (mis.{" "}
            <b>50000</b> atau <b>50.000</b>), atau kosongkan untuk memakai perkiraan.
          </p>
        )}
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(angkaDari(qty) > 0) || hargaSalahKetik || kirim.isPending}
            className={btnPrimary}
          >
            📦 Simpan
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Cabang minta stok ke Central Kitchen — faktur kiriman KP-, terima dulu di cabang. */
function MintaModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  // Saran: cukupi sampai stok minimum, minimal 1. Kekurangannya dari
  // `kekuranganKeMinimum` — fungsi yang sama dengan yang dipakai permintaan
  // otomatis di server; `max(1, …)` di sini murni keputusan tampilan (kotak
  // isian tak boleh menyarankan 0), bukan bagian dari hitungannya.
  const saran = Math.max(1, kekuranganKeMinimum(item));
  const [qty, setQty] = useState(teksAngka(Math.min(saran, item.saldo_ck ?? saran)));
  const [catatan, setCatatan] = useState("");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/minta${branchQuery}`, {
        method: "POST",
        body: { qty: angkaDari(qty), catatan: catatan.trim() || null },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Minta ke CK — ${item.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Stok cabang: <b>{formatAngka(item.saldo)} {item.satuan}</b>
          {item.stok_minimum > 0 && <> · minimum {formatAngka(item.stok_minimum)}</>}
          <br />
          Stok Central Kitchen: <b>{formatAngka(item.saldo_ck ?? 0)} {item.satuan}</b>
        </div>
        <label className="block text-sm">
          Jumlah diminta ({item.satuan})
          <input
            type="text"
            inputMode="decimal" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
        </label>
        <div className="text-xs text-stone-500">
          Faktur kiriman terbit dari stok CK — stok pindah setelah cabang menekan <b>Terima</b>.
        </div>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(angkaDari(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            📥 Minta Kiriman
          </button>
        </div>
      </div>
    </Modal>
  );
}

const STATUS_SESI: Record<string, { label: string; cls: string }> = {
  menunggu: { label: "⏳ Menunggu ACC", cls: "bg-amber-100 text-amber-800" },
  disetujui: { label: "✔ Disetujui", cls: "bg-green-100 text-green-700" },
  ditolak: { label: "✖ Ditolak", cls: "bg-red-100 text-red-700" },
};

/**
 * Riwayat sesi opname perlengkapan + ACC/Tolak/Hapus (owner/admin).
 * Diekspor: dipakai juga dari halaman Opname Perlengkapan (staf cabang/CK).
 */
export function RiwayatOpnameModal({
  branchQuery,
  isManajemen,
  onClose,
  onSukses,
}: {
  branchQuery: string;
  isManajemen: boolean;
  onClose: () => void;
  onSukses: () => void;
}) {
  const queryClient = useQueryClient();
  const [buka, setBuka] = useState<string | null>(null);
  const { data: sesi = [], isLoading } = useQuery({
    queryKey: ["perlengkapan-opname", branchQuery],
    queryFn: () => api<OpnamePerlengkapanSesiRow[]>(`/perlengkapan/opname/riwayat${branchQuery}`),
  });
  const { data: detail } = useQuery({
    queryKey: ["perlengkapan-opname", "sesi", buka],
    queryFn: () => api<OpnamePerlengkapanDetail>(`/perlengkapan/opname/sesi/${buka}`),
    enabled: buka != null,
  });
  const aksi = useMutation({
    mutationFn: ({ id, jenis }: { id: string; jenis: "acc" | "tolak" | "hapus" }) =>
      jenis === "hapus"
        ? api(`/perlengkapan/opname/sesi/${id}`, { method: "DELETE" })
        : api(`/perlengkapan/opname/sesi/${id}/${jenis}`, { method: "POST" }),
    onSuccess: () => {
      onSukses();
      queryClient.invalidateQueries({ queryKey: ["perlengkapan-opname"] });
      setBuka(null);
    },
  });
  return (
    <Modal open onClose={onClose} title="🗂 Riwayat Opname Perlengkapan" lebar="max-w-2xl">
      <ErrorText error={aksi.error} />
      {isLoading ? (
        <Spinner />
      ) : sesi.length === 0 ? (
        <div className="py-8 text-center text-sm text-stone-400">Belum ada sesi opname.</div>
      ) : (
        <div className="space-y-2">
          {sesi.map((s) => (
            <div key={s.session_id} className="rounded-lg border border-stone-200">
              <button
                onClick={() => setBuka(buka === s.session_id ? null : s.session_id)}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50"
              >
                {s.nomor && (
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {s.nomor}
                  </span>
                )}
                <span className="text-stone-600">{formatWaktu(s.waktu)}</span>
                <span className="text-xs text-stone-500">
                  {s.jumlah_item} selisih{s.oleh ? ` · ${s.oleh}` : ""}
                </span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_SESI[s.status]?.cls ?? ""}`}
                >
                  {STATUS_SESI[s.status]?.label ?? s.status}
                </span>
              </button>
              {buka === s.session_id && detail && (
                <div className="border-t border-stone-100 px-3 py-2">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-stone-200">
                        <th className={thClass}>Item</th>
                        <th className={`${thClass} text-right`}>Sistem</th>
                        <th className={`${thClass} text-right`}>Fisik</th>
                        <th className={`${thClass} text-right`}>Selisih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.rows.map((r) => (
                        <tr key={r.supply_id} className="border-b border-stone-100">
                          <td className={tdClass}>{r.nama}</td>
                          <td className={`${tdClass} text-right`}>
                            {r.system_qty != null ? formatAngka(r.system_qty) : "—"}
                          </td>
                          <td className={`${tdClass} text-right`}>
                            {r.qty_fisik != null ? formatAngka(r.qty_fisik) : "—"}
                          </td>
                          <td
                            className={`${tdClass} text-right font-semibold ${r.selisih < 0 ? "text-red-700" : "text-emerald-700"}`}
                          >
                            {r.selisih > 0 ? "+" : ""}
                            {formatAngka(r.selisih)} {r.satuan}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {isManajemen && (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      {s.status === "menunggu" && (
                        <>
                          <button
                            onClick={() => aksi.mutate({ id: s.session_id, jenis: "acc" })}
                            disabled={aksi.isPending}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            ✔ ACC (stok berubah)
                          </button>
                          <button
                            onClick={() => aksi.mutate({ id: s.session_id, jenis: "tolak" })}
                            disabled={aksi.isPending}
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            ✖ Tolak
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => {
                          if (confirm("Hapus sesi opname ini? Selisih yang sudah disetujui ikut dibatalkan."))
                            aksi.mutate({ id: s.session_id, jenis: "hapus" });
                        }}
                        disabled={aksi.isPending}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                      >
                        🗑 Hapus
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
