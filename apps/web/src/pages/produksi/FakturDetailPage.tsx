import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { FakturLogRow, JenisPengadaan } from "@kakarut/shared";
import { lolosHtml as esc } from "@kakarut/shared";
import { ErrorText, PageTitle, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
import { AreaCetak } from "../../components/AreaCetak";
import { useCabangData } from "../../context/BranchContext";
import { useKirimanMenggantung } from "../../lib/menggantung";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";
import { unduhPdf } from "../../lib/pdf";
import type { StokMasukRow } from "@kakarut/shared";
import {
  AKSI_TAHAP,
  TEKS,
  URUTAN_TAHAP,
  badgeFaktur,
  belumSelesai,
  kelompokkanFaktur,
  sinyalFaktur,
  type FakturGroup,
  type TahapTujuan,
} from "./TambahStokPage";
import type { TahapNavState } from "./TahapPage";
import { DokumenBelanjaModal } from "./DokumenBelanjaModal";
import { DokumenKirimModal } from "./DokumenKirimModal";
import { LaporanHargaModal } from "./LaporanHargaModal";

/** Entri buku dana faktur: pencairan RAB, dana tambahan, atau sisa kembali. */
interface DanaEntri {
  id: string;
  tipe: "cair" | "tambahan" | "kembali";
  nominal: number;
  catatan: string | null;
  oleh: string | null;
  waktu: string;
}

/**
 * Stylesheet dokumen — DI-SCOPE ke `.dok` supaya aman dipakai membuat PDF,
 * sama persis dengan yang sudah dipakai `DokumenBelanjaModal`.
 */
const DOK_CSS = `.dok{font-family:system-ui,-apple-system,Arial,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:0 4px;font-size:13px;line-height:1.45;background:#fff}
.dok h1{font-size:18px;margin:0 0 2px}
.dok .muted{color:#555;font-size:12px}
.dok table{width:100%;border-collapse:collapse;margin:2px 0 4px}
.dok th{padding:4px 6px;border-bottom:1px solid #111;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.dok td{padding:4px 6px;border-bottom:1px solid #e5e5e5;vertical-align:top}
.dok td.r,.dok th.r{text-align:right;white-space:nowrap}
.dok .head{border-bottom:1px solid #111;padding-bottom:6px;margin-bottom:6px}
.dok .blok{margin-top:10px}
.dok .blok b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}
.dok .kv{display:flex;gap:6px}.dok .kv span:first-child{color:#555;min-width:120px}
.dok .tot{border-top:2px solid #111;margin-top:10px;padding-top:6px}.dok .tot>div{display:flex;justify-content:space-between}
.dok .sign{display:flex;justify-content:space-between;margin-top:48px;font-size:12px;text-align:center;gap:24px}.dok .sign .ln{margin-top:44px;border-top:1px solid #111;padding-top:2px}`;

/**
 * HALAMAN DOKUMEN SATU FAKTUR — pengganti `FakturDetailModal`, yang dihapus.
 *
 * Diminta pemilik repo: *"detail produksi ingin di buat form seperti form
 * produksi dan page sendiri supaya bisa di print dan share"*. Tiga hal yang
 * tak bisa diberikan sebuah modal, dan ketiganya alasan berkas ini ada:
 * URL yang bisa dikirim, kertas yang bisa dicetak, dan PDF yang bisa disimpan.
 *
 * SATU RUMAH, bukan dua. Modalnya tidak dipertahankan berdampingan: 28 medan
 * yang dirender di dua tempat adalah 28 medan yang akan berbeda — dan yang
 * satu diperbaiki sementara yang lain tidak. Riwayat pengadaan kini menavigasi
 * ke sini.
 *
 * DATANYA DARI RUTE SENDIRI (`GET {endpoint}/faktur/:id`), bukan dari daftar
 * yang kebetulan sudah dimuat. Itu yang membuat tautannya benar-benar bisa
 * dikirim: penerimanya membuka URL tanpa pernah menyentuh halaman riwayat.
 * `GET /produksi` sendiri berhalaman 20 tanpa saringan `faktur_id` — mencari
 * fakturnya di sana berarti menyisir sampai empat permintaan @ ~44 KB.
 *
 * BATAS "SHARE" YANG DIPILIH PEMILIK (2026-09-03), ditulis supaya tak ada yang
 * mengira lebih: tautannya untuk SESAMA KARYAWAN — penerimanya tetap wajib
 * login dan tetap tunduk pada peran & cabangnya (server yang menegakkan, lihat
 * gerbang di rutenya). Tidak ada tautan publik bertoken. Untuk ke luar —
 * supplier, pemilik lain — yang dikirim PDF-nya.
 */
export function FakturDetailPage({ tipe }: { tipe: JenisPengadaan }) {
  const { fakturId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const t = TEKS[tipe];
  /*
   * URL-nya dari terner ber-LITERAL, bukan `t.endpoint`, dan itu bukan
   * kelebihan huruf. Penelusur nilai `cabang-ikut-di-url` tak melintasi
   * berkas: `TEKS` tinggal di `TambahStokPage`, jadi `${t.endpoint}/faktur/…`
   * terbaca sebagai URL yang TAK BISA DITELUSURI — dan penjaga yang tak bisa
   * menelusuri sebuah URL berhenti bisa menilai apakah ia membawa cabangnya,
   * lalu hijau karena "tak diperiksa" alih-alih karena "aman". Premis
   * penjaganya sendiri yang menuntut ini, dan ia menyebut nama berkas yang
   * gagal ditelusuri.
   *
   * Nilainya WAJIB sama dengan `TEKS[tipe].endpoint`; kesamaannya dipaku
   * `faktur-halaman-dokumen.test.ts` supaya dua tempat ini tak bisa berselisih.
   */
  const endpoint = tipe === "beli" ? "/pembelian" : "/produksi";
  const { fakturBermasalah } = useKirimanMenggantung();
  const { dariKantor } = useCabangData();
  const [mode, setMode] = useState<"lihat" | "hapus">("lihat");
  const [dokumen, setDokumen] = useState(false);
  const [laporHarga, setLaporHarga] = useState(false);
  const [dokumenKirim, setDokumenKirim] = useState(false);
  const [tautanTersalin, setTautanTersalin] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const {
    data: baris,
    isLoading,
    error: gagalMuat,
  } = useQuery({
    queryKey: [endpoint, "faktur", fakturId],
    queryFn: () => api<{ rows: StokMasukRow[] }>(`${endpoint}/faktur/${fakturId}`),
    enabled: !!fakturId,
  });
  /*
   * PERAKITNYA SAMA dengan yang dipakai daftar (`kelompokkanFaktur`). Halaman
   * ini merakit satu faktur; daftar merakit satu halaman riwayat. Kalau
   * masing-masing menurunkan status/jejak-terima sendiri, badge di sini dan
   * badge di barisnya akan berbeda untuk faktur yang sama — dan orang membaca
   * itu sebagai "datanya salah", bukan sebagai bug perakitan.
   */
  const grup: FakturGroup | null = baris ? (kelompokkanFaktur(baris.rows)[0] ?? null) : null;

  const { data: dana, error: danaGagal } = useQuery({
    queryKey: [endpoint, "dana", fakturId],
    queryFn: () => api<{ rows: DanaEntri[]; total: number }>(`${endpoint}/dana/${fakturId}`),
    enabled: mode === "lihat" && !!grup?.fakturId && (grup?.danaCair ?? 0) !== 0,
  });
  const { data: log, error: logGagal } = useQuery({
    queryKey: [endpoint, "log", fakturId],
    queryFn: () => api<{ rows: FakturLogRow[] }>(`${endpoint}/log/${fakturId}`),
    enabled: mode === "lihat" && !!grup?.fakturId,
  });

  const hapus = useMutation({
    mutationFn: () => api(`${endpoint}/faktur/${grup?.key}`, { method: "DELETE" }),
    onSuccess: () => {
      for (const key of [endpoint, "stok", "sampah", "laporan", "rekomendasi"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      // Halaman yang isinya baru saja dihapus tak boleh tinggal diam
      // memandangi dokumen yang sudah tak ada.
      navigate(endpoint, { replace: true });
    },
  });

  if (isLoading) return <Spinner />;

  /*
   * GAGAL MUAT ≠ FAKTUR KOSONG. Dokumen kosong terbaca sebagai "faktur tanpa
   * bahan" — pernyataan tentang fakturnya, padahal yang gagal bacaannya. Dan
   * karena halaman ini justru yang dibuka dari tautan kiriman orang lain,
   * penerimanya yang paling mungkin melihat layar ini: ia harus tahu apa yang
   * terjadi DAN punya jalan keluar.
   */
  if (gagalMuat || !grup) {
    return (
      <div>
        <PageTitle>Dokumen {tipe === "beli" ? "Pembelian" : "Produksi"}</PageTitle>
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-stone-500">
          <div className="mb-2">
            Faktur ini tidak bisa dibuka — bisa jadi sudah dihapus, atau di luar cabang/divisi yang
            boleh Anda lihat.
          </div>
          <Link to={endpoint} className="font-semibold text-orange-600 hover:underline">
            ← Kembali ke {t.judul}
          </Link>
        </div>
      </div>
    );
  }

  const badge = badgeFaktur(tipe, grup.status);
  const sinyal = sinyalFaktur(grup, tipe, { dariKantor, fakturBermasalah });
  const dariPermintaan = grup.dariPermintaan;
  const bisaDokumen = tipe === "beli" && grup.rows.some((r) => r.status !== "ditolak");
  const judulDok = `Dokumen ${tipe === "beli" ? "Pembelian" : "Produksi"}`;
  const namaBerkas = `${judulDok} ${grup.nomor ?? formatTanggalRingkas(grup.waktu)}`;

  /** Pasangan label→nilai kop dokumen, dipakai layar DAN kertas DAN PDF. */
  const medan: { k: string; v: string }[] = [
    ...(grup.nomor ? [{ k: "Nomor", v: grup.nomor }] : []),
    { k: "Waktu", v: `${formatTanggalRingkas(grup.waktu)} · ${formatWaktu(grup.waktu)}` },
    ...(grup.cabang ? [{ k: "Cabang", v: grup.cabang }] : []),
    { k: "Dibuat oleh", v: grup.dibuatOleh ?? "—" },
    ...(tipe === "produksi"
      ? [{ k: "Dikerjakan oleh", v: grup.dikerjakanOleh ?? grup.supplier ?? "—" }]
      : [
          { k: "Supplier", v: grup.supplier ?? "Tanpa sumber" },
          { k: "No. faktur", v: grup.noFaktur ?? "—" },
        ]),
    { k: "Status", v: badge.label },
    ...(grup.diterimaOleh
      ? [
          {
            k: "Diterima oleh",
            v: `${grup.diterimaOleh}${grup.diterimaPada ? ` · ${formatWaktu(grup.diterimaPada)}` : ""}`,
          },
        ]
      : []),
    ...(grup.danaCair > 0
      ? [
          {
            k: "Dana cair",
            v: `${formatRupiah(grup.danaCair)}${grup.totalHarga > 0 ? ` dari RAB ${formatRupiah(grup.totalHarga)}` : ""}`,
          },
        ]
      : []),
    ...(grup.rows.some((r) => r.alasan_tolak)
      ? [{ k: "Alasan tolak", v: grup.rows.find((r) => r.alasan_tolak)?.alasan_tolak ?? "" }]
      : []),
    ...(grup.catatan ? [{ k: "Catatan", v: grup.catatan }] : []),
    ...(grup.diubahOleh
      ? [
          {
            k: "Diubah oleh",
            v: `${grup.diubahOleh}${grup.updatedAt ? ` · ${formatWaktu(grup.updatedAt)}` : ""}`,
          },
        ]
      : []),
  ];

  /** Teks jumlah satu baris — `qty_teks` milik server, jangan dirakit ulang. */
  const jumlahTeks = (r: StokMasukRow) =>
    r.status === "ditolak"
      ? `0 dari ${formatAngka(r.qty)} ${r.satuan}`
      : `+${formatAngka(r.qty)} ${r.satuan}`;

  const isi = (cetak: boolean) => (
    <div className={cetak ? "text-black" : ""}>
      <div className={`border-b pb-2 ${cetak ? "border-black" : "border-stone-200"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-bold">📋 {judulDok}</div>
            <div className={`text-xs ${cetak ? "" : "text-stone-500"}`}>
              {grup.nomor && <span className="font-mono">{grup.nomor} · </span>}
              {formatTanggalRingkas(grup.waktu)} · {formatWaktu(grup.waktu)}
            </div>
          </div>
          {!cetak && (
            <span
              className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
            >
              {badge.label}
            </span>
          )}
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-y-1 text-sm">
        {medan.map((m) => (
          <div key={m.k} className="col-span-3 grid grid-cols-3 gap-2">
            <dt className={cetak ? "" : "text-stone-400"}>{m.k}</dt>
            <dd className="col-span-2">{m.v}</dd>
          </div>
        ))}
      </dl>

      {log && log.rows.length > 0 && (
        <div className={`mt-3 rounded-lg border p-2 ${cetak ? "border-black" : "border-stone-200"}`}>
          <div className="mb-1 text-sm font-semibold">📜 Riwayat tahap</div>
          <ol className="space-y-0.5 text-sm">
            {log.rows.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className={`shrink-0 font-mono text-xs ${cetak ? "" : "text-stone-400"}`}>
                  {formatWaktu(l.waktu)}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{l.aksi}</span>
                  {l.detail && <span className={cetak ? "" : "text-stone-500"}> — {l.detail}</span>}
                  {l.oleh && <span className="text-xs text-stone-400"> · {l.oleh}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {dana && dana.rows.length > 0 && (
        <div className={`mt-3 rounded-lg border p-2 ${cetak ? "border-black" : "border-emerald-200"}`}>
          <div className="mb-1 text-sm font-semibold">💸 Buku dana faktur</div>
          <ul className="space-y-0.5 text-sm">
            {dana.rows.map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span className="min-w-0">
                  {d.tipe === "cair" ? "Cair" : d.tipe === "tambahan" ? "Tambahan" : "Kembali"}
                  {d.catatan && <span className={cetak ? "" : "text-stone-500"}> — {d.catatan}</span>}
                  {d.oleh && <span className="text-xs text-stone-400"> · {d.oleh}</span>}
                </span>
                <span className="shrink-0 font-medium">
                  {d.tipe === "kembali" ? "−" : "+"}
                  {formatRupiah(d.nominal)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t pt-1 text-right text-xs font-semibold">
            Dana efektif: {formatRupiah(dana.total)}
          </div>
        </div>
      )}

      <div className={`mt-3 rounded-lg border ${cetak ? "border-black" : "border-stone-200"}`}>
        <table className="w-full text-sm">
          <thead className={`border-b text-xs ${cetak ? "border-black" : "border-stone-200 bg-stone-50 text-stone-500"}`}>
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">
                {tipe === "produksi" ? "Bahan diproduksi" : "Bahan dibeli"}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">
                {tipe === "produksi" ? "Hasil & batch" : "Jumlah"}
              </th>
              <th className="px-3 py-1.5 text-left font-medium">Rak simpan</th>
              {tipe === "beli" && <th className="px-3 py-1.5 text-right font-medium">Biaya</th>}
            </tr>
          </thead>
          <tbody className={cetak ? "" : "divide-y divide-stone-100"}>
            {grup.rows.map((r) => {
              const ditolak = r.status === "ditolak";
              return (
                <tr key={r.id} className={!cetak && ditolak ? "bg-red-50/60" : ""}>
                  <td className="border-b border-stone-100 px-3 py-1.5 font-medium">
                    {r.bahan}
                    {!cetak && tipe === "produksi" && r.ingredient_id && (
                      <Link
                        to={`/resep?bahan=${r.ingredient_id}`}
                        className="ml-1.5 whitespace-nowrap text-xs font-medium text-orange-600 hover:underline"
                      >
                        📖 resep
                      </Link>
                    )}
                    {ditolak && (
                      <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                        ❌ ditolak
                      </span>
                    )}
                    {tipe === "beli" && r.supplier_bahan && (
                      <div className={`mt-0.5 text-xs font-normal ${cetak ? "" : "text-stone-600"}`}>
                        🏪 {r.supplier_bahan}
                        {r.supplier_bahan_telepon && <span> · {r.supplier_bahan_telepon}</span>}
                      </div>
                    )}
                    {r.exp_date && (
                      <div className={`mt-0.5 text-[11px] font-normal ${cetak ? "" : "text-stone-500"}`}>
                        ⏳ exp {formatTanggalRingkas(r.exp_date)}
                      </div>
                    )}
                  </td>
                  <td className={`border-b border-stone-100 px-3 py-1.5 text-right ${cetak ? "" : "text-stone-600"}`}>
                    {jumlahTeks(r)}
                    {r.qty_dipesan != null && r.qty_dipesan !== r.qty && !ditolak && (
                      <span className="ml-1 text-xs text-amber-600">
                        (dipesan {formatAngka(r.qty_dipesan)})
                      </span>
                    )}
                    {r.batch_teks && (
                      <div className={`text-xs font-semibold ${cetak ? "" : "text-orange-600"}`}>
                        🍳 {r.batch_teks}
                      </div>
                    )}
                  </td>
                  <td className={`border-b border-stone-100 px-3 py-1.5 ${cetak ? "" : "text-stone-500"}`}>
                    {r.tempat ?? "—"}
                  </td>
                  {tipe === "beli" && (
                    <td className={`border-b border-stone-100 px-3 py-1.5 text-right ${cetak ? "" : "text-stone-500"}`}>
                      {r.total_harga == null ? "—" : formatRupiah(r.total_harga)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {tipe === "beli" && grup.totalHarga > 0 && (
        <div className="mt-1 text-right text-sm font-semibold">
          Total: {formatRupiah(grup.totalHarga)}
        </div>
      )}
    </div>
  );

  // ===== PDF: badan HTML dirakit sendiri (bukan snapshot DOM) supaya berkasnya
  // bersih dari kelas layar. Tiap teks lewat `lolosHtml` — nama bahan & catatan
  // datang dari pemakai, dan dokumen yang menempelkannya mentah adalah lubang
  // injeksi yang ikut tersimpan di berkas yang dibagikan.
  const buildBody = () => {
    const kop = medan
      .map((m) => `<div class="kv"><span>${esc(m.k)}</span><span>${esc(m.v)}</span></div>`)
      .join("");
    const riwayat =
      log && log.rows.length > 0
        ? `<div class="blok"><b>Riwayat tahap</b>${log.rows
            .map(
              (l) =>
                `<div class="kv"><span>${esc(formatWaktu(l.waktu))}</span><span>${esc(l.aksi)}${l.detail ? " — " + esc(l.detail) : ""}${l.oleh ? " · " + esc(l.oleh) : ""}</span></div>`,
            )
            .join("")}</div>`
        : "";
    const kolomBiaya = tipe === "beli" ? '<th class="r">Biaya</th>' : "";
    const baris = grup.rows
      .map((r) => {
        const biaya =
          tipe === "beli"
            ? `<td class="r">${r.total_harga == null ? "—" : esc(formatRupiah(r.total_harga))}</td>`
            : "";
        const batch = r.batch_teks ? `<div class="muted">${esc(r.batch_teks)}</div>` : "";
        const exp = r.exp_date
          ? `<div class="muted">exp ${esc(formatTanggalRingkas(r.exp_date))}</div>`
          : "";
        return `<tr><td>${esc(r.bahan)}${r.status === "ditolak" ? " (ditolak)" : ""}${exp}</td><td class="r">${esc(jumlahTeks(r))}${batch}</td><td>${esc(r.tempat ?? "—")}</td>${biaya}</tr>`;
      })
      .join("");
    const total =
      tipe === "beli" && grup.totalHarga > 0
        ? `<div class="tot"><div><span>Total</span><b>${esc(formatRupiah(grup.totalHarga))}</b></div></div>`
        : "";
    return `<div class="dok"><div class="head"><h1>${esc(judulDok)}</h1><div class="muted">${grup.nomor ? esc(grup.nomor) + " · " : ""}${esc(formatTanggalRingkas(grup.waktu))} · ${esc(formatWaktu(grup.waktu))}</div></div><div class="blok">${kop}</div>${riwayat}<div class="blok"><b>${tipe === "produksi" ? "Bahan diproduksi" : "Bahan dibeli"}</b><table><tr><th>Bahan</th><th class="r">${tipe === "produksi" ? "Hasil &amp; batch" : "Jumlah"}</th><th>Rak simpan</th>${kolomBiaya}</tr>${baris}</table></div>${total}<div class="sign"><div>Pelaksana<div class="ln">( ${esc(grup.dikerjakanOleh ?? "…………")} )</div></div><div>Mengetahui<div class="ln">( ………… )</div></div></div></div>`;
  };

  const simpanPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      await unduhPdf({ bodyHtml: buildBody(), css: DOK_CSS, namaBerkas });
    } catch {
      window.print();
    } finally {
      setPdfBusy(false);
    }
  };

  /*
   * SALIN TAUTAN — `navigator.clipboard` butuh konteks aman (https/localhost)
   * dan bisa ditolak izinnya; `execCommand("copy")` usang tapi masih jalan di
   * peramban lama dan saat izinnya ditolak. Yang tak boleh terjadi: tombol
   * yang berkata "Tersalin" padahal papan kliknya kosong.
   */
  const salinTautan = async () => {
    const url = window.location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setTautanTersalin(true);
      setTimeout(() => setTautanTersalin(false), 2500);
    }
  };

  const ubahTahap = (ke: TahapTujuan) => {
    const st: TahapNavState = { grup, tipe, endpoint, ke, kembali: endpoint };
    navigate(`${endpoint}/tahap`, { state: st });
  };

  const tahapTerawal = Math.min(...grup.rows.map((r) => URUTAN_TAHAP[r.status]));
  const isWorkOrderFaktur = tipe === "produksi" && grup.rows.some((r) => r.tujuan_branch_id != null);
  const adaTujuan = grup.rows.some((r) => r.tujuan_branch_id != null);
  const opsiTahap = AKSI_TAHAP[tipe]
    .filter((a) => URUTAN_TAHAP[a.ke] > tahapTerawal && !(isWorkOrderFaktur && a.ke === "dikonfirmasi"))
    .map((a) =>
      tipe === "beli" && adaTujuan && a.ke === "menunggu"
        ? { ...a, label: "📦 Tiba di CK (semua barang di CK)" }
        : a,
    );

  return (
    <div>
      <PageTitle
        aksi={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={endpoint} className={btnSecondary}>
              ← {t.judul}
            </Link>
            <button onClick={salinTautan} className={btnSecondary}>
              {tautanTersalin ? "✓ Tautan tersalin" : "🔗 Salin tautan"}
            </button>
            <button onClick={() => window.print()} className={btnSecondary}>
              🖨 Cetak
            </button>
            <button onClick={simpanPdf} disabled={pdfBusy} className={btnPrimary}>
              {pdfBusy ? "Membuat PDF…" : "📄 Download PDF"}
            </button>
          </div>
        }
      >
        {judulDok}
        {grup.nomor ? ` ${grup.nomor}` : ""}
      </PageTitle>

      {/* Tautannya untuk sesama karyawan — dikatakan, bukan dibiarkan ditebak.
          Orang yang mengira ini tautan publik akan mengirimnya ke supplier dan
          baru tahu keliru saat supplier itu melihat layar login. */}
      <p className="mb-3 text-xs text-stone-400">
        Tautan halaman ini bisa dikirim ke sesama karyawan (mereka tetap perlu masuk dan hanya
        melihat yang boleh dilihat perannya). Untuk ke luar, kirim PDF-nya.
      </p>

      {mode === "lihat" ? (
        <>
          <div className="rounded-xl border border-stone-200 bg-white p-4">{isi(false)}</div>

          <ErrorText error={danaGagal} />
          <ErrorText error={logGagal} />

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {grup.fakturId && belumSelesai(grup.status) && opsiTahap.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const ke = e.target.value as TahapTujuan | "";
                  if (ke) ubahTahap(ke);
                }}
                aria-label="Ubah tahap faktur dari detail"
                className="cursor-pointer rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-500"
              >
                <option value="">➡ Ubah Tahap</option>
                {opsiTahap.map((a) => (
                  <option key={a.ke} value={a.ke}>
                    {a.label}
                  </option>
                ))}
              </select>
            )}
            {bisaDokumen && (
              <button
                onClick={() => setDokumen(true)}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:border-orange-400 hover:text-orange-700"
              >
                📄{" "}
                {grup.rows.every((r) => r.status === "rencana" || r.status === "ditolak")
                  ? "Dokumen RAB"
                  : "Dokumen belanja"}
              </button>
            )}
            {sinyal.bisaLapor && (
              <button
                onClick={() => setLaporHarga(true)}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                  sinyal.laporanSelesai
                    ? "border-stone-300 bg-white text-stone-700 hover:border-emerald-400"
                    : "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                💰 {sinyal.laporanSelesai ? "Ubah Laporan Harga" : "Laporan Harga"}
              </button>
            )}
            {sinyal.adaTerkirim && (
              <button
                onClick={() => setDokumenKirim(true)}
                className="rounded-lg border border-purple-300 bg-white px-4 py-2 text-sm font-semibold text-purple-700 hover:border-purple-500"
              >
                📄 Dokumen kirim
              </button>
            )}
            <button
              onClick={() => setMode("hapus")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                dariPermintaan ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {dariPermintaan ? "🚫 Batalkan" : "🗑 Hapus"}
            </button>
          </div>
        </>
      ) : (
        <div className="max-w-xl space-y-3 rounded-xl border border-stone-200 bg-white p-4">
          {dariPermintaan ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Faktur ini berasal dari <b>Permintaan {grup.permintaanNomor ?? "Stok"}</b>.
              Membatalkan akan mengeluarkan faktur ini (stok dikoreksi) & memindahkannya ke{" "}
              <b>Tempat Sampah</b> (bisa dipulihkan). <b>Permintaannya tetap ada</b> — untuk
              menghapus permanen, hapus dari <b>Permintaan Stok</b>.
            </div>
          ) : (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Faktur akan dipindah ke <b>Tempat Sampah</b> dan stoknya dikoreksi. Masih bisa{" "}
              <b>dipulihkan</b> dari Tempat Sampah bila terhapus tak sengaja.
            </div>
          )}
          <ErrorText error={hapus.error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setMode("lihat")} className={btnSecondary}>
              {dariPermintaan ? "Tidak" : "Batal"}
            </button>
            <button
              onClick={() => hapus.mutate()}
              disabled={hapus.isPending}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                dariPermintaan ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {hapus.isPending
                ? dariPermintaan
                  ? "Membatalkan…"
                  : "Menghapus…"
                : dariPermintaan
                  ? "Ya, Batalkan faktur"
                  : "Ya, pindahkan ke Tempat Sampah"}
            </button>
          </div>
        </div>
      )}

      {dokumen && <DokumenBelanjaModal grup={grup} onClose={() => setDokumen(false)} />}
      {laporHarga && <LaporanHargaModal grup={grup} onClose={() => setLaporHarga(false)} />}
      {dokumenKirim && (
        <DokumenKirimModal grup={grup} tipe={tipe} onClose={() => setDokumenKirim(false)} />
      )}

      {/* Area cetak memakai id `dokumen-print` yang aturan @media print-nya
          SUDAH ada di index.css — dan `AreaCetak` memportalnya ke luar #root,
          tanpa itu tinggi shell ikut menentukan tinggi kertas. */}
      <AreaCetak id="dokumen-print">
        {isi(true)}
        <div className="mt-6 flex justify-between gap-4 text-xs">
          <div className="text-center">
            Pelaksana
            <div className="mt-10 border-t border-black px-8">
              ( {grup.dikerjakanOleh ?? "…………"} )
            </div>
          </div>
          <div className="text-center">
            Mengetahui
            <div className="mt-10 border-t border-black px-8">( ………… )</div>
          </div>
        </div>
      </AreaCetak>
    </div>
  );
}
