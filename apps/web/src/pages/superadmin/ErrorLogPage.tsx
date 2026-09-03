import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ErrorLogDetailDto, ErrorLogDto, ErrorLogKelompokRow } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, SpinnerAtauGalat } from "../../components/ui";
import { api } from "../../lib/api";

/**
 * LOG GALAT PLATFORM (super admin). Daftarnya berisi KELOMPOK, bukan baris
 * mentah: 4xx ikut dicatat, jadi satu tombol yang rusak bisa menghasilkan
 * ribuan baris yang sebenarnya satu masalah. Klik kelompok → kronologi
 * kejadiannya (siapa, perusahaan mana, jejak tumpukan).
 */

type Saring = "semua" | "5xx" | "4xx";

const fmtWaktu = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));

/** "2 menit lalu" — untuk galat, "kapan terakhir" lebih penting dari jam persisnya. */
function seberapaLalu(iso: string): string {
  const detik = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (detik < 60) return "baru saja";
  if (detik < 3600) return `${Math.floor(detik / 60)} menit lalu`;
  if (detik < 86400) return `${Math.floor(detik / 3600)} jam lalu`;
  return `${Math.floor(detik / 86400)} hari lalu`;
}

function warnaStatus(status: number): string {
  if (status >= 500) return "bg-red-100 text-red-700";
  if (status === 429) return "bg-purple-100 text-purple-700";
  if (status === 401 || status === 403) return "bg-amber-100 text-amber-800";
  return "bg-stone-200 text-stone-700";
}

function KartuAngka({
  label,
  value,
  nada,
}: {
  label: string;
  value: string | number;
  nada?: "merah" | "kuning";
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold ${
          nada === "merah" ? "text-red-600" : nada === "kuning" ? "text-amber-600" : "text-stone-800"
        }`}
      >
        {value}
      </div>
    </Card>
  );
}

export function ErrorLogPage() {
  const queryClient = useQueryClient();
  const [hari, setHari] = useState(7);
  const [saring, setSaring] = useState<Saring>("5xx");
  const [cari, setCari] = useState("");
  const [dibuka, setDibuka] = useState<string | null>(null);

  /**
   * KOTAK PENCARIAN ADA DI DALAM CABANG `data` DI BAWAH — jadi apa pun yang
   * membuat `data` sesaat `undefined` MENCABUT kotaknya dari DOM, dan fokus
   * ketikan ikut hilang bersamanya. Dulu `cari` masuk langsung ke queryKey
   * tanpa penahan apa pun: satu ketukan tombol = kunci baru = query tanpa
   * cache = `data` undefined = kotaknya lenyap. Praktis kotak ini hanya bisa
   * menerima SATU huruf, lalu pengguna harus mengklik ulang untuk huruf
   * berikutnya — pencariannya ada, tapi tak bisa dipakai.
   *
   * Dua penahan, keduanya pola yang sudah dipakai di repo ini:
   * - ketikan ditunda dulu (`LaporanHargaModal`), jadi mengetik cepat tidak
   *   menembakkan satu request per huruf;
   * - `placeholderData` menahan hasil sebelumnya selama yang baru diambil
   *   (`TambahStokPage`), jadi tak ada satu render pun tanpa `data` — ini yang
   *   benar-benar menyelamatkan fokusnya, sebab menunda saja hanya menggeser
   *   pencabutannya ke 400 ms kemudian.
   *
   * Saringan hari & status ikut kecipratan untungnya: menekan chip tak lagi
   * mengedipkan seluruh halaman jadi spinner.
   */
  const [cariTunda, setCariTunda] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setCariTunda(cari), 400);
    return () => clearTimeout(t);
  }, [cari]);

  const kunci = ["admin-error-log", hari, saring, cariTunda] as const;
  const { data, isFetching, error: gagalMuat } = useQuery({
    queryKey: kunci,
    queryFn: () =>
      api<ErrorLogDto>(
        `/admin/error-log?hari=${hari}${saring === "semua" ? "" : `&status=${saring}`}${
          cariTunda ? `&q=${encodeURIComponent(cariTunda)}` : ""
        }`,
      ),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });

  const bersihkan = useMutation({
    mutationFn: () => api("/admin/error-log", { method: "DELETE" }),
    onSuccess: () => {
      setDibuka(null);
      queryClient.invalidateQueries({ queryKey: ["admin-error-log"] });
    },
  });

  const chip = (aktif: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${
      aktif ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-100"
    }`;

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PageTitle>🚨 Log Galat</PageTitle>
        <button
          onClick={() => {
            if (confirm("Hapus SEMUA baris log galat? Tidak bisa dibatalkan.")) bersihkan.mutate();
          }}
          disabled={bersihkan.isPending}
          className="rounded-lg px-3 py-2 text-sm font-medium text-stone-500 hover:bg-stone-100 hover:text-red-600"
        >
          {bersihkan.isPending ? "Membersihkan…" : "🗑 Bersihkan log"}
        </button>
      </div>

      {!data ? (
        <SpinnerAtauGalat error={gagalMuat} apa="Log galat" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KartuAngka label={`Total ${hari} hari`} value={data.total.toLocaleString("id-ID")} />
            <KartuAngka
              label="Galat server (5xx)"
              value={data.total_5xx.toLocaleString("id-ID")}
              nada={data.total_5xx > 0 ? "merah" : undefined}
            />
            <KartuAngka
              label="Penolakan (4xx)"
              value={data.total_4xx.toLocaleString("id-ID")}
              nada={data.total_4xx > 0 ? "kuning" : undefined}
            />
            <KartuAngka label="Masalah berbeda" value={data.jumlah_kelompok} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(["5xx", "4xx", "semua"] as const).map((s) => (
              <button key={s} onClick={() => setSaring(s)} className={chip(saring === s)}>
                {s === "5xx" ? "Galat server" : s === "4xx" ? "Penolakan" : "Semua"}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-stone-300" />
            {[1, 7, 30].map((h) => (
              <button key={h} onClick={() => setHari(h)} className={chip(hari === h)}>
                {h === 1 ? "24 jam" : `${h} hari`}
              </button>
            ))}
            {/*
              Angka & daftar di layar bisa sesaat milik saringan SEBELUMNYA
              (itulah harga `placeholderData`), jadi katakan saat itu terjadi —
              tanpa penanda ini, hasil lama terlihat seperti jawaban final.
            */}
            {isFetching && <span className="text-xs text-stone-400">Memuat…</span>}
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari pesan / jalur…"
              className="ml-auto w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:w-64"
            />
          </div>

          <ErrorText error={bersihkan.error} />

          {data.rows.length === 0 ? (
            <Card className="p-8 text-center text-stone-500">
              Tidak ada galat pada rentang &amp; saringan ini. 🎉
            </Card>
          ) : (
            <div className="space-y-2">
              {data.rows.map((k) => (
                <BarisKelompok
                  key={k.sidik}
                  k={k}
                  hari={hari}
                  terbuka={dibuka === k.sidik}
                  onToggle={() => setDibuka(dibuka === k.sidik ? null : k.sidik)}
                />
              ))}
            </div>
          )}

          <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <b>Cara membacanya:</b> tiap baris adalah SATU masalah — kejadian dengan status,
            jalur, dan pesan yang sama digabung, jadi angka “×” menunjukkan seberapa sering.
            <b> 5xx</b> hampir selalu bug yang perlu diperbaiki; <b>4xx</b> adalah penolakan yang
            memang disengaja (validasi, izin, tak ditemukan) — jumlahnya yang tiba-tiba melonjak
            justru sering jadi petunjuk pertama ada yang rusak di sisi klien.
            <br />
            <br />
            Log disimpan 30 hari (maksimum 50.000 baris terbaru) lalu dipangkas otomatis. Badan
            request, query string, dan header Authorization <b>tidak</b> ikut dicatat.
          </div>
        </>
      )}
    </div>
  );
}

function BarisKelompok({
  k,
  hari,
  terbuka,
  onToggle,
}: {
  k: ErrorLogKelompokRow;
  hari: number;
  terbuka: boolean;
  onToggle: () => void;
}) {
  const { data, error: detailGagal } = useQuery({
    queryKey: ["admin-error-log-detail", k.sidik, hari],
    queryFn: () => api<ErrorLogDetailDto>(`/admin/error-log/${k.sidik}?hari=${hari}`),
    enabled: terbuka,
  });

  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left hover:bg-stone-50">
        <span
          className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-bold ${warnaStatus(k.status)}`}
        >
          {k.status}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-stone-800">{k.pesan}</span>
          <span className="mt-0.5 block truncate font-mono text-xs text-stone-500">
            {k.metode} {k.jalur_pola}
          </span>
          <span className="mt-1 block text-xs text-stone-500">
            {k.jumlah.toLocaleString("id-ID")}× · terakhir {seberapaLalu(k.terakhir_pada)}
            {k.jumlah_user > 0 && ` · ${k.jumlah_user} akun`}
            {k.jumlah_perusahaan > 0 && ` · ${k.jumlah_perusahaan} perusahaan`}
          </span>
        </span>
        <span className="shrink-0 text-stone-400">{terbuka ? "▲" : "▼"}</span>
      </button>

      {terbuka && (
        <div className="border-t border-stone-200 bg-stone-50 p-3">
          {!data ? (
            <SpinnerAtauGalat error={detailGagal} apa="Rincian galat" />
          ) : (
            <>
              <div className="mb-2 text-xs text-stone-500">
                Pertama {fmtWaktu(k.pertama_pada)} · terakhir {fmtWaktu(k.terakhir_pada)} ·
                menampilkan {data.kejadian.length} kejadian terbaru
              </div>
              <div className="space-y-2">
                {data.kejadian.map((e) => (
                  <div key={e.id} className="rounded-lg bg-white p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-stone-600">
                      <span className="font-semibold text-stone-800">{fmtWaktu(e.waktu)}</span>
                      <span className="font-mono">{e.jalur}</span>
                      {e.user_nama && (
                        <span>
                          👤 {e.user_nama}
                          {e.peran && ` (${e.peran})`}
                        </span>
                      )}
                      {e.perusahaan_nama && <span>🏢 {e.perusahaan_nama}</span>}
                      {e.ip && <span className="text-stone-400">{e.ip}</span>}
                      {/* JENIS PERANGKATNYA, apa adanya. Sudah direkam sejak
                          awal (`error-log.ts`) tapi tak pernah dirender, jadi
                          pertanyaan pertama tiap diagnosis — "ini web atau
                          aplikasi ponsel?" — tak bisa dijawab dari panel ini.
                          Terasa pada 401 sesi mati: barisnya anonim (penolakan
                          terjadi SEBELUM `c.set("auth")`), jadi user-agent satu-
                          satunya penanda yang tersisa. Tak diterjemahkan jadi
                          label ringkas: menebak "Chrome di Android" dari teks
                          ini salah lebih sering daripada yang orang kira, dan
                          tebakan yang salah di alat diagnosis lebih buruk
                          daripada teks panjang. Dipotong CSS, utuhnya di
                          `title`. */}
                      {e.user_agent && (
                        <span
                          title={e.user_agent}
                          className="max-w-[18rem] truncate font-mono text-stone-400"
                        >
                          {e.user_agent}
                        </span>
                      )}
                    </div>
                    {e.stack && (
                      <pre className="mt-2 max-h-56 overflow-auto rounded bg-stone-900 p-2 text-[11px] leading-relaxed text-stone-100">
                        {e.stack}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
