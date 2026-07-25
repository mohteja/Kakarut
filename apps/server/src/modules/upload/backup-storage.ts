import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env, r2Configured } from "../../config/env";
import { localUploadDir } from "./storage";

/** Satu berkas cadangan yang tersimpan di storage. */
export interface CadanganObjek {
  /** kunci objek (R2) atau nama berkas (lokal) — cara mengambil/menghapus */
  key: string;
  ukuran: number;
  /** ISO string waktu tulis; null bila tak diketahui */
  waktu: string | null;
}

/**
 * Penyimpanan CADANGAN — sengaja TERPISAH dari driver upload publik. Cadangan
 * berisi seluruh data platform, jadi selalu PRIVAT: tidak pernah mengembalikan
 * URL publik; unduhan hanya lewat endpoint super admin yang meng-stream isinya.
 * R2 (bila dikonfigurasi) memakai bucket khusus `R2_BACKUP_BUCKET` bila diset,
 * atau bucket upload dengan prefix `backups/`. Fallback: disk lokal `BACKUP_DIR`.
 */
export interface CadanganStorage {
  readonly mode: "r2" | "local";
  simpan(key: string, body: Buffer): Promise<void>;
  daftar(): Promise<CadanganObjek[]>;
  ambil(key: string): Promise<Buffer>;
  hapus(key: string): Promise<void>;
}

const R2_PREFIX = "backups/";

class R2CadanganStorage implements CadanganStorage {
  readonly mode = "r2" as const;
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    this.bucket = env.R2_BACKUP_BUCKET ?? env.R2_BUCKET!;
  }

  // `key` yang dilihat pemanggil selalu nama berkas polos (tanpa prefix);
  // prefix R2 disembunyikan di sini agar konsisten dgn driver lokal.
  async simpan(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: R2_PREFIX + key,
        Body: body,
        ContentType: "application/gzip",
      }),
    );
  }

  async daftar(): Promise<CadanganObjek[]> {
    const out: CadanganObjek[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: R2_PREFIX,
          ContinuationToken: token,
        }),
      );
      for (const o of res.Contents ?? []) {
        if (!o.Key || !o.Key.endsWith(".gz")) continue;
        out.push({
          key: o.Key.slice(R2_PREFIX.length),
          ukuran: o.Size ?? 0,
          waktu: o.LastModified ? o.LastModified.toISOString() : null,
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async ambil(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: R2_PREFIX + key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async hapus(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: R2_PREFIX + key }),
    );
  }
}

class LocalCadanganStorage implements CadanganStorage {
  readonly mode = "local" as const;

  constructor(private baseDir: string) {}

  private jalur(key: string): string {
    // key = nama berkas polos; tolak traversal.
    const p = path.join(this.baseDir, key);
    if (!p.startsWith(this.baseDir)) throw new Error("Kunci cadangan tidak valid");
    return p;
  }

  async simpan(key: string, body: Buffer): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.jalur(key), body);
  }

  async daftar(): Promise<CadanganObjek[]> {
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return []; // folder belum ada
    }
    const out: CadanganObjek[] = [];
    for (const nama of entries) {
      if (!nama.endsWith(".gz")) continue;
      try {
        const s = await stat(path.join(this.baseDir, nama));
        out.push({ key: nama, ukuran: s.size, waktu: s.mtime.toISOString() });
      } catch {
        /* lewati berkas yang menghilang di tengah jalan */
      }
    }
    return out;
  }

  async ambil(key: string): Promise<Buffer> {
    return readFile(this.jalur(key));
  }

  async hapus(key: string): Promise<void> {
    await unlink(this.jalur(key)).catch(() => {
      /* sudah tidak ada — idempoten */
    });
  }
}

export const backupDir =
  env.BACKUP_DIR ?? path.resolve(localUploadDir, "..", "backups");

let cadanganStorage: CadanganStorage | null = null;

export function getCadanganStorage(): CadanganStorage {
  if (!cadanganStorage) {
    cadanganStorage = r2Configured
      ? new R2CadanganStorage()
      : new LocalCadanganStorage(backupDir);
  }
  return cadanganStorage;
}
