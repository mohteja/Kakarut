import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TemuanSetelanDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, SpinnerAtauGalat, btnPrimary } from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { api } from "../../lib/api";

interface MigrationEntry {
  tag: string;
  dibuat: string | null;
  status: "terpasang" | "menunggu";
}

interface SistemStatus {
  database_ok: boolean;
  storage_mode: "r2" | "local";
  node_version: string;
  migrations: {
    total: number;
    terpasang: number;
    menunggu: number;
    terakhir_diterapkan: string | null;
    daftar: MigrationEntry[];
  };
  pemeriksaan: TemuanSetelanDto[];
  // `email_percobaan` ikut datang di balasan yang sama, tapi dibaca di
  // `RiwayatEmailPage` — halaman ini tak lagi menampilkannya.
}


function InfoCard({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div
        className={`mt-1 text-lg font-bold ${
          ok === undefined ? "text-stone-800" : ok ? "text-green-600" : "text-red-600"
        }`}
      >
        {value}
      </div>
    </Card>
  );
}

export function SistemPage() {
  const queryClient = useQueryClient();
  const { data: sistem, isLoading, error } = useQuery({
    queryKey: ["admin-sistem"],
    queryFn: () => api<SistemStatus>("/admin/sistem"),
  });

  const jalankan = useMutation({
    mutationFn: () => api("/admin/sistem/migrate", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-sistem"] }),
  });

  if (!sistem) return <SpinnerAtauGalat error={error} apa="Status sistem" />;

  const m = sistem.migrations;
  const temuan = sistem.pemeriksaan ?? [];

  return (
    <div className="max-w-3xl">
      <PageTitle>Sistem &amp; Migrasi Database</PageTitle>

      {/*
        Temuan ditaruh PALING ATAS, sebelum kartu status.
        Semuanya berbentuk sama: setelannya sah, servernya menyala tanpa
        keluhan, dan salahnya baru ketahuan berbulan-bulan kemudian. Yang
        seperti itu tak boleh diletakkan di bawah tabel migrasi.
      */}
      {temuan.length > 0 && (
        <div className="mb-5 space-y-2">
          {temuan.map((t) => (
            <div
              key={t.kode}
              className={`rounded-lg px-4 py-3 text-sm ${
                t.tingkat === "kritis"
                  ? "bg-red-50 text-red-800"
                  : "bg-yellow-50 text-yellow-800"
              }`}
            >
              <div className="font-bold">
                {t.tingkat === "kritis" ? "⛔" : "⚠️"} {t.judul}
              </div>
              <div className="mt-1">{t.rincian}</div>
              <div className="mt-1 font-semibold">→ {t.tindakan}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoCard
          label="Database"
          value={sistem.database_ok ? "Terhubung" : "Bermasalah"}
          ok={sistem.database_ok}
        />
        <InfoCard
          label="Storage Upload"
          value={sistem.storage_mode === "r2" ? "Cloudflare R2" : "Disk lokal"}
        />
        <InfoCard label="Migrasi Terpasang" value={`${m.terpasang} / ${m.total}`} ok={m.menunggu === 0} />
        <InfoCard label="Node.js" value={sistem.node_version} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-stone-500">
          {m.menunggu === 0 ? (
            <>Skema database sudah versi terbaru. Migrasi juga berjalan otomatis setiap server start (AUTO_MIGRATE).</>
          ) : (
            <>
              <b className="text-yellow-700">{m.menunggu} migrasi menunggu</b> — jalankan
              sekarang, atau restart server (migrasi otomatis saat boot).
            </>
          )}
          {m.terakhir_diterapkan && (
            <>
              {" "}
              Terakhir diterapkan:{" "}
              {new Intl.DateTimeFormat("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Jakarta",
              }).format(new Date(m.terakhir_diterapkan))}
            </>
          )}
        </div>
        <button
          onClick={() => jalankan.mutate()}
          disabled={jalankan.isPending || m.menunggu === 0}
          className={btnPrimary}
        >
          {jalankan.isPending ? "Menjalankan…" : "▶ Jalankan Migrasi"}
        </button>
      </div>
      <ErrorText error={jalankan.error} />
      {jalankan.isSuccess && (
        <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          Migrasi berhasil dijalankan.
        </div>
      )}

      <TabelResponsif
        data={m.daftar}
        kunci={(e) => e.tag}
        kosong="Belum ada migrasi terdaftar."
        kolom={[
          {
            judul: "Migrasi",
            hp: "judul",
            kelasSel: "font-mono",
            sel: (e) => <span className="font-mono">{e.tag}</span>,
          },
          {
            judul: "Dibuat",
            sel: (e) =>
              e.dibuat
                ? new Intl.DateTimeFormat("id-ID", {
                    dateStyle: "medium",
                    timeZone: "Asia/Jakarta",
                  }).format(new Date(e.dibuat))
                : "—",
          },
          {
            judul: "Status",
            sel: (e) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  e.status === "terpasang"
                    ? "bg-green-100 text-green-800"
                    : "bg-yellow-100 text-yellow-800"
                }`}
              >
                {e.status === "terpasang" ? "Terpasang" : "Menunggu"}
              </span>
            ),
          },
        ]}
      />

      <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <b>Cara kerja migrasi otomatis:</b> setiap rilis fitur baru menyertakan file migrasi
        di <code>apps/server/drizzle/</code>. Saat versi baru di-deploy, server menerapkan
        migrasi yang belum terpasang secara otomatis saat start (aman dijalankan berulang,
        dilindungi lock antar-instance). Halaman ini untuk memantau &amp; menjalankan manual
        bila diperlukan.
      </div>

    </div>
  );
}
