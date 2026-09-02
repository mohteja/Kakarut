/**
 * KASIR DIBERI TAHU: NAMA SAJA TIDAK MENJADI MEMBER.
 *
 * Yang tak bisa dijawab uji statis: petunjuknya benar-benar MUNCUL saat kasir
 * mengetik nama, HILANG begitu nomor WA-nya cukup, dan KEMBALI bila nomornya
 * dihapus — tiga transisi di DOM sungguhan, dari medan yang sama dengan yang
 * dipakai kasir. Premisnya dibuktikan lebih dulu: medan kosong → tak ada
 * petunjuk (kalau petunjuknya selalu tampil, semua asersi "muncul" hampa).
 *
 * MASUK LEWAT SESI, bukan layar login — `/auth/login` dibatasi 10 per 5 menit
 * dan suite ini duduk di langit-langit itu; `sesiApi` menyimpan sesinya per
 * proses (workers: 1), jadi spec ini tak menambah satu login pun.
 */
import { expect, test } from "@playwright/test";
import { absenMasuk, KASIR_EMAIL, KASIR_PASS, masukLewatSesi, pastikanShiftTerbuka } from "./util";

test("kasir: nama tanpa WA → petunjuk menyebut namanya; WA sah → petunjuk hilang", async ({
  page,
  request,
}) => {
  await absenMasuk(request, KASIR_EMAIL, KASIR_PASS);
  await masukLewatSesi(page, request, KASIR_EMAIL, KASIR_PASS);
  await page.goto("/kasir");
  await pastikanShiftTerbuka(page);

  const nama = page.getByPlaceholder("👤 Nama konsumen");
  const wa = page.getByPlaceholder("📱 No. WhatsApp");
  await expect(nama, "premis: medan nama konsumen tampil").toBeVisible();
  const petunjuk = page.getByRole("status").filter({ hasText: /member/i });

  // PREMIS: keduanya kosong → diam.
  await expect(petunjuk, "premis: tanpa isian tak ada petunjuk").toHaveCount(0);

  await nama.fill("Tamu Uji Petunjuk");
  await expect(petunjuk, "nama tanpa WA tidak diberi tahu").toContainText("Tamu Uji Petunjuk");
  await expect(petunjuk).toContainText("tidak tersimpan sebagai member");

  await wa.fill("0812");
  await expect(petunjuk, "WA 4 angka tidak disebut terlalu pendek").toContainText("terlalu pendek");

  await wa.fill("0812 3456 7890");
  await expect(petunjuk, "WA sah masih memunculkan petunjuk").toHaveCount(0);

  // PASANGAN: hapus WA → petunjuk kembali. Bukan pintu satu arah.
  await wa.fill("");
  await expect(petunjuk, "petunjuk tak kembali sesudah WA dihapus").toContainText(
    "tidak tersimpan sebagai member",
  );
});
