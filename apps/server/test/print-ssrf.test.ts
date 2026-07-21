import { describe, expect, it } from "vitest";
import { ipInternal, normalisasiIp, resolveHostPrinter } from "../src/modules/print/routes";

describe("normalisasiIp", () => {
  it("membuka IPv4-mapped IPv6 (::ffff:127.0.0.1 → 127.0.0.1)", () => {
    expect(normalisasiIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalisasiIp("::FFFF:10.0.0.5")).toBe("10.0.0.5");
  });
  it("membuang zone-id IPv6", () => {
    expect(normalisasiIp("fe80::1%eth0")).toBe("fe80::1");
  });
});

describe("ipInternal (saringan SSRF)", () => {
  it("menolak loopback / this-net / link-local / metadata / unspecified", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "169.254.169.254", // metadata cloud
      "::1",
      "::",
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "fe80::1",
      "fd00:ec2::254", // metadata AWS IPv6
    ]) {
      expect(ipInternal(ip), ip).toBe(true);
    }
  });
  it("mengizinkan LAN privat & IP publik (tujuan printer sah)", () => {
    for (const ip of ["192.168.1.50", "10.0.0.5", "172.16.0.9", "8.8.8.8", "203.0.113.7"]) {
      expect(ipInternal(ip), ip).toBe(false);
    }
  });
});

describe("resolveHostPrinter (resolve → saring → pin IP)", () => {
  it("menolak host yang menunjuk ke internal", async () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "169.254.169.254", "::ffff:127.0.0.1"]) {
      await expect(resolveHostPrinter(host), host).rejects.toMatchObject({ status: 400 });
    }
  });
  it("mengembalikan IP untuk target sah (LAN privat / publik)", async () => {
    expect(await resolveHostPrinter("192.168.1.50")).toBe("192.168.1.50");
    expect(await resolveHostPrinter("8.8.8.8")).toBe("8.8.8.8");
    // Kurung siku IPv6 literal ikut dibersihkan.
    expect(await resolveHostPrinter("[2001:4860:4860::8888]")).toBe("2001:4860:4860::8888");
  });
});
