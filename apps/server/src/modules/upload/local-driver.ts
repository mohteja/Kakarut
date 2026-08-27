import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ObjekUnggahan, StorageDriver } from "./storage";
import { hapusBerkasLokal, jalurDalam } from "./jalur-aman";

/** Fallback development: simpan ke disk lokal, disajikan via /uploads/*. */
export class LocalDriver implements StorageDriver {
  readonly mode = "local" as const;

  constructor(private baseDir: string) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<{ url: string }> {
    const filePath = jalurDalam(this.baseDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return { url: `/uploads/${key}` };
  }

  async list(prefix: string): Promise<ObjekUnggahan[]> {
    const akar = jalurDalam(this.baseDir, prefix);
    const out: ObjekUnggahan[] = [];
    const jalanKe = async (dir: string): Promise<void> => {
      let isi;
      try {
        isi = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // prefix belum pernah ditulis — daftar kosong, bukan galat
      }
      for (const e of isi) {
        const penuh = join(dir, e.name);
        if (e.isDirectory()) {
          await jalanKe(penuh);
        } else if (e.isFile()) {
          const s = await stat(penuh).catch(() => null);
          out.push({
            key: relative(this.baseDir, penuh).split("\\").join("/"),
            waktu: s ? s.mtime : null,
          });
        }
      }
    };
    await jalanKe(akar);
    return out;
  }

  async hapus(key: string): Promise<void> {
    await hapusBerkasLokal(this.baseDir, key);
  }
}
