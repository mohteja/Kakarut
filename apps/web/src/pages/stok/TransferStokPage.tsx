import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { TransferStokFaktur, TransferStokSaldoRow } from "@kakarut/shared";
import { angkaDari } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggalRingkas, formatWaktu } from "../../lib/format";
import { uuidV4 } from "../../lib/idempoten";

/** Satu baris bahan pada form transfer (qty sebagai teks agar input bebas). */
interface BarisTransfer {
  ingredient_id: string;
  qty: string;
}

/** Badge JENIS bahan — pembeda tegas bahan dibeli vs diproduksi sendiri. */
function BadgeJenis({ pengadaan }: { pengadaan: "beli" | "produksi" }) {
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold ${
        pengadaan === "produksi"
          ? "bg-orange-100 text-orange-800"
          : "bg-sky-100 text-sky-800"
      }`}
    >
      {pengadaan === "produksi" ? "🏭 Produksi" : "🛒 Beli"}
    </span>
  );
}

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  menunggu: { label: "🚚 Dalam perjalanan", cls: "bg-yellow-100 text-yellow-800" },
  dikonfirmasi: { label: "✅ Diterima", cls: "bg-green-100 text-green-800" },
  ditolak: { label: "❌ Ditolak", cls: "bg-red-100 text-red-700" },
  sebagian: { label: "📦 Diterima sebagian", cls: "bg-green-100 text-green-800" },
  rencana: { label: "📋 Draf", cls: "bg-stone-100 text-stone-600" },
  dikerjakan: { label: "🔨 Diproses", cls: "bg-blue-100 text-blue-800" },
};

/**
 * TRANSFER STOK: memindahkan stok yang SUDAH ADA (ready) antar lokasi —
 * CK↔cabang atau cabang↔cabang — dalam satu faktur multi bahan (nomor TF-).
 * Dipakai mis. saat barang kiriman rusak di jalan dan perlu dikirim ulang.
 * BERDAMPINGAN dengan "Kirim dari stok CK" pada Permintaan Stok (jalur rencana
 * menu); yang ini manual/ad-hoc.
 */
export function TransferStokPage() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const role = auth?.user.role;
  const terkunci =
    role === "tim" || role === "kitchen" || role === "bar" || role === "cashier";
  const lokasiStok = cabang.filter((b) => b.is_active && b.tipe !== "kantor");
  // PENGIRIM HANYA CENTRAL KITCHEN. Cabang (kasir, tim toko, kitchen, bar) dan
  // manajemen yang sedang berada di toko hanya MEMANTAU kiriman yang menuju ke
  // sana. Server menegakkan aturan yang sama (403 bila asal bukan CK), jadi ini
  // murni supaya tak ada formulir yang pasti gagal saat ditekan.
  const daftarCk = lokasiStok.filter((b) => b.tipe === "central_kitchen");
  const ckSaya = terkunci
    ? daftarCk.find((b) => b.id === auth?.user.branch_id)
    : daftarCk[0];
  const bolehKirim = !!ckSaya;

  // Cabang ASAL selalu Central Kitchen; manajemen dgn >1 CK boleh memilih.
  const asalDefault = ckSaya?.id ?? "";
  const [asalId, setAsalId] = useState(asalDefault);
  /**
   * `asalDefault` diturunkan dari `cabang`, dan `cabang` datang dari useQuery
   * di BranchContext yang TIDAK menahan render. Saat halaman ini dimuat ulang
   * langsung (F5/bookmark) dengan chunk-nya sudah hangat di cache, daftar itu
   * masih kosong ketika komponen mount — dan nilai awal useState hanya dibaca
   * sekali, jadi `asalId` terkunci "" selamanya.
   *
   * Akibatnya halaman TERLIHAT siap: `<select value="">` tak punya opsi yang
   * cocok, jadi browser menampilkan opsi pertama ("🏭 Dapur Pusat") seolah
   * terpilih. Tapi state-nya kosong, `enabled: !!asalId` membuat saldo tak
   * pernah diminta, dan pilihan bahannya kosong tanpa satu pun keterangan.
   * Yang terkunci di CK lebih buntu lagi: asalnya dirender sebagai teks mati,
   * jadi tak ada cara memperbaikinya selain memuat ulang dan beruntung.
   *
   * Sengaja tidak menimpa pilihan yang SAH — manajemen dengan >1 CK yang sudah
   * memilih CK kedua tak boleh ditarik balik ke CK pertama tiap render.
   */
  const asalSah = daftarCk.some((b) => b.id === asalId);
  useEffect(() => {
    if (asalSah || !asalDefault) return;
    setAsalId(asalDefault);
  }, [asalSah, asalDefault]);
  const [tujuanId, setTujuanId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [baris, setBaris] = useState<BarisTransfer[]>([{ ingredient_id: "", qty: "" }]);

  // Stok READY di cabang asal — sumber pilihan bahan, satuan, dan batas qty.
  const { data: saldoData, isLoading: saldoLoading, error: gagalSaldo } = useQuery({
    queryKey: ["transfer-saldo", asalId],
    enabled: !!asalId,
    queryFn: () =>
      api<{ branch_id: string; rows: TransferStokSaldoRow[] }>(
        `/transfer-stok/saldo?branch_id=${asalId}`,
      ),
  });
  const saldoRows = saldoData?.rows ?? [];
  const saldoById = useMemo(
    () => new Map(saldoRows.map((r) => [r.ingredient_id, r])),
    [saldoRows],
  );
  /**
   * Batas transfer = stok fisik DIKURANGI barang yang sudah dikirim tapi belum
   * diterima tujuan. Tanpa potongan ini stok yang sama bisa dijanjikan
   * berkali-kali dan saldo asal jadi minus saat semua kiriman diterima.
   */
  const tersediaDari = (r: TransferStokSaldoRow) => r.saldo - r.dalam_jalan;
  const bahanBeli = saldoRows.filter((r) => r.pengadaan === "beli");
  const bahanProduksi = saldoRows.filter((r) => r.pengadaan === "produksi");

  const { data: riwayat, isLoading: riwayatLoading, error: riwayatGagal } = useQuery({
    queryKey: ["transfer-stok"],
    queryFn: () => api<{ rows: TransferStokFaktur[] }>("/transfer-stok"),
  });

  /**
   * Kunci idempotensi satu PENGIRIMAN.
   *
   * Bukan pengaman dari klik ganda — tombolnya sudah dimatikan selama pending.
   * Yang dijaga adalah jaringan yang putus SESUDAH server menulis tapi SEBELUM
   * balasannya sampai. Dan itu tak selalu butuh manusia: terukur di Chromium,
   * saat server menutup koneksi keep-alive yang sedang dipakai ulang, browser
   * MENGULANG SENDIRI POST itu (lihat `lib/idempoten.ts`).
   *
   * Akibat penggandaan di sini bukan sekadar faktur kembar: stok keluar dari
   * CK DUA KALI untuk satu pengiriman, dan cabang menerima dua kiriman yang
   * sama. Persis kelas yang sudah dijaga di penjualan dan opname; transfer
   * satu-satunya pembuat-baris pemindah-stok yang belum ikut.
   *
   * Kuncinya mengikat ISI, bukan umur komponen: dicabut begitu kirimannya
   * sukses (isi form direset), supaya pengiriman BERIKUTNYA — meski bahan dan
   * qty-nya kebetulan sama — tak dianggap ulangan dan diam-diam tak terjadi.
   */
  const refKirim = useRef<string | null>(null);

  const kirim = useMutation({
    mutationFn: () =>
      api<{ ok: true; nomor: string; jumlah_baris: number }>("/transfer-stok", {
        method: "POST",
        body: {
          asal_branch_id: asalId,
          tujuan_branch_id: tujuanId,
          catatan: catatan.trim() || null,
          client_ref: (refKirim.current ??= uuidV4()),
          items: baris
            .filter((b) => b.ingredient_id && angkaDari(b.qty) > 0)
            .map((b) => ({ ingredient_id: b.ingredient_id, qty: angkaDari(b.qty) })),
        },
      }),
    onSuccess: () => {
      refKirim.current = null;
      setBaris([{ ingredient_id: "", qty: "" }]);
      setCatatan("");
      queryClient.invalidateQueries({ queryKey: ["transfer-stok"] });
      queryClient.invalidateQueries({ queryKey: ["transfer-saldo"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["penerimaan"] });
      queryClient.invalidateQueries({ queryKey: ["produksi-nav"] });
    },
  });

  const batal = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/transfer-stok/${fakturId}/batal`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-stok"] });
      queryClient.invalidateQueries({ queryKey: ["transfer-saldo"] });
      queryClient.invalidateQueries({ queryKey: ["penerimaan"] });
    },
  });

  /**
   * Aturan KEMASAN: barang yang hanya bisa dibeli per kemasan juga hanya boleh
   * dikirim per kemasan. Dicermin dari server (`wajib_kelipatan`) supaya form
   * tak pernah menjanjikan sesuatu yang nanti ditolak POST /transfer-stok —
   * termasuk pengecualian "kirim habis" (qty = seluruh sisa).
   */
  const salahKemasan = (s: TransferStokSaldoRow | undefined, qtyTeks: string) => {
    const qty = angkaDari(qtyTeks);
    if (!s || !s.wajib_kelipatan || !(qty > 0)) return null;
    const sisa = tersediaDari(s);
    if (Math.abs(qty - sisa) < 1e-6) return null; // kirim habis
    const kemasan = qty / s.isi;
    if (Math.abs(kemasan - Math.round(kemasan)) < 1e-6) return null;
    return { bawah: Math.floor(kemasan) * s.isi, atas: Math.ceil(kemasan) * s.isi, sisa };
  };

  const barisTerisi = baris.filter((b) => b.ingredient_id && angkaDari(b.qty) > 0);
  /**
   * Baris berbahan yang qty-nya SUDAH DIISI tapi tidak akan ikut terkirim.
   *
   * Halaman ini sudah cermat menolak apa yang server akan tolak — `adaQtyLebih`
   * dan `adaSalahKemasan` sengaja mencerminkan aturan server "supaya form tak
   * pernah menjanjikan sesuatu yang nanti ditolak". Celahnya justru pada yang
   * TIDAK ditolak server: NaN gagal `angkaDari(b.qty) > 0`, jadi barisnya
   * dibuang di sisi klien — hilang dari `barisTerisi` sekaligus dari `items`
   * yang dikirim. Selama satu baris lain benar, `bisaKirim` tetap true dan
   * transfernya berangkat TANPA bahan itu; asal mengira sudah mengirim, tujuan
   * tak pernah menerimanya, dan tak ada galat di mana pun.
   *
   * Nol dan minus terjaring lewat `!(… > 0)` yang sama: nasib barisnya persis
   * sama, dibuang diam-diam.
   */
  const qtyTerbuang = baris
    .filter((b) => b.ingredient_id && b.qty.trim() !== "" && !(angkaDari(b.qty) > 0))
    .map((b) => saldoById.get(b.ingredient_id)?.nama)
    .filter((n): n is string => !!n);
  /**
   * Batas qty diperiksa atas JUMLAH per bahan, bukan per baris.
   *
   * Server menggabungkan dulu ("Gabungkan baris bahan yang sama (qty dijumlah)
   * → satu baris per bahan") lalu membandingkan totalnya dengan
   * `saldo − dalam_jalan`. Pemeriksaan per baris di sini tak melihat itu: dua
   * baris bahan yang sama, masing-masing 60 dari 100 yang tersedia, LOLOS
   * sendiri-sendiri padahal berjumlah 120.
   *
   * Akibatnya form ini melanggar janjinya sendiri — komentar `salahKemasan` di
   * atas menyebutnya: aturan server dicermin "supaya form tak pernah
   * menjanjikan sesuatu yang nanti ditolak POST /transfer-stok". Yang menekan
   * Kirim akan menerima 400 yang menyebut angka total yang tak sama dengan
   * baris mana pun di layar, jadi ia tak punya cara tahu baris mana yang
   * harus dikecilkan.
   *
   * Aturan KEMASAN sengaja tetap per baris: kelipatan tertutup terhadap
   * penjumlahan (dua kelipatan selalu berjumlah kelipatan), jadi tak ada
   * kasus yang lolos per baris tapi gagal setelah digabung.
   */
  const totalPerBahan = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of baris) {
      const q = angkaDari(b.qty);
      if (!b.ingredient_id || !(q > 0)) continue;
      m.set(b.ingredient_id, (m.get(b.ingredient_id) ?? 0) + q);
    }
    return m;
  }, [baris]);
  const bahanQtyLebih = [...totalPerBahan.entries()]
    .filter(([id, total]) => {
      const s = saldoById.get(id);
      return s != null && total > tersediaDari(s) + 1e-9;
    })
    .map(([id]) => saldoById.get(id)?.nama)
    .filter((n): n is string => !!n);
  const adaQtyLebih = bahanQtyLebih.length > 0;
  const adaSalahKemasan = baris.some((b) => salahKemasan(saldoById.get(b.ingredient_id), b.qty));
  const bisaKirim =
    !!asalId &&
    !!tujuanId &&
    asalId !== tujuanId &&
    barisTerisi.length > 0 &&
    qtyTerbuang.length === 0 &&
    !adaQtyLebih &&
    !adaSalahKemasan;

  const namaCabang = (id: string) => cabang.find((b) => b.id === id)?.nama ?? "—";

  return (
    <div>
      <PageTitle>🔄 Transfer Stok</PageTitle>
      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Memindahkan <b>stok yang sudah ada</b> dari <b>Central Kitchen</b> ke cabang.
        Dipakai mis. saat barang kiriman <b>rusak di jalan</b> lalu perlu dikirim ulang.
        Kiriman muncul di <b>📥 Penerimaan Barang</b> cabang tujuan; <b>stok CK berkurang
        saat kiriman diterima</b>. Terpisah dari <b>🚚 Kirim dari stok CK</b> pada
        Permintaan Stok (jalur rencana menu) — keduanya tetap bisa dipakai.
      </div>

      {!bolehKirim && (
        <div className="mb-4 rounded-lg bg-stone-100 px-4 py-2 text-sm text-stone-700">
          👀 <b>Tampilan pantauan.</b> Pengiriman transfer stok hanya dilakukan dari{" "}
          <b>Central Kitchen</b>. Di halaman ini Anda melihat kiriman yang menyangkut
          cabang Anda — terima barangnya di <b>📥 Penerimaan Barang</b>.
        </div>
      )}

      {bolehKirim && (
      <Card className="mb-4 p-4">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (bisaKirim) kirim.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Dari lokasi (asal)</label>
              {terkunci ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  📦 {namaCabang(asalId)}
                </div>
              ) : (
                <select
                  value={asalId}
                  onChange={(e) => {
                    setAsalId(e.target.value);
                    setBaris([{ ingredient_id: "", qty: "" }]);
                    if (e.target.value === tujuanId) setTujuanId("");
                  }}
                  className={inputClass}
                  aria-label="Cabang asal transfer"
                >
                  {/* hanya Central Kitchen — cabang tidak boleh jadi pengirim */}
                  {daftarCk.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.tipe === "central_kitchen" ? "🏭 " : "🏪 "}
                      {b.nama}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Ke lokasi (tujuan)</label>
              <select
                value={tujuanId}
                onChange={(e) => setTujuanId(e.target.value)}
                className={inputClass}
                required
                aria-label="Cabang tujuan transfer"
              >
                <option value="">— pilih tujuan —</option>
                {lokasiStok
                  .filter((b) => b.id !== asalId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.tipe === "central_kitchen" ? "🏭 " : "🏪 "}
                      {b.nama}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/*
            Baris bahan. Tabel enam kolom butuh ~46rem; di layar HP (±390px) itu
            memaksa geser horizontal dan kolom "Jumlah kirim" jatuh jauh di luar
            layar sehingga input gramasi tak terlihat sama sekali. Karena itu HP
            memakai kartu bertumpuk, tabel baru dipakai mulai lebar `sm`.
            Kendali yang sama dirender lewat helper di bawah agar kedua tata
            letak tak punya perilaku berbeda.
          */}
          {(() => {
            const pilihBahan = (i: number, b: BarisTransfer) => {
              // bahan yang sudah dipakai di baris lain disembunyikan
              const dipakaiLain = new Set(
                baris.filter((_, j) => j !== i).map((x) => x.ingredient_id),
              );
              const opsi = (rows: TransferStokSaldoRow[]) =>
                rows.filter(
                  (r) =>
                    r.ingredient_id === b.ingredient_id ||
                    !dipakaiLain.has(r.ingredient_id),
                );
              return (
                <select
                  value={b.ingredient_id}
                  onChange={(e) => {
                    const s2 = [...baris];
                    s2[i] = { ...s2[i], ingredient_id: e.target.value };
                    setBaris(s2);
                  }}
                  className={inputClass}
                  aria-label={`Bahan baris ${i + 1}`}
                >
                  <option value="">— pilih bahan —</option>
                  {bahanBeli.length > 0 && (
                    <optgroup label="🛒 Bahan beli">
                      {opsi(bahanBeli).map((r) => (
                        <option key={r.ingredient_id} value={r.ingredient_id}>
                          {r.nama} — {r.tersedia_teks}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {bahanProduksi.length > 0 && (
                    <optgroup label="🏭 Bahan produksi">
                      {opsi(bahanProduksi).map((r) => (
                        <option key={r.ingredient_id} value={r.ingredient_id}>
                          {r.nama} — {r.tersedia_teks}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              );
            };

            const inputQty = (i: number, b: BarisTransfer, lebih: boolean, lebar: string) => (
              <input
                type="text"
                min="0.0001"
                step="any"
                inputMode="decimal"
                value={b.qty}
                onChange={(e) => {
                  const s2 = [...baris];
                  s2[i] = { ...s2[i], qty: e.target.value };
                  setBaris(s2);
                }}
                className={`${lebar} rounded-lg border px-2 py-2 text-right text-sm focus:outline-none ${
                  lebih
                    ? "border-red-400 bg-red-50 focus:border-red-500"
                    : "border-stone-300 focus:border-orange-500"
                }`}
                placeholder="0"
                aria-label={`Jumlah kirim baris ${i + 1}`}
              />
            );

            const tombolHapus = (i: number, teks: string) =>
              baris.length > 1 && (
                <button
                  type="button"
                  onClick={() => setBaris(baris.filter((_, j) => j !== i))}
                  className="text-sm font-medium text-red-500 hover:underline"
                  aria-label={`Hapus baris ${i + 1}`}
                >
                  {teks}
                </button>
              );

            /**
             * Petunjuk kemasan di bawah input: menyebut kelipatannya SEBELUM
             * ditekan Kirim, dan saat salah menyebut angka terdekat yang sah —
             * lebih berguna daripada sekadar "tidak boleh".
             */
            const hintKemasan = (s: TransferStokSaldoRow | undefined, qtyTeks: string) => {
              if (!s?.wajib_kelipatan) return null;
              const kemasan = s.satuan_beli ?? "kemasan";
              const salah = salahKemasan(s, qtyTeks);
              if (!salah) {
                return (
                  <div className="mt-1 text-[11px] text-stone-400">
                    Per {kemasan} — kelipatan {formatAngka(s.isi)} {s.satuan}
                  </div>
                );
              }
              return (
                <div className="mt-1 text-[11px] font-medium text-red-600">
                  Harus kelipatan {formatAngka(s.isi)} {s.satuan} (1 {kemasan}) — isi{" "}
                  {salah.bawah > 0 ? `${formatAngka(salah.bawah)} atau ` : ""}
                  {formatAngka(salah.atas)}
                  {salah.sisa < s.isi
                    ? `, atau ${formatAngka(salah.sisa)} untuk kirim habis`
                    : ""}
                  .
                </div>
              );
            };

            // Teks sisa datang dari server (`tersedia_teks`) supaya tampilan web
            // dan mobile memakai satuan yang persis sama.
            const stokTersedia = (s: TransferStokSaldoRow | undefined) => (
              <>
                {s ? s.tersedia_teks : "—"}
                {s?.tersedia_setara && (
                  <div className="text-[11px] font-normal text-stone-400">{s.tersedia_setara}</div>
                )}
                {s && s.dalam_jalan > 0 && (
                  <div className="text-[11px] font-normal text-amber-600">
                    {formatAngka(s.dalam_jalan)} {s.satuan} dalam perjalanan
                  </div>
                )}
              </>
            );

            return (
              <>
                {/* HP: satu kartu per bahan — semua kendali tetap di dalam layar */}
                <div className="mt-4 space-y-3 sm:hidden">
                  {baris.map((b, i) => {
                    const s = saldoById.get(b.ingredient_id);
                    const lebih = s != null && angkaDari(b.qty) > tersediaDari(s) + 1e-9;
                    return (
                      <div key={i} className="rounded-xl border border-stone-200 p-3">
                        {pilihBahan(i, b)}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          {s ? (
                            <BadgeJenis pengadaan={s.pengadaan} />
                          ) : (
                            <span className="text-xs text-stone-400">Bahan belum dipilih</span>
                          )}
                          {tombolHapus(i, "✕ Hapus")}
                        </div>
                        <div className="mt-3 grid grid-cols-2 items-end gap-3">
                          <div>
                            <div className="text-xs text-stone-500">Stok tersedia</div>
                            <div className="tabular-nums text-sm text-stone-700">
                              {stokTersedia(s)}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-stone-500">
                              Jumlah kirim{s?.satuan ? ` (${s.satuan})` : ""}
                            </div>
                            {inputQty(i, b, lebih, "w-full")}
                            {hintKemasan(s, b.qty)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Layar lebar: tabel seperti semula */}
                <div className="mt-4 hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                        <th className="pb-2">Bahan baku</th>
                        <th className="pb-2">Jenis</th>
                        <th className="pb-2 text-right">Stok tersedia</th>
                        <th className="pb-2 text-right">Jumlah kirim</th>
                        <th className="pb-2">Satuan</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {baris.map((b, i) => {
                        const s = saldoById.get(b.ingredient_id);
                        const lebih = s != null && angkaDari(b.qty) > tersediaDari(s) + 1e-9;
                        return (
                          <tr key={i}>
                            <td className="py-2 pr-2">{pilihBahan(i, b)}</td>
                            <td className="py-2 pr-2">
                              {s ? <BadgeJenis pengadaan={s.pengadaan} /> : "—"}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums text-stone-600">
                              {stokTersedia(s)}
                            </td>
                            <td className="py-2 pr-2 text-right">
                              {inputQty(i, b, lebih, "w-28")}
                              {hintKemasan(s, b.qty)}
                            </td>
                            <td className="py-2 pr-2 text-xs text-stone-500">{s?.satuan ?? ""}</td>
                            <td className="py-2 text-right">{tombolHapus(i, "✕")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
          {saldoLoading ? (
            <div className="mt-2">
              <Spinner />
            </div>
          ) : gagalSaldo ? (
            /*
              KOSONG ≠ TAK TERBACA. Dulu bacaan yang gagal jatuh ke kalimat di
              bawah: "Tidak ada stok siap kirim — isi stok dulu (produksi,
              pembelian, atau stok awal)". Itu dua kesalahan sekaligus —
              menyatakan cabang asal tak punya stok, lalu menyuruh
              memproduksi/membeli barang yang sebenarnya ADA di rak. Sekaligus
              pemilih bahannya kosong tanpa satu kata pun, jadi tak ada
              petunjuk bahwa yang salah adalah bacaannya.
            */
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <div className="text-sm font-semibold text-amber-900">
                ⚠ Stok {namaCabang(asalId)} <b>tidak terbaca</b>
              </div>
              <ErrorText error={gagalSaldo} />
              <div className="text-sm text-amber-900">
                Ini <b>bukan</b> berarti stoknya kosong. Muat ulang halaman sebelum memutuskan
                memproduksi atau membeli — daftar bahan di atas ikut kosong karena bacaan ini,
                bukan karena raknya kosong.
              </div>
            </div>
          ) : saldoRows.length === 0 ? (
            <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-500">
              Tidak ada stok siap kirim di {namaCabang(asalId)} — isi stok dulu (produksi,
              pembelian, atau stok awal).
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setBaris([...baris, { ingredient_id: "", qty: "" }])}
              className="mt-2 text-sm font-medium text-orange-600 hover:underline"
            >
              + Tambah bahan
            </button>
          )}

          <div className="mt-3">
            <label className="mb-1 block text-sm font-medium">Catatan (opsional)</label>
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              maxLength={300}
              placeholder="mis. ganti barang rusak di jalan (kiriman PM-0006)"
              className={inputClass}
            />
          </div>

          {adaQtyLebih && (
            <p className="mt-2 text-sm font-medium text-red-600">
              {/* Bahannya DISEBUT, karena batasnya dihitung atas jumlah semua
                  baris bahan itu — dengan dua baris untuk bahan yang sama, tak
                  ada satu pun baris yang kelihatan salah sendirian. */}
              Jumlah kirim <b>{bahanQtyLebih.join(", ")}</b> melebihi stok tersedia (dihitung
              dari total semua barisnya) — perbaiki dulu.
            </p>
          )}
          {qtyTerbuang.length > 0 && (
            <p className="mt-2 text-sm font-medium text-red-600">
              Jumlah pada <b>{qtyTerbuang.join(", ")}</b> belum terbaca sebagai angka lebih dari
              0 — tulis seperti <b>3</b> atau <b>1,5</b>. Tanpa itu bahannya tidak ikut terkirim.
            </p>
          )}
          <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button
              type="submit"
              disabled={!bisaKirim || kirim.isPending}
              className={`${btnPrimary} w-full whitespace-nowrap sm:w-auto`}
            >
              {kirim.isPending ? "Mengirim…" : "🔄 Kirim Transfer"}
            </button>
            {barisTerisi.length > 0 && (
              <span className="text-sm text-stone-500">
                {barisTerisi.length} bahan → {tujuanId ? namaCabang(tujuanId) : "pilih tujuan"}
              </span>
            )}
            {kirim.isSuccess && !kirim.isPending && (
              <span className="text-sm font-medium text-green-600">
                ✓ Transfer {kirim.data?.nomor} terkirim
              </span>
            )}
          </div>
          <ErrorText error={kirim.error} />
        </form>
      </Card>
      )}

      <h2 className="mb-2 text-lg font-bold text-stone-800">Riwayat Transfer</h2>
      {riwayatLoading ? (
        <Spinner />
      ) : riwayatGagal ? (
        <ErrorText error={riwayatGagal} />
      ) : (riwayat?.rows ?? []).length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada transfer stok.
        </Card>
      ) : (
        <div className="space-y-3">
          {(riwayat?.rows ?? []).map((f) => {
            const badge = BADGE_STATUS[f.status] ?? BADGE_STATUS.menunggu;
            return (
              <Card key={f.faktur_id} className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 px-3 py-2.5 sm:px-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-stone-800">🔄 Transfer</span>
                      {f.nomor && (
                        <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                          {f.nomor}
                        </span>
                      )}
                      <span className="text-sm text-stone-500">
                        {formatTanggalRingkas(f.waktu)} · {formatWaktu(f.waktu)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm text-stone-600">
                      <b>{f.asal_cabang ?? "—"}</b> → <b>{f.tujuan_cabang ?? "—"}</b>
                      {f.dibuat_oleh && (
                        <span className="text-xs text-stone-400"> · oleh {f.dibuat_oleh}</span>
                      )}
                    </div>
                    {f.catatan && <div className="text-xs text-stone-500">{f.catatan}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    {f.status === "menunggu" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Batalkan transfer ${f.nomor ?? ""}? Kiriman ditarik dari Penerimaan cabang tujuan dan masuk Tempat Sampah.`,
                            )
                          )
                            batal.mutate(f.faktur_id);
                        }}
                        disabled={batal.isPending}
                        className="text-xs font-medium text-red-500 hover:underline"
                      >
                        Batalkan
                      </button>
                    )}
                  </div>
                </div>
                {/* HP: item ditumpuk agar tak perlu geser horizontal */}
                <div className="divide-y divide-stone-100 sm:hidden">
                  {f.items.map((it) => (
                    <div
                      key={it.id}
                      className={`px-3 py-2 ${it.status === "ditolak" ? "bg-red-50/60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{it.nama}</span>
                        <span className="shrink-0 tabular-nums text-sm">
                          {it.qty_teks}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <BadgeJenis pengadaan={it.pengadaan} />
                        <span className="text-xs text-stone-500">
                          {(BADGE_STATUS[it.status] ?? BADGE_STATUS.menunggu).label}
                          {it.alasan_tolak && ` · ${it.alasan_tolak}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 text-left text-xs text-stone-500">
                        <th className="px-3 py-1.5">Bahan baku</th>
                        <th className="px-3 py-1.5">Jenis</th>
                        <th className="px-3 py-1.5 text-right">Jumlah</th>
                        <th className="px-3 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {f.items.map((it) => (
                        <tr key={it.id} className={it.status === "ditolak" ? "bg-red-50/60" : ""}>
                          <td className="px-3 py-1.5 font-medium">{it.nama}</td>
                          <td className="px-3 py-1.5">
                            <BadgeJenis pengadaan={it.pengadaan} />
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {it.qty_teks}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-stone-500">
                            {(BADGE_STATUS[it.status] ?? BADGE_STATUS.menunggu).label}
                            {it.alasan_tolak && ` · ${it.alasan_tolak}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
          <ErrorText error={batal.error} />
        </div>
      )}
    </div>
  );
}
