import { btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { formatRupiah, formatWaktu } from "../../lib/format";

export interface SaleResult {
  sale: {
    id: string;
    nomor: string;
    subtotal: number;
    pb1Amount: number;
    total: number;
    waktu: string;
    isDineIn: boolean;
    catatan: string | null;
  };
  items: {
    id: string;
    menuNama: string;
    hargaSatuan: number;
    qty: number;
    lineTotal: number;
    isDineIn: boolean;
  }[];
  branch_nama: string;
}

export function ReceiptModal({ data, onClose }: { data: SaleResult; onClose: () => void }) {
  const { auth } = useAuth();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl">
        <div id="struk-print" className="font-mono text-xs text-stone-800">
          <div className="text-center">
            <div className="text-base font-bold">{auth?.company?.nama ?? "Kakarut POS"}</div>
            <div>Cabang {data.branch_nama}</div>
            <div className="mt-1">{data.sale.nomor}</div>
            <div>
              {formatWaktu(data.sale.waktu)} · {data.sale.isDineIn ? "Dine-in" : "Bawa pulang"}
            </div>
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
            </div>
          ))}
          <hr className="my-2 border-dashed border-stone-400" />
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatRupiah(data.sale.subtotal)}</span>
          </div>
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
          <div className="mt-3 text-center">Terima kasih! 🙏</div>
        </div>
        <div className="mt-4 flex gap-2 print:hidden">
          <button onClick={() => window.print()} className={`${btnSecondary} flex-1`}>
            🖨 Cetak
          </button>
          <button onClick={onClose} className={`${btnPrimary} flex-1`}>
            Transaksi Baru
          </button>
        </div>
      </div>
    </div>
  );
}
