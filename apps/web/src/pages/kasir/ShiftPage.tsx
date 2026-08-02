import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Shift } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { ShiftDetailModal } from "../../components/ShiftDetailModal";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

/** Label + warna selisih kas. */
function selisihInfo(selisih: number | null) {
  if (selisih == null) return { label: "—", warna: "text-stone-500" };
  if (Math.abs(selisih) < 0.005) return { label: "Pas", warna: "text-green-600" };
  if (selisih < 0) return { label: `Kurang ${formatRupiah(-selisih)}`, warna: "text-red-600" };
  return { label: `Lebih ${formatRupiah(selisih)}`, warna: "text-amber-600" };
}

/** Rupiah yang menghormati hitung buta: `null` dari server = sengaja ditutup. */
function rp(n: number | null) {
  return n == null ? "•••" : formatRupiah(n);
}

function Stat({ label, value, warna = "text-stone-800" }: { label: string; value: string; warna?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 font-bold ${warna}`}>{value}</div>
    </div>
  );
}

export function ShiftPage() {
  const qc = useQueryClient();
  // Shift kas berjalan per cabang — dari Kantor pilih cabang kasnya.
  const { query: branchQuery } = useCabangData();

  const { data: aktif, isLoading } = useQuery({
    queryKey: ["shift-aktif", branchQuery],
    queryFn: () => api<Shift | null>(`/shift/aktif${branchQuery}`),
    refetchInterval: 30_000,
  });
  const { data: riwayat = [] } = useQuery({
    queryKey: ["shift-riwayat", branchQuery],
    queryFn: () => api<Shift[]>(`/shift${branchQuery}`),
  });

  const [modalAwal, setModalAwal] = useState("");
  const [uangFisik, setUangFisik] = useState("");
  const [catatan, setCatatan] = useState("");
  // Shift yang sedang dilihat detailnya (klik kartu riwayat / shift berjalan).
  const [detailId, setDetailId] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shift-aktif"] });
    qc.invalidateQueries({ queryKey: ["shift-riwayat"] });
  };

  const buka = useMutation({
    mutationFn: () =>
      api(`/shift/buka${branchQuery}`, { method: "POST", body: { modal_awal: Number(modalAwal) || 0 } }),
    onSuccess: () => {
      invalidate();
      setModalAwal("");
    },
  });
  /**
   * KUNCI HITUNGAN — momen "reveal"-nya. Selama shift terbuka & belum dikunci,
   * server tak mengirimkan kas seharusnya sama sekali; angka itu baru muncul
   * setelah nominal fisik dikunci, dan sejak itu tak bisa diubah lagi.
   *
   * Statusnya dibaca dari `aktif.uang_fisik`, bukan dari state React: kalau
   * kasir me-refresh halaman di antara mengunci dan menutup, ia harus mendarat
   * di langkah yang sama — bukan disuruh menghitung ulang.
   */
  const kunci = useMutation({
    mutationFn: () =>
      api(`/shift/kunci-hitungan${branchQuery}`, {
        method: "POST",
        body: { uang_fisik: Number(uangFisik) || 0 },
      }),
    onSuccess: () => invalidate(),
  });
  /** Hasil penutupan, ditahan di layar alih-alih hilang bersama shift. */
  const [hasil, setHasil] = useState<Shift | null>(null);
  const tutup = useMutation({
    mutationFn: () =>
      api<Shift>(`/shift/tutup${branchQuery}`, {
        method: "POST",
        body: { catatan: catatan || null, selisih_alasan: catatan || null },
      }),
    onSuccess: (r) => {
      invalidate();
      setHasil(r);
      setUangFisik("");
      setCatatan("");
    },
  });

  const hasilInfo = selisihInfo(hasil?.selisih ?? null);
  const terkunci = aktif != null && aktif.uang_fisik != null;
  const infoAktif = selisihInfo(aktif?.selisih ?? null);
  // Selisih wajib dijelaskan: catatan inilah satu-satunya konteks yang owner
  // punya saat memutuskan menerima kekurangan/kelebihan kas.
  const perluAlasan = terkunci && Math.abs(aktif!.selisih ?? 0) >= 0.005;

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-2xl">
      <CabangDataBar />
      <PageTitle
        aksi={
          <Link to="/kasir" className={btnSecondary}>
            ← Kasir
          </Link>
        }
      >
        Tutup Kasir
      </PageTitle>

      {!aktif ? (
        <Card className="space-y-3 p-5">
          <div className="text-sm text-stone-500">
            Belum ada shift terbuka di cabang ini. Buka kasir dengan mengisi <b>modal awal</b>{" "}
            (uang tunai di laci saat mulai).
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Modal awal (Rp)</label>
            <input
              /* Pola rupiah rumah ini (lihat "Uang diterima" di KasirPage):
                 state = DIGIT MURNI, tampilan = berkelompok. `type="number"`
                 tak bisa dipakai — Chromium menyimpan "150.000" apa adanya
                 (Number → 150) dan MEMBUANG titik kedua pada "1.500.000"
                 (Number → 1,5). Dua-duanya diam-diam. */
              type="text"
              inputMode="numeric"
              value={modalAwal ? formatAngka(Number(modalAwal), 0) : ""}
              onChange={(e) => setModalAwal(e.target.value.replace(/\D/g, ""))}
              placeholder="mis. 200.000"
              className={inputClass}
            />
          </div>
          <ErrorText error={buka.error} />
          <button onClick={() => buka.mutate()} disabled={buka.isPending} className={btnPrimary}>
            {buka.isPending ? "Membuka…" : "🔓 Buka Kasir"}
          </button>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-800">Shift berjalan</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailId(aktif.id)}
                  className="text-xs font-semibold text-orange-600 hover:underline"
                >
                  Lihat detail
                </button>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                  Terbuka
                </span>
              </div>
            </div>
            <div className="mb-3 text-sm text-stone-500">
              Dibuka oleh <b>{aktif.dibuka_oleh}</b> · {formatTanggalRingkas(aktif.dibuka_pada)}{" "}
              {formatWaktu(aktif.dibuka_pada)}
              {aktif.branch_nama ? ` · ${aktif.branch_nama}` : ""}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Modal awal" value={formatRupiah(aktif.modal_awal)} />
              {/* Hitung buta: angka tunai & kas seharusnya sengaja ditutup
                  sampai hitungan laci dikunci — kalau terlihat lebih dulu,
                  menghitung uang berhenti jadi pemeriksaan. */}
              <Stat label="Penjualan tunai" value={rp(aktif.penjualan_tunai)} />
              <Stat label="Non-tunai" value={formatRupiah(aktif.penjualan_nontunai)} />
              <Stat label="Transaksi" value={`${aktif.jumlah_transaksi}×`} />
              <Stat label="Kas seharusnya" value={rp(aktif.kas_sistem)} warna="text-orange-600" />
            </div>
            {aktif.hitung_buta && (
              <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
                🔒 <b>Hitung dulu, angka menyusul.</b> Kas yang seharusnya ada di laci
                ditutup sampai Anda mengunci hitungan — supaya angka yang Anda laporkan
                benar-benar hasil menghitung.
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-bold text-stone-800">Tutup & setor</h2>

            {/* LANGKAH 1 — hitung & kunci. Tanpa pratinjau selisih apa pun:
                itu akan membocorkan kas seharusnya sebelum uang dihitung. */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                {terkunci ? "Uang tunai fisik (terkunci)" : "Uang tunai fisik di laci (Rp)"}
              </label>
              <input
                /* Hitungan uang laci — salah baca di sini langsung jadi
                   selisih kas yang dituduhkan ke kasir. */
                type="text"
                inputMode="numeric"
                value={
                  terkunci
                    ? // `uang_fisik` nullable di DTO; `terkunci` memang berarti
                      // sudah terisi, tapi jangan mencetak "0" bila ternyata tidak.
                      (aktif.uang_fisik != null ? formatAngka(aktif.uang_fisik, 0) : "")
                    : uangFisik
                      ? formatAngka(Number(uangFisik), 0)
                      : ""
                }
                onChange={(e) => setUangFisik(e.target.value.replace(/\D/g, ""))}
                readOnly={terkunci}
                placeholder="hitung uang fisik lalu isi di sini"
                className={`${inputClass} ${terkunci ? "bg-stone-100 text-stone-600" : ""}`}
              />
            </div>

            {!terkunci ? (
              <>
                <p className="text-xs leading-relaxed text-stone-500">
                  Hitung uang di laci, isi nominalnya, lalu <b>kunci</b>. Setelah dikunci
                  nominal tak bisa diubah lagi — barulah kas seharusnya &amp; selisih
                  ditampilkan.
                </p>
                <ErrorText error={kunci.error} />
                <button
                  onClick={() => kunci.mutate()}
                  disabled={uangFisik === "" || kunci.isPending}
                  className={`${btnPrimary} w-full py-3`}
                >
                  {kunci.isPending ? "Mengunci…" : "🔒 Kunci Hitungan"}
                </button>
              </>
            ) : (
              <>
                {/* LANGKAH 2 — angka terbuka. */}
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Kas seharusnya" value={rp(aktif.kas_sistem)} />
                  <Stat label="Selisih" value={infoAktif.label} warna={infoAktif.warna} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Catatan{" "}
                    <span className="font-normal text-stone-400">
                      {perluAlasan ? "(wajib — jelaskan selisihnya)" : "(opsional)"}
                    </span>
                  </label>
                  <input
                    value={catatan}
                    onChange={(e) => setCatatan(e.target.value)}
                    placeholder={
                      perluAlasan ? "mis. kembalian kurang saat jam ramai" : "mis. setor ke owner"
                    }
                    className={inputClass}
                  />
                  {perluAlasan && (
                    <p className="mt-1 text-xs text-stone-500">
                      Selisih ini akan dikirim ke owner untuk disetujui. Catatan Anda ikut
                      terkirim sebagai keterangannya.
                    </p>
                  )}
                </div>
                <ErrorText error={tutup.error} />
                <button
                  onClick={() => {
                    if (confirm("Tutup kasir sekarang? Shift akan tercatat di riwayat.")) {
                      tutup.mutate();
                    }
                  }}
                  disabled={tutup.isPending || (perluAlasan && catatan.trim() === "")}
                  className={`${btnPrimary} w-full py-3`}
                >
                  {tutup.isPending ? "Menutup…" : "🔒 Tutup Kasir"}
                </button>
              </>
            )}
          </Card>
        </div>
      )}

      {/* REVEAL — angka yang selama shift ditutup, baru dibuka di sini */}
      {hasil && (
        <Card className="mt-5 space-y-3 border-2 border-orange-200 p-5">
          <h2 className="text-lg font-bold text-stone-800">Hasil tutup kasir</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Uang fisik dihitung" value={formatRupiah(hasil.uang_fisik ?? 0)} />
            <Stat label="Kas seharusnya" value={rp(hasil.kas_sistem)} />
            <Stat label="Selisih" value={hasilInfo.label} warna={hasilInfo.warna} />
          </div>
          {hasil.status_selisih === "menunggu" ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-800">
              ⏳ <b>Menunggu persetujuan owner.</b> Selisih ini sudah terkirim beserta
              keterangan Anda. Owner yang memutuskan diterima atau tidak — Anda tak perlu
              melakukan apa-apa lagi.
            </div>
          ) : (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              ✅ <b>Pas.</b> Uang fisik sama dengan kas seharusnya — tak perlu persetujuan.
            </div>
          )}
          <button type="button" onClick={() => setHasil(null)} className={btnSecondary}>
            Tutup
          </button>
        </Card>
      )}

      {/* Riwayat shift */}
      <div className="mt-6">
        <h2 className="mb-2 text-lg font-semibold text-stone-700">Riwayat shift</h2>
        {riwayat.length === 0 ? (
          <Card className="p-6 text-center text-sm text-stone-400">Belum ada shift ditutup.</Card>
        ) : (
          <div className="space-y-2">
            {riwayat.map((s) => {
              const info = selisihInfo(s.selisih);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setDetailId(s.id)}
                  className="block w-full text-left"
                >
                  <Card className="p-3 transition hover:border-orange-300 hover:bg-orange-50/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-stone-800">
                          {formatTanggalRingkas(s.dibuka_pada)} · {formatWaktu(s.dibuka_pada)} –{" "}
                          {s.ditutup_pada ? formatWaktu(s.ditutup_pada) : "—"}
                        </div>
                        <div className="text-xs text-stone-500">
                          🔓 {s.dibuka_oleh || "—"} · 🔒 {s.ditutup_oleh || "—"}
                        </div>
                        <div className="text-xs text-stone-400">
                          {s.jumlah_transaksi}× · tunai {rp(s.penjualan_tunai)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-sm font-bold ${info.warna}`}>{info.label}</div>
                        <div className="text-xs text-stone-400">
                          fisik {formatRupiah(s.uang_fisik ?? 0)}
                        </div>
                        <div className="mt-0.5 text-xs font-medium text-orange-600">Detail ›</div>
                      </div>
                    </div>
                    {s.catatan && <div className="mt-1 text-xs text-stone-500">📝 {s.catatan}</div>}
                  </Card>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ShiftDetailModal shiftId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
