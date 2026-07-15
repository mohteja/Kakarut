import type { JenisPengadaan } from "@kakarut/shared";
import { Modal, btnPrimary, btnSecondary } from "../../components/ui";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";
import type { FakturGroup, StokMasukRow } from "./TambahStokPage";

/** qty kemasan (satuan beli): qty ÷ isi — hanya info, tak dibulatkan. */
function kemasan(r: StokMasukRow) {
  if (!r.satuan_beli || !(r.isi > 0) || Math.abs(r.isi - 1) < 1e-9) return null;
  return `≈ ${formatAngka(Math.round((r.qty / r.isi) * 100) / 100)} ${r.satuan_beli}`;
}

/**
 * DOKUMEN KIRIM (surat jalan) CK → cabang: daftar barang yang dikirim ke
 * cabang tujuan — pegangan pengantar & penerima. Bisa dicetak (kontainer
 * #dokumen-print) dengan area tanda tangan pengirim/penerima.
 */
export function DokumenKirimModal({
  grup,
  tipe,
  onClose,
}: {
  grup: FakturGroup;
  tipe: JenisPengadaan;
  onClose: () => void;
}) {
  // barang DALAM PERJALANAN: sudah dikirim (baris pindah ke cabang tujuan),
  // menunggu diterima di Penerimaan cabang
  const rows = grup.rows.filter(
    (r) =>
      r.tujuan_branch_id != null &&
      r.status === "menunggu" &&
      r.branch_id === r.tujuan_branch_id,
  );
  const tujuan = rows[0]?.tujuan_cabang ?? grup.tujuanCabang ?? "cabang";
  const total = rows.reduce((t, r) => t + (r.total_harga ?? 0), 0);

  const isi = (cetak: boolean) => (
    <div className={cetak ? "text-black" : ""}>
      <div className={`border-b pb-2 ${cetak ? "border-black" : "border-stone-200"}`}>
        <div className="text-base font-bold">📄 Dokumen Kirim (Surat Jalan)</div>
        <div className={`text-xs ${cetak ? "" : "text-stone-500"}`}>
          {tipe === "produksi" ? "🏭 Barang produksi" : "🛒 Barang belanja"}
          {grup.noFaktur && (
            <>
              {" "}
              · <span className="font-mono">{grup.noFaktur}</span>
            </>
          )}{" "}
          · {formatTanggalRingkas(grup.waktu)} · {formatWaktu(grup.waktu)}
          {grup.catatan && <> · 📝 {grup.catatan}</>}
        </div>
        <div
          className={`mt-2 rounded-lg px-3 py-2 text-base font-bold ${
            cetak ? "border-2 border-black" : "bg-purple-100 text-purple-900"
          }`}
        >
          📦 Dikirim ke: → {tujuan}
        </div>
      </div>

      <table className="mt-2 w-full text-sm">
        <tbody className={`divide-y ${cetak ? "divide-stone-300" : "divide-stone-100"}`}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="w-6 py-1 align-top">☐</td>
              <td className="py-1 pr-2 font-medium">{r.bahan}</td>
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
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className={`py-4 text-center text-sm ${cetak ? "" : "text-stone-400"}`}>
                Tidak ada barang dalam perjalanan.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div
        className={`mt-2 flex justify-between border-t pt-2 text-sm ${cetak ? "border-black" : "border-stone-200"}`}
      >
        <span>
          Total {rows.length} bahan{" "}
          <span className={cetak ? "" : "text-stone-400"}>
            — diterima & dicek di Penerimaan cabang
          </span>
        </span>
        <b>{formatRupiah(total)}</b>
      </div>
    </div>
  );

  return (
    <>
      <Modal open onClose={onClose} title="📄 Dokumen Kirim" lebar="max-w-xl">
        {isi(false)}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Tutup
          </button>
          <button onClick={() => window.print()} className={btnPrimary}>
            🖨 Cetak dokumen
          </button>
        </div>
      </Modal>
      {/* Kontainer khusus cetak — hanya dokumen yang tampil saat window.print() */}
      <div id="dokumen-print" className="hidden print:block">
        {isi(true)}
        <div className="mt-6 flex justify-between gap-4 text-xs">
          <div className="text-center">
            Pengirim (CK)
            <div className="mt-10 border-t border-black px-8">( ………… )</div>
          </div>
          <div className="text-center">
            Pengantar
            <div className="mt-10 border-t border-black px-8">( ………… )</div>
          </div>
          <div className="text-center">
            Penerima ({tujuan})
            <div className="mt-10 border-t border-black px-8">( ………… )</div>
          </div>
        </div>
      </div>
    </>
  );
}
