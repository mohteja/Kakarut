import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import type { TemuanSetelanDto } from "@kakarut/shared";
import { db } from "../db/client";
import { users } from "../db/schema";
import { env, r2Configured } from "../config/env";
import { getStorage } from "../modules/upload/storage";
import { getCadanganStorage } from "../modules/upload/backup-storage";
import { getSmtpRow, penyediaEmail } from "../modules/mail/service";
import { pengamatanProxy, type PengamatanProxy } from "./pengamatan-proxy";

/**
 * PEMERIKSAAN SETELAN.
 *
 * Semua yang diperiksa di sini punya satu bentuk yang sama: setelannya SAH,
 * servernya menyala tanpa keluhan, dan yang salah baru ketahuan berbulan-bulan
 * kemudian — saat berkasnya dicari dan tak ada, atau saat akun yang tak pernah
 * diganti passwordnya dipakai orang lain.
 *
 * Itu sebabnya hasilnya tak cukup ditulis ke log boot. Baris log boot dibaca
 * sekali, oleh orang yang saat itu sedang menunggu deploy selesai, lalu tak
 * pernah lagi. Temuan yang sama juga dipulangkan `GET /admin/sistem` supaya
 * ada di tempat orang benar-benar melihatnya.
 */

const KODE_DEFAULT_SUPERADMIN = "SuperAdmin123!";

/**
 * Verdict soal proxy — DIPISAH sebagai fungsi murni supaya bisa diuji tanpa
 * menyalakan server: yang menentukan benar-salahnya adalah aritmetika sederhana
 * atas cacahan, dan justru aritmetika itu yang mudah keliru.
 */
export function nilaiProxy(
  hops: number,
  amatan: PengamatanProxy,
): { kode: string; rincian: string } | null {
  // Sampel terlalu kecil belum bercerita apa pun. Server yang baru menyala
  // hanya melihat beberapa permintaan pertama, dan menuduh berdasarkan itu
  // berarti tiap deploy melahirkan temuan palsu.
  if (amatan.total < 50) return null;
  const rasio = amatan.dengan_xff / amatan.total;

  if (hops === 0 && rasio >= 0.9) {
    return {
      kode: "proxy_hops_terlalu_rendah",
      rincian:
        `${amatan.dengan_xff} dari ${amatan.total} permintaan membawa X-Forwarded-For, ` +
        `tapi TRUST_PROXY_HOPS=0 sehingga header itu diabaikan. Artinya SEMUA pengguna ` +
        `dihitung sebagai satu alamat yang sama: satu orang yang salah password ` +
        `berkali-kali mengunci login untuk semua kasir.`,
    };
  }
  if (hops > 0 && rasio <= 0.1) {
    return {
      kode: "proxy_hops_terlalu_tinggi",
      rincian:
        `Hanya ${amatan.dengan_xff} dari ${amatan.total} permintaan membawa X-Forwarded-For, ` +
        `tapi TRUST_PROXY_HOPS=${hops}. Bila aplikasi memang tak di belakang proxy, klien ` +
        `bisa mengirim header itu sendiri dan alamatnya akan dipercaya — batas percobaan ` +
        `login bisa dilewati dengan mengganti satu header.`,
    };
  }
  // Rantai lebih pendek daripada yang dijanjikan: `ipKlien` jatuh ke X-Real-IP
  // atau alamat koneksi, jadi tidak berbahaya — tapi setelannya tetap salah.
  if (hops > 0 && rasio >= 0.9 && amatan.rantai_terpanjang > 0 && amatan.rantai_terpanjang < hops) {
    return {
      kode: "proxy_hops_lebih_panjang_dari_rantai",
      rincian:
        `TRUST_PROXY_HOPS=${hops}, tapi rantai X-Forwarded-For terpanjang yang pernah ` +
        `terlihat cuma ${amatan.rantai_terpanjang} entri. Setel ke ${amatan.rantai_terpanjang}.`,
    };
  }
  return null;
}

/** Super admin aktif yang passwordnya masih sama dengan `SEED_SUPERADMIN_PASSWORD`. */
async function superAdminBerpasswordBawaan(): Promise<string[]> {
  const baris = await db
    .select({ email: users.email, hash: users.passwordHash })
    .from(users)
    .where(and(eq(users.isSuperAdmin, true), eq(users.isActive, true), isNull(users.deletedAt)));
  // bcrypt sengaja lambat (~100 ms/perbandingan). Jumlah super admin selalu
  // segelintir, dan pemeriksaan ini tidak berada di jalur permintaan panas.
  return baris.filter((b) => bcrypt.compareSync(env.SEED_SUPERADMIN_PASSWORD, b.hash)).map((b) => b.email);
}

export async function periksaSetelan(): Promise<TemuanSetelanDto[]> {
  const temuan: TemuanSetelanDto[] = [];

  /*
   * 1. PASSWORD SUPER ADMIN MASIH BAWAAN.
   *
   * Deployment yang belum pernah di-seed MEMBUAT super admin sendiri saat boot
   * dari SEED_SUPERADMIN_EMAIL/PASSWORD, dan mengatakannya satu kali di log
   * ("segera ganti password"). Baris itu lewat bersama ratusan baris boot lain.
   * Yang tersisa: akun yang bisa mengunduh SELURUH database, dengan password
   * yang tertulis di `config/env.ts`.
   */
  const bawaan = await superAdminBerpasswordBawaan().catch(() => [] as string[]);
  if (bawaan.length > 0) {
    const dariRepo = env.SEED_SUPERADMIN_PASSWORD === KODE_DEFAULT_SUPERADMIN;
    temuan.push({
      kode: "superadmin_password_bawaan",
      tingkat: "kritis",
      judul: `Password super admin masih bawaan (${bawaan.length} akun)`,
      rincian:
        `${bawaan.join(", ")} masih memakai SEED_SUPERADMIN_PASSWORD. ` +
        (dariRepo
          ? "Nilainya adalah bawaan yang tertulis di kode sumber — siapa pun yang pernah melihat repo ini mengetahuinya. "
          : "Nilainya berasal dari variabel lingkungan, jadi ia sama untuk siapa pun yang bisa membaca konfigurasi deploy. ") +
        "Akun ini bisa mengunduh seluruh cadangan database.",
      tindakan: "Masuk sebagai super admin, ganti password lewat menu akun.",
    });
  }

  /*
   * 2. KONFIGURASI R2 SETENGAH JALAN.
   *
   * `r2Configured` menuntut KEEMPAT variabel terisi. Satu yang salah ketik →
   * false → diam-diam jatuh ke disk lokal. Di kontainer, disk lokal hilang pada
   * re-deploy berikutnya, bersama seluruh foto absensi & laporan kebersihan
   * yang diunggah sejak itu. Tak ada galat di titik mana pun.
   */
  const r2Terisi = [
    ["R2_ACCOUNT_ID", env.R2_ACCOUNT_ID],
    ["R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID],
    ["R2_SECRET_ACCESS_KEY", env.R2_SECRET_ACCESS_KEY],
    ["R2_BUCKET", env.R2_BUCKET],
  ] as const;
  const kosong = r2Terisi.filter(([, v]) => !v).map(([k]) => k);
  if (kosong.length > 0 && kosong.length < r2Terisi.length) {
    temuan.push({
      kode: "r2_setengah",
      tingkat: "kritis",
      judul: "Konfigurasi R2 tidak lengkap — upload jatuh ke disk lokal",
      rincian:
        `Sebagian variabel R2 terisi, tapi ${kosong.join(", ")} kosong. Storage otomatis ` +
        "memakai disk lokal, dan di kontainer isinya hilang saat re-deploy berikutnya. " +
        "Tidak ada galat yang muncul saat unggah — berkasnya tersimpan, lalu lenyap.",
      tindakan: `Isi ${kosong.join(", ")}, atau kosongkan semuanya bila memang ingin disk lokal.`,
    });
  }

  /*
   * 3. CADANGAN KE DISK LOKAL.
   *
   * Cadangan yang hilang bersama kontainer yang dicadangkannya bukan cadangan.
   */
  if (env.BACKUP_ENABLED && getCadanganStorage().mode === "local") {
    temuan.push({
      kode: "cadangan_lokal",
      tingkat: "peringatan",
      judul: "Cadangan database tersimpan di disk lokal",
      rincian:
        "Cadangan otomatis aktif, tapi tujuannya disk lokal. Bila server ini berjalan di " +
        "kontainer, cadangannya hilang bersama kontainer yang dicadangkannya — tepat pada " +
        "kejadian yang paling mungkin membuatnya dibutuhkan.",
      tindakan: "Isi R2_BACKUP_BUCKET (atau R2_BUCKET), atau arahkan BACKUP_DIR ke volume ter-mount.",
    });
  }

  /*
   * 4. TAK ADA PENYEDIA EMAIL.
   *
   * Tiga jalur diam-diam mati sekaligus, dan ketiganya `catch {}` supaya
   * permintaannya tetap berhasil: reset password (pengguna diberi tahu "cek
   * email Anda"), verifikasi email pendaftar baru, dan peringatan cadangan.
   */
  if (penyediaEmail(await getSmtpRow().catch(() => null)) === "none") {
    temuan.push({
      kode: "email_mati",
      tingkat: "peringatan",
      judul: "Email belum dikonfigurasi",
      rincian:
        "Tanpa SMTP maupun Resend, reset password dan verifikasi email pendaftar baru " +
        "gagal diam-diam — penggunanya tetap diberi tahu 'cek email Anda'. Peringatan " +
        "cadangan juga tak punya jalan keluar.",
      tindakan: "Isi pengaturan SMTP di panel super admin, atau set RESEND_API_KEY.",
    });
  }

  /*
   * 5. JWT_SECRET BAWAAN. Di produksi ini melempar saat boot, jadi temuan ini
   * hanya muncul di staging/dev — tempat orang paling mudah lupa bahwa token
   * yang ditandatangani di sana bisa dipalsukan siapa saja.
   */
  if (!process.env.JWT_SECRET) {
    temuan.push({
      kode: "jwt_bawaan",
      tingkat: "kritis",
      judul: "JWT_SECRET belum di-set",
      rincian:
        "Server memakai secret development yang tertulis di kode sumber. Siapa pun yang " +
        "mengetahuinya bisa membuat token untuk akun mana pun, termasuk super admin.",
      tindakan: "Set JWT_SECRET ke nilai acak yang panjang, lalu restart.",
    });
  }

  /* 6. Setelan proxy versus yang benar-benar datang. */
  const proxy = nilaiProxy(env.TRUST_PROXY_HOPS, pengamatanProxy());
  if (proxy) {
    temuan.push({
      kode: proxy.kode,
      tingkat: proxy.kode === "proxy_hops_lebih_panjang_dari_rantai" ? "peringatan" : "kritis",
      judul: "TRUST_PROXY_HOPS tak cocok dengan lalu lintas yang masuk",
      rincian: proxy.rincian,
      tindakan: "Sesuaikan TRUST_PROXY_HOPS dengan jumlah proxy yang benar-benar ada di depan aplikasi.",
    });
  }

  return temuan;
}

/**
 * Cetak hasil pemeriksaan ke log boot.
 *
 * Ini SETENGAH dari mekanismenya, bukan seluruhnya: log boot dibaca sekali,
 * oleh orang yang sedang menunggu deploy selesai. Setengah yang lain adalah
 * `GET /admin/sistem`, yang memulangkan temuan yang sama kapan pun ditanya.
 */
export async function laporkanPemeriksaanSetelan(): Promise<void> {
  let temuan: TemuanSetelanDto[];
  try {
    temuan = await periksaSetelan();
  } catch (e) {
    console.warn("Pemeriksaan setelan gagal:", e instanceof Error ? e.message : String(e));
    return;
  }
  if (temuan.length === 0) {
    console.log("Pemeriksaan setelan: tak ada temuan.");
    return;
  }
  for (const t of temuan) {
    const tulis = t.tingkat === "kritis" ? console.error : console.warn;
    tulis(`SETELAN [${t.tingkat.toUpperCase()}] ${t.judul} — ${t.rincian} → ${t.tindakan}`);
  }
}

/**
 * Pemeriksaan pertama sesaat sesudah boot, lalu tiap 6 jam.
 *
 * Diulang, bukan sekali: temuan proxy baru punya arti setelah ada lalu lintas
 * yang cukup, dan password super admin bisa berubah kapan saja — ke arah mana
 * pun.
 */
export function jadwalkanPemeriksaanSetelan(): void {
  setTimeout(() => void laporkanPemeriksaanSetelan(), 90_000).unref();
  setInterval(() => void laporkanPemeriksaanSetelan(), 6 * 3_600_000).unref();
}
