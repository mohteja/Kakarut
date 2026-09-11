import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SETELAN YANG DIBACA KODE HARUS BISA SAMPAI KE PRODUKSI.
 *
 * Dua berkas di repo ini wajib sepakat, dan sampai hari ini tak ada satu pun
 * uji yang membandingkannya:
 *
 *   · `config/env.ts` — daftar setelan yang DIBACA aplikasi;
 *   · `docker-compose.yml` — satu-satunya jembatan dari panel Environment
 *     Dokploy ke dalam kontainer.
 *
 * Jembatan itu tidak otomatis. `docker stack deploy` hanya mengganti `${VAR}`
 * yang BENAR-BENAR DITULIS di berkas stack; variabel yang tak disebut di sana
 * tak pernah masuk ke proses, seberapa pun rapi ia diketik di panel Dokploy.
 * Jadi kunci yang hilang dari `environment:` bukan "belum disetel" — ia
 * **tidak bisa disetel**, dan tak ada pesan galat yang mengatakannya.
 *
 * Terukur 2026-09-11, sebelum putaran ini: **30 kunci dibaca, 17 dioper, 15
 * tak terjangkau.** Dua di antaranya membuat temuan KRITIS milik panel super
 * admin mustahil dipadamkan (`APP_BASE_URL`, `APP_HOST_DIPERCAYA` — tautan
 * reset password diturunkan dari header yang dikendalikan peminta), dan satu
 * lagi memaksa cadangan menumpang bucket yang dilayani publik
 * (`R2_BACKUP_BUCKET`).
 *
 * Uji ini menjaga KEDUA arah: setelan yang dibaca tapi tak terjangkau, DAN
 * kunci yang dioper tapi tak dibaca siapa pun (setelan mati yang menipu
 * pembacanya).
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Kunci yang SENGAJA tidak dioper — tiap entri wajib menyebut sebabnya, sebab
 * daftar pengecualian tanpa alasan adalah cara gerbang ini berhenti berarti.
 */
const TAK_DIOPER: Record<string, string> = {
  UPLOAD_DIR:
    "Knop mode LOKAL. Stack ini sengaja tanpa volume (lihat kepala berkas compose), " +
    "jadi jalur apa pun yang diisi akan mendarat di lapisan kontainer yang fana — " +
    "unggahan yang tampak tersimpan lalu lenyap saat re-deploy. Jalannya R2.",
  BACKUP_DIR:
    "Sama: knop mode LOKAL pada stack tanpa volume. Menambah volume berarti menyunting " +
    "berkas compose ini juga, dan kunci ini ditambahkan bersama volumenya.",
};

/** Kunci pada skema Zod `EnvSchema` — yaitu setelan yang dibaca aplikasi. */
export function kunciSkema(sumber: string): string[] {
  const i = sumber.indexOf("const EnvSchema = z.object({");
  if (i < 0) return [];
  const j = sumber.indexOf("\n});", i);
  const blok = sumber.slice(i, j < 0 ? undefined : j);
  return [...blok.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

/** Kunci pada blok `environment:` service `app` di berkas stack. */
export function kunciCompose(sumber: string): string[] {
  const m = /^ {4}environment:\n((?: {6}.*\n|\n)*)/m.exec(sumber);
  if (!m) return [];
  return [...m[1].matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((x) => x[1]);
}

/** Setelan yang dibaca tapi tak bisa disetel dari panel deploy. */
export function takTerjangkau(
  skema: string[],
  compose: string[],
  kecuali: Record<string, string>,
): string[] {
  const ada = new Set(compose);
  return skema.filter((k) => !ada.has(k) && !(k in kecuali));
}

function berkasTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasTs(jalur);
    return jalur.endsWith(".ts") ? [jalur] : [];
  });
}

describe("setelan yang dibaca kode bisa sampai ke produksi", () => {
  const env = readFileSync(`${AKAR}apps/server/src/config/env.ts`, "utf8");
  const compose = readFileSync(`${AKAR}docker-compose.yml`, "utf8");
  const entrypoint = readFileSync(`${AKAR}docker-entrypoint.sh`, "utf8");
  const dockerfile = readFileSync(`${AKAR}Dockerfile`, "utf8");
  const skema = kunciSkema(env);
  const dioper = kunciCompose(compose);

  it("PREMIS: kedua pengurai melihat sebanyak yang diukur", () => {
    expect(skema.length, "pengurai skema env.ts runtuh").toBeGreaterThanOrEqual(25);
    expect(dioper.length, "pengurai blok environment compose runtuh").toBeGreaterThanOrEqual(25);
    // Kunci yang pasti ada di keduanya — kalau salah satunya hilang dari
    // hasil urai, yang rusak pengurainya, bukan reponya.
    expect(skema).toContain("DATABASE_URL");
    expect(dioper).toContain("DATABASE_URL");
  });

  it("INTI: tak ada setelan yang dibaca tapi mustahil disetel dari panel deploy", () => {
    const hilang = takTerjangkau(skema, dioper, TAK_DIOPER);
    expect(
      hilang,
      "Setelan ini dibaca `config/env.ts` tapi tak disebut di blok `environment:` " +
        "docker-compose.yml. `docker stack deploy` hanya mengganti ${VAR} yang benar-benar " +
        "ditulis di sana, jadi nilainya TAK PERNAH sampai ke kontainer walau diketik rapi " +
        "di panel Dokploy — dan tak ada galat yang mengatakannya. Tambahkan barisnya, atau " +
        "daftarkan di TAK_DIOPER BESERTA sebabnya:\n" +
        hilang.join("\n"),
    ).toEqual([]);
  });

  it("INTI: tiap kunci yang dioper memang DIBACA seseorang", () => {
    const sumber = berkasTs(`${AKAR}apps/server/src`)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const yatim = dioper.filter(
      (k) =>
        !skema.includes(k) &&
        !sumber.includes(`process.env.${k}`) &&
        !entrypoint.includes(k) &&
        !dockerfile.includes(k),
    );
    expect(
      yatim,
      "Kunci ini dioper stack tapi tak dibaca skema, kode, entrypoint, maupun Dockerfile. " +
        "Setelan mati lebih buruk daripada setelan yang tak ada: orang mengisinya, lalu " +
        "percaya sesuatu berubah:\n" + yatim.join("\n"),
    ).toEqual([]);
  });

  it("INTI: daftar pengecualian tak menyimpan kunci yang ternyata sudah dioper", () => {
    // Pengecualian yang basi membuat gerbang ini diam untuk kunci yang justru
    // sudah beres — dan diam yang salah adalah cara daftar begini membusuk.
    for (const k of Object.keys(TAK_DIOPER)) {
      expect(dioper, `${k} sudah dioper; cabut dari TAK_DIOPER`).not.toContain(k);
      expect(skema, `${k} tak lagi dibaca env.ts; cabut dari TAK_DIOPER`).toContain(k);
      expect(TAK_DIOPER[k].length, `${k} tanpa sebab tertulis`).toBeGreaterThan(40);
    }
  });

  it("INTI: kunci yang memadamkan temuan KRITIS panel memang terjangkau", () => {
    // Bukan sekadar "ada di daftar": ketiganya punya akibat yang sudah
    // ditulis panel super admin sebagai temuan kritis / pengungkapan data.
    for (const k of ["APP_BASE_URL", "APP_HOST_DIPERCAYA", "R2_BACKUP_BUCKET"]) {
      expect(dioper, `${k} — temuan panel tak bisa dipadamkan tanpa kunci ini`).toContain(k);
    }
  });

  it("PASANGAN: pengurainya menuduh — dan diam saat kuncinya memang dioper", () => {
    const skemaPalsu = 'const EnvSchema = z.object({\n  A_SATU: z.string(),\n  B_DUA: z.string(),\n});';
    const composePalsu = "services:\n  app:\n    environment:\n      A_SATU: ${A_SATU}\n";
    expect(kunciSkema(skemaPalsu)).toEqual(["A_SATU", "B_DUA"]);
    expect(kunciCompose(composePalsu)).toEqual(["A_SATU"]);
    expect(takTerjangkau(["A_SATU", "B_DUA"], ["A_SATU"], {})).toEqual(["B_DUA"]);
    // Pengecualian memang meredam — itu sebabnya entri TAK_DIOPER wajib
    // menyebut sebabnya, dan uji di atas menagihnya.
    expect(takTerjangkau(["A_SATU", "B_DUA"], ["A_SATU"], { B_DUA: "x" })).toEqual([]);
    // Indentasi salah tak dihitung sebagai kunci (blok lain di berkas stack).
    expect(kunciCompose("services:\n  app:\n    environment:\n    A_SATU: x\n")).toEqual([]);
  });
});
