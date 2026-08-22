import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { env } from "../../config/env";
import { type AppEnv } from "../../middleware/auth";
import { lewatiRateLimit, rateLimit } from "../../middleware/rateLimit";
import { getStorage } from "./storage";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * BATAS PER BERKAS SUDAH ADA; BATAS LAJUNYA BELUM.
 *
 * `MAX_SIZE` menjaga SATU permintaan. Yang tak dijaga siapa pun: BERAPA BANYAK
 * permintaan. Terukur terhadap server sungguhan, sebagai KASIR — peran paling
 * rendah yang punya token:
 *
 *     20 unggahan 5 MB berturut-turut → 100 MB dalam 0,81 detik
 *     123 MB/detik  ≈  432 GB/jam dari SATU akun
 *     201 diterima: 20 · 429 ditolak: 0
 *
 * Akibatnya beda menurut penyimpanannya, dan keduanya buruk: di R2 ia tagihan
 * yang tumbuh diam-diam, di penyimpanan lokal ia volume yang penuh — dan saat
 * volumenya penuh yang berhenti bukan cuma unggahan, melainkan basis datanya.
 *
 * Tak ada yang menghapus berkas ini kelak: tak ada kuota per perusahaan, tak
 * ada pembersihan yatim. Jadi satu-satunya pengendali yang tersedia lajunya.
 *
 * DUA EMBER, sama seperti `POST /karyawan/undang`:
 *
 *   · per PENGGUNA — yang menekan tombolnya satu orang, dan dialah yang
 *     bertanggung jawab. 60 per 15 menit longgar untuk pemilik yang sedang
 *     memotret seluruh menunya sekaligus, tapi memupus pemakaian sebagai pipa.
 *   · per PERUSAHAAN — supaya banyak akun dalam satu tenant tak menjumlahkan
 *     jatahnya jadi pipa yang sama besar.
 *
 * Dikunci ke pengguna & perusahaan, BUKAN ke IP: pemanggilnya sudah
 * terautentikasi, dan yang bertanggung jawab atas berkas yang tersimpan adalah
 * akunnya — bukan jaringan tempat ia kebetulan duduk.
 */
const rlUnggah = (mw: ReturnType<typeof rateLimit>) =>
  env.RATE_LIMIT_ENABLED ? mw : lewatiRateLimit;

/** Satu akun tak boleh jadi pipa. */
const batasUnggahPengguna = rlUnggah(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 60,
    key: (c) => `unggah:${c.get("auth").sub}`,
    message: "Terlalu banyak unggahan — coba lagi beberapa menit lagi.",
  }),
);

/** …dan banyak akun dalam satu tenant tak boleh menjumlahkan jatahnya. */
const batasUnggahPerusahaan = rlUnggah(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 300,
    key: (c) => `unggah-co:${c.get("auth").company_id ?? "-"}`,
    message: "Terlalu banyak unggahan dari perusahaan ini — coba lagi beberapa menit lagi.",
  }),
);
/**
 * Tipe yang diterima — dan `image/svg+xml` SENGAJA TIDAK ADA DI SINI.
 *
 * SVG satu-satunya format gambar yang bisa memuat `<script>`, dan berkas
 * unggahan disajikan dari origin yang SAMA dengan aplikasinya (`/uploads/*`).
 * Menambahkannya ke daftar ini berarti tiap pemegang token — termasuk kasir —
 * bisa menaruh skrip yang berjalan di sesi orang lain. Ketiga tipe di bawah
 * raster: browser tak pernah mengeksekusinya.
 *
 * Ada uji yang menjaga daftar ini tetap begitu (`unggahan-hanya-gambar`), sebab
 * hari ini keamanannya bersandar pada ketiadaan satu baris — dan ketiadaan tak
 * meninggalkan jejak yang bisa dibaca orang berikutnya.
 */
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * TANDA TANGAN BYTE, bukan tipe yang diklaim pengirim.
 *
 * `file.type` pada multipart datang dari header yang DITULIS KLIEN. Sebelum
 * pemeriksaan ini, 5 MB byte acak — atau `<svg><script>alert(1)</script></svg>`
 * — tersimpan sebagai `.png` dan dilayani `Content-Type: image/png`; terbukti
 * dengan `file(1)` dan dengan menembak rutenya.
 *
 * Yang MENAHAN akibatnya hari ini dua hal lain: SVG tak ada di `ALLOWED`, dan
 * `secureHeaders` memasang `X-Content-Type-Options: nosniff` pada `/uploads/*`
 * (terukur). Jadi tak ada skrip yang berjalan. Tapi keduanya penjagaan di
 * HILIR; yang di hulu — "isinya memang gambar" — tak pernah diperiksa sama
 * sekali, dan penyimpanannya jadi kanal menaruh data sembarang.
 *
 * Yang diperiksa cuma beberapa byte pertama. Itu memang bukan pengurai gambar,
 * dan tak berpura-pura: berkas yang kepalanya benar tapi badannya rusak tetap
 * lolos. Yang ditegakkan lebih sederhana dan bisa diandalkan — **tipe yang
 * DIKLAIM harus cocok dengan yang TERTULIS di byte-nya**.
 */
function cocokTandaTangan(tipe: string, b: Buffer): boolean {
  if (tipe === "image/png") {
    return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (tipe === "image/jpeg") {
    return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }
  if (tipe === "image/webp") {
    return (
      b.length >= 12 &&
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP"
    );
  }
  return false;
}

export const uploadRoutes = new Hono<AppEnv>().post(
  "/",
  batasUnggahPengguna,
  batasUnggahPerusahaan,
  async (c) => {
    const auth = c.get("auth");
    const q = c.req.query("tujuan");
    const tujuan =
      q === "logo" ? "logo" : q === "bukti" ? "bukti" : q === "resep" ? "resep" : "menu";

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: "Kirim file gambar pada field 'file'" });
    }
    const ext = ALLOWED[file.type];
    if (!ext) {
      throw new HTTPException(400, { message: "Format harus JPEG, PNG, atau WebP" });
    }
    if (file.size > MAX_SIZE) {
      throw new HTTPException(400, { message: "Ukuran maksimal 5 MB" });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Tipe yang DIKLAIM harus cocok dengan yang TERTULIS di byte-nya. Tanpa ini
    // `file.type` cuma keterangan dari pengirim, dan `.png` di nama berkasnya
    // tak menyatakan apa pun tentang isinya.
    if (!cocokTandaTangan(file.type, buffer)) {
      throw new HTTPException(400, {
        message: "Isi berkas bukan gambar JPEG/PNG/WebP yang sah",
      });
    }

    const key = `companies/${auth.company_id}/${tujuan}/${randomUUID()}.${ext}`;
    const { url } = await getStorage().put(key, buffer, file.type);
    return c.json({ url }, 201);
  },
);
