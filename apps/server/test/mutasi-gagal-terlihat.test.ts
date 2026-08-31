import { describe, expect, it } from "vitest";
import { situsMutasi } from "./util/mutasi-web";

/**
 * PENULISAN YANG GAGAL HARUS PUNYA JALAN KE LAYAR.
 *
 * `useMutation` yang gagal tidak melempar dan tidak merender apa pun sendiri:
 * `onSuccess` sekadar tak jalan. Tombolnya ditekan, tak ada yang berubah, tak
 * ada yang dikatakan — dan orangnya menekan lagi. Bentuk kegagalan yang sama
 * dengan `useQuery` yang gagal (putaran 19–22), tapi di sisi TULIS, dan
 * sisi itu tak pernah punya gerbang: di `kueri-web.ts`, `useMutation` muncul
 * satu kali dan cuma sebagai petunjuk bahwa sebuah berkas punya tombol simpan.
 *
 * Taruhannya bukan kerapian. Server menulis kalimatnya dengan hati-hati —
 * *"Kiriman tidak ditemukan atau bukan status dikirim"*, *"Meja tidak
 * ditemukan"* — dan kalimat itu tak berguna bila tak ada yang merendernya.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HASIL SAPUANNYA: **BERSIH** — 124 pengikatan, 123 punya jalan ke layar,
 * satu terdaftar beralasan. Dan angka itu baru boleh ditulis SESUDAH
 * detektornya dibetulkan, sebab generasi pertamanya menuduh SEPULUH pintu
 * yang benar. Pencabutannya ada di kepala `util/mutasi-web.ts`; ringkasnya:
 * repo ini memakai `galatTerbaru(...mutasi)` dari `lib/galat.ts`, yang
 * menerima OBJEK MUTASINYA (bukan `.error`-nya) supaya dua tombol di satu
 * layar tak berebut satu slot pesan. Pemindai yang hanya kenal `x.error`
 * melihatnya sebagai kesunyian.
 *
 * DUA LAPIS untuk satu aturan, dan yang kedua bukan hiasan:
 *
 *   berkas ini                          → adakah JALAN dari mutasi ke JSX;
 *   `apps/web/e2e/mutasi-gagal-terlihat.spec.ts` → apakah jalan itu benar-benar
 *   berakhir di mata orang, diukur di peramban dengan kegagalan yang DIPAKSA
 *   SECARA NYATA (mejanya dihapus lewat API sesudah layar memuat daftarnya,
 *   lalu tombol hapus ditekan → 404 asli dari server).
 *
 * Yang pertama tak bisa dielakkan dengan menulis kode berbeda; yang kedua tak
 * bisa dielakkan dengan menulis penalaran yang salah. Berkas ini sendiri
 * adalah buktinya bahwa lapis kedua perlu: penalarannya salah sepuluh kali.
 *
 * Batas-batas yang diakui ditulis di kepala `util/mutasi-web.ts` — hijau di
 * sini berarti "punya jalan, dalam batas itu", bukan "pasti terbaca".
 */

/**
 * Situs yang kesunyiannya SAH, dengan alasannya.
 *
 * Kuncinya `berkas nama-mutasi`, BUKAN nomor baris: pembusukan kunci bernomor
 * baris sudah dibayar dua kali (`pelaku.test.ts`, lalu `bendera-hapus-disaring`
 * di putaran 27, tempat satu baris `import` menggeser 1228 jadi 1229 dan dua
 * gerbang memerah). Sekali cukup.
 */
const DIPILAH: Record<string, string> = {
  "pages/bahan/BahanPage.tsx hapusBanyak":
    "Kegagalannya dibawa NILAI SUKSESNYA, bukan galatnya. `mutationFn` memakai " +
    "`Promise.allSettled` atas satu DELETE per bahan lalu MEMULANGKAN daftar id " +
    "yang gagal beserta pesannya; `onSuccess` menyusunnya jadi kalimat " +
    "('N dari M bahan gagal dihapus — nama: sebab') dan mencentang ulang yang " +
    "gagal supaya bisa dicoba lagi. Mutasi ini karena itu tak pernah menolak, " +
    "dan `.error`-nya memang selalu kosong — bentuk keempat yang sah, dan " +
    "lebih teliti daripada satu pesan gagal untuk sepuluh baris sekaligus.",
};

/**
 * Batas utang. WAJIB TURUN, tak boleh naik — disiplin yang sama sejak
 * putaran 22. Menaikkannya adalah cara daftar pengecualian tumbuh diam-diam
 * sampai gerbangnya berhenti menjaga apa pun.
 */
const MAKS_UTANG = 1;

describe("mutasi web: kegagalannya punya jalan ke layar", () => {
  const semua = situsMutasi();

  /* ── CAKUPAN: nol di salah satu angka ini berarti pemindainya buta ──────── */

  it("menemukan populasi mutasi (bukan lolos karena kosong)", () => {
    // 124 pengikatan di 64 berkas saat ditulis.
    expect(semua.length).toBeGreaterThanOrEqual(100);
    expect(new Set(semua.map((s) => s.berkas)).size).toBeGreaterThanOrEqual(40);
  });

  it("kelas TERLIHAT terisi — idiomnya benar-benar dikenali", () => {
    // Bukti bahwa pemindainya tak runtuh ke satu jawaban. Kalau angka ini nol,
    // aturan di bawah "lolos" untuk alasan yang salah.
    expect(semua.filter((s) => s.kelas === "TERLIHAT").length).toBeGreaterThanOrEqual(80);
  });

  it("kelas ONERROR terisi — bentuk kedua juga dikenali", () => {
    expect(semua.filter((s) => s.kelas === "ONERROR").length).toBeGreaterThan(0);
  });

  /* ── ATURANNYA ─────────────────────────────────────────────────────────── */

  it("tak ada mutasi yang kegagalannya tak bisa sampai ke layar", () => {
    const senyap = semua.filter((s) => s.kelas === "SENYAP");
    const tak_terdaftar = senyap.filter((s) => !(s.kunci in DIPILAH)).map((s) => s.kunci);
    expect(
      tak_terdaftar,
      "tekan tombolnya, servernya menolak, dan layar tak berkata apa-apa. " +
        "Render galatnya — `<ErrorText error={x.error} />`, atau " +
        "`galatTerbaru(a, b, …)` bila satu layar punya beberapa tombol",
    ).toEqual([]);
    expect(senyap.length, "batas utang wajib TURUN, tak boleh naik").toBeLessThanOrEqual(
      MAKS_UTANG,
    );
  });

  it("tiap entri daftar punya ALASAN, dan situsnya masih ada", () => {
    for (const [kunci, alasan] of Object.entries(DIPILAH)) {
      expect(alasan.length, `alasan terlalu pendek: ${kunci}`).toBeGreaterThan(80);
      expect(
        semua.some((s) => s.kunci === kunci),
        `entri daftar menunjuk situs yang sudah tak ada: ${kunci} — hapus entrinya`,
      ).toBe(true);
    }
  });

  /* ── PREMIS: detektornya bisa menuduh, dua arah ─────────────────────────── */

  /**
   * Dibuktikan di FIKSTUR, bukan di pohon: pelanggarnya nol di `apps/web`,
   * jadi contohnya HARUS disuntik. Premis yang bersandar pada "kebetulan masih
   * ada contohnya" berhenti membuktikan apa pun begitu contohnya diperbaiki.
   */
  const satu = (kode: string) => situsMutasi({ "x.tsx": kode })[0];

  it("MERAH: mutasi yang galatnya tak ke mana-mana", () => {
    const s = satu(
      `const C = () => {
         const hapus = useMutation({ mutationFn: (id) => api(id), onSuccess: segarkan });
         return <button onClick={() => hapus.mutate(1)}>Hapus</button>;
       };`,
    );
    expect(s.kelas).toBe("SENYAP");
  });

  it("HIJAU: `x.error` dirender", () => {
    const s = satu(
      `const C = () => {
         const hapus = useMutation({ mutationFn: (id) => api(id) });
         return <div><ErrorText error={hapus.error} /></div>;
       };`,
    );
    expect(s.kelas).toBe("TERLIHAT");
  });

  it("HIJAU: `onError` menanganinya sendiri", () => {
    const s = satu(
      `const C = () => {
         const hapus = useMutation({ mutationFn: (id) => api(id), onError: (e) => setPesan(e) });
         return <button onClick={() => hapus.mutate(1)}>Hapus</button>;
       };`,
    );
    expect(s.kelas).toBe("ONERROR");
  });

  it("HIJAU: mutasinya SENDIRI dioper ke pembantu yang dirender", () => {
    // Bentuk `galatTerbaru(a, b, …)` — yang hampir membuat gerbang ini
    // menuduh sembilan pintu yang benar. Tanpa uji ini, pencabutan itu bisa
    // hilang lagi pada generasi berikutnya.
    const s = satu(
      `const C = () => {
         const terima = useMutation({ mutationFn: (id) => api(id) });
         const tolak = useMutation({ mutationFn: (id) => api(id) });
         return <div><ErrorText error={galatTerbaru(terima, tolak)} /></div>;
       };`,
    );
    expect(s.kelas).toBe("TERLIHAT");
    expect(situsMutasi({ "x.tsx": `const C = () => {
         const terima = useMutation({ mutationFn: (id) => api(id) });
         const tolak = useMutation({ mutationFn: (id) => api(id) });
         return <div><ErrorText error={galatTerbaru(terima, tolak)} /></div>;
       };` })[1].kelas).toBe("TERLIHAT");
  });

  it("PASANGAN: `useQuery` tak ikut masuk populasi", () => {
    // Sisi BACA sudah punya gerbangnya sendiri (`gagal-muat-bukan-kosong`,
    // `spinner-abadi`). Gerbang yang menuduh hal yang sama dua kali akan
    // ditutup orang alih-alih dipatuhi.
    expect(
      situsMutasi({ "x.tsx": `const C = () => { const q = useQuery({ queryKey: ["a"] }); return <b>{q.data}</b>; };` }),
    ).toEqual([]);
  });

  it("PASANGAN: pemakaian yang BUKAN jalur galat tak membebaskan", () => {
    // `x.isPending` dan `x.mutate(…)` mengalir ke JSX terus-menerus; kalau
    // salah satunya dihitung sebagai "galatnya terlihat", gerbang ini
    // membebaskan hampir semua situs dan berhenti menjaga apa pun.
    const s = satu(
      `const C = () => {
         const simpan = useMutation({ mutationFn: (x) => api(x) });
         return <button disabled={simpan.isPending} onClick={() => simpan.mutate(1)}>
           {simpan.isPending ? "Menyimpan…" : "Simpan"}
         </button>;
       };`,
    );
    expect(s.kelas).toBe("SENYAP");
  });
});
