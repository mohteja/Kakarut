import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { qtyDitagih } from "@kakarut/shared";
import type { MetodeBayar, ReceiptData } from "@kakarut/shared";

const METODE_LABEL: Record<MetodeBayar, string> = {
  tunai: "Tunai",
  qris: "QRIS",
  transfer: "Transfer",
};
import { ErrorText, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { usePrinter } from "../../context/PrinterContext";
import { api } from "../../lib/api";
import { formatRupiah, formatWaktu } from "../../lib/format";
import { RefundPanel } from "./RefundPanel";

export interface SaleResult {
  sale: {
    id: string;
    branchId: string;
    nomor: string;
    subtotal: number;
    diskon: number;
    diskonPersen: number | null;
    pb1Amount: number;
    total: number;
    waktu: string;
    isDineIn: boolean;
    mejaLabel: string | null;
    customerNama: string | null;
    customerWa: string | null;
    metodeBayar: MetodeBayar;
    uangDiterima: number | null;
    catatan: string | null;
    /**
     * Angka SEBELUM refund apa pun — jangkar tetap agar refund bertahap tak
     * menggerus diskon dua kali. null = transaksi ini belum pernah direfund,
     * jadi nilai terkini di atas memang nilai asalnya.
     */
    subtotalAsal: number | null;
    diskonAsal: number | null;
    pb1Asal: number | null;
    /** uang yang sudah dikembalikan ke pembeli (kumulatif, Rp) */
    refundTotal: number;
  };
  items: {
    id: string;
    menuNama: string;
    hargaSatuan: number;
    qty: number;
    lineTotal: number;
    isDineIn: boolean;
    catatan: string | null;
    /**
     * Porsi baris ini yang sudah dikembalikan (kumulatif). `qty` sengaja tidak
     * dikurangi — berapa yang dipesan dan berapa yang dikembalikan adalah dua
     * fakta, dan struk asli harus tetap terbaca. Yang DITAGIH = `qty − ini`.
     */
    qtyRefund: number;
  }[];
  branch_nama: string;
  /** nama kasir yang melayani (untuk dicetak di nota) */
  kasir?: string | null;
}

/**
 * Catatan baris untuk struk: catatan pembeli, plus keterangan porsi yang
 * uangnya sudah dikembalikan. Tanpa keterangan itu, struk cetak ulang hanya
 * menampilkan angka yang lebih kecil tanpa sebab — dan pembeli yang memegang
 * struk lamanya tak punya cara mencocokkannya.
 */
function catatanBaris(it: { catatan: string | null; qtyRefund: number }): string | null {
  if (it.qtyRefund <= 0) return it.catatan;
  const ket = `↩ ${it.qtyRefund} porsi dikembalikan`;
  return it.catatan ? `${it.catatan} · ${ket}` : ket;
}

/** Baris companies dari GET /company (camelCase Drizzle) — field yg dipakai struk */
interface CompanyStruk {
  nama: string;
  alamat: string | null;
  telepon: string | null;
  pb1Rate: number;
  receiptFooter: string | null;
  receiptShowAlamat: boolean;
}

/** Cabang dari GET /cabang — struk memakai alamat/telepon & footer PER CABANG */
interface CabangStruk {
  id: string;
  alamat: string | null;
  telepon: string | null;
  receipt_footer: string | null;
  receipt_show_alamat: boolean;
}

export function ReceiptModal({
  data,
  onClose,
  autoPrintOnOpen = true,
  onDeleted,
  onRefunded,
}: {
  data: SaleResult;
  onClose: () => void;
  /** false saat cetak ulang dari riwayat (jangan auto-print, user cetak manual) */
  autoPrintOnOpen?: boolean;
  /** bila diberi (owner/admin di Riwayat), tampilkan tombol Hapus → Tempat Sampah */
  onDeleted?: () => void;
  /**
   * bila diberi, tampilkan tombol kembalikan uang per sajian (bahan habis).
   * Kasir pun boleh — pembelinya sedang berdiri di depan kasir; jejaknya
   * tersimpan di server.
   */
  onRefunded?: () => void;
}) {
  const { auth } = useAuth();
  const { settings, isThermal, canAutoPrint, printReceipt } = usePrinter();
  const { data: company } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<CompanyStruk>("/company"),
  });
  // Struk per cabang: alamat/telepon & footer dari CABANG transaksi
  // (fallback ke data perusahaan bila kosong — data lama tetap tercetak benar).
  const { data: daftarCabang } = useQuery({
    queryKey: ["cabang"],
    queryFn: () => api<CabangStruk[]>("/cabang"),
  });
  const cabangStruk = daftarCabang?.find((b) => b.id === data.sale.branchId);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [modeHapus, setModeHapus] = useState(false);
  const [modeRefund, setModeRefund] = useState(false);
  const autoPrintedFor = useRef<string | null>(null);

  // SOFT-DELETE ke Tempat Sampah (cukup konfirmasi — bisa dipulihkan)
  const hapus = useMutation({
    mutationFn: () => api(`/penjualan/${data.sale.id}`, { method: "DELETE" }),
    onSuccess: () => onDeleted?.(),
  });

  // Nomor antrian (urutan hari ini) — dari sekuens akhir nomor struk
  const antrian = Number(data.sale.nomor.slice(-4)) || null;

  const waktuStr = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(data.sale.waktu));

  const showAlamat = cabangStruk?.receipt_show_alamat ?? company?.receiptShowAlamat ?? true;
  const footerRaw = cabangStruk?.receipt_footer ?? company?.receiptFooter ?? null;
  const footer = footerRaw?.trim() || "Terima kasih! 🙏";
  const alamatStruk = cabangStruk?.alamat ?? company?.alamat ?? null;
  const teleponStruk = cabangStruk?.telepon ?? company?.telepon ?? null;

  function toReceiptData(): ReceiptData {
    return {
      companyNama: company?.nama ?? auth?.company?.nama ?? "Terakasir",
      alamat: alamatStruk,
      telepon: teleponStruk,
      showAlamat,
      branchNama: data.branch_nama,
      nomor: data.sale.nomor,
      waktu: waktuStr,
      isDineIn: data.sale.isDineIn,
      mejaLabel: data.sale.mejaLabel,
      customerNama: data.sale.customerNama,
      customerWa: data.sale.customerWa,
      // Porsi yang DITAGIH, bukan yang dipesan: sajian yang uangnya sudah
      // dikembalikan tak boleh muncul sebagai tagihan di struk cetak ulang.
      // Barisnya tetap ada dengan catatan, supaya pembeli bisa mencocokkan
      // struk lamanya dan melihat mengapa totalnya berbeda.
      items: data.items.map((it) => ({
        nama: it.menuNama,
        qty: qtyDitagih(it),
        hargaSatuan: it.hargaSatuan,
        lineTotal: it.hargaSatuan * qtyDitagih(it),
        tag: it.isDineIn !== data.sale.isDineIn ? (it.isDineIn ? "DI" : "TA") : null,
        catatan: catatanBaris(it),
      })),
      subtotal: data.sale.subtotal,
      diskon: data.sale.diskon,
      diskonPersen: data.sale.diskonPersen,
      pb1Amount: data.sale.pb1Amount,
      pb1Rate: company?.pb1Rate ?? null,
      total: data.sale.total,
      refundTotal: data.sale.refundTotal,
      metodeBayar: data.sale.metodeBayar,
      uangDiterima: data.sale.uangDiterima,
      catatan: data.sale.catatan,
      kasir: data.kasir ?? null,
      footer: footerRaw,
    };
  }

  async function cetakThermal() {
    setPrintError(null);
    setPrinting(true);
    try {
      await printReceipt(toReceiptData());
    } catch (e) {
      setPrintError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }

  // Cetak otomatis sekali per transaksi (BLE/USB yang sudah terhubung).
  // Tunggu data company termuat agar header/footer struk lengkap.
  useEffect(() => {
    if (!autoPrintOnOpen || !settings.autoPrint || !canAutoPrint || !company) return;
    if (autoPrintedFor.current === data.sale.id) return;
    autoPrintedFor.current = data.sale.id;
    void cetakThermal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.sale.id, settings.autoPrint, canAutoPrint, company]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl">
        <div
          id="struk-print"
          data-paper={settings.paperWidth}
          className="font-mono text-xs text-stone-800"
        >
          <div className="text-center">
            <div className="text-base font-bold">
              {company?.nama ?? auth?.company?.nama ?? "Terakasir"}
            </div>
            {showAlamat && alamatStruk && <div>{alamatStruk}</div>}
            {showAlamat && teleponStruk && <div>Telp: {teleponStruk}</div>}
            <div>Cabang {data.branch_nama}</div>
            <div className="mt-1">{data.sale.nomor}</div>
            <div>
              {formatWaktu(data.sale.waktu)} · {data.sale.isDineIn ? "Dine-in" : "Bawa pulang"}
            </div>
            {antrian != null && <div className="mt-1 text-xl font-bold">Antrian {antrian}</div>}
            {(data.sale.customerNama || data.sale.mejaLabel) && (
              <div className="font-bold">{data.sale.customerNama || data.sale.mejaLabel}</div>
            )}
            {data.sale.customerNama && data.sale.mejaLabel && <div>Meja: {data.sale.mejaLabel}</div>}
          </div>
          <hr className="my-2 border-dashed border-stone-400" />
          {data.items.map((it) => {
            // Yang ditagih = dipesan − dikembalikan. `qty` sengaja tak dikurangi
            // di basis data (dua fakta berbeda), jadi pengurangannya di sini.
            const ditagih = qtyDitagih(it);
            return (
              <div key={it.id} className="mb-1">
                <div className={ditagih === 0 ? "text-stone-400 line-through" : undefined}>
                  {it.menuNama}
                </div>
                <div className="flex justify-between">
                  <span>
                    {ditagih} × {formatRupiah(it.hargaSatuan)}
                    {it.isDineIn !== data.sale.isDineIn && (it.isDineIn ? " (DI)" : " (TA)")}
                  </span>
                  <span>{formatRupiah(it.hargaSatuan * ditagih)}</span>
                </div>
                {it.qtyRefund > 0 && (
                  <div className="text-amber-700">↩ {it.qtyRefund} porsi dikembalikan</div>
                )}
                {it.catatan && <div className="text-stone-500">* {it.catatan}</div>}
              </div>
            );
          })}
          <hr className="my-2 border-dashed border-stone-400" />
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatRupiah(data.sale.subtotal)}</span>
          </div>
          {data.sale.diskon > 0 && (
            <div className="flex justify-between">
              <span>Diskon{data.sale.diskonPersen ? ` ${data.sale.diskonPersen}%` : ""}</span>
              <span>−{formatRupiah(data.sale.diskon)}</span>
            </div>
          )}
          {data.sale.pb1Amount > 0 && (
            <div className="flex justify-between">
              <span>PB1</span>
              <span>{formatRupiah(data.sale.pb1Amount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold">
            <span>TOTAL</span>
            <span>{formatRupiah(data.sale.total)}</span>
          </div>
          {/* Angka di atas SUDAH bersih dari refund, jadi baris ini keterangan —
              bukan pengurang. Ia ada supaya struk cetak ulang bisa menjelaskan
              sendiri kenapa totalnya beda dari struk yang dipegang pembeli. */}
          {data.sale.refundTotal > 0 && (
            <div className="flex justify-between text-amber-700">
              <span>↩ Sudah dikembalikan</span>
              <span>{formatRupiah(data.sale.refundTotal)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between">
            <span>Metode</span>
            <span>{METODE_LABEL[data.sale.metodeBayar]}</span>
          </div>
          {data.sale.metodeBayar === "tunai" && data.sale.uangDiterima != null && (
            <>
              <div className="flex justify-between">
                <span>Tunai</span>
                <span>{formatRupiah(data.sale.uangDiterima)}</span>
              </div>
              <div className="flex justify-between">
                <span>Kembali</span>
                <span>{formatRupiah(Math.max(0, data.sale.uangDiterima - data.sale.total))}</span>
              </div>
            </>
          )}
          {data.sale.catatan && <div className="mt-2">Catatan: {data.sale.catatan}</div>}
          {data.kasir && <div className="mt-2">Kasir: {data.kasir}</div>}
          <div className="mt-3 text-center">{footer}</div>
        </div>

        {printError && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden">
            Gagal mencetak: {printError}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          {isThermal && (
            <button
              onClick={() => void cetakThermal()}
              disabled={printing}
              className={`${btnPrimary} flex-1`}
            >
              {printing ? "Mencetak…" : "🧾 Cetak Thermal"}
            </button>
          )}
          <button onClick={() => window.print()} className={`${btnSecondary} flex-1`}>
            🖨 Cetak Browser
          </button>
          <button
            onClick={onClose}
            className={`${isThermal ? btnSecondary : btnPrimary} flex-1`}
          >
            {autoPrintOnOpen ? "Transaksi Baru" : "Tutup"}
          </button>
        </div>

        {/* Kembalikan uang mendahului Hapus: yang dituju kasir saat bahan
            ternyata habis adalah mengembalikan SATU sajian, bukan membuang
            seluruh transaksi. Menaruh Hapus lebih dulu mengundang keliru. */}
        {onRefunded && !modeRefund && !modeHapus && (
          <button
            onClick={() => setModeRefund(true)}
            className="mt-2 w-full text-center text-xs font-medium text-amber-700 hover:underline print:hidden"
          >
            ↩ Kembalikan uang (sajian tak jadi dibuat)
          </button>
        )}
        {onRefunded && modeRefund && (
          <RefundPanel
            data={data}
            onBatal={() => setModeRefund(false)}
            onSelesai={() => {
              setModeRefund(false);
              onRefunded();
            }}
          />
        )}

        {onDeleted && !modeHapus && !modeRefund && (
          <button
            onClick={() => setModeHapus(true)}
            className="mt-2 w-full text-center text-xs font-medium text-red-600 hover:underline print:hidden"
          >
            🗑 Hapus transaksi (Tempat Sampah)
          </button>
        )}
        {onDeleted && modeHapus && (
          <div className="mt-3 space-y-2 rounded-lg bg-red-50 p-3 print:hidden">
            <div className="text-xs text-red-800">
              Transaksi dipindah ke <b>Tempat Sampah</b> & stok dikoreksi. Masih bisa{" "}
              <b>dipulihkan</b> dari Tempat Sampah bila terhapus tak sengaja.
            </div>
            <ErrorText error={hapus.error} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModeHapus(false)}
                className={`${btnSecondary} flex-1`}
              >
                Batal
              </button>
              <button
                onClick={() => hapus.mutate()}
                disabled={hapus.isPending}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {hapus.isPending ? "Menghapus…" : "Ya, hapus"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
