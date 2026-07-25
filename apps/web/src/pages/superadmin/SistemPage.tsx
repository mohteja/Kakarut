import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BackupStatusDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  tdClass,
  thClass,
} from "../../components/ui";
import { api, loadAuth } from "../../lib/api";

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
  const { data: sistem, isLoading } = useQuery({
    queryKey: ["admin-sistem"],
    queryFn: () => api<SistemStatus>("/admin/sistem"),
  });

  const jalankan = useMutation({
    mutationFn: () => api("/admin/sistem/migrate", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-sistem"] }),
  });

  if (isLoading || !sistem) return <Spinner />;

  const m = sistem.migrations;

  return (
    <div className="max-w-3xl">
      <PageTitle>Sistem &amp; Migrasi Database</PageTitle>

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

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Migrasi</th>
              <th className={thClass}>Dibuat</th>
              <th className={thClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {m.daftar.map((e) => (
              <tr key={e.tag}>
                <td className={`${tdClass} font-mono`}>{e.tag}</td>
                <td className={tdClass}>
                  {e.dibuat
                    ? new Intl.DateTimeFormat("id-ID", {
                        dateStyle: "medium",
                        timeZone: "Asia/Jakarta",
                      }).format(new Date(e.dibuat))
                    : "—"}
                </td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      e.status === "terpasang"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {e.status === "terpasang" ? "Terpasang" : "Menunggu"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <b>Cara kerja migrasi otomatis:</b> setiap rilis fitur baru menyertakan file migrasi
        di <code>apps/server/drizzle/</code>. Saat versi baru di-deploy, server menerapkan
        migrasi yang belum terpasang secara otomatis saat start (aman dijalankan berulang,
        dilindungi lock antar-instance). Halaman ini untuk memantau &amp; menjalankan manual
        bila diperlukan.
      </div>

      <BackupSection />
    </div>
  );
}

const fmtWaktu = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));

function fmtUkuran(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Panel Pencadangan (backup) database — riwayat, backup manual, unduh, hapus. */
function BackupSection() {
  const queryClient = useQueryClient();
  const [pesan, setPesan] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-backup"],
    queryFn: () => api<BackupStatusDto>("/admin/sistem/backup"),
    refetchInterval: 15_000,
  });

  const backupSekarang = useMutation({
    mutationFn: () => api("/admin/sistem/backup", { method: "POST" }),
    onSuccess: () => {
      setPesan("Cadangan berhasil dibuat.");
      queryClient.invalidateQueries({ queryKey: ["admin-backup"] });
    },
  });

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/admin/sistem/backup/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-backup"] }),
  });

  // Unduh berkas cadangan: fetch ber-token → blob → picu unduhan browser.
  async function unduh(id: string, nama: string | null) {
    const token = loadAuth()?.token;
    const res = await fetch(`/api/admin/sistem/backup/${id}/unduh`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setPesan("Gagal mengunduh cadangan.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nama ?? `cadangan-${id}.jsonl.gz`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-800">💾 Pencadangan Database</h2>
        <button
          onClick={() => {
            setPesan(null);
            backupSekarang.mutate();
          }}
          disabled={backupSekarang.isPending}
          className={btnPrimary}
        >
          {backupSekarang.isPending ? "Mencadangkan…" : "＋ Backup sekarang"}
        </button>
      </div>

      {isLoading || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <InfoCard
              label="Otomatis"
              value={data.aktif ? `Tiap ${data.selang_jam} jam` : "Nonaktif"}
              ok={data.aktif}
            />
            <InfoCard label="Simpan" value={`${data.simpan} terakhir`} />
            <InfoCard
              label="Tujuan"
              value={data.storage_mode === "r2" ? "Cloudflare R2" : "Disk lokal"}
            />
            <InfoCard
              label="Cadangan terakhir"
              value={data.terakhir_sukses ? fmtWaktu(data.terakhir_sukses) : "Belum ada"}
              ok={data.terakhir_sukses ? true : undefined}
            />
          </div>

          {data.storage_mode === "local" && (
            <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
              Cadangan tersimpan di <b>disk lokal</b> — di kontainer ini bisa hilang saat
              re-deploy. Atur R2 (atau <code>BACKUP_DIR</code> ke volume ter-mount) agar
              benar-benar aman.
            </div>
          )}

          {pesan && (
            <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              {pesan}
            </div>
          )}
          <ErrorText error={backupSekarang.error} />
          <ErrorText error={hapus.error} />

          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={thClass}>Waktu</th>
                  <th className={thClass}>Pemicu</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Ukuran</th>
                  <th className={thClass}>Cakupan</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.riwayat.map((b) => (
                  <tr key={b.id}>
                    <td className={tdClass}>{fmtWaktu(b.waktu)}</td>
                    <td className={tdClass}>
                      {b.pemicu === "otomatis" ? "Otomatis" : "Manual"}
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          b.status === "sukses"
                            ? "bg-green-100 text-green-800"
                            : b.status === "gagal"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-800"
                        }`}
                        title={b.error ?? undefined}
                      >
                        {b.status === "sukses"
                          ? "Sukses"
                          : b.status === "gagal"
                            ? "Gagal"
                            : "Berjalan"}
                      </span>
                    </td>
                    <td className={tdClass}>{fmtUkuran(b.ukuran_bytes)}</td>
                    <td className={`${tdClass} text-stone-500`}>
                      {b.jumlah_tabel != null
                        ? `${b.jumlah_tabel} tabel · ${b.jumlah_baris?.toLocaleString("id-ID") ?? 0} baris`
                        : "—"}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right`}>
                      {b.bisa_unduh && (
                        <button
                          onClick={() => unduh(b.id, b.object_key)}
                          className="text-sm font-medium text-orange-600 hover:underline"
                        >
                          ⬇ Unduh
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm("Hapus cadangan ini? Berkasnya ikut dihapus."))
                            hapus.mutate(b.id);
                        }}
                        className="ml-3 text-sm font-medium text-stone-400 hover:text-red-600 hover:underline"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
                {data.riwayat.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-stone-400">
                      Belum ada cadangan. Klik “Backup sekarang” atau tunggu jadwal otomatis.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <div className="mt-3 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <b>Cara kerja:</b> seluruh tabel database diekspor (JSONL ter-gzip) lalu diunggah
            ke storage cadangan secara privat. Berkas hanya bisa diunduh dari sini. Pemulihan
            memakai perintah <code>npm run db:restore</code> (lihat README). File upload (foto)
            aman tersimpan terpisah di storage sehingga tidak perlu ikut dicadangkan.
          </div>
        </>
      )}
    </div>
  );
}
