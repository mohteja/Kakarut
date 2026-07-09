import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AppEnv } from "../../middleware/auth";
import { getStorage } from "./storage";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const uploadRoutes = new Hono<AppEnv>().post("/", async (c) => {
  const auth = c.get("auth");
  const tujuan = c.req.query("tujuan") === "logo" ? "logo" : "menu";

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
});
