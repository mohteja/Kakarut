import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { hitungUangSetelahRefund, nominalRefund, qtyDitagih } from "@kakarut/shared";
import { ErrorText, btnSecondary } from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah } from "../../lib/format";
import { uuidV4 } from "../../lib/idempoten";
import type { SaleResult } from "./ReceiptModal";

/**
 * KEMBALIKAN UANG untuk sajian yang tak jadi dibuat.
 *
 * Sebabnya di lapangan cuma satu, dan owner menyebutkannya sendiri: bahan
 * ternyata habis. Pesanan yang masuk selalu dibuat — kecuali bahannya kosong,
 * dan saat itu uangnya harus kembali.
 *
 * Kasir boleh melakukannya sendiri: pembelinya sedang berdiri di depan kasir,
 * dan memanggil owner berarti menahan antrean. Wewenang itu ditukar dengan
 * jejak — siapa, kapan, berapa, dan alasannya tersimpan di server.
 *
 * Angka yang ditampilkan di sini dihitung dengan fungsi yang SAMA PERSIS dengan
 * yang dipakai server (`@kakarut/shared/refund`), jadi yang dilihat kasir
 * sebelum menekan tombol adalah yang benar-benar akan terjadi — bukan taksiran
 * yang lalu meleset beberapa rupiah karena diskon & PB1 ikut menyusut.
 */
export function RefundPanel({
  data,
  onBatal,
  onSelesai,
}: {
  data: SaleResult;
  onBatal: () => void;
  /** dipanggil setelah refund berhasil — pemanggil menyegarkan datanya */
  onSelesai: () => void;
}) {
  // saleItemId -> porsi yang dipilih untuk dikembalikan pada kejadian ini
  const [pilih, setPilih] = useState<Record<string, number>>({});
  const [alasan, setAlasan] = useState("Bahan habis");

  const asal = {
    subtotal: data.sale.subtotalAsal ?? data.sale.subtotal,
    diskon: data.sale.diskonAsal ?? data.sale.diskon,
    pb1: data.sale.pb1Asal ?? data.sale.pb1Amount,
  };

  /**
   * Kunci idempotensi satu kejadian refund, bertahan melintasi percobaan ulang.
   *
   * Akibat salahnya lebih buruk daripada pada pembayaran: refund yang terkirim
   * dua kali MENGEMBALIKAN UANG DUA KALI. Pagar "melebihi sisa porsi" tak
   * menolong — selama masih ada porsi tersisa, permintaan kedua sah menurut
   * aturan dan langsung dijalankan.
   *
   * TAPI kuncinya harus mengikat ISI refundnya, bukan umur panel ini. Server
   * memutar ulang hasil PERTAMA untuk `client_ref` yang sama — apa pun `items`
   * yang dibawa permintaan kedua, dan dengan 200 OK. Jadi tanpa penyetelan
   * ulang di bawah:
   *
   *   1. Kasir memilih Nasi Goreng ×1, menekan Kembalikan. Server MENYIMPAN-nya,
   *      lalu jaringan putus sebelum balasannya sampai → mutasi gagal, panel
   *      tetap terbuka, dan angkanya masih memajang "sisa 1" (data di panel ini
   *      belum disegarkan — memang belum bisa: tak ada yang tahu ia berhasil).
   *   2. Kasir menyimpulkan tak ada yang tersimpan, menambah Es Teh ×1, dan
   *      menekan lagi.
   *   3. Kunci yang sama diputar ulang → 200 OK berisi hasil LANGKAH 1. Es Teh
   *      TIDAK PERNAH dikembalikan, tapi `onSelesai` jalan, panel menutup, dan
   *      layar terlihat berhasil. Uang Es Teh sudah telanjur diserahkan.
   *
   * Karena itu setiap perubahan porsi mencabut kuncinya: mengulang kiriman yang
   * SAMA tetap idempoten (itu gunanya), sementara pilihan yang BERUBAH menjadi
   * kejadian yang benar-benar baru. Kalau ternyata langkah 1 memang berhasil,
   * kiriman kedua ditolak server dengan pesan yang menyebutkan sisanya — jauh
   * lebih baik daripada sukses palsu.
   *
   * `alasan` SENGAJA tidak ikut mencabut: ia catatan, bukan uang. Kalau ikut,
   * membenahi ejaan alasan di antara dua percobaan akan membuat refund yang
   * sama terkirim dua kali — persis bahaya yang kunci ini ada untuk mencegahnya.
   */
  const refKejadian = useRef<string | null>(null);

  function ubah(id: string, delta: number, maks: number) {
    setPilih((p) => {
      const next = Math.min(maks, Math.max(0, (p[id] ?? 0) + delta));
      if (next === (p[id] ?? 0)) return p;
      refKejadian.current = null;
      return { ...p, [id]: next };
    });
  }

  const dipilih = Object.entries(pilih).filter(([, q]) => q > 0);
  // Pratinjau memakai aritmetika server: `qtyRefund` KUMULATIF, jadi pilihan
  // kali ini ditambahkan ke yang sudah pernah dikembalikan.
  const sesudah = hitungUangSetelahRefund(
    data.items.map((it) => ({
      hargaSatuan: it.hargaSatuan,
      qty: it.qty,
      qtyRefund: it.qtyRefund + (pilih[it.id] ?? 0),
    })),
    asal,
  );
  const nominal = nominalRefund({ ...asal, total: data.sale.total }, sesudah);

  const kirim = useMutation({
    mutationFn: () => {
      refKejadian.current ??= uuidV4();
      return api(`/penjualan/${data.sale.id}/refund`, {
        method: "POST",
        body: {
          client_ref: refKejadian.current,
          alasan: alasan.trim() || null,
          items: dipilih.map(([sale_item_id, qty]) => ({ sale_item_id, qty })),
        },
      });
    },
    onSuccess: onSelesai,
  });

  // Baris yang sudah dikembalikan seluruhnya tak punya apa pun untuk dipilih.
  const bisaDirefund = data.items.filter((it) => qtyDitagih(it) > 0);

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-amber-50 p-3 print:hidden">
      <div className="text-xs text-amber-900">
        Pilih sajian yang <b>tak jadi dibuat</b> (mis. bahannya habis). Uangnya dikembalikan
        berikut bagian diskon &amp; PB1-nya, dan bahan yang tak jadi terpakai kembali ke stok.
      </div>

      {bisaDirefund.length === 0 ? (
        <div className="rounded-lg bg-white px-3 py-2 text-xs text-stone-500">
          Semua sajian di transaksi ini sudah dikembalikan.
        </div>
      ) : (
        <div className="space-y-1.5">
          {bisaDirefund.map((it) => {
            const sisa = qtyDitagih(it);
            const n = pilih[it.id] ?? 0;
            return (
              <div
                key={it.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-stone-800">{it.menuNama}</div>
                  <div className="text-xs text-stone-500">
                    sisa {sisa} × {formatRupiah(it.hargaSatuan)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => ubah(it.id, -1, sisa)}
                    disabled={n === 0}
                    className="h-8 w-8 rounded-lg border border-stone-300 text-sm font-bold text-stone-600 disabled:opacity-40"
                    aria-label={`Kurangi ${it.menuNama}`}
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{n}</span>
                  <button
                    type="button"
                    onClick={() => ubah(it.id, 1, sisa)}
                    disabled={n >= sisa}
                    className="h-8 w-8 rounded-lg border border-stone-300 text-sm font-bold text-stone-600 disabled:opacity-40"
                    aria-label={`Tambah ${it.menuNama}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium text-amber-900">Alasan (tercatat)</span>
        <input
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="mis. bahan habis"
          className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      {nominal > 0 && (
        <div className="rounded-lg bg-white px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">Total sekarang</span>
            <span className="tabular-nums">{formatRupiah(data.sale.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Total setelah refund</span>
            <span className="tabular-nums">{formatRupiah(sesudah.total)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-stone-200 pt-1 font-bold text-amber-700">
            <span>Dikembalikan ke pembeli</span>
            <span className="tabular-nums">{formatRupiah(nominal)}</span>
          </div>
        </div>
      )}

      <ErrorText error={kirim.error} />
      <div className="flex gap-2">
        <button type="button" onClick={onBatal} className={`${btnSecondary} flex-1`}>
          Batal
        </button>
        <button
          type="button"
          onClick={() => kirim.mutate()}
          disabled={dipilih.length === 0 || kirim.isPending}
          className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {kirim.isPending ? "Memproses…" : `Kembalikan ${formatRupiah(nominal)}`}
        </button>
      </div>
    </div>
  );
}
