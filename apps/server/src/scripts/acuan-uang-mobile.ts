/**
 * Hasilkan fikstur acuan untuk uji cermin di `kakarut-mobile`.
 *
 * Dart tak bisa mengimpor `@kakarut/shared`, jadi tiga fungsi uang di repo
 * mobile memang salinan: `hitungPb1`, `tarifPb1Struk`,
 * `hitungUangSetelahRefund`. Yang membuat salinan itu bisa dipercaya bukan
 * pembacaan berulang, melainkan JAWABANNYA diadu dengan yang asli.
 *
 * Berkas keluarannya — `test/fikstur/uang-acuan-server.txt` di repo mobile —
 * DIHASILKAN dari implementasi di sini, bukan diketik ulang. Jalankan skrip ini
 * lalu tempatkan keluarannya di sana setiap kali salah satu rumus berubah:
 *
 *     npm run --silent acuan:uang-mobile -w @kakarut/server > \
 *       ../kakarut-mobile/test/fikstur/uang-acuan-server.txt
 *
 * Yang ditemukan lewat adu ini: lembar pembayaran mobile menghitung
 * `net × tarif ÷ 100`, sedangkan di sini `net × (tarif ÷ 100)` — terukur
 * berbeda satu rupiah pada net Rp 25.000 tarif 1,13% (Rp 282 vs Rp 283).
 */
import { hitungPb1, hitungUangSetelahRefund, tarifPb1Struk } from "@kakarut/shared";

const keluar: string[] = [];

for (const sub of [0, 1, 7, 33, 99, 100, 333, 1_234, 9_999, 12_345, 99_999, 1_000_000, 7_777_777]) {
  for (const rate of [0, 1, 2.5, 5, 7.5, 10, 11, 11.5, 12.34, 33.33, 50, 99.99, 100]) {
    keluar.push(`pb1|${sub}|${rate}|${hitungPb1(sub, rate)}`);
  }
}

for (const sub of [1_000, 12_345, 99_999, 333_333]) {
  for (const dis of [0, 1, 500, 1_234]) {
    for (const rate of [0, 5, 10, 11, 12.34, 33.33]) {
      const pb1 = hitungPb1(sub - dis, rate);
      keluar.push(`tarif|${sub}|${dis}|${pb1}|${tarifPb1Struk(sub, dis, pb1) ?? "null"}`);
    }
  }
}

for (const h of [1_000, 3_333, 12_500]) {
  for (const qty of [1, 3, 7]) {
    for (const ref of [0, 1, 3, 7]) {
      if (ref > qty) continue;
      for (const dAsal of [0, 1, 999, 5_000]) {
        for (const pAsal of [0, 1, 777, 12_345]) {
          const r = hitungUangSetelahRefund(
            [{ hargaSatuan: h, qty, qtyRefund: ref }],
            { subtotal: h * qty, diskon: dAsal, pb1: pAsal },
          );
          keluar.push(
            `refund|${h}|${qty}|${ref}|${dAsal}|${pAsal}|${r.subtotal}|${r.diskon}|${r.pb1}|${r.total}`,
          );
        }
      }
    }
  }
}

console.log(keluar.join("\n"));
