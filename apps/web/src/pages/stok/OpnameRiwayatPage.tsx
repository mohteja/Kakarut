import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  OpnamePerlengkapanDetail,
  OpnamePerlengkapanSesiRow,
  OpnameSesiDetail,
  OpnameSesiRow,
  OpnameSesiStatus,
  PenyesuaianStatus,
} from "@kakarut/shared";
import { ErrorText, Spinner, SpinnerAtauGalat } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatWaktu } from "../../lib/format";

type JenisOpname = "bahan" | "perlengkapan";

/** Badge status ACC sesi opname. */
function StatusBadge({ status, jumlahSelisih }: { status: OpnameSesiStatus; jumlahSelisih: number }) {
  const map: Record<OpnameSesiStatus, { teks: string; kelas: string }> = {
    cocok: { teks: "Semua cocok", kelas: "bg-green-100 text-green-800" },
    menunggu: {
      teks: `Menunggu ACC${jumlahSelisih ? ` · ${jumlahSelisih} selisih` : ""}`,
      kelas: "bg-yellow-100 text-yellow-800",
    },
    disetujui: { teks: "Disetujui ✓", kelas: "bg-blue-100 text-blue-800" },
    ditolak: { teks: "Ditolak", kelas: "bg-red-100 text-red-700" },
  };
  const b = map[status];
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${b.kelas}`}>
      {b.teks}
    </span>
  );
}

/** Badge status ACC per BARIS opname (per produk). */
function BarisStatusBadge({ status }: { status: PenyesuaianStatus }) {
  const map: Record<PenyesuaianStatus, { teks: string; kelas: string }> = {
    menunggu: { teks: "Menunggu ACC", kelas: "bg-yellow-100 text-yellow-800" },
    disetujui: { teks: "Disetujui ✓", kelas: "bg-green-100 text-green-800" },
    ditolak: { teks: "Ditolak ✕", kelas: "bg-red-100 text-red-700" },
  };
  const b = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.kelas}`}>{b.teks}</span>
  );
}

function DetailSheet({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { data, error: gagalMuat } = useQuery({
    queryKey: ["opname-sesi", sessionId],
    queryFn: () => api<OpnameSesiDetail>(`/stok/opname/sesi/${sessionId}`),
  });

  /**
   * Setelah ACC/tolak/hapus: segarkan SEMUA yang ikut berubah.
   *
   * Ketiganya mengubah `stock_opnames.penyesuaian_status`, dan status itu
   * dibaca lebih jauh daripada yang tampak:
   *
   *   /stok/exp   — `JOIN stock_opnames … penyesuaian_status = 'disetujui'`
   *   /stok/fifo  — `UNION ALL … FROM stock_opnames` (lot 'opname')
   *
   * Jadi dua layar ikut basi: panel lot mendekati kedaluwarsa di halaman Stok,
   * dan rincian FIFO di Detail Bahan. Keduanya TIDAK terjangkau `["stok"]` —
   * pencocokan awalan React Query membandingkan elemen pertama secara UTUH,
   * jadi `"stok"` tak pernah cocok dengan `"stok-exp"` maupun `"stok-fifo"`.
   *
   * Jebakan yang sama sudah dipelajari dua kali di repo ini: `CatatWasteModal`
   * menyebut `stok-exp` satu per satu, dan pasangan perlengkapan di berkas ini
   * menuliskan alasannya sendiri untuk `perlengkapan-master`. Sisi bahan baku
   * belum ikut — padahal ia yang justru punya kedua layar itu.
   */
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["opname-riwayat"] });
    queryClient.invalidateQueries({ queryKey: ["opname-sesi", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["stok"] });
    queryClient.invalidateQueries({ queryKey: ["kartu-stok"] });
    queryClient.invalidateQueries({ queryKey: ["stok-exp"] });
    queryClient.invalidateQueries({ queryKey: ["stok-fifo"] });
  };

  // ACC/Tolak menerima daftar id baris. Kosong = semua sisa (bulk). Modal TETAP
  // terbuka agar owner/admin bisa ACC sebagian & Tolak sebagian dalam satu sesi.
  const acc = useMutation({
    mutationFn: (ids?: string[]) =>
      api(`/stok/opname/sesi/${sessionId}/acc`, {
        method: "POST",
        body: ids && ids.length ? { ids } : {},
      }),
    onSuccess: invalidate,
  });
  const tolak = useMutation({
    mutationFn: (arg: { ids?: string[]; alasan: string | null }) =>
      api(`/stok/opname/sesi/${sessionId}/tolak`, {
        method: "POST",
        body: { ...(arg.ids && arg.ids.length ? { ids: arg.ids } : {}), alasan: arg.alasan },
      }),
    onSuccess: invalidate,
  });
  const hapus = useMutation({
    mutationFn: () => api(`/stok/opname/sesi/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const sibuk = acc.isPending || tolak.isPending || hapus.isPending;

  const sisaMenunggu =
    data?.items.filter((i) => Math.abs(i.selisih ?? 0) > 1e-9 && i.penyesuaian_status === "menunggu")
      .length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-800">Detail Opname</h2>
          <button onClick={onClose} className="text-stone-400">✕</button>
        </div>
        {/* `isLoading` sengaja tidak dipakai: bacaan yang GAGAL berakhir
            `isLoading === false` DAN `data === undefined`, jadi syarat lama
            tetap benar dan spinnernya berputar selamanya. */}
        {!data ? (
          <SpinnerAtauGalat error={gagalMuat} apa="Detail opname" />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                {data.nomor && (
                  <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {data.nomor}
                  </span>
                )}
                <span>
                  {formatWaktu(data.waktu)} · {data.oleh ?? "—"}
                  {data.catatan && ` · ${data.catatan}`}
                </span>
              </div>
              <StatusBadge
                status={data.status}
                jumlahSelisih={data.items.filter((i) => Math.abs(i.selisih ?? 0) > 1e-9).length}
              />
            </div>
            {bolehUbah && sisaMenunggu > 0 && (
              <div className="mb-3 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                <b>ACC per produk</b>: setujui yang benar, tolak yang meragukan. Hanya baris yang
                di-<b>ACC</b> yang diterapkan ke stok.
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-1">Bahan</th>
                  <th className="py-1 text-right">Sistem</th>
                  <th className="py-1 text-right">Fisik</th>
                  <th className="py-1 text-right">Selisih</th>
                  <th className="py-1 text-center">Bukti</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.items.map((it) => {
                  const sel = it.selisih ?? 0;
                  const adaSelisih = Math.abs(sel) >= 1e-9;
                  return (
                    <Fragment key={it.id}>
                      <tr>
                        <td className="py-1.5 pr-2">
                          {it.nama} <span className="text-stone-400">{it.satuan}</span>
                          {it.alasan && (
                            <div className="text-xs italic text-stone-500">“{it.alasan}”</div>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-stone-500">
                          {it.system_qty != null ? formatAngka(it.system_qty) : "—"}
                        </td>
                        <td className="py-1.5 text-right font-medium">{formatAngka(it.qty_fisik)}</td>
                        <td
                          className={`py-1.5 text-right font-semibold ${
                            !adaSelisih
                              ? "text-green-600"
                              : sel > 0
                                ? "text-yellow-700"
                                : "text-red-600"
                          }`}
                        >
                          {!adaSelisih ? "0" : `${sel > 0 ? "+" : ""}${formatAngka(sel)}`}
                        </td>
                        <td className="py-1.5 text-center">
                          {it.foto_url ? (
                            <a href={it.foto_url} target="_blank" rel="noreferrer" title="Lihat bukti foto">
                              <img
                                src={it.foto_url}
                                alt="bukti"
                                className="mx-auto h-8 w-8 rounded object-cover ring-1 ring-stone-200"
                              />
                            </a>
                          ) : adaSelisih ? (
                            <span className="text-xs text-stone-300">—</span>
                          ) : null}
                        </td>
                      </tr>
                      {/* Baris aksi per produk — hanya bila ada selisih */}
                      {adaSelisih && (
                        <tr>
                          <td colSpan={5} className="pb-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <BarisStatusBadge status={it.penyesuaian_status} />
                              {it.penyesuaian_status === "ditolak" && it.tolak_alasan && (
                                <span className="text-xs italic text-red-500">
                                  “{it.tolak_alasan}”
                                </span>
                              )}
                              {bolehUbah && (
                                <div className="ml-auto flex gap-1.5">
                                  <button
                                    onClick={() => acc.mutate([it.id])}
                                    disabled={sibuk || it.penyesuaian_status === "disetujui"}
                                    className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                                      it.penyesuaian_status === "disetujui"
                                        ? "bg-green-600 text-white"
                                        : "border border-green-300 text-green-700 hover:bg-green-50"
                                    }`}
                                  >
                                    ✅ ACC
                                  </button>
                                  <button
                                    onClick={() => tolak.mutate({ ids: [it.id], alasan: null })}
                                    disabled={sibuk || it.penyesuaian_status === "ditolak"}
                                    className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                                      it.penyesuaian_status === "ditolak"
                                        ? "bg-red-600 text-white"
                                        : "border border-red-300 text-red-600 hover:bg-red-50"
                                    }`}
                                  >
                                    ❌ Tolak
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* ACC/Tolak SENGAJA membiarkan modal terbuka supaya sebagian bisa
                disetujui & sebagian ditolak dalam satu sesi. Konsekuensinya:
                bila permintaannya gagal, tak ada satu pun yang berubah di layar
                — persis sama dengan "belum diklik". Galatnya harus terlihat.
                Yang paling sering muncul di sini bukan gangguan jaringan
                melainkan "Sesi tidak ditemukan / sudah ditinjau": rekan lain
                sudah meninjau sesi yang sama dari perangkat lain. Tanpa pesan
                itu, owner menekan ACC, tak melihat apa-apa, lalu menutup modal
                dengan keyakinan selisih stoknya sudah dibukukan. */}
            <ErrorText error={acc.error ?? tolak.error ?? hapus.error} />
            {/* Aksi massal + Hapus — HANYA owner/admin */}
            {bolehUbah && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
                {sisaMenunggu > 0 && (
                  <>
                    <button
                      onClick={() => acc.mutate(undefined)}
                      disabled={sibuk}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      ✅ ACC semua sisa ({sisaMenunggu})
                    </button>
                    <button
                      onClick={() => {
                        const alasan = window.prompt("Tolak semua sisa? (alasan opsional)", "");
                        if (alasan !== null) tolak.mutate({ ids: undefined, alasan: alasan.trim() || null });
                      }}
                      disabled={sibuk}
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      ❌ Tolak sisa
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Hapus riwayat opname ini? Bila sudah disetujui, stok kembali seperti sebelum opname.",
                      )
                    )
                      hapus.mutate();
                  }}
                  disabled={sibuk}
                  className="ml-auto text-sm font-medium text-stone-400 hover:text-red-600 disabled:opacity-50"
                >
                  🗑 Hapus
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Badge status ACC sesi opname perlengkapan (menunggu/disetujui/ditolak). */
function StatusBadgePerl({ status, jumlah }: { status: PenyesuaianStatus; jumlah: number }) {
  const map: Record<PenyesuaianStatus, { teks: string; kelas: string }> = {
    menunggu: {
      teks: `Menunggu ACC${jumlah ? ` · ${jumlah} selisih` : ""}`,
      kelas: "bg-yellow-100 text-yellow-800",
    },
    disetujui: { teks: "Disetujui ✓", kelas: "bg-blue-100 text-blue-800" },
    ditolak: { teks: "Ditolak", kelas: "bg-red-100 text-red-700" },
  };
  const b = map[status];
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${b.kelas}`}>
      {b.teks}
    </span>
  );
}

/** Lembar detail sesi opname PERLENGKAPAN + ACC/Tolak/Hapus (owner/admin). */
function DetailSheetPerl({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { data, error: gagalMuat } = useQuery({
    queryKey: ["perlengkapan-opname", "sesi", sessionId],
    queryFn: () => api<OpnamePerlengkapanDetail>(`/perlengkapan/opname/sesi/${sessionId}`),
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-opname"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
    queryClient.invalidateQueries({ queryKey: ["kartu-perlengkapan"] });
    // ACC opname membukukan selisihnya ke saldo — halaman MASTER Perlengkapan
    // menampilkan saldo itu per cabang. ["perlengkapan"] di atas tidak
    // menjangkaunya: pencocokan awalan membandingkan elemen pertama secara utuh.
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-master"] });
  };
  const aksi = useMutation({
    mutationFn: (jenis: "acc" | "tolak" | "hapus") =>
      jenis === "hapus"
        ? api(`/perlengkapan/opname/sesi/${sessionId}`, { method: "DELETE" })
        : api(`/perlengkapan/opname/sesi/${sessionId}/${jenis}`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const sibuk = aksi.isPending;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-800">Detail Opname Perlengkapan</h2>
          <button onClick={onClose} className="text-stone-400">✕</button>
        </div>
        {/* `isLoading` sengaja tidak dipakai: bacaan yang GAGAL berakhir
            `isLoading === false` DAN `data === undefined`, jadi syarat lama
            tetap benar dan spinnernya berputar selamanya. */}
        {!data ? (
          <SpinnerAtauGalat error={gagalMuat} apa="Detail opname perlengkapan" />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                {data.nomor && (
                  <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {data.nomor}
                  </span>
                )}
              </div>
              <StatusBadgePerl status={data.status} jumlah={data.rows.length} />
            </div>
            {data.status === "menunggu" && (
              <div className="mb-3 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                Stok <b>belum berubah</b>. Owner/admin meng-<b>ACC</b> agar selisih diterapkan, atau{" "}
                <b>Tolak</b> untuk membuang hitungan ini.
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-1">Perlengkapan</th>
                  <th className="py-1 text-right">Sistem</th>
                  <th className="py-1 text-right">Fisik</th>
                  <th className="py-1 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.rows.map((it) => (
                  <tr key={it.supply_id}>
                    <td className="py-1.5 pr-2">
                      {it.nama} <span className="text-stone-400">{it.satuan}</span>
                    </td>
                    <td className="py-1.5 text-right text-stone-500">
                      {it.system_qty != null ? formatAngka(it.system_qty) : "—"}
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      {it.qty_fisik != null ? formatAngka(it.qty_fisik) : "—"}
                    </td>
                    <td
                      className={`py-1.5 text-right font-semibold ${
                        it.selisih < 0 ? "text-red-600" : "text-emerald-700"
                      }`}
                    >
                      {it.selisih > 0 ? "+" : ""}
                      {formatAngka(it.selisih)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Modal hanya menutup saat berhasil, jadi kegagalan meninggalkan
                layar yang sama tanpa sebab apa pun. Sama seperti opname bahan:
                "Sesi tidak ditemukan / sudah ditinjau" adalah jawaban yang
                paling mungkin, dan justru itulah yang perlu dibaca owner. */}
            <ErrorText error={aksi.error} />
            {bolehUbah && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
                {data.status === "menunggu" && (
                  <>
                    <button
                      onClick={() => {
                        if (window.confirm("Setujui opname ini? Stok perlengkapan disesuaikan ke hitungan fisik."))
                          aksi.mutate("acc");
                      }}
                      disabled={sibuk}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      ✅ ACC — terapkan ke stok
                    </button>
                    <button
                      onClick={() => aksi.mutate("tolak")}
                      disabled={sibuk}
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      ❌ Tolak
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Hapus sesi opname ini? Bila sudah disetujui, selisihnya ikut dibatalkan.",
                      )
                    )
                      aksi.mutate("hapus");
                  }}
                  disabled={sibuk}
                  className="ml-auto text-sm font-medium text-stone-400 hover:text-red-600 disabled:opacity-50"
                >
                  🗑 Hapus
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Riwayat sesi opname (mobile-friendly, layar penuh) — bahan baku & perlengkapan. */
export function OpnameRiwayatPage() {
  const { query: branchQuery } = useCabangData();
  const [params, setParams] = useSearchParams();
  const tab: JenisOpname = params.get("tab") === "perlengkapan" ? "perlengkapan" : "bahan";
  const [detail, setDetail] = useState<string | null>(null);
  const [detailPerl, setDetailPerl] = useState<string | null>(null);

  const { data: sesi, isLoading, error: sesiGagal } = useQuery({
    queryKey: ["opname-riwayat", branchQuery],
    queryFn: () => api<OpnameSesiRow[]>(`/stok/opname/riwayat${branchQuery}`),
    enabled: tab === "bahan",
  });
  const { data: sesiPerl, isLoading: loadingPerl, error: sesiPerlGagal } = useQuery({
    queryKey: ["perlengkapan-opname", branchQuery],
    queryFn: () => api<OpnamePerlengkapanSesiRow[]>(`/perlengkapan/opname/riwayat${branchQuery}`),
    enabled: tab === "perlengkapan",
  });

  const gantiTab = (t: JenisOpname) => {
    setDetail(null);
    setDetailPerl(null);
    setParams(t === "perlengkapan" ? { tab: "perlengkapan" } : {}, { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-stone-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 shadow-sm">
        <Link to="/" className="text-2xl text-stone-500" aria-label="Kembali">
          ←
        </Link>
        <div className="flex-1 text-base font-bold text-stone-800">Riwayat Stock Opname</div>
      </header>

      {/* Tab: opname bahan baku vs perlengkapan — riwayat digabung di sini */}
      <div className="sticky top-[57px] z-10 flex gap-1 border-b border-stone-200 bg-white px-3 py-2">
        <button
          onClick={() => gantiTab("bahan")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${
            tab === "bahan" ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600"
          }`}
        >
          🥩 Bahan Baku
        </button>
        <button
          onClick={() => gantiTab("perlengkapan")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${
            tab === "perlengkapan" ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600"
          }`}
        >
          🧰 Perlengkapan
        </button>
      </div>

      <main className="flex-1 space-y-2 p-3">
        {tab === "bahan" ? (
          sesiGagal ? (
            <SpinnerAtauGalat error={sesiGagal} apa="Riwayat opname bahan baku" />
          ) : isLoading ? (
            <Spinner />
          ) : (sesi ?? []).length === 0 ? (
            <div className="py-10 text-center text-sm text-stone-400">
              Belum ada riwayat opname bahan baku.
            </div>
          ) : (
            (sesi ?? []).map((s) => (
              <button
                key={s.session_id}
                onClick={() => setDetail(s.session_id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {s.nomor && (
                      <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                        {s.nomor}
                      </span>
                    )}
                    <span className="font-semibold text-stone-800">{formatWaktu(s.waktu)}</span>
                  </div>
                  <div className="truncate text-sm text-stone-500">
                    {s.oleh ?? "—"} · {s.jumlah_item} bahan
                    {s.catatan ? ` · ${s.catatan}` : ""}
                  </div>
                </div>
                <StatusBadge status={s.status} jumlahSelisih={s.jumlah_selisih} />
              </button>
            ))
          )
        ) : sesiPerlGagal ? (
          <SpinnerAtauGalat error={sesiPerlGagal} apa="Riwayat opname perlengkapan" />
        ) : loadingPerl ? (
          <Spinner />
        ) : (sesiPerl ?? []).length === 0 ? (
          <div className="py-10 text-center text-sm text-stone-400">
            Belum ada riwayat opname perlengkapan.
          </div>
        ) : (
          (sesiPerl ?? []).map((s) => (
            <button
              key={s.session_id}
              onClick={() => setDetailPerl(s.session_id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {s.nomor && (
                    <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                      {s.nomor}
                    </span>
                  )}
                  <span className="font-semibold text-stone-800">{formatWaktu(s.waktu)}</span>
                </div>
                <div className="truncate text-sm text-stone-500">
                  {s.oleh ?? "—"} · {s.jumlah_item} selisih
                </div>
              </div>
              <StatusBadgePerl status={s.status} jumlah={s.jumlah_item} />
            </button>
          ))
        )}
      </main>

      {detail && <DetailSheet sessionId={detail} onClose={() => setDetail(null)} />}
      {detailPerl && <DetailSheetPerl sessionId={detailPerl} onClose={() => setDetailPerl(null)} />}
    </div>
  );
}
