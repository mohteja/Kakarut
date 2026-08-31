import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spinnerTurunan } from "./util/kueri-web";

/**
 * Penjaga SPINNER ABADI.
 *
 * Di React Query v5, bacaan yang GAGAL berakhir dengan `isLoading === false`
 * DAN `data === undefined`. Maka dua bentuk ini menunggu selamanya:
 *
 *     {isLoading || !data ? <Spinner /> : …}
 *     {!data ? <Spinner /> : …}
 *
 * Syaratnya tetap benar sesudah kegagalan, jadi spinnernya tak pernah berhenti.
 * Layarnya tak menyebut ada yang salah dan tak ada apa pun yang bisa ditekan —
 * satu-satunya jalan keluar adalah menutup modalnya dan menebak sendiri. Enam
 * tempat mengidapnya sekaligus (detail shift, dua detail opname, lot FIFO,
 * detail kebersihan, riwayat meja): bukan kelalaian satu orang, melainkan pola
 * yang tersalin.
 *
 * Gantinya `<SpinnerAtauGalat error={…} />` — berputar selagi dimuat, berhenti
 * dan menjelaskan begitu gagal.
 *
 * Yang dilarang hanya bentuk `!data ? <Spinner />`. `isLoading ? <Spinner />`
 * TANPA `!data` tetap sah: ia berhenti sendiri saat bacaannya gagal, lalu jatuh
 * ke cabang berikutnya — asalkan cabang berikutnya bukan klaim kosong palsu,
 * dan itu urusan penjaga lain.
 */
const akarWeb = fileURLToPath(new URL("../../web/src/", import.meta.url));

function berkasTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return berkasTsx(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

/**
 * `!<nama> ? (…) <Spinner />` — termasuk varian `isLoading || !data`.
 *
 * Pola ini SENDIRI tidak selalu salah: bila ada cabang galat yang mendahuluinya
 * dalam rantai ternary yang sama, spinnernya tak pernah tercapai sesudah gagal.
 * Yang diperiksa karena itu bukan bentuknya, melainkan syarat yang membuatnya
 * mungkin ditulis benar: query yang memberi makan `data` WAJIB ikut membaca
 * `error`. Tanpa itu tak ada bahan untuk cabang galat mana pun, dan spinner
 * abadi jadi satu-satunya hasil yang bisa terjadi.
 *
 * Memeriksa "adakah cabang galat di atasnya" lewat teks tak bisa diandalkan —
 * kalimatnya bebas ("tidak dapat dimuat", "gagal", "server tak menjawab") dan
 * penjaga yang menebak-nebak prosa akan berbohong ke dua arah.
 */
const SPINNER_MENUNGGU_DATA = /!\s*(\w+)\s*\?\s*\(?\s*\n?\s*<Spinner\s*\/>/g;

/**
 * Bentuk KEDUA, dan ini yang lolos dari penjaga versi pertama:
 *
 *     if (isLoading || !data) return <Spinner />;
 *
 * Sama persis akibatnya — bacaan gagal → `isLoading` false, `data` undefined →
 * berputar selamanya — tapi tak ada tanda tanya di dalamnya, jadi pola ternary
 * di atas tak pernah mengenainya. Enam halaman mengidapnya diam-diam
 * (riwayat harga, perusahaan, profil, dan tiga panel superadmin) SESUDAH kelas
 * ini saya nyatakan terkunci.
 *
 * Pelajarannya bukan "tambah satu regex": penjaga yang cuma mengunci SATU
 * penulisan dari sebuah kesalahan memberi rasa aman yang lebih berbahaya
 * daripada tak ada penjaga sama sekali, karena kelasnya dilaporkan beres.
 */
const SPINNER_RETURN_AWAL = /if\s*\([^)]*?!\s*(\w+)[^)]*\)\s*return\s*<Spinner\s*\/>/g;

/** Nama yang di-bind ke `data` pada tiap `useQuery`, + apakah `error` dibaca. */
function queryPerBerkas(isi: string): Map<string, boolean> {
  const hasil = new Map<string, boolean>();
  for (const m of isi.matchAll(/(?:const|let)\s*(\{[^}]*\})\s*=\s*useQuery(?:<[^>]*>)?\(\{/g)) {
    const dest = m[1];
    const dm = /\bdata\s*(?::\s*(\w+))?/.exec(dest);
    if (!dm) continue;
    hasil.set(dm[1] ?? "data", /\b(isError|error)\b/.test(dest));
  }
  return hasil;
}

describe("tak ada spinner abadi di web", () => {
  const pelanggar: string[] = [];
  for (const berkas of berkasTsx(akarWeb)) {
    const isi = readFileSync(berkas, "utf8");
    const query = queryPerBerkas(isi);
    for (const pola of [SPINNER_MENUNGGU_DATA, SPINNER_RETURN_AWAL]) {
      for (const m of isi.matchAll(pola)) {
        const nama = m[1];
        // Bukan dari useQuery (mis. state lokal) → bukan urusan penjaga ini.
        //
        // PENGECUALIAN INI BENAR untuk state yang benar-benar lokal, dan
        // KELIRU justru ketika state itu hanya pernah diisi dari data kueri:
        // `if (isLoading || rows === null) return <Spinner/>` dengan `rows`
        // yang diisi efek dari `bahan` berputar selamanya. Cakupannya dicabut
        // oleh arah kedua di bawah (`spinnerTurunan`), bukan penilaiannya.
        if (!query.has(nama)) continue;
        if (query.get(nama)) continue; // `error` dibaca → cabang galat mungkin
        const baris = isi.slice(0, m.index).split("\n").length;
        pelanggar.push(`${berkas.slice(akarWeb.length)}:${baris} (${nama})`);
      }
    }
  }

  it("setiap `!data ? <Spinner />` berasal dari query yang membaca `error`", () => {
    expect(pelanggar).toEqual([]);
  });

  it("penggantinya benar-benar ada dan menampilkan galat", () => {
    const ui = readFileSync(join(akarWeb, "components/ui.tsx"), "utf8");
    expect(ui).toContain("export function SpinnerAtauGalat");
    // Wajib menyerah saat ada galat, bukan tetap memutar spinner.
    const badan = ui.slice(ui.indexOf("export function SpinnerAtauGalat"));
    expect(badan).toMatch(/if\s*\(\s*!error\s*\)\s*return\s*<Spinner/);
  });
});

describe("arah kedua: spinner abadi yang tak berbentuk `!data`", () => {
  /*
   * Gerbang di atas jujur, dan batasnya tertulis — tapi ia buta pada DUA
   * bentuk lain, dan keduanya nyata di repo ini:
   *
   *   1. KEADAAN TURUNAN. `if (isLoading || rows === null)` dengan `rows`
   *      hanya diisi efek dari data kueri. Pengecualian "state lokal" di atas
   *      melewatkannya.
   *   2. SYARAT BERKURUNG. `if (!bahan || !kategori || (id && !menuEdit))` —
   *      regex di atas memakai `[^)]*`, yang tak bisa melewati kurung dalam,
   *      jadi barisnya **tak pernah cocok**. Bukan diloloskan beralasan:
   *      tak terlihat. `menuEdit` tak membaca galatnya, dan mode sunting
   *      `MenuFormPage` berputar selamanya.
   *
   * Yang dituntut sama seperti gerbang lama: bacaan yang memberi makan
   * syaratnya WAJIB membaca `error`, supaya cabang galat mungkin ada.
   */
  const semua = spinnerTurunan();

  it("PREMIS: penyapunya benar-benar menemukan penjaga spinner", () => {
    expect(semua.length, "tak satu pun penjaga spinner terbaca").toBeGreaterThan(0);
  });

  it("INTI: tak ada penjaga spinner yang bergantung bacaan tanpa galat", () => {
    const lalai = semua
      .filter((x) => !x.bacaGalat)
      .map((x) => `${x.berkas}:${x.baris} [${x.state}] ${x.syarat}`);
    expect(
      lalai,
      `spinner ini tak pernah berhenti sesudah bacaannya gagal:\n${lalai.join("\n")}`,
    ).toEqual([]);
  });

  it("BUKTI MERAH: kedua bentuk buta itu kini tertangkap", () => {
    const turunan = spinnerTurunan([
      {
        nama: "palsu/A.tsx",
        isi: 'function P() { const { data: bahan } = useQuery({}); const [rows, setRows] = useState(null); useEffect(() => { setRows(bahan); }, [bahan]); if (isLoading || rows === null) return <Spinner />; return <hr/>; }',
      },
    ]);
    expect(turunan.filter((x) => !x.bacaGalat), "bentuk KEADAAN TURUNAN tak tertangkap").not.toEqual(
      [],
    );
    const kurung = spinnerTurunan([
      {
        nama: "palsu/B.tsx",
        isi: 'function P() { const { data: a } = useQuery({}); const { data: b } = useQuery({}); if (!a || (id && !b)) return <Spinner />; return <hr/>; }',
      },
    ]);
    expect(kurung.filter((x) => !x.bacaGalat), "bentuk BERKURUNG tak tertangkap").not.toEqual([]);
  });

  it("PASANGAN: yang membaca galatnya, dan state yang benar-benar lokal, tak dituduh", () => {
    const sehat = spinnerTurunan([
      {
        nama: "palsu/C.tsx",
        isi: 'function P() { const { data: a, error } = useQuery({}); if (!a) return <Spinner />; return <b>{String(error)}</b>; }',
      },
    ]);
    expect(sehat.filter((x) => !x.bacaGalat)).toEqual([]);
    const lokal = spinnerTurunan([
      {
        nama: "palsu/D.tsx",
        isi: 'function P() { const [menuOpen, setMenuOpen] = useState(false); if (!menuOpen) return <Spinner />; return <hr/>; }',
      },
    ]);
    expect(lokal, "state yang benar-benar lokal ikut dituduh").toEqual([]);
  });
});
