import { describe, expect, it } from "vitest";
import { qtyTeks } from "@kakarut/shared";
import { barisMenggantung } from "../src/modules/penerimaan/routes";

/**
 * BARIS KIRIMAN MENGGANTUNG — DIUJI DI SINI KARENA KAWAT TAK BISA.
 *
 * `GET /penerimaan/anomali` memulangkan `rows` yang, kalau semuanya benar,
 * SELALU KOSONG: §157 verify-api ada persis untuk membuktikan tak ada satu
 * pun pintu kirim yang meninggalkan barang menggantung, dan ia menagih
 * `jumlah == 0` sesudah menempuh kelimanya. Akibatnya bentuk BARISNYA tak
 * pernah bisa diadu dari kawat — §309/§311 tak pernah melihat satu pun
 * `KirimanMenggantung`, dan itu tercatat di antrean sebagai batas.
 *
 * Yang menutup celah itu di sini: perakitnya fungsi MURNI, jadi ia bisa
 * diberi baris SQL karangan dan hasilnya diperiksa medan demi medan.
 *
 * KENAPA `qty_teks` ADA DI BARIS INI SAMA SEKALI. Sampai 2026-09-11 rute ini
 * tak mengirimnya, dan KEDUA klien merakit `formatAngka(qty) + satuan`
 * sendiri (`PenerimaanPage.tsx`, `anomali_page.dart`) — satu-satunya pilihan
 * yang ada. Menebak satuan sendiri sudah pernah melahirkan "900 kg" untuk
 * barang yang sebenarnya 900 gr; kasus itu diuji harfiah di bawah.
 */
const BARIS = {
  id: "11111111-1111-4111-8111-111111111111",
  faktur_id: "22222222-2222-4222-8222-222222222222",
  nomor: "PR-2026-0007",
  tipe: "produksi",
  status: "menunggu",
  qty: 900,
  waktu: new Date("2026-09-10T14:37:32.000Z"),
  bahan: "Tepung Terigu",
  satuan: "gr",
  isi: 1000,
  satuan_beli: "kg",
  posisi_sekarang: "Cabang 2",
  dikirim_dari: "Central Kitchen",
  umur_hari: 3,
};

describe("barisMenggantung — perakit tunggal baris kiriman menggantung", () => {
  it("PREMIS: seluruh medan kontrak terisi, tak ada yang undefined", () => {
    // Baris SQL mentah tak membawa tipe apa pun; yang menahan bentuknya cuma
    // fungsi ini. Medan yang lupa ditulis lolos typecheck sebagai `undefined`
    // di sini kalau kontraknya opsional — jadi kelengkapannya dipaku juga.
    const b = barisMenggantung(BARIS);
    expect(Object.keys(b).sort()).toEqual([
      "bahan",
      "dikirim_dari",
      "faktur_id",
      "id",
      "nomor",
      "posisi_sekarang",
      "qty",
      "qty_setara",
      "qty_teks",
      "satuan",
      "status",
      "tipe",
      "umur_hari",
      "waktu",
    ]);
    for (const [k, v] of Object.entries(b)) {
      expect(v, `${k} undefined`).not.toBeUndefined();
    }
  });

  it('INTI: "900 gr" — BUKAN "900 kg", dan itu kejadian yang pernah terjadi', () => {
    const b = barisMenggantung(BARIS);
    expect(b.qty_teks).toBe("900 gr");
    expect(b.qty_setara).toBe("≈ 0,9 kg");
    // …dan teksnya SAMA PERSIS dengan pembantu bersama, bukan ejaan sendiri.
    const acuan = qtyTeks({ qty: 900, satuan: "gr", isi: 1000, satuanBeli: "kg" });
    expect(b.qty_teks).toBe(acuan.teks);
    expect(b.qty_setara).toBe(acuan.setara);
  });

  it("bahan tanpa kemasan: setara null, teks tetap terisi", () => {
    const b = barisMenggantung({ ...BARIS, isi: null, satuan_beli: null });
    expect(b.qty_teks).toBe("900 gr");
    expect(b.qty_setara).toBeNull();
  });

  it("stempel waktu ISO-8601, bukan keluaran Date.toString", () => {
    // Kelas yang dibayar #111: `String(new Date())` memulangkan "Thu Sep 10
    // 2026 …", yang `DateTime.tryParse` Dart tolak.
    expect(barisMenggantung(BARIS).waktu).toBe("2026-09-10T14:37:32.000Z");
    // …dan kolom yang sudah berupa teks diteruskan apa adanya
    expect(barisMenggantung({ ...BARIS, waktu: "2026-09-10T14:37:32.000Z" }).waktu).toBe(
      "2026-09-10T14:37:32.000Z",
    );
  });

  it("null dipertahankan null — bukan berubah jadi teks \"null\"", () => {
    /*
     * `String(null)` memulangkan `"null"`, sebuah teks empat huruf yang
     * tercetak di layar sebagai nama cabang. Ketiga medan opsional di baris
     * ini melewati penjaga eksplisit justru karena itu.
     */
    const b = barisMenggantung({ ...BARIS, nomor: null, posisi_sekarang: null, dikirim_dari: null });
    expect(b.nomor).toBeNull();
    expect(b.posisi_sekarang).toBeNull();
    expect(b.dikirim_dari).toBeNull();
  });

  it("angka datang sebagai ANGKA, walau kolomnya teks", () => {
    // Baris SQL mentah bisa memulangkan `numeric` sebagai string di driver
    // lain; `Number(...)` di perakitnya yang menahannya.
    const b = barisMenggantung({ ...BARIS, qty: "900", umur_hari: "3" });
    expect(b.qty).toBe(900);
    expect(b.umur_hari).toBe(3);
    expect(b.qty_teks).toBe("900 gr");
  });
});
