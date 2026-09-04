import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lolosAtribut, lolosHtml } from "@kakarut/shared";
import { suratReset, suratUndangan, suratVerifikasi } from "../src/modules/mail/surat";
import { AKAR, daftarBerkas, kotor, sapuTeks, templatHtml, type Templat } from "./util/templat-html";

/**
 * HTML DIRAKIT TANGAN — tiap sisipan dilolos, atau terdaftar beralasan.
 *
 * Sebelum vena ini: web punya `esc()` dan memakainya konsisten di tiap
 * interpolasi; server merakit badan surat dari nama perusahaan & nama pengguna
 * TANPA satu pun pelolos. Terukur dari keluaran perakit yang sungguhan, nama
 * perusahaan `</b></p><p><a href="https://penyerang.example">…</a></p><p>`
 * membuat surat undangan memuat DUA `<a` — satu milik Kakarut, satu milik
 * penyerang — di dalam pesan yang berangkat dari domain produk dan lolos
 * SPF/DKIM. Di jalur itu penyerang memilih keduanya: isinya (nama
 * perusahaannya sendiri) dan penerimanya (`body.email`).
 *
 * Beratnya ditulis apa adanya: transport (nodemailer & Resend) menyandikan
 * header, jadi injeksi `Subject` TIDAK terjangkau; klien surat menyaring skrip,
 * jadi ini BUKAN XSS. Yang nyata: penyuntikan tautan & pemalsuan isi.
 */

/** Nama perusahaan yang SAH menurut `z.string().trim().min(1)` — dan berbahaya. */
const JAHAT = `</b></p><p><a href="https://penyerang.example">Klik di sini untuk aktivasi</a></p><p>`;

/**
 * Sisipan yang SENGAJA tidak dilolos, dengan alasan yang bisa diperiksa.
 * Kunci: `akar/berkas`. Daftarnya per-EKSPRESI, jadi sisipan baru di berkas
 * yang sama tetap menagih keputusan alih-alih menumpang izin tetangganya.
 */
const DIIZINKAN = new Map<string, { ekspresi: string[]; alasan: string }>([
  [
    "server/index.ts",
    {
      ekspresi: ["buildId"],
      alasan:
        "heksa dari computeBuildId(index.html) — dirakit server, tak pernah menyentuh masukan peminta",
    },
  ],
  [
    "server/lib/backup-peringatan.ts",
    {
      ekspresi: ["pokok", "barisSukses", "barisGagal", "tujuan", "tautan"],
      alasan:
        "surat ke SUPER ADMIN yang seluruh isinya dirakit server: kalimat tetap, angka jam, dua " +
        "nama penyedia ('Cloudflare R2'/'disk lokal'), pesan galat backup, dan env.APP_BASE_URL. " +
        "Zona waktunya dari companies.timezone yang tak punya SATU pun jalur tulis (default 'Asia/Jakarta')",
    },
  ],
  [
    "web/lib/pdf.ts",
    {
      ekspresi: ["opts.css", "opts.bodyHtml"],
      alasan:
        "situs penggabungan: bodyHtml dirakit pemanggil yang sudah melolos tiap sisipan datanya",
    },
  ],
  [
    "web/pages/produksi/DokumenBelanjaModal.tsx",
    {
      ekspresi: [
        "nKeCabang",
        "nDiSini",
        'r.tujuan_branch_id != null ? "\u{1F4E6} " : "\u{1F3ED} "',
        "tag",
        "kepala",
        "alamat",
        "baris",
        'sisa > 0 ? "Kekurangan dari RAB" : "Kelebihan dana"',
        "tujuanBlok",
        "tabel",
        "sisaBlok",
        "DOK_CSS",
        "buildBody()",
      ],
      alasan:
        "angka, dua ternary yang KEDUA cabangnya literal, konstanta DOK_CSS, dan potongan HTML " +
        "yang dirakit di berkas yang sama — tiap sisipan datanya sudah lewat esc()",
    },
  ],
  [
    "web/pages/produksi/FakturDetailPage.tsx",
    {
      ekspresi: [
        'r.status === "ditolak" ? " (ditolak)" : ""',
        'tipe === "produksi" ? "Bahan diproduksi" : "Bahan dibeli"',
        'tipe === "produksi" ? "Hasil &amp; batch" : "Jumlah"',
        "exp",
        "batch",
        "biaya",
        "kolomBiaya",
        "kop",
        "riwayat",
        "baris",
        "total",
      ],
      alasan:
        "PDF dokumen faktur. Tiga ternary yang KEDUA cabangnya literal, dan delapan potongan HTML " +
        "yang dirakit di berkas yang sama beberapa baris di atasnya — di dalam masing-masing, tiap " +
        "nilai yang berasal dari pemakai (nama bahan, catatan, nama orang, nomor faktur) sudah " +
        "lewat esc(). Bentuknya sama persis dengan DokumenBelanjaModal di atas, sebab keduanya " +
        "dokumen cetak yang dirakit dengan pola yang sama.",
    },
  ],
]);

function daftar(t: Templat) {
  return DIIZINKAN.get(`${t.akar}/${t.berkas}`);
}

describe("HTML dirakit tangan: tiap sisipan dilolos atau terdaftar", () => {
  const semua = templatHtml();

  it("populasinya benar-benar tersapu (bukan nol karena pemindainya patah)", () => {
    const per: Record<string, number> = {};
    for (const t of semua) per[t.akar] = (per[t.akar] ?? 0) + 1;
    // Angka boleh tumbuh; yang dijaga: pemindainya tidak diam-diam jadi kosong.
    expect(semua.length).toBeGreaterThanOrEqual(20);
    expect(per.server ?? 0).toBeGreaterThanOrEqual(10);
    expect(per.web ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("tak ada satu pun sisipan kotor yang tak terdaftar", () => {
    const liar: string[] = [];
    for (const t of semua) {
      const d = daftar(t);
      for (const e of kotor(t)) {
        if (!d?.ekspresi.includes(e)) liar.push(`${t.akar}/${t.berkas}:${t.baris} -> \${${e}}`);
      }
    }
    expect(liar, `HTML dirakit dari nilai yang tak dilolos:\n${liar.join("\n")}`).toEqual([]);
  });

  it("anti-kuburan: tiap entri daftar masih benar-benar ada di sumbernya", () => {
    const hidup = new Set<string>();
    for (const t of semua) for (const e of kotor(t)) hidup.add(`${t.akar}/${t.berkas} ${e}`);
    const basi: string[] = [];
    for (const [k, v] of DIIZINKAN) {
      for (const e of v.ekspresi) if (!hidup.has(`${k} ${e}`)) basi.push(`${k} -> \${${e}}`);
    }
    expect(basi, `entri daftar sudah tak punya situs — hapus:\n${basi.join("\n")}`).toEqual([]);
  });

  it("tiap entri daftar menyebut ALASAN, bukan sekadar didiamkan", () => {
    for (const [k, v] of DIIZINKAN) {
      expect(v.alasan.length, `${k} tanpa alasan`).toBeGreaterThan(40);
    }
  });

  it("BUKTI MERAH: pelolos dicabut dari surat.ts -> gerbang menuduh berkas & barisnya", () => {
    const asli = readFileSync(join(AKAR.server, "modules/mail/surat.ts"), "utf8");
    const dilucuti = asli.replace(/lolosHtml\((\w+)\)/g, "$1");
    expect(dilucuti, "pencabutan tak mengubah apa pun — buktinya tak jadi merah").not.toBe(asli);

    const tertuduh = sapuTeks("server", "modules/mail/surat.ts", dilucuti).filter(
      (t) => kotor(t).length > 0,
    );
    expect(tertuduh.length).toBeGreaterThan(0);
    // Yang dituduh persis nama perusahaan di surat undangan, dengan nomor baris.
    expect(tertuduh.some((t) => kotor(t).includes("namaPerusahaan"))).toBe(true);
    expect(tertuduh.every((t) => t.baris > 0)).toBe(true);
    // Dan berkas yang UTUH tidak dituduh sama sekali.
    expect(
      sapuTeks("server", "modules/mail/surat.ts", asli).filter((t) => kotor(t).length > 0),
    ).toEqual([]);
  });

  it("pelolosnya SATU rumah: tak ada peta lolos kedua di luar packages/shared/src/html.ts", () => {
    const salinan: string[] = [];
    for (const akar of Object.keys(AKAR)) {
      for (const p of daftarBerkas(akar)) {
        if (akar === "shared" && p === "html.ts") continue;
        if (readFileSync(join(AKAR[akar], p), "utf8").includes('"&lt;"')) {
          salinan.push(`${akar}/${p}`);
        }
      }
    }
    expect(
      salinan,
      `peta pelolos disalin lagi — pakai lolosHtml/lolosAtribut dari @kakarut/shared:\n${salinan.join("\n")}`,
    ).toEqual([]);
  });
});

describe("keluaran perakit surat: suntikan mati, nama wajar tetap terbaca", () => {
  const URL_SAH = "https://kakarut.app/daftar";

  it("SEBELUM (dirakit tanpa pelolos) suntikannya SUNGGUH mendarat", () => {
    const tanpaPelolos = `<p>Anda diundang bergabung ke <b>${JAHAT}</b> di Terakasir.</p>`;
    expect((tanpaPelolos.match(/<a\b/g) ?? []).length).toBe(1);
    expect(tanpaPelolos).toContain('<a href="https://penyerang.example">');
  });

  it("undangan: nama ber-HTML tak menambah satu pun tag", () => {
    const html = suratUndangan(JAHAT, URL_SAH);
    expect((html.match(/<a\b/g) ?? []).length).toBe(1); // hanya tautan daftar milik Kakarut
    expect((html.match(/<b>/g) ?? []).length).toBe(1);
    expect(html).not.toContain('<a href="https://penyerang.example">');
    expect(html).toContain("&lt;/b&gt;"); // suntikannya jadi TEKS yang terlihat
  });

  it("reset: nama ber-HTML tak menambah satu pun tag", () => {
    const html = suratReset(JAHAT, "https://kakarut.app/reset-password?token=abc", "abc");
    expect((html.match(/<a\b/g) ?? []).length).toBe(1);
    expect(html).not.toContain('<a href="https://penyerang.example">');
  });

  /**
   * ASERSI INI DULU BERBUNYI "TAK ADA TAUTAN SAMA SEKALI", dan itu benar
   * selama satu putaran — lalu salah, dan diganti alih-alih dilonggarkan.
   *
   * Tautannya kembali karena `docs/API-CONTRACT.md` menuliskan alur daftar
   * APLIKASI PONSEL di atasnya: register → tangkap deep link
   * `APP_BASE_URL/verifikasi-email?token=…` → `verify-email { token }`.
   * Mencabut tautannya mematikan pendaftaran dari ponsel sampai repo ponsel
   * menyusul.
   *
   * Yang dijaga karena itu bukan lagi "nol tautan" melainkan **tepat satu**:
   * nama pemakai ikut ke dalam badan surat, dan nama ber-HTML yang tak dilolos
   * bisa menyelipkan `<a>` KEDUA yang menuju ke mana pun ia mau — di dalam
   * email yang dikirim atas nama kami, ke orang yang baru saja mendaftar.
   */
  it("verifikasi: TEPAT SATU tautan, dan nama ber-HTML tak bisa menambah yang kedua", () => {
    const html = suratVerifikasi(JAHAT, "123456", 60, URL_SAH);
    expect(html.match(/<a\b/g) ?? [], "jumlah tautan di surat verifikasi").toHaveLength(1);
    expect(html).not.toContain('<a href="https://penyerang.example">');
    expect(html).toContain("&lt;/b&gt;"); // suntikannya jadi TEKS yang terlihat
    // Tautan yang SAH tetap utuh — pelolosnya tak boleh merusak jalan ponsel.
    expect(html).toContain(`href="${URL_SAH}"`);
    // Dan kodenya tetap ada: ia jalan utamanya, tautannya cuma pendamping.
    expect(html).toContain("123456");
  });

  it("url ber-tanda-kutip tak keluar dari atributnya", () => {
    const url = 'https://kakarut.app" onmouseover="jahat()" x="';
    for (const html of [
      suratUndangan("PT Waras", url),
      suratReset("Budi", url, "abc"),
    ]) {
      // Kutipnya jadi `&quot;` — jadi `onmouseover` tinggal teks di dalam href,
      // bukan atribut sungguhan. Yang dilarang: kutip MENTAH yang menutup href.
      expect(html).not.toContain('onmouseover="');
      expect((html.match(/<a\b/g) ?? []).length).toBe(1);
      // Tag <a>-nya hanya punya satu atribut: href.
      const tag = html.match(/<a\b[^>]*>/)![0].replace(/"[^"]*"/g, '""');
      expect(tag.match(/\w+=/g)).toEqual(["href="]);
    }
  });

  it("PASANGAN: nama wajar ber-& dan ber-apostrof tetap TERBACA, tidak dibuang", () => {
    const html = suratUndangan("Warung Bu Ani & Anak", URL_SAH);
    expect(html).toContain("<b>Warung Bu Ani &amp; Anak</b>");
    expect(html).not.toContain("&amp;amp;"); // bukan dilolos dua kali
    const reset = suratReset(`D'Rasa "Enak"`, "https://kakarut.app/r?token=abc", "abc");
    expect(reset).toContain("D'Rasa &quot;Enak&quot;"); // apostrof di TEKS tak perlu dilolos
    // Tautan sahnya tetap utuh — pengetatan tak boleh mematikan jalur wajar.
    expect(html).toContain(`<a href="${URL_SAH}">${URL_SAH}</a>`);
    expect(reset).toContain('<a href="https://kakarut.app/r?token=abc">');
  });

  it("pelolos: teks vs atribut beda tepat pada apostrof", () => {
    expect(lolosHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e'f");
    expect(lolosAtribut(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
    expect(lolosHtml(null)).toBe("");
    expect(lolosHtml(undefined)).toBe("");
    expect(lolosHtml(0)).toBe("0"); // angka nol tetap tercetak, bukan hilang
  });
});
