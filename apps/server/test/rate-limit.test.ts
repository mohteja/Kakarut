import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "../src/middleware/auth";
import { memoryStore, rateLimit } from "../src/middleware/rateLimit";

// Konteks palsu minimal: middleware hanya memanggil c.header(...) pada jalur 429.
const ctx = () => ({ header: () => {} }) as unknown as Context<AppEnv>;
const next = async () => {};

describe("rateLimit (fixed window)", () => {
  it("mengizinkan sampai max, lalu memblokir 429", async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3, key: () => "k" }, memoryStore());
    const c = ctx();
    await mw(c, next); // 1
    await mw(c, next); // 2
    await mw(c, next); // 3 (masih diizinkan)
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("kunci berbeda punya jendela terpisah", async () => {
    let k = "a";
    const mw = rateLimit({ windowMs: 60_000, max: 1, key: () => k }, memoryStore());
    const c = ctx();
    await mw(c, next); // a → ok
    k = "b";
    await mw(c, next); // b → ok (bucket sendiri)
    k = "a";
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 }); // a lagi → blok
  });

  it("key async didukung (mis. baca email dari body)", async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2, key: async () => "async" }, memoryStore());
    const c = ctx();
    await mw(c, next);
    await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("fail-open: bila store error, permintaan diizinkan (tak 429/throw)", async () => {
    const storeError: import("../src/middleware/rateLimit").RateLimitStore = {
      hit: async () => {
        throw new Error("db down");
      },
    };
    const mw = rateLimit({ windowMs: 60_000, max: 1, key: () => "x" }, storeError);
    const c = ctx();
    let lolos = false;
    await mw(c, async () => {
      lolos = true;
    });
    expect(lolos).toBe(true);
  });
});
