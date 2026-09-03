import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import type { TemuanSetelanDto } from "@kakarut/shared";
import { db } from "../db/client";
import { users } from "../db/schema";
import { env, r2Configured } from "../config/env";
import { getStorage } from "../modules/upload/storage";
import { getCadanganStorage } from "../modules/upload/backup-storage";
import { getSmtpRow, keadaanEmail, penyediaEmail, type KeadaanEmail } from "../modules/mail/service";
import { tautanEmailDariHeader } from "./base-url";
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
  // RANTAI LEBIH PANJANG daripada yang dijanjikan — dan ini yang paling mudah
  // luput, sebab tak ada yang tampak rusak.
  //
  // `ipKlien` mengambil entri ke-`hops` DARI KANAN. Tiap proxy menambahkan satu
  // entri, jadi `hops` yang benar = panjang rantai. Bila proxy-nya dua
  // (mis. CDN di depan reverse proxy) sementara `hops` masih 1, yang terambil
  // adalah simpul proxy TERDEKAT, bukan pengunjung — alamat yang sah, terlihat
  // wajar di log, dan salah orang.
  //
  // Terukur di production 2026-09-02: SELURUH alamat di panel Log Galat berada
  // di rentang milik satu CDN. Akibatnya bukan cuma kolom log yang keliru —
  // `ipKlien` juga MENGUNCI PEMBATAS LAJU, dan empat embernya berkunci alamat
  // saja (pendaftaran, tamu, reset, verifikasi). Bila semua orang tampak datang
  // dari segelintir simpul yang sama, jatah itu ditanggung bersama oleh
  // perusahaan yang tak berhubungan.
  //
  // Ketiga tuduhan lain tidak menjangkau keadaan ini: `hops` bukan 0, XFF-nya
  // ada, dan rantainya tidak lebih pendek. Tanpa cabang ini setelannya salah
  // tanpa satu pun keluhan.
  if (hops > 0 && rasio >= 0.9 && amatan.rantai_terpanjang > hops) {
    return {
      kode: "proxy_hops_terlalu_rendah_dari_rantai",
      rincian:
        `TRUST_PROXY_HOPS=${hops}, tapi rantai X-Forwarded-For yang masuk sepanjang ` +
        `${amatan.rantai_terpanjang} entri. Artinya alamat yang tercatat adalah PROXY ` +
        `terdekat, bukan pengunjungnya: log galat tak bisa menunjuk perangkat mana, dan ` +
        `pembatas laju yang berkunci alamat saja (pendaftaran, tamu, reset password, ` +
        `verifikasi email) ditanggung bersama oleh semua pemakai di belakang proxy yang ` +
        `sama — satu perusahaan bisa menghabiskan jatah perusahaan lain. ` +
        `Setel ke ${amatan.rantai_terpanjang}.`,
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

/**
 * Verdict soal PENGIRIMAN email — dipisah sebagai fungsi murni dengan alasan
 * yang sama seperti `nilaiProxy`: yang menentukan benar-salahnya adalah aturan
 * sederhana atas beberapa medan, dan justru aturan sederhana itu yang paling
 * mudah salah tanpa ketahuan.
 *
 * Bedanya dengan `email_mati` (temuan 4): di sana penyedianya memang belum
 * ada, di sini penyedianya ADA dan menolak. Panel yang cuma punya temuan
 * pertama akan menampilkan halaman bersih untuk pemasangan yang emailnya sudah
 * mati berhari-hari — persis keadaan yang terukur 2026-09-01.
 */
export function temuanEmailGagal(keadaan: KeadaanEmail | null): TemuanSetelanDto | null {
  // Nol berarti kiriman TERAKHIR berhasil. Melaporkan kegagalan yang sudah
  // pulih mengajari pembacanya mengabaikan panel ini.
  if (!keadaan || keadaan.gagalBeruntun <= 0) return null;
  const kapan = keadaan.gagalPada ? keadaan.gagalPada.toISOString() : "(waktu tak tercatat)";
  const lewat = keadaan.gagalPenyedia ?? "penyedia tak tercatat";
  const galat = keadaan.gagalPesan?.trim() || "(penyedia tak memberi pesan)";
  /*
   * Kiriman sukses terakhir IKUT disebut, dan itu bukan hiasan: "sejak kapan"
   * adalah pertanyaan pertama yang ditanyakan orang yang baru tahu emailnya
   * mati, dan tanpa angka ini jawabannya cuma tebakan. Kosong pun bercerita —
   * artinya pemasangan ini BELUM PERNAH berhasil mengirim satu surat pun.
   */
  const sukses = keadaan.suksesPada
    ? `Kiriman sukses terakhir: ${keadaan.suksesPada.toISOString()}.`
    : "Pemasangan ini BELUM PERNAH berhasil mengirim satu surat pun.";
  return {
    kode: "email_gagal_kirim",
    tingkat: "kritis",
    judul: "Pengiriman email GAGAL",
    rincian:
      `${keadaan.gagalBeruntun} kiriman berturut-turut gagal, terakhir ${kapan} lewat ` +
      `${lewat}. Galat dari penyedia: "${galat}". ${sukses} Selama ini berlangsung, ` +
      "kode verifikasi pendaftar baru dan tautan reset password TIDAK sampai — " +
      "sementara penggunanya tetap menerima jawaban 'cek email Anda', karena " +
      "jawaban yang berbeda akan membocorkan email mana yang terdaftar.",
    tindakan:
      "Baca pesan galat di atas apa adanya — ia datang dari penyedianya, bukan dari aplikasi ini. " +
      "Lalu uji dengan tombol Kirim Test Email di halaman SMTP; angka di sini kembali nol " +
      "begitu satu kiriman berhasil.",
  };
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
   * 4b. PENYEDIANYA ADA, TAPI MENOLAK. Lihat `temuanEmailGagal` di atas untuk
   * kenapa ini temuan tersendiri dan bukan pelebaran temuan 4.
   */
  const emailGagal = temuanEmailGagal(await keadaanEmail().catch(() => null));
  if (emailGagal) temuan.push(emailGagal);

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

  /*
   * 6. TAUTAN EMAIL DIBANGUN DARI HEADER PERMINTAAN.
   *
   * Tereproduksi 2026-08-26 lewat HTTP: `POST /api/auth/forgot-password`
   * dengan `Host: penyerang.example` memulangkan tautan reset yang menunjuk
   * domain itu — BERIKUT token hidup milik korban. Sama lewat
   * `X-Forwarded-Host`, dengan protonya ikut ditempa jadi `https`.
   *
   * Surat mendarat di kotak masuk korban, tampak sah, dan sekali diklik
   * tokennya berpindah tangan. Itu pengambilalihan akun, bukan phishing.
   */
  if (tautanEmailDariHeader()) {
    temuan.push({
      kode: "tautan_email_dari_header",
      tingkat: "kritis",
      judul: "Tautan email diturunkan dari header permintaan",
      rincian:
        "APP_BASE_URL dan APP_HOST_DIPERCAYA sama-sama kosong, jadi tautan reset password " +
        "dan verifikasi email memakai host dari header permintaan — yang dikendalikan " +
        "peminta. Permintaan reset ber-Host palsu membuat surat korban menunjuk domain " +
        "penyerang, lengkap dengan token yang masih hidup.",
      tindakan:
        "Set APP_BASE_URL ke domain publik aplikasi (mis. https://app.contoh.id), lalu restart. " +
        "Untuk multi-domain, set APP_HOST_DIPERCAYA berisi daftar host yang sah, dipisah koma.",
    });
  }

  /* 7. Setelan proxy versus yang benar-benar datang. */
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
