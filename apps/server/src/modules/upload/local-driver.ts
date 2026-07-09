import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./storage";

/** Fallback development: simpan ke disk lokal, disajikan via /uploads/*. */
export class LocalDriver implements StorageDriver {
  readonly mode = "local" as const;

  constructor(private baseDir: string) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<{ url: string }> {
    const filePath = path.join(this.baseDir, key);
    if (!filePath.startsWith(this.baseDir)) {
      throw new Error("Key upload tidak valid");
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return { url: `/uploads/${key}` };
  }
}
