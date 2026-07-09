import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, r2Configured } from "../../config/env";
import { LocalDriver } from "./local-driver";
import { R2Driver } from "./r2-driver";

export interface StorageDriver {
  readonly mode: "r2" | "local";
  put(key: string, body: Buffer, contentType: string): Promise<{ url: string }>;
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
