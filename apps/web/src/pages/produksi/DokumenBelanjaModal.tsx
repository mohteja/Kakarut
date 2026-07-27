import { useState } from "react";
import { Modal, btnPrimary, btnSecondary } from "../../components/ui";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";
import { unduhPdf } from "../../lib/pdf";
import { badgeFaktur, labelTahapRingkas, type FakturGroup, type StokMasukRow } from "./TambahStokPage";

/** Stylesheet dokumen — DI-SCOPE ke `.dok` agar aman dipakai saat buat PDF. */
const DOK_CSS = `.dok{font-family:system-ui,-apple-system,Arial,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:0 4px;font-size:13px;line-height:1.45;background:#fff}
.dok h1{font-size:18px;margin:0 0 2px}
.dok .muted{color:#555;font-size:12px}
.dok table{width:100%;border-collapse:collapse;margin:2px 0 4px}
.dok td{padding:4px 6px;border-bottom:1px solid #e5e5e5;vertical-align:top}
.dok td.r{text-align:right;white-space:nowrap}
.dok .supplier{font-weight:700;margin-top:12px}
.dok .head{border-bottom:1px solid #111;padding-bottom:6px;margin-bottom:6px}
.dok .tag{border:1px solid #111;border-radius:3px;padding:0 4px;font-size:10px;font-weight:700;white-space:nowrap}
.dok .tot{border-top:2px solid #111;margin-top:10px;padding-top:6px}.dok .tot>div{display:flex;justify-content:space-between}
.dok .tujuan{border:2px solid #111;border-radius:6px;padding:6px 10px;font-weight:700;margin-top:8px}
.dok .sign{display:flex;justify-content:space-between;margin-top:48px;font-size:12px;text-align:center;gap:24px}.dok .sign .ln{margin-top:44px;border-top:1px solid #111;padding-top:2px}`;

/** Kelompokkan baris belanja per SUPPLIER (rute belanja: satu toko satu daftar). */
function perSupplier(rows: StokMasukRow[]) {
  const byKey = new Map<
    string,
    { nama: string | null; telepon: string | null; alamat: string | null; rows: StokMasukRow[] }
  >();
  for (const r of rows) {
    const key = r.supplier_bahan ?? "__tanpa";
    let g = byKey.get(key);
    if (!g) {
      g = {
        nama: r.supplier_bahan ?? null,
        telepon: r.supplier_bahan_telepon ?? null,
        alamat: r.supplier_bahan_alamat ?? null,
        rows: [],
      };
      byKey.set(key, g);
    }
    g.rows.push(r);
  }
  // supplier bernama dulu (urut abjad), "tanpa supplier" paling akhir
  return [...byKey.values()].sort((a, b) => {
    if (a.nama == null) return 1;
    if (b.nama == null) return -1;
    return a.nama.localeCompare(b.nama);
  });
}

/** qty kemasan (satuan beli): qty ÷ isi — hanya info, tak dibulatkan. */
function kemasan(r: StokMasukRow) {
  if (!r.satuan_beli || !(r.isi > 0) || Math.abs(r.isi - 1) < 1e-9) return null;
  return `≈ ${formatAngka(Math.round((r.qty / r.isi) * 100) / 100)} ${r.satuan_beli}`;
}

/**
 * DOKUMEN BELANJA: pegangan lengkap untuk yang mengerjakan — daftar bahan
 * dikelompokkan per supplier (nama + telepon + alamat), qty + konversi
 * kemasan, RAB per baris, total RAB & dana cair. Bisa dicetak (dibawa ke
 * pasar) lewat tombol 🖨 — memakai kontainer #dokumen-print.
 */
export function DokumenBelanjaModal({
  grup,
  onClose,
}: {
  grup: FakturGroup;
  onClose: () => void;
}) {
  const badge = badgeFaktur("beli", grup.status);
  // RAB murni (belum ada yang diproses) → dokumen untuk peninjauan finance,
  // bukan lagi pegangan pembelanja. Judul & kop menyesuaikan.
  const isRab = grup.rows.every((r) => r.status === "rencana" || r.status === "ditolak");
  const judul = isRab ? "Dokumen RAB" : "Dokumen Belanja";
  // baris ditolak tak ikut daftar belanja
  const rows = grup.rows.filter((r) => r.status !== "ditolak");
  const grupSupplier = perSupplier(rows);
  const totalRab = rows.reduce((t, r) => t + (r.total_harga ?? 0), 0);
  const sisa = totalRab - grup.danaCair;
  // satu faktur bisa CAMPURAN: produk jadi → dikirim ke cabang, bahan
  // produksi → tetap di CK. Pemisahannya ditampilkan per bahan.
  const nKeCabang = rows.filter((r) => r.tujuan_branch_id != null).length;
  const nDiSini = rows.length - nKeCabang;
  const campuran = nKeCabang > 0 && nDiSini > 0;
  const lokalNama = grup.cabang ?? "CK";
  /** label tujuan satu baris (dipakai saat faktur campuran) */
  const tujuanBaris = (r: StokMasukRow) =>
    r.tujuan_branch_id != null ? `→ ${r.tujuan_cabang ?? "cabang"}` : `di ${lokalNama}`;
  // Laporan Harga kini tombol tersendiri di kartu faktur (LaporanHargaModal),
  // bukan di dokumen ini — dokumen fokus jadi surat belanja/RAB yang dicetak.

  const isi = (cetak: boolean) => (
    <div className={cetak ? "text-black" : ""}>
      {/* Kop dokumen */}
      <div className={`border-b pb-2 ${cetak ? "border-black" : "border-stone-200"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-bold">🧾 {judul}</div>
            <div className={`text-xs ${cetak ? "" : "text-stone-500"}`}>
              {grup.noFaktur && <span className="font-mono">{grup.noFaktur} · </span>}
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
        <div className={`mt-1 text-xs ${cetak ? "" : "text-stone-500"}`}>
          {grup.cabang && <>🏪 {grup.cabang}</>}
          {grup.dikerjakanOleh && <> · 🔧 pembelanja: {grup.dikerjakanOleh}</>}
          {grup.catatan && <> · 📝 {grup.catatan}</>}
        </div>
        {/* TUJUAN BARANG dibuat besar & mencolok agar tak salah kirim */}
        {grup.tujuanCabang && (
          <div
            className={`mt-2 rounded-lg px-3 py-2 text-base font-bold ${
              cetak ? "border-2 border-black" : "bg-purple-100 text-purple-900"
            }`}
          >
            📦 Barang untuk: → {grup.tujuanCabang}
            {campuran && (
              <div className={`text-xs font-semibold ${cetak ? "" : "text-purple-700"}`}>
                {nKeCabang} bahan dikirim ke cabang · {nDiSini} bahan produksi tetap di{" "}
                {lokalNama} — lihat label tiap bahan
              </div>
            )}
          </div>
        )}
      </div>

      {/* Daftar belanja per supplier */}
      <div className="mt-2 space-y-3">
        {grupSupplier.map((s, i) => (
          <div key={i}>
            <div className="text-sm font-bold">
              {s.nama ? <>🏪 {s.nama}</> : "🛒 Tanpa supplier (bebas beli di mana)"}
              {s.telepon && (
                <span className={`font-normal ${cetak ? "" : "text-stone-500"}`}>
                  {" "}
                  · 📞 {s.telepon}
                </span>
              )}
            </div>
            {s.alamat && (
              <div className={`text-xs ${cetak ? "" : "text-stone-500"}`}>📍 {s.alamat}</div>
            )}
            <table className="mt-1 w-full text-sm">
              <tbody className={`divide-y ${cetak ? "divide-stone-300" : "divide-stone-100"}`}>
                {s.rows.map((r) => (
                  <tr key={r.id}>
                    {/* kotak centang manual utk pembelanja (dokumen kerja) */}
                    <td className="w-6 py-1 align-top">☐</td>
                    <td className="py-1 pr-2 font-medium">
                      {r.bahan}
                      {/* faktur campuran: tujuan tiap bahan ditulis eksplisit */}
                      {campuran && (
                        <span
                          className={`ml-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            cetak
                              ? "border border-black"
                              : r.tujuan_branch_id != null
                                ? "bg-purple-100 text-purple-800"
                                : "bg-stone-200 text-stone-700"
                          }`}
                        >
                          {r.tujuan_branch_id != null ? "📦 " : "🏭 "}
                          {tujuanBaris(r)}
                        </span>
                      )}
                      {!cetak && r.status !== "rencana" && (
                        <span
                          className={`ml-1.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeFaktur("beli", r.status).cls}`}
                        >
                          {labelTahapRingkas("beli", r.status)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1 pr-2 text-right">
                      {formatAngka(r.qty)} {r.satuan}
                      {kemasan(r) && (
                        <div className={`text-[11px] ${cetak ? "" : "text-stone-400"}`}>
                          {kemasan(r)}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1 text-right">
                      {r.total_harga == null ? "—" : formatRupiah(r.total_harga)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Ringkasan uang */}
      <div
        className={`mt-3 space-y-0.5 border-t pt-2 text-sm ${cetak ? "border-black" : "border-stone-200"}`}
      >
        <div className="flex justify-between">
          <span>Total est. RAB</span>
          <b>{formatRupiah(totalRab)}</b>
        </div>
        <div className="flex justify-between">
          <span>💸 Dana cair</span>
          <b className={cetak ? "" : "text-emerald-700"}>{formatRupiah(grup.danaCair)}</b>
        </div>
        {Math.abs(sisa) >= 0.5 && (
          <div className={`flex justify-between text-xs ${cetak ? "" : "text-stone-500"}`}>
            <span>{sisa > 0 ? "Kekurangan dari RAB" : "Kelebihan dana"}</span>
            <span>{formatRupiah(Math.abs(sisa))}</span>
          </div>
        )}
      </div>
    </div>
  );

  // ===== Bangun dokumen HTML mandiri (inline style). Tidak lagi diunduh
  // sebagai berkas .html — hanya dipakai jalur cadangan jendela cetak bila
  // pembuatan PDF gagal.
  const esc = (s: unknown) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
    );
  const buildBody = () => {
    const tujuanBlok = grup.tujuanCabang
      ? `<div class="tujuan">📦 Barang untuk: → ${esc(grup.tujuanCabang)}${
          campuran
            ? `<div style="font-size:11px;font-weight:600">${nKeCabang} bahan dikirim ke cabang · ${nDiSini} bahan produksi tetap di ${esc(lokalNama)}</div>`
            : ""
        }</div>`
      : "";
    const tabel = grupSupplier
      .map((s) => {
        const kepala = s.nama
          ? `🏪 ${esc(s.nama)}${s.telepon ? ` · 📞 ${esc(s.telepon)}` : ""}`
          : "🛒 Tanpa supplier (bebas beli di mana)";
        const alamat = s.alamat ? `<div class="muted">📍 ${esc(s.alamat)}</div>` : "";
        const baris = s.rows
          .map((r) => {
            const km = kemasan(r);
            const tag = campuran
              ? ` <span class="tag">${r.tujuan_branch_id != null ? "📦 " : "🏭 "}${esc(tujuanBaris(r))}</span>`
              : "";
            return `<tr><td style="width:16px">☐</td><td>${esc(r.bahan)}${tag}</td><td class="r">${esc(formatAngka(r.qty))} ${esc(r.satuan)}${km ? `<div class="muted">${esc(km)}</div>` : ""}</td><td class="r">${r.total_harga == null ? "—" : esc(formatRupiah(r.total_harga))}</td></tr>`;
          })
          .join("");
        return `<div class="supplier">${kepala}</div>${alamat}<table>${baris}</table>`;
      })
      .join("");
    const sisaBlok =
      Math.abs(sisa) >= 0.5
        ? `<div class="muted" style="display:flex;justify-content:space-between"><span>${sisa > 0 ? "Kekurangan dari RAB" : "Kelebihan dana"}</span><span>${esc(formatRupiah(Math.abs(sisa)))}</span></div>`
        : "";
    return `<div class="dok"><div class="head"><h1>🧾 ${esc(judul)}</h1><div class="muted">${grup.noFaktur ? esc(grup.noFaktur) + " · " : ""}${esc(formatTanggalRingkas(grup.waktu))} · ${esc(formatWaktu(grup.waktu))} · ${esc(badge.label)}</div><div class="muted">${grup.cabang ? "🏪 " + esc(grup.cabang) : ""}${grup.dikerjakanOleh ? " · 🔧 pembelanja: " + esc(grup.dikerjakanOleh) : ""}${grup.catatan ? " · 📝 " + esc(grup.catatan) : ""}</div>${tujuanBlok}</div>${tabel}<div class="tot"><div><span>Total est. RAB</span><b>${esc(formatRupiah(totalRab))}</b></div><div><span>💸 Dana cair</span><b>${esc(formatRupiah(grup.danaCair))}</b></div>${sisaBlok}</div><div class="sign"><div>Pembelanja<div class="ln">( ${esc(grup.dikerjakanOleh ?? "…………")} )</div></div><div>Penerima<div class="ln">( ………… )</div></div></div>`;
  };
  const buildHtml = () =>
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(judul)}${grup.noFaktur ? " " + esc(grup.noFaktur) : ""}</title><style>${DOK_CSS}</style></head><body>${buildBody()}</body></html>`;

  // ===== DOWNLOAD PDF: LANGSUNG unduh berkas .pdf (tanpa dialog cetak/preview)
  // — enak di HP: satu ketuk, file turun. Bila gagal (mis. lib tak termuat),
  // jatuh ke jendela cetak (dialog cetak punya opsi Simpan PDF).
  const [pdfBusy, setPdfBusy] = useState(false);
  const simpanPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      await unduhPdf({
        bodyHtml: buildBody(),
        css: DOK_CSS,
        namaBerkas: `${judul} ${grup.noFaktur ?? formatTanggalRingkas(grup.waktu)}`,
      });
    } catch {
      const w = window.open("", "_blank");
      if (w) {
        w.document.open();
        w.document.write(buildHtml());
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 350);
      } else {
        window.print();
      }
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <Modal open onClose={onClose} title={`📄 ${judul}`} lebar="max-w-xl">
        {isi(false)}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Tutup
          </button>
          <button onClick={() => window.print()} className={btnSecondary}>
            🖨 Cetak ke printer
          </button>
          <button onClick={simpanPdf} disabled={pdfBusy} className={btnPrimary}>
            {pdfBusy ? "Membuat PDF…" : "📄 Download PDF"}
          </button>
        </div>
      </Modal>
      {/* Kontainer khusus cetak — hanya dokumen yang tampil saat window.print() */}
      <div id="dokumen-print" className="hidden print:block">
        {isi(true)}
        <div className="mt-6 flex justify-between gap-4 text-xs">
          <div className="text-center">
            Pembelanja
            <div className="mt-10 border-t border-black px-8">( {grup.dikerjakanOleh ?? "…………"} )</div>
          </div>
          <div className="text-center">
            Penerima
            <div className="mt-10 border-t border-black px-8">( ………… )</div>
          </div>
        </div>
      </div>
    </>
  );
}
