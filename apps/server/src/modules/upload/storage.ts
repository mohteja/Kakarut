import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, r2Configured } from "../../config/env";
import { LocalDriver } from "./local-driver";
import { R2Driver } from "./r2-driver";

/** Satu berkas unggahan di storage — untuk sapuan yatim. */
export interface ObjekUnggahan {
  /** kunci penuh, mis. `companies/<id>/bukti/<uuid>.jpg` */
  key: string;
  /** waktu tulis — dasar masa tenggang sapuan; null bila tak diketahui */
  waktu: Date | null;
}

export interface StorageDriver {
  readonly mode: "r2" | "local";
  put(key: string, body: Buffer, contentType: string): Promise<{ url: string }>;
  /** Daftar semua berkas di bawah prefix (rekursif). */
  list(prefix: string): Promise<ObjekUnggahan[]>;
  /** Hapus satu berkas; berkas yang sudah tak ada bukan galat. */
  hapus(key: string): Promise<void>;
}

export const localUploadDir =
  env.UPLOAD_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads");

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (!driver) {
    driver = r2Configured ? new R2Driver() : new LocalDriver(localUploadDir);
  }
  return driver;
}
