# Spesifikasi Handoff Backend — Sistem HPP & Stok Basooopa

Dokumen ini untuk tim backend yang akan membangun versi produksi (API + database) dari prototipe Basooopa. Disusun 9 Juli 2026.

## 1. File yang perlu diserahkan ke tim backend

Cukup tiga file (ada di folder `web-app-assets/`, kecuali sumber Excel):

1. **`basooopa-backend-data.json`** — DATA UTAMA. Model data lengkap dalam bentuk mesin: daftar bahan (master), resep tiap menu (bill of materials), aturan markup, dan rumus. Ini yang di-seed ke database.
2. **`basooopa-hpp-app.html`** — PROTOTIPE REFERENSI. Semua logika bisnis (hitung HPP, markup, potong stok, kasir, produksi) sudah berjalan di sini. Backend cukup meniru perilakunya. Buka di browser untuk melihat perilaku yang diharapkan; logika ada di dalam tag `<script>`.
3. **`HPP BASO (revisi).xlsx`** — SUMBER KEBENARAN. Rujukan angka bila ada keraguan; sheet "Menu Baru", "HPP Dine-in", "Target Penjualan (BEP)" berisi rumus asli.

Dokumen ini (`SPEC-BACKEND-basooopa.md`) menjelaskan model & aturannya. File lain di folder (menu book, mockup, analisis kompetitor, papan kompetitor) bersifat bisnis/branding — tidak diperlukan backend.

## 2. Model data (entitas)

**master (bahan baku)** — 90 baris. Field: `id` (slug unik), `nama`, `harga_beli` (harga satu satuan pembelian, IDR), `isi` (jumlah unit hasil satu pembelian), `kategori` (`baso` | `minuman` | `lain`), `catatan`. Harga per unit = `harga_beli / isi`.

Penting soal satuan `isi`:
- Item baso (mis. "baso urat besar"): `isi` = jumlah butir hasil satu batch produksi (Rp249.000 → 90 butir besar). Jadi satu pembelian daging menghasilkan sekian butir.
- Item minuman/kemasan: `isi` = jumlah gr/ml/pcs per pembelian (realistis).
- Item racikan per-porsi ("kuah dan bumbu", "complement saos & sambal", "topping mie dkk"): `isi = 1` = satu porsi. Di produksi nyata ini dibuat batch besar; backend sebaiknya izinkan set stok dalam satuan porsi.

**recipe (resep menu / bill of materials)** — 60 baris. Field: `menu` (nama), `kategori`, `mult` (pengali markup, mis. 2.0 = HPP × 2), `jual` (harga jual final IDR), `komponen` (array `{bahan: master.id, qty}`). `qty` adalah jumlah unit master yang dipakai satu porsi (mis. 4 butir baso aci original → `qty: 4`; 0.7576 artinya sebagian dari satu unit master).

**paketYamin** — 2 baris, dihitung khusus (lihat rumus di bawah). Field: `menu`, `base` (nama recipe yamin dasar), `base_mult`, `jual`.

## 3. Aturan bisnis & rumus (WAJIB ditiru persis)

Semua ada juga di blok `_meta` file JSON. Ringkasnya:

- **Harga per unit bahan** = `harga_beli / isi`.
- **HPP menu** = jumlah dari (`qty` × harga_per_unit) untuk semua komponen resep.
- **Harga saran** = `HPP × mult`.
- **Harga jual bulat** = `ROUND(harga_saran / 1000) × 1000`.
- **Food cost %** = `HPP / harga_jual × 100`.
- **Paket Yamin** (kasus khusus, keputusan pemilik): HPP = HPP(yamin dasar) + 2×(baso urat kecil) + 2×(baso aci original); Harga = HPP(yamin dasar) × `base_mult` + biaya topping tsb **tanpa overhead tambahan** (topping dibebankan pada harga aslinya). Hasil: Ori Rp11.000, Misdasem Rp15.000.
- **Mode dine-in** (opsional per transaksi): HPP dihitung tanpa komponen kemasan take-away (lihat daftar `komponen_kemasan_take_away`) dan komponen `complement saos & sambal` dikali 0.5.

Markup (`mult`) sudah tersimpan per menu, tapi asalnya dari aturan kategori: food set 100%, minuman 150–175%, teh 150%, frozen/dessert 100–150%, yamin satuan 200%, side dish 250–350%, oseng 0%, paket yamin 0%. Backend cukup pakai `mult` yang sudah ada; aturan kategori hanya untuk menambah menu baru.

## 4. Logika stok (loop persediaan)

Tiga tabel transaksi + satu saldo:
- **stok_awal** per master (hasil stok opname / setelan awal).
- **produksi**: catatan menambah stok — `{master_id, qty, waktu}`. Contoh "produksi 1 batch" menambah `master.isi`.
- **penjualan**: tiap transaksi kasir berisi item `{menu, qty, harga}`; total omzet = Σ(harga×qty). Konsumsi bahan per transaksi = untuk tiap item, `komponen.qty × qty` diakumulasi per master.
- **Saldo stok** master = `stok_awal + Σ produksi − Σ terpakai`. Status: Habis (saldo ≤ 0 & ada pemakaian), Menipis (saldo/(awal+produksi) < 15%), else Aman.

Prototipe memakai satu "hari" in-memory dan ekspor/impor JSON `{stokAwal, produksi, terjual, riwayatJual, riwayatProd}`. Backend sebaiknya menyimpan per-tanggal (histori) dan menghitung saldo dari akumulasi transaksi.

## 5. Saran skema database (opsional, sebagai titik awal)

Tabel: `bahan` (dari master), `menu` + `menu_komponen` (dari recipes; many-to-many ke bahan dengan qty), `transaksi_penjualan` + `transaksi_item`, `produksi`, `stok_opname`. HPP & harga bisa disimpan denormal (cache) ATAU dihitung on-the-fly dari `bahan.harga_beli` + `menu_komponen` — pendekatan hitung-langsung menjaga konsistensi saat harga bahan berubah (ini yang dilakukan prototipe).

Saran endpoint minimum: `GET /bahan`, `PUT /bahan/:id` (ubah harga), `GET /menu` (dengan hpp & harga terhitung), `POST /penjualan`, `POST /produksi`, `GET /stok` (saldo + status), `GET /laporan?tanggal=`.

## 6. Yang belum final (beri tahu tim backend)

- Bahan racikan per-porsi (`isi=1`) perlu keputusan: apakah stoknya dilacak dalam porsi, atau di-derive dari bahan mentahnya. Prototipe melacak dalam porsi.
- Ceker & Kikil (sudah ada di master) belum masuk daftar menu jual resmi.
- Angka BEP/target di sheet "Target Penjualan" adalah kalkulator terpisah (biaya tetap ÷ margin kontribusi) — bisa jadi modul laporan, bukan bagian inti transaksi.
- Belum ada konsep pajak (PB1 10%) — jika nanti diberlakukan, tambahkan di layer harga jual.
