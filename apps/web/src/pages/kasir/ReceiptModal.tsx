import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReceiptData } from "@kakarut/shared";
import { ErrorText, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { usePrinter } from "../../context/PrinterContext";
import { api } from "../../lib/api";
import { formatRupiah, formatWaktu } from "../../lib/format";

export interface SaleResult {
  sale: {
    id: string;
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
    catatan: string | null;
  };
  items: {
    id: string;
    menuNama: string;
    hargaSatuan: number;
    qty: number;
    lineTotal: number;
    isDineIn: boolean;
    catatan: string | null;
  }[];
  branch_nama: string;
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

export function ReceiptModal({
  data,
  onClose,
  autoPrintOnOpen = true,
  onDeleted,
}: {
  data: SaleResult;
  onClose: () => void;
  /** false saat cetak ulang dari riwayat (jangan auto-print, user cetak manual) */
  autoPrintOnOpen?: boolean;
  /** bila diberi (owner/admin di Riwayat), tampilkan tombol Hapus → Tempat Sampah */
  onDeleted?: () => void;
}) {
  const { auth } = useAuth();
  const { settings, isThermal, canAutoPrint, printReceipt } = usePrinter();
  const { data: company } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<CompanyStruk>("/company"),
  });
  const [printError, setPrintError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [modeHapus, setModeHapus] = useState(false);
  const [password, setPassword] = useState("");
  const autoPrintedFor = useRef<string | null>(null);

  const hapus = useMutation({
    mutationFn: () =>
      api(`/penjualan/${data.sale.id}`, { method: "DELETE", body: { password } }),
    onSuccess: () => onDeleted?.(),
  });

  const waktuStr = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(data.sale.waktu));

  const showAlamat = company?.receiptShowAlamat ?? true;
  const footer = company?.receiptFooter?.trim() || "Terima kasih! 🙏";

  function toReceiptData(): ReceiptData {
    return {
      companyNama: company?.nama ?? auth?.company?.nama ?? "Kakarut POS",
      alamat: company?.alamat ?? null,
      telepon: company?.telepon ?? null,
      showAlamat,
      branchNama: data.branch_nama,
      nomor: data.sale.nomor,
      waktu: waktuStr,
      isDineIn: data.sale.isDineIn,
      mejaLabel: data.sale.mejaLabel,
      customerNama: data.sale.customerNama,
      customerWa: data.sale.customerWa,
      items: data.items.map((it) => ({
        nama: it.menuNama,
        qty: it.qty,
        hargaSatuan: it.hargaSatuan,
        lineTotal: it.lineTotal,
        tag: it.isDineIn !== data.sale.isDineIn ? (it.isDineIn ? "DI" : "TA") : null,
        catatan: it.catatan,
      })),
      subtotal: data.sale.subtotal,
      diskon: data.sale.diskon,
      diskonPersen: data.sale.diskonPersen,
      pb1Amount: data.sale.pb1Amount,
      pb1Rate: company?.pb1Rate ?? null,
      total: data.sale.total,
      catatan: data.sale.catatan,
      footer: company?.receiptFooter ?? null,
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
              {company?.nama ?? auth?.company?.nama ?? "Kakarut POS"}
            </div>
            {showAlamat && company?.alamat && <div>{company.alamat}</div>}
            {showAlamat && company?.telepon && <div>Telp: {company.telepon}</div>}
            <div>Cabang {data.branch_nama}</div>
            <div className="mt-1">{data.sale.nomor}</div>
            <div>
              {formatWaktu(data.sale.waktu)} · {data.sale.isDineIn ? "Dine-in" : "Bawa pulang"}
            </div>
            {data.sale.mejaLabel && <div>Meja: {data.sale.mejaLabel}</div>}
            {data.sale.customerNama && (
              <div>
                Konsumen: {data.sale.customerNama}
                {data.sale.customerWa ? ` (${data.sale.customerWa})` : ""}
              </div>
            )}
          </div>
          <hr className="my-2 border-dashed border-stone-400" />
          {data.items.map((it) => (
            <div key={it.id} className="mb-1">
              <div>{it.menuNama}</div>
              <div className="flex justify-between">
                <span>
                  {it.qty} × {formatRupiah(it.hargaSatuan)}
                  {it.isDineIn !== data.sale.isDineIn && (it.isDineIn ? " (DI)" : " (TA)")}
                </span>
                <span>{formatRupiah(it.lineTotal)}</span>
              </div>
              {it.catatan && <div className="text-stone-500">* {it.catatan}</div>}
            </div>
          ))}
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
          {data.sale.catatan && <div className="mt-2">Catatan: {data.sale.catatan}</div>}
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

        {onDeleted && !modeHapus && (
          <button
            onClick={() => setModeHapus(true)}
            className="mt-2 w-full text-center text-xs font-medium text-red-600 hover:underline print:hidden"
          >
            🗑 Hapus transaksi (Tempat Sampah)
          </button>
        )}
        {onDeleted && modeHapus && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              hapus.mutate();
            }}
            className="mt-3 space-y-2 rounded-lg bg-red-50 p-3 print:hidden"
          >
            <div className="text-xs text-red-800">
              Transaksi dipindah ke <b>Tempat Sampah</b> & stok dikoreksi. Tidak bisa dikembalikan.
              Masukkan password akun.
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
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
                type="submit"
                disabled={hapus.isPending}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {hapus.isPending ? "Menghapus…" : "Hapus"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
