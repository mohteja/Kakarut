import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env";
import type { StorageDriver } from "./storage";

/** Cloudflare R2 lewat API kompatibel S3. */
export class R2Driver implements StorageDriver {
  readonly mode = "r2" as const;
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<{ url: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET!,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    const base = env.R2_PUBLIC_URL?.replace(/\/$/, "");
    return { url: base ? `${base}/${key}` : `/uploads/${key}` };
  }
}
