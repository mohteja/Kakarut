import { z } from "zod";

// Muat .env bila ada (Node >= 20.12) — tidak fatal jika tidak ada.
try {
  process.loadEnvFile();
} catch {
  /* .env opsional */
}

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://postgres@127.0.0.1:5433/kakarut"),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("12h"),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  UPLOAD_DIR: z.string().optional(),

  SEED_SUPERADMIN_EMAIL: z.string().default("superadmin@kakarut.id"),
  SEED_SUPERADMIN_PASSWORD: z.string().default("SuperAdmin123!"),
  SEED_OWNER_EMAIL: z.string().default("terahokiindonesia@gmail.com"),
  SEED_OWNER_PASSWORD: z.string().default("Basooopa123!"),
  SEED_KASIR_EMAIL: z.string().default("kasir@basooopa.id"),
  SEED_KASIR_PASSWORD: z.string().default("Kasir123!"),
  SEED_DEMO_STOCK: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
});

const parsed = EnvSchema.parse(process.env);

// JWT_SECRET wajib di produksi — tanpa ini siapa pun bisa memalsukan token.
if (!parsed.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET wajib di-set di produksi (lihat .env.example)");
  }
  console.warn(
    "PERINGATAN: JWT_SECRET belum di-set — memakai secret development. JANGAN dipakai di produksi.",
  );
}

export const env = {
  ...parsed,
  JWT_SECRET: parsed.JWT_SECRET ?? "dev-secret-kakarut-hanya-development",
};

export const r2Configured = Boolean(
  env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET,
);
