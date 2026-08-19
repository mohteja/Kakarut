import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BackupStatusDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, SpinnerAtauGalat, btnPrimary } from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { api, loadAuth } from "../../lib/api";

/**
 * DASBOR PENCADANGAN DATABASE (super admin). Sebelumnya menumpang di bawah
 * halaman Sistem & Migrasi; dipisah supaya punya tempat sendiri di sidebar —
 * cadangan adalah hal yang dicari saat panik, bukan saat menelusuri halaman.
 */

const fmtWaktu = (iso: string, zona?: string) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zona || "Asia/Jakarta",
  }).format(new Date(iso));

function fmtUkuran(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "3 jam lagi" / "12 menit lagi" — jadwal berikutnya lebih mudah dibaca begini. */
function jarakWaktu(iso: string): string {
  const menit = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  if (menit < 60) return `${menit} menit lagi`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa ? `${jam} jam ${sisa} menit lagi` : `${jam} jam lagi`;
}

function InfoCard({
  label,
  value,
  sub,
  ok,
}: {
  label: string;
  value: string;
  sub?: string;
  ok?: boolean;
}) {
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
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </Card>
  );
}

export function BackupPage() {
  const queryClient = useQueryClient();
  const [pesan, setPesan] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
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

  if (!data) return <SpinnerAtauGalat error={error} apa="Status cadangan" />;

  const jam = `${String(data.jam_lokal).padStart(2, "0")}:00`;
  const gagalTerakhir = data.riwayat.find((b) => b.status === "gagal");
  const suksesTerakhir = data.riwayat.find((b) => b.status === "sukses");
  /*
   * Ambangnya DARI SERVER, bukan dihitung ulang di sini.
   *
   * Halaman ini dulu memakai "> 48 jam" tertulis tangan, sementara server tak
   * punya pendapat apa pun karena belum ada yang mengirim peringatan. Sekarang
   * ada penjaga yang mengirim email pada ambang `BACKUP_ALERT_DAYS`, dan dua
   * angka yang ditulis di dua tempat pasti bergeser: panel hijau sementara
   * email berbunyi (atau sebaliknya) adalah keadaan yang mustahil ditebak
   * penyebabnya oleh yang melihatnya.
   */
  const p = data.peringatan;
  const basi = p.gawat;
  // Peringatan yang tak punya jalan keluar = tak ada peringatan. Ini yang
  // membedakan "sudah dikabari" dari "mengira sudah dikabari".
  const saluranMati = p.ambang_hari > 0 && (!p.email_siap || p.penerima === 0);

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PageTitle>💾 Pencadangan Database</PageTitle>
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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoCard
          label="Jadwal otomatis"
          value={data.aktif ? `Tiap hari ${jam}` : "Nonaktif"}
          sub={data.aktif ? `waktu ${data.zona_waktu}` : "BACKUP_ENABLED=false"}
          ok={data.aktif}
        />
        <InfoCard
          label="Berikutnya"
          value={data.berikutnya ? jarakWaktu(data.berikutnya) : "—"}
          sub={data.berikutnya ? fmtWaktu(data.berikutnya, data.zona_waktu) : undefined}
        />
        <InfoCard
          label="Cadangan terakhir"
          value={data.terakhir_sukses ? fmtWaktu(data.terakhir_sukses, data.zona_waktu) : "Belum ada"}
          sub={suksesTerakhir ? fmtUkuran(suksesTerakhir.ukuran_bytes) : undefined}
          ok={!basi}
        />
        <InfoCard
          label="Tujuan"
          value={data.storage_mode === "r2" ? "Cloudflare R2" : "Disk lokal"}
          sub={`simpan ${data.simpan} terakhir`}
          ok={data.storage_mode === "r2"}
        />
      </div>

      {basi && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          <b>Belum ada cadangan yang segar.</b>{" "}
          {p.umur_jam === null
            ? "Sistem belum pernah punya cadangan sukses."
            : `Cadangan sukses terakhir ${
                p.umur_jam < 48 ? `${p.umur_jam} jam` : `${Math.floor(p.umur_jam / 24)} hari`
              } lalu`}{" "}
          (ambang: {p.ambang_hari} hari). Klik <b>Backup sekarang</b> dan periksa penyebabnya di
          daftar di bawah.
          {p.terakhir_dikirim && (
            <>
              {" "}
              Email peringatan terakhir dikirim {fmtWaktu(p.terakhir_dikirim, data.zona_waktu)}.
            </>
          )}
        </div>
      )}

      {saluranMati && (
        <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <b>Peringatan cadangan tak akan sampai ke siapa pun.</b>{" "}
          {!p.email_siap
            ? "Email belum dikonfigurasi (SMTP kosong & tanpa Resend)."
            : "Tidak ada super admin aktif sebagai penerima."}{" "}
          Halaman ini cuma bekerja pada yang membukanya — dan halaman cadangan biasanya dibuka
          justru setelah cadangan dibutuhkan.
        </div>
      )}

      {gagalTerakhir && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          <b>Cadangan terakhir yang gagal</b> ({fmtWaktu(gagalTerakhir.waktu, data.zona_waktu)}):{" "}
          {gagalTerakhir.error ?? "tanpa keterangan"}
        </div>
      )}

      {data.storage_mode === "local" && (
        <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          Cadangan tersimpan di <b>disk lokal</b> — di kontainer ini bisa hilang saat re-deploy.
          Atur R2 (atau <code>BACKUP_DIR</code> ke volume ter-mount) agar benar-benar aman.
        </div>
      )}

      {pesan && (
        <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{pesan}</div>
      )}
      <ErrorText error={backupSekarang.error} />
      <ErrorText error={hapus.error} />

      <TabelResponsif
        data={data.riwayat}
        kunci={(b) => b.id}
        kosong="Belum ada cadangan. Klik “Backup sekarang” atau tunggu jadwal otomatis."
        kolom={[
          { judul: "Waktu", hp: "judul", sel: (b) => fmtWaktu(b.waktu, data.zona_waktu) },
          { judul: "Pemicu", sel: (b) => (b.pemicu === "otomatis" ? "Otomatis" : "Manual") },
          {
            judul: "Status",
            sel: (b) => (
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
                {b.status === "sukses" ? "Sukses" : b.status === "gagal" ? "Gagal" : "Berjalan"}
              </span>
            ),
          },
          { judul: "Ukuran", sel: (b) => fmtUkuran(b.ukuran_bytes) },
          {
            judul: "Cakupan",
            kelasSel: "text-stone-500",
            sel: (b) =>
              b.jumlah_tabel != null
                ? `${b.jumlah_tabel} tabel · ${b.jumlah_baris?.toLocaleString("id-ID") ?? 0} baris`
                : "—",
          },
          {
            hp: "aksi",
            kelasSel: "whitespace-nowrap text-right",
            sel: (b) => (
              <>
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
                    if (confirm("Hapus cadangan ini? Berkasnya ikut dihapus.")) hapus.mutate(b.id);
                  }}
                  className="ml-3 text-sm font-medium text-stone-400 hover:text-red-600 hover:underline"
                >
                  Hapus
                </button>
              </>
            ),
          },
        ]}
      />

      <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <b>Cara kerja:</b> seluruh tabel database diekspor (JSONL ter-gzip) lalu diunggah ke
        storage cadangan secara privat. Berkas hanya bisa diunduh dari sini. Pemulihan memakai
        perintah <code>npm run db:restore</code> (lihat README). File upload (foto) aman tersimpan
        terpisah di storage sehingga tidak perlu ikut dicadangkan.
        <br />
        <br />
        <b>Jadwalnya {jam} waktu {data.zona_waktu}</b> — dini hari saat outlet tutup, karena ekspor
        penuh membebani database. Zona waktunya mengikuti tenant terbanyak; ubah lewat{" "}
        <code>BACKUP_HOUR</code> / <code>BACKUP_TIMEZONE</code>. Server yang mati melewati jadwalnya
        akan mencadangkan begitu hidup lagi (jaring pengaman 26 jam).
      </div>
    </div>
  );
}
