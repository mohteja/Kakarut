import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StorageDriver } from "./storage";
import { jalurDalam } from "./jalur-aman";

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
}
