import { Modal, btnPrimary, btnSecondary } from "../../components/ui";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";
import { badgeFaktur, labelTahapRingkas, type FakturGroup, type StokMasukRow } from "./TambahStokPage";

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

  return (
    <>
      <Modal open onClose={onClose} title={`📄 ${judul}`} lebar="max-w-xl">
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
