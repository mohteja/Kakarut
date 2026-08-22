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
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

    const key = `companies/${auth.company_id}/${tujuan}/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { url } = await getStorage().put(key, buffer, file.type);
    return c.json({ url }, 201);
  },
);
