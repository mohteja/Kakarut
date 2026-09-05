# Peta vena audit

Satu entri per **vena** — satu populasi yang disapu mekanis dari ujung ke
ujung. Berkas ini ada karena satu alasan tunggal: **ingatan**. Tanpa peta,
tiap sesi baru memeriksa ulang yang sudah bersih dan tak pernah sampai ke yang
belum tersentuh.

## Kenapa mekanis, bukan membaca modul

Hampir setiap bug yang ditemukan berbentuk sama, dan bentuknya BUKAN "tak ada
yang memikirkan aturan ini":

> Aturannya sudah dipikirkan, ditulis, bahkan dikomentari panjang. Penjaganya
> dipasang di **satu** pintu menuju keadaan yang dijaga, lalu pintu lain ke
> keadaan yang sama dibiarkan terbuka.

`sql<number>` tanpa cast, `date -u` di §218, dan `POST /karyawan/undang` tanpa
batas laju semuanya begitu — pada dua yang terakhir, komentar di berkas yang
SAMA sudah menuliskan aturannya. Tak satu pun ditemukan dengan membaca kode;
semuanya muncul dari menyapu seluruh populasi lalu memisahkan yang menyimpang.

## Aturan menulis entri

Tanpa keempatnya, berkas ini berubah jadi daftar hijau yang tak pernah dibayar:

1. **"BERSIH" hanya sah bila detektornya DIBUKTIKAN bisa menuduh.** Baris
   `Detektor:` wajib menyebut bagaimana pembuktiannya. Sapuan yang tak pernah
   merah tidak menyatakan apa pun.
2. **Populasinya disebut angkanya.** "Sudah diperiksa" tanpa angka tak bisa
   ditinjau siapa pun.
3. **Temuan memuat ukurannya**, sebelum dan sesudah.
4. **Batas detektornya ditulis jujur.** Vena yang bersih *dalam batas tertentu*
   bukan vena yang bersih.
5. **CAKUPAN disebut, bukan cuma kemampuan menuduh.** Bukti merah menjawab
   "bisakah detektornya menuduh?" — ia TIDAK menjawab "berapa banyak yang
   dilihatnya?". Sudah terjadi: gerbang larik dibuktikan bisa menuduh, lalu
   dikirim dengan regex yang hanya melihat 18 dari 39. Tiap entri karena itu
   menyebut populasinya, dan sedapat mungkin membandingkannya dengan cara
   hitung kedua.

6. **DATA SUNTIKAN WAJIB DIBUKTIKAN TERBACA.** Mengukur di atas data uji hanya
   sah bila kuerinya benar-benar MELIHAT data itu — dan yang membuktikannya
   angka dari balasan rutenya sendiri, bukan `SELECT count(*)` di basis data.
   Sudah terjadi, dan menghasilkan kesimpulan yang salah masuk ledger: 50.111
   penjualan yang kusuntikkan mendarat di PERUSAHAAN LAIN, sementara tokennya
   milik perusahaan yang punya 98. Kuerinya tak pernah melihat satu pun baris
   itu, dan "laporan agregat ternyata murah (0,035 dtk)" tercatat sebagai
   temuan terukur. Diukur ulang dengan tenant yang benar: **0,212 dtk**.
   `scripts/ukur-latensi.sh` menolak berjalan sampai premis itu terbukti.

---

## Layar masuk ponsel diam pada KODE penolakan yang sudah dikirim server — dan salinan literal yang akhirnya diikat ke sumbernya — ponsel + server — 2026-09-05

**Vena.** Butir teratas antrean: "Ponsel: tombol Daftar di layar masuk belum
membawa alamatnya" (lahir dari putaran `/login` menyebut alasannya,
2026-09-03).

**Populasi.** Empat kode `SEBAB_LOGIN` × tiga permukaan.

| | server melempar | web bercabang | ponsel bercabang |
| --- | --- | --- | --- |
| `email_tak_dikenal` | ✓ | ✓ tautan "Daftar dengan email ini →" `?email=` | **✗** |
| `akun_terhapus` | ✓ (jaring; tombstone diganti nama → jatuh ke `email_tak_dikenal`) | — | — |
| `akun_nonaktif` | ✓ | — | — |
| `password_salah` | ✓ | — | — |

Diukur lewat HTTP terhadap server gerbang (2026-09-05): alamat tak dikenal →
401 `{"sebab":"email_tak_dikenal"}`; password salah → `password_salah`; akun
`is_active=false` → `akun_nonaktif` (cabangnya SEBELUM password — password
apa pun); alamat cacat (`bukan-email`) → `email_tak_dikenal`; akun
belum-verifikasi dengan password salah → `password_salah` (cabang 403 belum
verifikasi baru sesudah password cocok). `ApiException.data` di ponsel sudah
membawa badan itu utuh; `login_page.dart` menampilkan `e.message` lalu
berhenti. Satu-satunya dari keempatnya yang bisa diselesaikan orangnya
sendiri di layar itu — dan pembaca tersering adalah karyawan yang SUDAH
diundang (undangan cuma baris `invitations`).

**Temuan kedua, di gerbang.** `status_cermin_server_test.dart` (ponsel)
menagih tiap `x == 'nilai'` ber-medan enum ke fikstur `status-kontrak-server`.
Fikstur itu punya TIGA sumber (pgEnum, `z.enum`/`kode:`/`sebab:` literal di
rute, union literal bernama di shared) — dan `SEBAB_LOGIN` lolos dari
ketiganya: server melemparnya lewat `SEBAB_LOGIN.takTerdaftar` (bukan literal
`sebab: "…"`), dan tipenya `(typeof X)[keyof typeof X]` (bukan union literal).
Jadi ponsel yang menulis `sebab == 'email_tak_dikenal'` — hal yang BENAR —
akan dituduh memakai nilai "yang tak ada di kontrak mana pun", dan jalan
keluar termudahnya adalah mendaftarkannya di `milikPonsel`: pengecualian yang
memutus ikatan ke sumber persis pada nilai yang paling butuh ikatan itu.

### Yang dibangun

- **Server** — `acuan-status-mobile.ts` sumber ke-4 `konst:<NAMA>`: objek
  `export const X = {…} as const` di `packages/shared`, hanya nilai berbentuk
  kode (`^[a-z][a-z0-9_]*$`) — `PESAN_LOGIN` yang bertetangga dan berbentuk
  sama TIDAK ikut (kalimat manusia bukan kontrak mesin). Fikstur ponsel +4
  baris. `status-satu-kontrak.test.ts`: KEEMPAT sumber terwakili,
  `email_tak_dikenal` ada, `konst:PESAN_LOGIN|` nol. `login-beralasan.test.ts`
  lengan lintas-repo (bila repo ponsel ada): `login_page.dart` memuat
  `== '${SEBAB_LOGIN.takTerdaftar}'` (nilainya DIBACA dari shared, bukan
  diketik), `RegisterPage(emailAwal:`, TIDAK memuat `PESAN_LOGIN.takTerdaftar`
  maupun `contains('…terdaftar')`; `register_page.dart` membaca
  `widget.emailAwal`; fikstur ponsel memuat keempat `konst:SEBAB_LOGIN|…`.
- **Ponsel** — `login_page.dart`: `_sebab` dari `e.data?['sebab']`, tombol
  "Daftar dengan email ini →" hanya bila `== 'email_tak_dikenal'`, membuka
  `RegisterPage(emailAwal: alamat yang diketik)`; `_tamu` ikut mereset
  `_sebab`. `register_page.dart`: `emailAwal` (trim → kolom email).
  `test/sebab_login_ponsel_test.dart`: widget test (kode → tombol →
  `RegisterPage` dengan kolom terisi; `password_salah` → tanpa tombol; kalimat
  yang SAMA tanpa kode → tanpa tombol — bukti layarnya tak mengendus teks;
  `emailAwal` terisi/kosong), statis, ikatan fikstur.

### Detektor & bukti merah

Asersi statis ditiru Python sebelum push; lengan server dijalankan vitest.
Dipulihkan byte-per-byte.

| | dicabut | tertuduh |
| --- | --- | --- |
| QQ | kode diganti `_error!.contains('tidak terdaftar')` | cermin ponsel: `login: tak bercabang pada kode`; lengan server: `expected … to contain "== 'email_tak_dikenal'"` |
| RR | `widget.emailAwal` diabaikan di `initState` | `daftar: emailAwal tak dibaca` |
| SS | baris `konst:SEBAB_LOGIN|email_tak_dikenal` dicabut dari fikstur | tiruan `status_cermin`: `_sebab == 'email_tak_dikenal'` asing; lengan server: `konst:SEBAB_LOGIN|email_tak_dikenal hilang dari fikstur ponsel — regenerasi` |

Catatan jujur atas alat ukurnya: skrip bukti merah menilai lengan server
lewat kode keluar, padahal perintahnya dipipakan ke `grep` (keluar 0) — skor
otomatisnya "gagal menuduh" untuk QQ-server dan SS-server, sementara baris
`AssertionError` yang tertangkap adalah persis tuduhan yang diharapkan.
Yang dipercaya barisnya, bukan skornya; skripnya alat sekali pakai.

### Batas yang diakui

- Tak ada Flutter di mesin ini; widget test-nya (memompa `LoginPage` dan
  `RegisterPage` sungguhan, termasuk `Image.asset`) adalah asersi yang belum
  pernah dijalankan siapa pun sebelum CI — kalau CI merah, itu kabar dari
  putaran ini sendiri.
- Tiga kode lain (`akun_terhapus`, `akun_nonaktif`, `password_salah`) tetap
  hanya kalimat di kedua klien — sama dengan web; tak ada tindakan yang bisa
  ditawarkan layar untuk ketiganya.
- `akun_terhapus` tak bisa diukur lewat HTTP: tombstone diganti nama
  (`deleted:<id>:<email>`), dan alamat `hapus96@…` di DB gerbang sudah
  didaftarkan ulang (→ `password_salah`). Cabangnya jaring, seperti ditulis
  di `PESAN_LOGIN`.
- Butir antrean "`/register` & `/resend-verification` masih netral" TIDAK
  disentuh — itu keputusan pemilik, bukan pekerjaan.

### Gerbang

- Ponsel: commit `2715d68` di `claude`, PR #18. CI #44 (run 33971591264)
  masih berjalan saat entri ini di-commit — verdiknya tercatat di PR #18 dan
  distempel di sini pada commit berikutnya.
- Server: typecheck hijau; vitest penuh **242 berkas / 3.012 uji hijau**
  (3.009 + 3 lengan baru). verify-api & e2e tidak dijalankan — nol perubahan
  rute/web.
- **Tak ada rilis.**

## Sepuluh daftar ponsel yang dipotong server dan DIAM — satu rumah, sebelas pengakuan, tiga lencana yang berhenti berbohong — ponsel + cermin server — 2026-09-05

**Vena.** Utang yang tercatat eksplisit di antrean Mobile sejak 2026-08-31:
"Header `X-Kakarut-Terpotong` belum dirender ponsel". Diambil sesudah antrean
A⁷/B⁷ lunas; keputusan pemilik untuk putarannya: **ponsel-saja, tanpa perubahan
API** — lencana selisih kas beralih ke `GET /shift/selisih/ringkas` yang sudah
ada, dua lencana lain tampil "N+" saat daftarnya terpotong, dan pintu ringkas
server untuk keduanya masuk antrean.

**Populasi, disapu mekanis rute → repository → layar.** Di server: 14 situs
pengirim pemotongan (`potongLarik(` ×11, `rows_terpotong:` ×2,
`riwayat_terpotong:` ×1), 13 di luar panel super admin. Di ponsel:

| | jumlah |
| --- | --- |
| tak dipanggil ponsel (`/stok/opname` baris mentah, `/supplier/:id/kartu`) | 2 |
| dirender — `sampah_page.dart`, SATU-SATUNYA pembaca header di seluruh aplikasi | 1 |
| **DIAM** — dibaca `as List` telanjang, header/bendera dibuang | **10** |

Yang diam, dan layarnya: `/shift` (Tutup Kasir + lembar riwayat Operasional
Cabang), `/shift/selisih` (Selisih Kas), `/stok/exp`, `/stok/opname/riwayat`
(Riwayat SO + 2 situs lencana), `/perlengkapan/opname/riwayat` (Riwayat SO
Perlengkapan + 2 situs lencana), `/perlengkapan/kiriman` (spanduk kiriman +
3 situs lencana), `/menu/:id/riwayat-harga` (lembar riwayat harga di Analisis
Harga), `/laporan/durasi-pesanan` (`riwayat_terpotong` tak pernah diurai —
`operasional_models.dart:1374`), `/transfer-stok` (`rows_terpotong` dibuang di
`transfer_repository.dart:51`, dan ponsel meminta **`per_page=50`** sendiri
padahal maksimum server 200), `/stok/penyesuaian` (utang tertulis sejak 2026-08).

**Tiga lencana dihitung `.length` atas daftar yang sudah dipotong**, jadi
mentok diam-diam: selisih kas → 50 (`shift_repository.dart:51`), SO menunggu
ACC → 200 (`dashboard_page.dart:87`, `kasir_page.dart:1358`), kiriman belum
diterima → 50 (`kasir_page.dart:1351`, `dashboard_tim.dart:120`,
`dashboard_page.dart:95`). Lencana yang berhenti bergerak justru saat antreannya
paling panjang. Server **sudah** punya `GET /shift/selisih/ringkas` (seluruh
populasi, lahir 2026-09-03 untuk sidebar web) yang ponsel tak pernah panggil.

**Tak ada rumah bersama.** Delapan situs yang SUDAH mengaku merakit kalimatnya
sendiri: 4 rumusan, 3 warna (`grey.shade600`, `orange.shade800`,
`amber.shade900`), 2 penempatan (di atas daftar / di bawah), 1 duplikat
verbatim (`kartu_stok_page.dart:128` = `perlengkapan_stok_page.dart:1176`).

### Yang dibangun (repo `kakarut-mobile`, satu commit)

- **`lib/core/widgets/daftar_dipotong.dart`** (baru, 200 baris): `Berbatas<T>`
  (`rows` + `batas`; header absen = utuh, BUKAN nol; `0`/`-1`/teks tak
  dipercaya), `bacaBerbatas(api, path, dari, {query})` — pola `sampah_page`
  dipindah, bukan disalin — `kalimatDipotong({ditampilkan, total?, apa,
  lanjutan?})` SATU rumusan ("Menampilkan N [dari T] apa — selebihnya tidak
  ikut dimuat. Buka Kakarut di peramban untuk daftar lengkapnya."; kalimat
  khusus layar MENAMBAH lewat `lanjutan`, tak mengganti), `DaftarDipotong`
  (satu warna `orange.shade800`, satu ikon, satu tempat: baris penutup
  daftar), `labelLencana(n, terpotong:)` → `"50+"`, `Lencana` +
  `hitungLencana`/`gabungLencana`, `keteranganLencanaDipotong`.
- **Repository → `Berbatas`**: `shift` (`/shift`, `/shift/selisih`, +
  `getRingkasSelisih` + model `RingkasSelisih{menunggu, terpotong}`), `stok`
  (`/stok/exp`, `/stok/opname/riwayat`, `/stok/penyesuaian`), `perlengkapan`
  (`/perlengkapan/opname/riwayat`, `/perlengkapan/kiriman`), `manajemen`
  (`/menu/:id/riwayat-harga`), `transfer` (`rows_terpotong` dibaca,
  **`per_page` 50 → 200**), `LaporanDurasi.riwayatTerpotong`.
- **12 layar memasang `DaftarDipotong`** bila `terpotong`: shift_page,
  operasional_cabang_page, selisih_kas_page, stok_exp_page,
  opname_riwayat_page, opname_perlengkapan_page, perlengkapan_stok_page
  (spanduk kiriman — angkanya pun lewat `labelLencana`), analisis_harga_page,
  laporan_page (kalimatnya menyebut bahwa sajian terhitung/rata-rata/per
  menu TIDAK terpotong), transfer_page, penyesuaian_page, sampah_page.
- **8 situs lama pindah rumah**: sampah (`IsiSampah` kini
  `typedef Berbatas<SampahRow>`), kartu_fifo, kartu_stok, kartu perlengkapan,
  beli_perlengkapan, permintaan, riwayat_harga_sheet, shift_detail. Kalimat
  khususnya masuk `lanjutan`. Dua kartu (stok & perlengkapan) mendapat
  kalimat yang dulu tak pernah dikatakan: server menjalankan saldo hanya atas
  mutasi yang dikirim (`stok/service.ts:498`, `perlengkapan/service.ts:610`),
  jadi **saldo akhir & total di kartu ikut terpotong**, bukan cuma daftarnya —
  kalimatnya kini bilang "persempit rentang tanggalnya".
- **Tiga lencana, satu aturan**: selisih kas dari `RingkasSelisih.menunggu`
  (+ `terpotong` milik ringkas bila kuerinya sendiri menyentuh plafon); SO
  menunggu & kiriman lewat `hitungLencana` → `BadgeAngka(terpotong:)` /
  `BarisAksi(terpotong:)` → "200+" / "50+". Aturan nol: **0 pada daftar
  terpotong tetap tanpa lencana** — "0+" di tiap layar warung besar adalah
  peringatan yang orang belajar abaikan; sisa ketidakpastiannya diucapkan
  `DaftarDipotong` di layar daftarnya.
- `kunci-belum-dibaca.txt`: `rows_terpotong` dan `riwayat_terpotong` DICABUT
  (keduanya kini dibaca; ratchet dua arah `kunci_kontrak_server_test`
  menagihnya). Layar kartu supplier tetap belum ada — yang berubah cuma nama
  medannya yang kini punya pembaca lain.

### Detektor — `test/daftar_dipotong_test.dart` (Dart) + cermin server

- **premis**: 11 rute, tiap rute punya pemanggil di `lib/`; pemakai provider
  ≥ 12 layar + 3 berkas lencana; rumah memuat keenam penghuninya.
- **INTI-1**: rute ber-header — nol `.get('<jalur>'` telanjang di `lib/`
  (komentar dibutakan; `/shift` tak menuduh `/shift/pantau`; `:id` cocok
  `$x`/`${x}`), ≥ 1 `bacaBerbatas(…'<jalur>'`; rute berkunci badan — kunci
  `'rows_terpotong'`/`'riwayat_terpotong'` dibaca di fitur pemanggilnya.
- **INTI-2**: tiap berkas yang `ref.watch` salah satu dari 12 provider daftar
  memuat `DaftarDipotong(` — kecuali 3 berkas lencana, yang wajib
  `hitungLencana(`.
- **INTI-3**: nol kalimat rakitan tangan di luar rumah: literal string
  (bersebelahan disambung; interpolasi `${…}` dibuang) yang dibuka
  "Menampilkan " atau memuat `terpotong`/`dipotong` sebagai kata; frasa
  `stok terpotong` (potongan STOK: "stok terpotong setelah di-ACC")
  dikecualikan — satu-satunya arti lain kata itu, terukur 3 literal.
- **INTI-4**: berkas lencana tanpa bentuk lama `ref.watch(P)…asData?.value
  ?? …length`; `selisihMenungguProvider` memanggil `getRingkasSelisih`,
  tanpa `.length`, rute `'/shift/selisih/ringkas'` ada; lencana selisih di
  kasir membawa `terpotong:`; `BadgeAngka` memakai `labelLencana`.
- **unit**: `batasDariHeader` (5 nilai omong kosong → null), `bacaBerbatas`
  atas `ApiClient` palsu ber-header, `kalimatDipotong` 3 varian,
  `labelLencana`, `hitungLencana` 4 keadaan + `gabungLencana`,
  `LaporanDurasi.riwayatTerpotong`, `TransferRepository.getFaktur`
  (`per_page=200` + `rows_terpotong`), `RingkasSelisih.fromJson`.
- **widget**: `DaftarDipotong` melukis kalimatnya; `BadgeAngka(terpotong:)`
  → teks `50+` (dan `50` tanpanya); `BarisAksi` meneruskannya.
- **PASANGAN**: pemindai `.get` telanjang vs `bacaBerbatas`, jalur `:id`,
  awalan `/shift` vs `/shift/pantau`, komentar; kalimat rakitan — kedelapan
  rumusan lama tertuduh, 6 literal sah (termasuk interpolasi
  `${labelLencana(…, terpotong: t)}` dan `'x-kakarut-terpotong'`) tidak.
- **Cermin lintas-repo di SERVER** —
  `apps/server/test/rute-terpotong-satu-kontrak.test.ts`: himpunan rute
  pengirim DIURAI dari `modules/*/routes.ts` (penanda → deklarasi `.get("`
  di awal baris — `c.get("auth")` di tengah baris sempat menang dan
  menghasilkan `/shiftauth`; itu bukti pertama pengurainya jalan — + mount
  dari `app.ts`), dikurangi 3 pengecualian BERALASAN (super admin,
  `/stok/opname` baris mentah, kartu supplier) yang alasannya ikut diperiksa:
  rute yang dikecualikan karena "tak dipanggil ponsel" memang tak boleh muncul
  di `lib/` ponsel. Dua arah terhadap `ruteTerpotong` Dart. Ambang premis
  pengurai Dart SENGAJA 8 (< 11): pengurai buta memberi 0, sedangkan satu
  rute yang dicabut harus jatuh ke asersi BERNAMA RUTE — versi pertama
  berambang 11 dan menuduh lewat premis, tanpa nama; dibetulkan.

**Bukti merah** (Python meniru tiap asersi statis; dipulihkan byte-per-byte,
`cmp`):

| | dicabut | tertuduh |
| --- | --- | --- |
| LL | `bacaBerbatas` → `.get` telanjang di `/stok/exp` | INTI-1: `/stok/exp .get telanjang di ['features/stok/stok_repository.dart']` |
| MM | `DaftarDipotong(` dicabut dari `penyesuaian_page` | INTI-2: `layar tanpa DaftarDipotong: ['features/stok/penyesuaian_page.dart']` |
| NN | `Text('Menampilkan mutasi terbaru (dipotong).')` dirakit di `kartu_stok_page` | INTI-3 |
| OO | lencana kiriman `dashboard_tim` kembali `.asData?.value.rows ?? …length` | INTI-4: `dashboard_tim.dart tanpa hitungLencana(` |
| PP | `/stok/exp` dicabut dari `ruteTerpotong` Dart | cermin server: `expected [ '/stok/exp' ] to deeply equal []` |

Dua tuduhan INTI-3 atas kode putaran ini SENDIRI sebelum pemindainya
diperhalus: interpolasi `${labelLencana(…, terpotong: …)}` (nama parameter,
bukan kalimat → interpolasi dibuang dulu) dan tooltip "daftar sumbernya
dipotong server" di `badge_angka.dart` — yang kedua memang kalimat pemotongan
di luar rumah, jadi dipindah ke rumah (`keteranganLencanaDipotong`), bukan
diputihkan.

### Batas yang diakui

- **Tak ada Flutter di mesin ini.** Tiap asersi statis ditiru Python sebelum
  push; yang menjalankan Dart-nya (analyze + seluruh uji, termasuk widget
  test) CI ponsel pada `claude`. Tak satu pun layar dilihat merender terhadap
  server hidup; "terpotong → mengaku" dibuktikan lewat balasan palsu
  ber-header + widget test.
- Fikstur gerbang server kecil — header pemotongan hampir tak pernah menyala
  di data uji, jadi tak ada lengan verify-api/e2e untuk putaran ini (nol
  perubahan rute/web; verify-api & e2e **tidak** dijalankan, dikatakan apa
  adanya).
- Lencana SO menunggu & kiriman tetap **tak akurat di atas plafon** — hanya
  jujur ("200+"). Pintu ringkas servernya di antrean. Aturan nol (0 pada
  daftar terpotong → tanpa lencana; spanduk kiriman tak muncul bila 0 yang
  menunggu meski daftarnya terpotong) adalah kompromi yang ditulis di
  `hitungLencana`, bukan yang tak disadari.
- `selisihMenungguProvider` masih `catch (_) → 0` (kini `RingkasSelisih` nol)
  — butir antrean Mobile yang terpisah, TIDAK disentuh putaran ini.
- INTI-3 hanya melihat literal berspasi yang memuat kata kuncinya; kalimat
  pemotongan yang ditulis tanpa `terpotong`/`dipotong`/"Menampilkan" lolos.

### Gerbang

- Ponsel: commit tunggal `006eb51` di `claude`, PR #18 (draft). **CI #43
  hijau** (run 33970721672; `flutter analyze` 22 s, `flutter test` 111 s —
  seluruh uji termasuk `daftar_dipotong_test.dart` dan widget test-nya).
  Cermin Python-nya tak pernah merah sebelum push, dan CI membenarkannya.
- Server: typecheck hijau; vitest penuh **242 berkas / 3.009 uji hijau**
  (241/3.004 + cermin baru 5). verify-api & e2e tidak dijalankan — nol
  perubahan rute/web.
- **Tak ada rilis** (aturan pemilik: rilis hanya bila diminta).

## RILIS 2026-09-05 — tujuh putaran tayang, dan clone satu-cabang yang dua kali membuat ref pelacaknya basi — web + ponsel — 2026-09-05

- **Diminta pemilik**: *"ok rilis sekarang ke production, web dan ponsel
  bersamaan"*. Aturan berdirinya terpenuhi oleh kalimat itu.

- **Yang tayang**, sembilan commit di web + empat di ponsel:

  | | commit merge | induk | CI |
  | --- | --- | --- | --- |
  | web → `production` | `fcf6c64` | `48532a3` + `33e99c3` | **#494 hijau**, termasuk build image + deploy Dokploy |
  | ponsel → `Production` | `d606025` | `f429dba` + `bcbdc80` | **#42 hijau** |

  Isinya: detail opname perlengkapan bertanggal (DTO +`waktu`/`oleh`) · lima
  daftar lintas-hari bertanggal + ratchet · riwayat SO tabel+tanggal+saringan ·
  Beli Perlengkapan tabel + berhalaman per faktur (**memutus ponsel**) · garis
  waktu resep & harga · resep terkunci · ringkasan menu dibuang.

- **Diukur dengan SHA dari `ls-remote`, bukan ref pelacak**: 18 dan 11 "commit
  ekstra" di kedua cabang rilis semuanya commit merge lama — nol hotfix;
  `git merge-tree` memulangkan pohon yang **byte-identik** dengan `claude` di
  kedua repo. Gerbang tetap dijalankan di atas commit merge web yang persis
  didorong: verify-api **3.550/0**, vitest **241/3.004**, invarian **27/27**,
  Playwright **48**. CI #494 mengulang verify-api + e2e di runner-nya sendiri
  dan hijau — konfirmasi independen.

- **Dua push berselang tiga detik** (08:57:25 → 08:57:28). Jendela putus
  Beli Perlengkapan tetap terbuka sampai APK di perangkat diperbarui — build
  store belum ada di CI ponsel (`scripts/build-rilis.sh` manual). Selama
  jendela itu APK lama menampilkan **keadaan galat**, bukan data yang salah
  (mekanisme yang sama dengan rilis Permintaan Stok: `as List` atas `Map`
  melempar, `FutureProvider` menangkapnya).

- **Ref pelacak ponsel basi LAGI — dan kali ini sebabnya ketemu.** Merge
  pertama `git merge --no-ff origin/claude` menjawab *"Already up to date"* dan
  `git diff --stat origin/claude` **kosong** — konfirmasi palsu terhadap ref
  `6cd7d88` yang basi. Yang membongkarnya baris **induk SHA** commit yang
  dihasilkan (`a0ea392 6cd7d88` = merge lama), bukan diff-nya. Sebab
  strukturalnya: clone ponsel adalah **clone satu-cabang** — `remote.origin.fetch`
  hanya memetakan `Production`, jadi `git fetch origin claude` memang tak
  pernah memperbarui `refs/remotes/origin/claude`. Itu alasan alarm palsu
  rilis sebelumnya, yang waktu itu dicatat sebagai kebiasaan. Diulang dengan
  SHA eksplisit `bcbdc80`; refspec-nya kini ditambah permanen. Kelasnya sama
  dengan tiga temuan sehari sebelumnya: **memeriksa nama yang ada, bukan
  apakah nama itu menunjuk ke tempat yang benar.**

- **Kontainer didaur ulang tepat saat gerbang-merge pertama mulai.** Postgres
  mati, seed gagal, dan skrip gerbang mencetak *"server hidup setelah 90s"*
  padahal loop health-nya habis tanpa satu pun jawaban — baris yang berbohong.
  Gerbang itu tak menguji apa pun. Skripnya kini **gagal keras** bila Postgres
  mati atau server tak hidup; Postgres dihidupkan lewat `scripts/dev-db.sh`;
  gerbang diulang dari nol. Tak ada yang didorong sebelum itu.

- **Stempel changelog** dipasang untuk ketiga entri pada commit yang SAMA
  dengan penghapusannya dari `BELUM_TAYANG`. Stempel ini ikut ke `production`
  pada rilis berikutnya — pola yang sama dengan `278158e`.

---

## Lembar detail opname perlengkapan tak menyebut waktu — dan DTO yang memang tak membawanya — web + server + ponsel(fikstur) — 2026-09-04

Diminta pemilik sesudah laporan "diakui tak penuh" putaran sebelumnya:
*"kerjakan sekalian lembar detail opname perlengkapan"*.

### Yang diukur

`OpnamePerlengkapanDetail` membawa `session_id`, `nomor`, `status`, `rows[]` —
**tanpa `waktu`, tanpa `oleh`**. Jadi lembar detail perlengkapan bukan lupa
merender; ia tak punya apa pun untuk dirender. Lembar bahan baku di sebelahnya
menyebut keduanya. Ponsel mengurai rute ini (`perlengkapan_repository.dart:525`)
lewat `fromJson` yang mengabaikan kunci tak dikenal → dua medan tambahan
**aditif**, 🟢, bukan 🔴.

### Keputusan yang menentukan: aturan detail = aturan daftar, di SQL yang sama

`riwayatOpnamePerlengkapan` menghitung `MIN(waktu)` dan `MIN(users.nama)`.
Detailnya kini menghitung `min(...) over ()` di kueri yang sama — bukan `Math.min`
di JS atas baris yang sama. Hasilnya "hampir selalu" sama; dan "hampir" adalah
celah tempat daftar dan detail mulai menyebut jam berbeda untuk satu sesi —
kelas yang sudah dua kali dibayar repo ini (aturan status faktur; lencana
permintaan). verify-api §84a menagih **`detail.waktu == daftar.waktu`** dan
**`detail.oleh == daftar.oleh`** untuk sesi yang sama, bukan sekadar "ada".

### Penjaga saya sendiri yang buta, dan ketahuan dari bukti merahnya

Bukti merah II — `waktu: string;` dicabut dari DTO — **19 lolos**. Penjaganya
mengiris `types.ts` 900 karakter dari awal interface; interface itu **609**
karakter, jadi irisannya menembus ke `PerlengkapanMutasiDto` di bawahnya, yang
juga punya `waktu: string;`. DTO yang kehilangan `waktu` tetap "mengandung"
`waktu: string;` milik tetangganya.

Kelas yang sama dengan tiga temuan hari sebelumnya — **memeriksa bahannya ADA
di sekitar, bukan di tempatnya** — kali ini milik saya, dan tertangkap oleh
disiplin yang sama: bukti merah yang gagal adalah temuan, bukan kejutan.
Irisannya kini sampai kurung tutup interface-nya sendiri, plus asersi bahwa
irisan itu tak memuat `export interface` kedua. II diulang → merah dengan
kalimatnya sendiri.

### Bukti merah (dipulihkan byte-per-byte, `cmp`)

| | dicabut | penjaga yang harus menuduh |
| --- | --- | --- |
| II | `waktu: string;` dari DTO | **GAGAL** di percobaan pertama (irisan 900) → diperbaiki → menuduh |
| JJ | `formatTanggalJam(data.waktu)` dari lembar perlengkapan | "lembar perlengkapan tak merender…" |
| KK | service mengirim `waktu` sebagai teks Postgres mentah, **di server hidup** | cermin §84a: `ISO? 0`, `waktu ==? 0`; sesudah pulih keduanya `1` |

KK sengaja mengubah BENTUK, bukan saatnya: sesi di fikstur berbaris tunggal,
jadi menukar `min`→`max` tak akan terlihat. Yang menangkap mutasi bentuk itu
justru asersi `detail == daftar` — karena daftarnya ISO.

### Ponsel

Fikstur `kunci-kontrak-server.txt` bertambah **tepat dua kunci**
(`OpnamePerlengkapanDetail|waktu`, `|oleh`); fikstur status tak berubah.
`waktu` (66 kali di lib/) dan `oleh` (12) sudah nama yang disentuh, jadi
**tak butuh entri** di `kunci-belum-dibaca.txt` — dan cermin KELAS di
`kunci-satu-kontrak` (dipasang sesudah CI ponsel #38) yang mengonfirmasinya di
gerbang ini, bukan CI ponsel sesudah PR ditulis. Tak ada kode Dart yang berubah.

### Cakupan yang DIAKUI tak penuh

- Lengan peramban mengukur "tanggal BERTAMBAH sesudah lembar terbuka", bukan
  "tanggal ada di dalam lembar" — sebab tabel di belakangnya sudah memuat
  tanggal yang sama. Cukup untuk menuduh lembar yang diam; tak membedakan
  lembar yang menyebut tanggal sesi LAIN.
- `ditinjau_oleh` (ada di lembar bahan) tak ditambahkan: `supply_mutations` tak
  mencatat siapa yang ACC/tolak. Itu putaran skema, bukan putaran ini.

### Gerbang penuh ke-46 — merah di SATU tahap, lalu diperbaiki

| | hasil |
| --- | --- |
| verify-api | **3.550 lolos / 0 gagal** (+4: §84a) |
| vitest | **merah 1 uji** → `changelog-stempel-rilis`: entri 🟢 baru berbunyi "belum tayang" tapi belum didaftarkan di `BELUM_TAYANG` |
| invarian | **27 sehat / 0 dilanggar** |
| Playwright | **48 lolos / 0 gagal** |

Perbaikannya satu berkas uji (registri changelog). Vitest diulang penuh:
**241 berkas / 3.004 uji**, typecheck bersih. Ketiga tahap lain TIDAK diulang,
dan itu dikatakan apa adanya: perbaikannya tak bisa menyentuh rute, verify-api,
maupun peramban, jadi hasilnya berlaku atas sumber yang sama persis. Tak ada
yang di-push sebelum vitest-nya hijau.

## Daftar lintas-hari yang cuma menyebut JAM — lima berkas, satu pemformat, satu ratchet — web — 2026-09-04

Ekor langsung dari putaran riwayat SO. Pemilik memilih "SO dulu, sisanya
dilaporkan"; sesudah laporan pilahannya: **"semua lintas-hari sekalian"**.

### Populasi, diukur

**64 panggilan `formatWaktu` di 32 berkas.** 21 berkas sudah menyebut tanggal di
suatu tempat. Dari 11 sisanya, yang **benar-benar daftar lintas-hari** ada di 5
berkas; 5 lainnya terkurung hari dan **dibuktikan**, bukan diandaikan:

| berkas | kenapa jam-saja BENAR |
| --- | --- |
| `kasir/RiwayatPage` | `tanggal` state + `<input type="date">` — daftar sehari |
| `absen/AbsenPage` | `GET /absensi` bawaannya `tanggalDi(hari ini)`; "Masuk pukul …" konfirmasi sesaat |
| `pengaturan/MejaPage`, `MejaStatusPanel` | keadaan meja hari ini |
| `kasir/ReceiptModal` | kertasnya bertanggal — ia **memanggil** `waktuKertasWIB` (diperiksa: 1 panggilan, bukan cuma impor) |

Yang paling mendorong putaran ini: **`BeliPerlengkapanPage` — tabelnya
bertanggal, kartunya (bentuk BAWAAN) tidak**, dan itu dari putaran saya sendiri
(`b130755`). Tanggalnya tinggal di `kolom-beli-perlengkapan.tsx`, berkas lain,
jadi berkas halamannya sendiri tak punya satu pun pemformat tanggal.
`PermintaanStokPage` punya belahan yang persis sama (`kolom-permintaan.tsx`
bertanggal, kartunya tidak).

### Yang dibangun

- **`formatTanggalJam`** — "4 Sep 2026 · 18.42", dirakit dari dua pemformat yang
  sudah ada (bukan `Intl` baru): bentuk tanggal & jam tetap satu sumber.
- **Sepuluh situs, lima berkas** → `formatTanggalJam`: kartu + detail + **kepala
  dokumen RAB yang DICETAK** di Beli Perlengkapan (kertas tanpa tanggal tak bisa
  diarsipkan); kartu Permintaan Stok; kedua kolom Tempat Sampah; kolom Waktu
  buku supplier; daftar sesi opname di tab Stok Perlengkapan; kepala lembar
  detail opname bahan. Disunting **per situs**, dan `git diff --stat` menunjukkan
  tepat `format.ts` + 6 berkas sumber.
- **Ratchet `waktu-tanpa-tanggal.test.ts`** — tiap berkas yang memakai
  `formatWaktu` tanpa satu pun pemformat tanggal wajib ada di `DIPUTUSKAN`
  dengan alasannya; dua arah (entri basi merah); PASANGAN memaku kelima berkas
  + tiga situs BP; penggolongnya dibuktikan pada masukan sintetis.
- **Dua lengan peramban** yang bentuknya BEDA dari tabel SO: kartu BP (bentuk
  bawaan, konteks peramban baru = localStorage kosong, dipastikan lewat tombol
  "🗂 Kartu"), dan modal riwayat opname di tab Stok Perlengkapan (dua klik dari
  `/stok`; tab-nya `useState`, jadi diklik, bukan `?tab=`). Harapannya dihitung
  dari `waktu` server.

### Yang DIUKUR lalu TIDAK dibangun

- **Kepala lembar detail opname PERLENGKAPAN** tak menampilkan waktu sama
  sekali — dan `OpnamePerlengkapanDetail` memang **tak membawa `waktu`/`oleh`**.
  Menambahkannya berarti DTO + service + kontrak + fikstur ponsel; di luar
  putaran web-saja ini. Dicatat, tak diam-diam dilewati.
- **Lengan kedua sempat direncanakan Tempat Sampah, lalu Kartu Supplier** —
  keduanya dibatalkan sesudah diukur: sampah cuma 1 baris dan itu lahir dari
  e2e gerbang (penjualan yang dihapus spec lain), buku supplier 1 baris pada 1
  dari 8 supplier berstempel jam verify-api. Premis yang bergantung urutan spec
  lain adalah persis kelas cacat yang tiga kali menggigit lengan resep. Dipilih
  daftar opname perlengkapan: 7 sesi dari seed, 2 di cabang bawaan.
- `kolom-beli-perlengkapan.tsx:64` dan `kolom-permintaan.tsx:201` **tak
  disentuh**: sudah bertanggal, dengan gaya dua-warna yang string
  `formatTanggalJam` tak bisa tiru.

### Perangkap lingkungan: kontainer didaur ulang di tengah putaran

`uptime` 5 menit; Postgres, server, dan proses latar hilang; suntingan pohon
kerja selamat (disk). Postgres dihidupkan lewat jalur resmi repo
(`scripts/dev-db.sh`, `pg_ctl` atas `/tmp/kakarut-pgdata` yang selamat), bukan
perintah karangan. Gejala pertamanya token login KOSONG — mudah disalahbaca
sebagai kuota `/auth/login` habis; yang membedakan: `curl -i` memulangkan HTTP
000 dan soket Postgres ditolak, bukan 429.

### Bukti merah (dipulihkan byte-per-byte, `cmp`)

| | dicabut | penjaga yang harus menuduh |
| --- | --- | --- |
| EE | satu situs kartu BP kembali `formatWaktu` | PASANGAN — "kembali memanggil formatWaktu" |
| FF | entri `MejaPage` dicabut dari `DIPUTUSKAN` | INTI, menyebut namanya |
| GG | entri PALSU `TempatSampahPage` ditambah | RATCHET — entri basi |
| HH | `formatTanggalJam` memulangkan jam saja, **di peramban** | kedua lengan, menyebut `"4 Sep 2026"` untuk `BP-0014` dan `OP-0008` |

HH yang paling berarti: ia membuktikan kedua lengan menangkap regresi pada
PEMFORMATNYA, bukan sekadar bentuk kode di situs pemanggil.

### Cakupan yang DIAKUI tak penuh

- Ratchet-nya **per berkas** — satu berkas bisa punya satu situs bertanggal dan
  satu daftar lintas-hari tanpa tanggal, dan ia tak akan melihatnya. Kasus nyata
  yang melahirkannya justru tertangkap karena tanggalnya tinggal di berkas lain.
- **Fikstur gerbang tetap satu hari** — yang dibuktikan: tanggalnya dirender dan
  cocok dengan `waktu` server; bukan bahwa dua hari berbeda terbedakan.
- Lembar detail opname perlengkapan tetap tanpa waktu (lihat di atas).

### Gerbang penuh ke-45

DB nol → seed → verify-api → regen jejak → vitest → invarian → reset batas laju
→ Playwright:

| | hasil |
| --- | --- |
| verify-api | **3.546 lolos / 0 gagal** |
| vitest | **241 berkas / 2.997 uji** (+1 berkas, +5 uji — tepat ratchet-nya) |
| invarian | **27 sehat / 0 dilanggar** |
| Playwright | **48 lolos / 0 gagal** (46 + 2 lengan putaran ini) |

Hijau di jalan pertama — tak ada yang di-push sebelum itu.

## Riwayat SO tak pernah menyebut TANGGAL — dan penjaga yang menganggap `error` ADA sama dengan `error` DIPAKAI — web — 2026-09-04

Diminta pemilik: *"riwayat SO bahan baku dan perlengkapan belum ada tanggal
hari — juga ingin di buat tabel saja dengan kolom status"*. Bagian pertama
CACAT, bukan selera.

### Keadaan sebelumnya, diukur

`OpnameRiwayatPage` merender `formatWaktu(s.waktu)` telanjang di kedua tab, dan
`formatWaktu` di web memulangkan **jam dan menit saja**:

```ts
export function formatWaktu(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", … }).format(…);
}
```

Setiap sesi dari setiap hari karena itu terbaca sama — di halaman yang justru
ada untuk menelusuri opname LAMA, dan yang sudah memasang spanduk *"yang lebih
lama tidak ikut ditampilkan"*. Nol `formatTanggal*` di seluruh berkas.

Tangkapan `error-context.md` dari lengan peramban pertama merekamnya apa
adanya, sebelum satu baris pun diperbaiki:

> `button "OP-0008 18.42 Owner Basooopa · 1 selisih Menunggu ACC"`

**Aplikasi ponsel tidak punya cacat ini.** `formatWaktu` di
`kakarut-mobile/lib/core/format.dart` memulangkan `dd/MM HH.mm`. Satu nama
fungsi, dua klien, dua jawaban — dan yang diam hanya web. Kelas yang sama
dengan aturan status faktur putaran lalu, hanya lebih tua.

Populasi basis gerbang: 24 sesi opname bahan + 7 sesi opname perlengkapan
(`supply_mutations` ber-`session_id`, tipe `koreksi`); lewat HTTP — yang
terkurung cabang — 18 dan 2. Status terukur: bahan 11 menunggu / 6 disetujui /
1 cocok; perlengkapan 1 menunggu / 1 ditolak.

### Yang DIUKUR lalu TIDAK diubah

Tiga hal diperiksa dan sengaja dibiarkan, supaya tak terbaca sebagai kelalaian:

1. **Urutannya sudah benar.** Pemilik meminta "terbaru di atas"; kedua rute
   sudah `desc` (`max(created_at)` di sisi bahan, `MIN(waktu)` di sisi
   perlengkapan) dan dibuktikan lewat HTTP, bukan dibaca dari kode saja.
2. **Dua bentuk kawat untuk medan yang sama.** `waktu` sisi bahan dikirim apa
   adanya dari Postgres (`2026-09-04 11:42:19.803239+00`), sisi perlengkapan
   sudah di-`toISOString()` (`2026-09-04T11:42:32.890Z`). Keduanya terurai
   di V8 MAUPUN di `DateTime.tryParse` Dart (yang menerima spasi sebagai
   pengganti `T`, dan offset dua-digit tanpa menit), jadi tak ada yang rusak
   hari ini. Diseragamkan berarti memutus kontrak yang dibaca ponsel, tanpa
   satu pun kegagalan yang menuntutnya.
3. **`MIN(status)` di `riwayatOpnamePerlengkapan`** memulangkan status sesi
   lewat urutan ABJAD (`disetujui` < `ditolak` < `menunggu`). Ia benar hari ini
   **karena konstruksi**, bukan karena kebetulan: `setStatusOpnamePerlengkapan`
   selalu mengubah SELURUH baris sesi, jadi status campur dalam satu sesi tak
   bisa lahir. Yang rapuh bukan jawabannya melainkan alasannya — invarian itu
   tak tertulis di mana pun.

### Bukti merah yang GAGAL, dan apa yang ia buka

Langkah "buktikan detektornya bisa menuduh" kali ini **tidak lolos**, dan itu
temuan terpenting putaran ini.

Saya mencabut penanganan galat sisi bahan — `<SpinnerAtauGalat>` dibuang,
bacaan yang gagal jatuh ke tabel kosong ber-*"Belum ada riwayat opname bahan
baku"* — lalu menjalankan seluruh sapuan `gagal-muat-bukan-kosong`. **Semuanya
tetap hijau.**

Sebabnya satu baris di `test/util/kueri-web.ts`:

```ts
if (k === "error" || k === "isError" || k === "isLoadingError") punyaGalat = true;
…
kelas: punyaGalat ? "GALAT" : …
```

Sebuah situs dinyatakan "sudah menangani galat" begitu `error:` muncul di
DESTRUCTURING-nya. Apakah galat itu sampai ke mata tak pernah ditanyakan.

Kelasnya persis yang baru saja ditutup di `kunci-satu-kontrak` beberapa jam
sebelumnya: **gerbang yang memeriksa BAHANNYA ADA, bukan bahannya DIPAKAI.**
Dua kali dalam satu hari, di dua gerbang yang tak saling kenal.

Diukur sebelum diperbaiki: **93 situs** `useQuery` mengambil `error`, dan
**nol** di antaranya membuangnya. Jadi yang dipasang RATCHET, bukan perbaikan —
tak ada yang sedang salah, dan yang dijaga adalah bahwa besok pun tak ada.
Batasnya ditulis: ia menuntut nama itu DISEBUT LAGI, bukan sampai ke JSX.
Menuntut JSX akan menuduh palsu bentuk `if (error) return <p>Gagal</p>`, yang
menangani galatnya dengan benar tanpa pernah menaruh namanya di dalam JSX.

### Yang dibangun

- **Tabel menggantikan kartu** (keputusan pemilik: "tabel saja"), lewat
  `TabelResponsif` — jadi di layar sempit tiap baris tetap jadi kartu, dan
  daftar yang bisa diklik tak berubah jadi daftar yang cuma bisa dipandang.
- **Tanggal dan Jam di kolom sendiri-sendiri** (keputusan pemilik), lewat SATU
  `selTanggal`/`selJam` yang dipakai kedua tab — dua salinan yang lahir kembar
  lalu menjawab beda adalah bentuk yang sudah dua kali dibayar repo ini.
- **Saringan status + pencarian**, keduanya hidup di **URL**: halaman ini
  sering dimuat ulang sesudah ACC/tolak, dan saringan yang hilang saat refresh
  membuat daftar yang tadinya TERSARING tiba-tiba terbaca sebagai daftar penuh.
- Kepala kolom sisi perlengkapan berbunyi **"Selisih"**, bukan "Item": sisi itu
  hanya mencatat baris berselisih, jadi angkanya menjawab pertanyaan yang
  berbeda dari angka di tab sebelah.
- Judul halaman jadi `<h1>`, bukan `<div>` tebal — tetangganya (Produksi,
  Pembelian) memakai heading, dan pembaca layar tak punya cara lain menemukan
  judul halaman ini.

### Keputusan yang ditulis: pencarian yang MENGAKU cuma menjangkau sebagian

Penyaringan dikerjakan **di klien**, atas potongan yang sudah dimuat (server
memotong di 200 sesi bahan / 100 perlengkapan). Itu pilihan sadar — rutenya
belum berhalaman, dan menambah parameter pencarian ke server berarti memutus
kontrak yang dibaca ponsel.

Tapi konsekuensinya dikatakan, bukan didiamkan: pada perusahaan yang riwayatnya
melewati plafon, *"tidak ditemukan"* berarti *"tidak ada di 200 sesi
terakhir"* — BUKAN *"tidak pernah ada"*. Dua kalimat itu menuntun ke keputusan
yang berlawanan, dan yang kedua yang biasa disimpulkan orang. Spanduk
pemotongan karena itu berubah bunyi begitu saringannya aktif.

Keadaan kosongnya juga dibedakan: *"Tak ada sesi yang cocok dengan saringan
ini"* ≠ *"Belum ada riwayat opname"*. Yang kedua adalah pernyataan tentang basis
data, dan ia salah saat daftarnya sedang disaring.

### Perangkap lingkungan yang memakan tiga jalan e2e

Lengan peramban merah tiga kali berturut-turut dengan "element(s) not found",
dan penyebabnya bukan produknya: **server men-cache `index.html` saat boot**.
Disk sudah `index-74JzS0EZ.js`, yang tersaji masih `index-be7PRacq.js`, jadi
peramban memuat aplikasi LAMA — kartu, bukan tabel. Itulah sebabnya skrip
gerbang selalu build → **restart** → e2e, dan menjalankan e2e tanpa restart
menguji bundel yang bukan yang baru saja diubah.

Yang mendiagnosisnya `error-context.md`, bukan tebakan: ia merekam markup kartu
lama apa adanya. Kebiasaan yang sama menyelamatkan putaran sebelumnya dari
salah-diagnosis kuota login.

### Bukti merah (dipulihkan byte-per-byte, `cmp`)

| | dicabut | penjaga yang harus menuduh |
| --- | --- | --- |
| V | penanganan galat sisi bahan | **TAK ADA** — kebutaan yang membuka ratchet baru |
| W | `selTanggal` kembali pakai `formatWaktu` | "kolom Tanggal membawa TANGGAL" (2 uji) |
| X | kolom Status dicabut dari tab perlengkapan | "kedua tab punya Tanggal/Jam/Status" |
| Y | spanduk berhenti mengaku pencariannya terpotong | "daftar terpotong mengaku" |
| Z | satu `error:` diambil lalu dibuang | ratchet detektor baru — menyebut namanya |
| AA | badge dapat keadaan kelima | "tiap keadaan bisa dicapai dari saringan" |
| BB | `selTanggal` dicabut, **di peramban** | kedua lengan, menyebut `"4 Sep 2026"` |

BB yang paling berarti: ia membuktikan lengan itu menangkap cacat yang PEMILIK
laporkan, bukan sekadar bentuk kode yang saya sukai.

### Ekor: penyaring yang ADA tapi hampir tak pernah menyaring

Gerbang ke-42 hijau di tiga tahap dan merah di SATU lengan peramban —
`resep-tampilan.spec.ts:262`, dengan sebab yang sama persis seperti dua putaran
lalu: *"Resep tidak bisa diubah saat masih ada produksi berjalan"*. Perbaikan
premis yang saya tulis putaran itu **tidak menahan**.

Sebabnya bukan pemotongan (diukur: `/produksi?per_page=200` memulangkan 22
baris / 15 faktur — jauh di bawah plafon). Sebabnya **cakupan cabang**:

| | melihat produksi berjalan |
| --- | --- |
| penjaga 409 di `PUT /bahan/:id/resep` | **tanpa syarat cabang sama sekali** |
| `GET /produksi` yang dipakai premis | **terkurung cabang** |

Terukur lewat HTTP: tanpa `branch_id=all` premis melihat **10** bahan terkunci;
dengan `branch_id=all` ia melihat **19** — persis angka SQL. Bahan yang dipilih
gerbang ke-42 punya **6 produksi `rencana` di Central Kitchen**, dan ia termasuk
sembilan yang tersembunyi.

Jadi penyaring itu ADA, dijaga penjaga statis, dan **hampir tak pernah
menyaring** — sebagian besar produksi memang terjadi di Central Kitchen, bukan
di cabang bawaan. Penjaganya menuntut helper-nya *menyebut* `/produksi`; ia tak
punya cara menanyakan apakah yang disebut itu menjawab pertanyaan yang SAMA
dengan yang ditanyakan server.

Dan begitu cakupan cabangnya benar, lengan yang sama merah LAGI — kali ini
dengan sebab ketiga:

> `Expected substring: "2000 → "` · `Received: "…daging uji66 2.000 → 7 gr…"`

`inputValue()` memulangkan angka MENTAH; panelnya merender lewat `formatAngka`,
yang mengelompokkan ribuan ala id-ID. Premisnya membandingkan keduanya
LANGSUNG — hijau hanya selama takaran resep yang terpilih di bawah 1.000.
Perbaikan `branch_id=all` menggeser pilihannya ke resep bertakaran 2.000, dan
cacat yang sudah ada sejak lengan itu ditulis pun terbuka. Ditutup dengan
memformat sisi harapannya memakai aturan yang sama, plus penjaga statis yang
menolak perbandingan mentah kembali (bukti merah DD).

Tiga kali berturut-turut premis lengan ini patah karena hal yang sama: **ia
mengandaikan sesuatu tentang subjek yang tak pernah ia nyatakan** — mula-mula
"resep pertama" (urutan Postgres), lalu "tak sedang diproduksi" (cabang yang
salah), kini "takarannya kecil" (format yang tak sama). Tiap kali, subjeknya
bergeser dan andaian yang tak tertulis itu jadi salah.

**Itu kelas yang sama dengan dua temuan lain hari ini** — `kunci-satu-kontrak`
yang menagih kesegaran bukan keputusan, dan `gagal-muat-bukan-kosong` yang
menerima `error:` yang tak pernah dipakai. Tiga kali dalam satu hari, di tiga
gerbang yang tak saling kenal: **penjaga yang memeriksa BAHANNYA ADA, bukan
bahannya MENJAWAB.**

Ditutup dua arah: premisnya memakai `branch_id=all` (mencerminkan kueri server),
dan ia kini **berbunyi bila daftar produksinya terpotong** — plafon yang
terlampaui membuat penyaringnya diam-diam kurang, dan diam adalah persis cara
cacat ini bertahan dua putaran. Penjaga statisnya menuntut kedua hal itu; bukti
merah CC: `branch_id=all` dicabut → penjaga menuduh dengan kalimatnya sendiri.

### Cakupan yang DIAKUI tak penuh

- **Fikstur gerbang hanya SATU HARI.** Seluruh sesi opname di basis uji lahir
  di tanggal yang sama, jadi tak satu pun lengan di sini membuktikan bahwa dua
  sesi dari HARI BERBEDA bisa dibedakan — yang dibuktikan cuma bahwa tanggalnya
  dirender dan cocok dengan `waktu` dari server. Cacat aslinya hanya kelihatan
  pada data lintas-hari, dan basis uji ini tak punya.
- **~70 situs `formatWaktu` lain di web belum dipilah.** Sebagian memang benar
  jam-saja (daftar sehari, mis. pesanan hari ini); sebagian daftar lintas-hari
  seperti riwayat SO. Pemilik memilih "SO dulu, sisanya dilaporkan", jadi
  daftarnya dilaporkan dan tak disentuh. Belum ada penjaga yang mencegah daftar
  lintas-hari BARU lahir jam-saja.
- **Ratchet `error` tak menuntut galatnya sampai ke mata**, hanya bahwa namanya
  dipakai. Sebuah `const _ = sesiGagal;` akan memuaskannya. Itu batas yang
  disengaja (lihat di atas), bukan yang terlewat.

## Beli Perlengkapan dapat bentuk TABEL — dan dua klien yang sudah menjawab beda soal faktur yang sama — web + server + ponsel — 2026-09-04

- **Diminta pemilik repo**: *"beli perlengkapan ingin ada tabel seperti
  produksi"*. Dua keputusan diambil lebih dulu: **sakelar 🗂 Kartu ↔ ☰ Tabel**
  (bukan penggantian seperti di Pengadaan), dan **rutenya sekalian berhalaman +
  ubin ringkasan** — dengan konsekuensi bahwa ponsel wajib diperbaiki di
  putaran yang sama.

- **Keadaan sebelumnya, diukur lewat HTTP:** `GET /perlengkapan/beli`
  memulangkan larik telanjang yang dipotong di **200 BARIS**. Terukur:
  **53 baris = 26.132 byte untuk 14 faktur** — rata-rata **3,79 baris per
  faktur**, jadi plafon 200 baris itu ≈**53 faktur**. Dan karena urutannya
  menaruh yang butuh aksi di atas, yang lenyap justru **ekor riwayatnya** —
  bagian yang paling mudah disalahbaca sebagai "tak pernah ada".

- **HALAMAN DIIRIS PER FAKTUR, bukan per baris**, dan itu keputusan yang
  menentukan seluruh bentuk kuerinya. `per_page=20` berarti 20 FAKTUR, dan
  seluruh baris kedua puluh faktur itu ikut — jadi `rows.length` hampir selalu
  lebih besar daripada `per_page`. Mengiris per baris akan mengirim faktur yang
  terpotong di tengah: kartu berisi separuh itemnya, tanpa satu pun penanda.
  Dibuktikan lewat HTTP: `per_page=3` × 5 halaman → **14 faktur unik, nol yang
  terbelah, nol yang hilang**.

### Temuan: dua klien yang menjawab BEDA soal faktur yang sama

Aturan "status satu faktur" diketik **dua kali**, dan keduanya **berbeda**:

| | aturan | keadaan |
| --- | --- | --- |
| web (`kelompokkanFaktur`) | "tahap paling tertinggal", `batal` tak pernah menang | **4** |
| ponsel (`statusFaktur`) | buang baris `batal` dulu; campuran tiba → `sebagian` | **5** |

Faktur berisi `[tiba, menunggu]` karena itu berbunyi **"Menunggu"** di web dan
**"Sebagian"** di ponsel. Faktur yang sama, dua layar, dua jawaban, dan tak ada
yang merah.

**TERUKUR SEBELUM DIPUTUSKAN, dan angkanya mengubah cara ini dilaporkan:**
pada basis gerbang, **14 faktur, 0** di antaranya menghasilkan jawaban berbeda
— tak satu pun faktur bercampur tiba+belum (SQL yang menghitung kedua aturan
berdampingan). Jadi ini perbedaan yang **nyata di kode dan nol kejadiannya hari
ini**. Yang diperbaiki bukan angka yang sedang salah di layar siapa pun,
melainkan dua aturan yang akan terus menjauh.

**Yang menang aturan PONSEL**, dan alasannya bisa diperiksa: `sebagian` membawa
informasi yang tak bisa diturunkan dari keempat keadaan lain. Web yang
menyebutnya "Menunggu" tidak salah arah — keduanya menuntut pekerjaan — ia cuma
kehilangan setengah kalimatnya. Rumah barunya
`packages/shared/src/beli-perlengkapan.ts`, anggota ketiga keluarga
`pengadaan.ts` / `permintaan-stok.ts`.

**Tiga ember** (`butuh_aksi` / `tiba` / `batal`) saling lepas menurut
konstruksi, jadi `ringkas` dijamin menjumlah tepat ke `total` — invarian yang
jadi asersi PERTAMA §294.

### Delapan hal yang ditemukan penjaga, bukan oleh saya

Gerbang penuh pertama memerahkan **11 uji di 10 berkas**. Tak satu pun palsu.

1. **`urutan-pemutus-seri` menuduh pemutus seri yang JUSTRU kunci grupnya
   sendiri.** Kunci grup di sini `coalesce(faktur_id, id)` — ekspresi, tak
   punya tabel untuk disematkan — sementara pemindainya hanya mengenal bentuk
   `tabel.kolom` yang bisa ditulis ulang jadi `subkueri.kolom`. Vonisnya SERI
   untuk kueri yang urutannya sudah menentukan. Komentar pemindainya sendiri
   sudah menuliskan kenapa itu mahal: *"ia menyuruh orang menambahkan pemutus
   seri kedua pada kunci yang sudah unik, dan yang berikutnya akan belajar
   bahwa gerbang ini boleh ditawar."* Diperbaiki dengan mengajarinya satu
   bentuk baru — kunci grup berupa pengenal telanjang yang dialiaskan ke medan
   select lewat `<<kunci>>.as(…)` — **plus bukti merah DUA ARAH**: pemutus seri
   dicabut → tetap SERI; medan lain yang kebetulan ada → tetap SERI.
2. **`gagal-muat-bukan-kosong` menuduh bacaan yang SUDAH membaca galatnya —
   dan ia benar.** Berkas itu punya `useQuery` kedua yang mendestrukturisasi
   `data: items = []`; penganalisis alur berbasis NAMA menamainya `"data"`
   (pola penugasan tak punya `.name`). Begitu saya menambahkan `const { data }`
   di komponen utama, pemakaian yang satu terbaca sebagai pemakaian yang lain.
   Yang salah bukan penjaganya melainkan penamaan saya: **dua hal berbeda
   bernama sama dalam satu berkas**. Diganti `data: daftar`, dan berkasnya jadi
   lebih terbaca (`daftar.ringkas`, `daftar.total`).
3. **`jangkar-iris`**: uji baru saya merakit jalur berkasnya lewat interpolasi
   (`${SRV}/modules/...`), jadi penelusurnya tak bisa menemukan satu pun sumber
   — ujinya akan lolos sebagai "berjangkar tanpa sumber", persis kebutaan yang
   penjaga itu ada untuk menolak. Ditulis literal.
4. **`pemotongan-terungkap`** memaku `GET /perlengkapan/beli` sebagai rute yang
   WAJIB memanggil `potongLarik`. Ia tak lagi memanggilnya — dan itu bukan
   pencabutan penanda melainkan penggantiannya dengan yang lebih kuat: `total`
   di dalam BADAN balasan, yang tak bisa hilang di proxy dan bisa menyebut
   BERAPA yang tak ikut. Dikeluarkan dari daftar dengan alasan itu tertulis.
5. **`potong-berpenanda`** menagih dua arah sekaligus: situs `.limit()` baru
   yang belum diadjudikasi, DAN entri lama (`BATAS_BELI_PERLENGKAPAN + 1`) yang
   situsnya sudah tak ada — "entri kuburan".
6. **`kueri-terkurung-tenant`**: dua kueri baru memakai `and(...conds)` —
   pengurungannya nyata tapi lewat variabel, jadi tak terbaca mekanis.
   Didaftarkan dengan alasan yang bisa diperiksa, dan ditembak lewat HTTP di
   §294 dengan token tenant kedua.
7. **`batal-tak-ditagih`**: dua berkas baru membandingkan `"batal"` di luar
   rumahnya. Keduanya sah — domainnya baris pembelian perlengkapan, bukan
   pembatalan sajian di dapur — tapi harus DITULIS begitu.
8. **`semai-sekali`**: `useEffect([page, totalPages])` penjepit nomor halaman,
   bentuk yang sudah punya tiga saudara terdaftar.

### Bukti merah

| | mutasi | memerahkan |
| --- | --- | --- |
| L | `MAX(created_at)` → `MIN(...)` | penjaga "MAX bukan MIN" |
| M | pemutus seri `asc(perFaktur.kunci)` dicabut | `urutan-pemutus-seri` |
| N | baris dipulangkan urutan peta | "disusun ulang mengikuti kunciHalaman" |
| O | web mengurut ulang halaman server | "halaman milik server" |
| P | lencana kehilangan keadaan `sebagian` | "lencana kenal kelima keadaan" |
| Q | ubin dirender walau bacaannya gagal | "tak dirender saat gagal" |

Keenamnya dipulihkan **byte-per-byte** (`cmp`), plus bukti merah dua arah
sintetis untuk aturan baru `urutan.ts`.

### Cacat yang saya kirim sendiri: pemanggil KEDUA yang terlewat

Yang paling mahal di putaran ini, dan seluruhnya perbuatan saya.

Saya mengubah balasan rutenya dari larik jadi objek, memperbaiki HALAMANNYA,
menulis penjaga statis untuknya, memperbarui ponselnya, dan **melewatkan
pemanggil kedua**: lencana sidebar di `Layout.tsx`, yang menarik daftar yang
sama lalu menyaringnya sendiri. `(bpNav ?? []).filter` melempar pada objek —
dan karena lencana itu hidup di **Layout**, yang runtuh bukan halaman
perlengkapan melainkan **setiap halaman aplikasi**. Gerbangnya merah di **19
spec**, dan tak satu pun menyebut perlengkapan; yang terbaca di log cuma
"elemen tak ditemukan".

Kenapa penjaga statis putaran ini tak menangkapnya: **ia hanya membaca berkas
yang saya SEBUT**. Penjaga yang daftar berkasnya saya tulis sendiri tak pernah
bisa memberi tahu saya tentang berkas yang tak terlintas di pikiran saya. Yang
menangkapnya lengan peramban — dan hanya sesudah tembok kuota login
disingkirkan; sebelum itu kegagalannya tersamar 429.

Ditutup **secara struktural**: sapuan yang mencari TIAP pemanggil rute ini di
seluruh `apps/web/src` dan menuntut masing-masing mengetiknya
`BeliPerlengkapanDaftar`. Sapuan itu sendiri sempat buta — versi pertamanya
memindai baris demi baris dan hanya menemukan satu dari dua pemanggil, sebab
yang satunya dipecah prettier jadi tiga baris. Premisnya ("sapuannya menemukan
≥2") yang menangkap itu, bukan saya.

Dan lencananya jadi lebih benar daripada sebelumnya: ia kini memakai
`ringkas.butuh_aksi` dari server. Bentuk lamanya menyaring daftar yang dipotong
200 baris, jadi pada perusahaan yang riwayatnya panjang lencananya **diam-diam
berhenti bertambah** — cacat yang sudah hidup sebelum putaran ini dan tak
pernah dilaporkan siapa pun.

### Uji yang hijau karena UNTUNG — dan baru merah sekarang

Lengan peramban dari putaran SEBELUMNYA (`resep-tampilan.spec.ts`, sudah
ter-commit di `b97b64b` dan hijau di gerbang 37) merah di putaran ini dengan
"✓ Tersimpan" tak muncul. Layarnya justru menampilkan kalimat yang BENAR:
*"Resep tidak bisa diubah saat masih ada produksi berjalan"* (409).

Produknya benar; premis ujinya yang salah, dan salahnya ada sejak lengan itu
ditulis:

> `bukaResepBerbahan()` mengambil `Object.keys(ringkas).find(count > 0)`, dan
> `GET /bahan/resep-ringkas` adalah `GROUP BY` **TANPA `ORDER BY`** yang
> diserialkan jadi objek JSON. "Resep pertama" karena itu adalah apa pun yang
> kebetulan dipulangkan Postgres.

Putaran ini menyisipkan baris ke `ingredients`, `ingredient_logs`, dan
`supply_purchases`; tata letak fisiknya bergeser, pilihannya mendarat di resep
yang punya produksi berjalan, dan uji yang MENYIMPAN resep menabrak penjaga
yang memang seharusnya menolaknya.

Dua cacat, dan menutup salah satu saja akan membuatnya kembali:
**pilihannya tak menentu** (diurut sekarang), dan **subjeknya tak dijamin boleh
disimpan** (kini disaring dengan cermin penjaga servernya: `GET /produksi`,
himpunan status `rencana`/`dikerjakan` yang sama).

Kelas yang layak dicatat: **merah yang pernah hijau adalah merah yang paling
mahal untuk didiagnosis** — ia mengundang mencari penyebabnya di perubahan
terakhir, padahal penyebabnya sudah tidur di sana sejak awal. Yang membuatnya
tidur bukan kebetulan tunggal melainkan uji yang subjeknya berpindah sendiri;
uji begitu tak bisa dipercaya saat merah MAUPUN saat hijau.

### Utang yang akhirnya dibayar: kuota login Playwright

Tembok yang tercatat di ledger ini **tiga putaran berturut-turut** akhirnya
menggigit cukup keras untuk dibayar. Gerbang penuh putaran ini merah di
**20 berkas spec berturut-turut** dengan kegagalan yang tak menyatakan apa pun
soal produk — dan yang terlihat di log ("elemen tak ditemukan", 5 detik) BUKAN
penyebab yang sebenarnya. Penyebabnya baru terbaca dari `error-context.md`
yang tersimpan: **429, kuota login habis**, sejak kegagalan PERTAMA.

Mekanismenya, dan bagian ini yang tak pernah saya lihat sebelumnya:

> `util.ts` menyimpan sesi per email — tapi cache itu hidup di **modul**, dan
> modul mati bersama worker-nya. **Playwright menyalakan ulang worker setiap
> kali sebuah test gagal.** Jadi satu kegagalan membuat tiap berkas spec
> sesudahnya membayar login lagi, sampai kuotanya habis dan sisanya merah
> berjamaah. Bukan sepuluh login lalu berhenti — LONGSORAN.

Sepuluh berkas memakai `OWNER_EMAIL`, tepat di plafon 10-per-5-menit bahkan
tanpa longsoran. Yang sudah dicatat ledger sebagai "berkas ke-11 akan
memerahkan yang lain" ternyata separuh cerita: yang benar-benar mahal adalah
kegagalan PERTAMA, apa pun sebabnya.

Diperbaiki dengan `globalSetup` Playwright yang login **sekali per akun untuk
seluruh suite** lalu menulis tokennya ke berkas; `sesiApi` membacanya sebelum
menyentuh jaringan. Berkasnya hidup di luar proses, jadi ia selamat dari
penyalaan ulang worker. Sesudah ini suite memakai **dua login**, berapa pun
jumlah berkas spec-nya dan berapa pun kali worker-nya restart.

`globalSetup` sengaja **tidak melempar** saat kuotanya sudah habis sebelum
suite mulai: menggagalkan seluruh jalan di tahap persiapan menyembunyikan spec
mana yang sebenarnya terpengaruh. Tiap spec tetap melempar kalimatnya sendiri.

### Cakupan yang DIAKUI tak penuh

- Aturan status ponsel **tak bisa dijaga dari repo ini**. Yang dijamin: rumah
  bersamanya ada, web memakainya, dan kontrak + changelog menuliskan bentuk
  lima-keadaannya. Ponselnya sendiri sudah memakai aturan itu sejak lama — yang
  berubah justru web.
- Lengan peramban "satu baris = satu FAKTUR" memeriksa PREMISNYA lebih dulu
  (`rows.length > total`), dan **gagal berbunyi bila fikstur tak punya faktur
  multi-item** — tanpa itu asersinya benar secara hampa.
- 18 situs pemanggil lama di `verify-api.sh` diubah **per-baris**, bukan lewat
  regex berkas-penuh — pelajaran putaran tabel Permintaan Stok, tempat satu
  `re.sub` menyentuh 865 situs sekaligus. Diperiksa dengan `diff`: **tepat 18
  baris berubah**.

### Ekor putaran ini: gerbang KESEGARAN bukan gerbang KEPUTUSAN

Sesudah kedua repo di-push dan kedua PR ditulis, CI ponsel run #38 (commit
fikstur putaran garis waktu, `4333bc9`) terbaca **MERAH**: `643 tests passed,
1 failed`. Yang jatuh `kunci_kontrak_server_test.dart` — INTI — dengan dua
nama: **`biaya_lama` dan `biaya_baru`**.

Keduanya milik `JejakBahanRow`. Dari dua belas kunci DTO itu, **sepuluh** sudah
terhitung "disentuh" lewat DTO lain — `harga_lama`/`harga_baru`/`sebab`/`oleh`/
`created_at` dibaca `MenuPriceLogRow`, sisanya nama umum (`id` 66 kali di lib/,
`rows` 12, `jenis` 9, `terpotong` 3, `detail` 2). Berkas keputusannya berkunci
NAMA MEDAN, bukan pasangan `Dto|medan`. Yang tersisa dua, dan keduanya nama
BARU sebab konsepnya baru: biaya per batch sebelum dan sesudah — justru inti
pintunya.

**Kenapa gerbang penuh di sini hijau seluruhnya.**
`kunci-satu-kontrak.test.ts` menjangkau repo ponsel saat repo itu ada, tapi
yang ia tagih hanya **kesegaran fikstur**: fikstur sama dengan keluaran
pembangkit → hijau. Saya memang meregenerasi fiksturnya, jadi ia hijau. Yang
menagih **keputusannya** ada di repo sebelah, dan repo sebelah hanya diuji CI-nya
sendiri. Celah waktunya sempit dan mahal: kunci baru lolos gerbang penuh,
ter-commit, ter-push, lalu memerahkan CI ponsel **sesudah** PR-nya ditulis.

Kelasnya: **gerbang yang memeriksa alat ukur, bukan yang diukur.** Kesegaran
fikstur adalah prasyarat keputusan, bukan penggantinya — dan selama keduanya
tinggal di repo berbeda, yang hijau di sini tak menyatakan apa pun tentang yang
di sana.

Sudah terjadi **tiga kali** (CI ponsel #32, #33, #38), dan dua kali pertamanya
sudah tercatat di ledger ini dengan kalimat "saya tak memeriksanya sebelum
mendorong commit berikutnya" — diagnosis yang menyalahkan kebiasaan, padahal
penyebabnya struktural. Ditutup dengan memindahkan **cermin asersinya** ke
`kunci-satu-kontrak.test.ts`: bila repo ponsel ada, tiap kunci yang lib/-nya tak
sentuh wajib sudah tercatat di `kunci-belum-dibaca.txt`. Bukti merah U: kedua
baris keputusan dicabut → penjaga menyebut `biaya_baru`, `biaya_lama` persis
seperti CI ponsel; dipulihkan byte-per-byte (`cmp`). Premisnya ikut dipaku
(>100 berkas Dart, >500 kunci disentuh, `'nama'` terbaca) supaya sapuan yang
rusak berbunyi, bukan lolos hampa. Bila repo ponsel tak ter-checkout — CI repo
ini — ia melewati, bukan merah, sama seperti asersi kesegaran di sebelahnya.

Yang tak ditutup, dan diakui: cermin ini hanya jalan **di mesin yang memuat
kedua repo**. Di CI repo server ia diam. Itu memang tempat perubahan kontrak
ditulis, jadi ia menjaga satu-satunya titik waktu yang penting — tapi seseorang
yang mengubah `types.ts` tanpa repo ponsel di sebelahnya tetap tak akan diberi
tahu.

## Resep & harga punya GARIS WAKTU — dan penjaga yang saya putihkan sendiri tanpa sadar — web + server — 2026-09-04

- **Diminta pemilik repo**: *"di resep di edit ataupun readonly ingin ada
  riwayat perubahan resep dan perubahan harga resep walaupun yang berubah
  harganya hanya 1 bahan"*.

- **Asalnya satu pertanyaan yang tak terjawab di layar itu.** Satu putaran
  sebelumnya pemilik bertanya soal kotak persetujuan harga: *"kalo yang di
  centang ini apa ya?"* Kotak itu berbunyi "Rp 60.570 → Rp 50.350 — mengubah
  HPP 7 menu", dan **tak ada satu pun tempat di Kakarut yang bisa menerangkan
  dari mana Rp 60.570 datang atau kapan biaya resepnya bergeser ke Rp 50.350**.
  Fitur ini jawaban atas pertanyaan itu, bukan penambahan yang berdiri sendiri.

- **Keadaan sebelumnya, diukur:** `ingredient_components` ditulis
  **hapus-lalu-sisip** tiap simpan (`bahan/routes.ts`), jadi takaran kemarin
  lenyap tanpa bekas di seluruh basis data. `riwayatHargaBahan` yang sudah ada
  hanya membaca faktur **beli** (`productions.tipe='beli'`), jadi untuk bahan
  **produksi** — persis yang punya resep — isinya selalu kosong.

- **Populasi (basis gerbang, SQL):** 230 bahan aktif (59 produksi / 171 beli),
  17 resep berkomponen, 22 baris komponen, rata-rata **1,29** komponen per
  resep (maks 2), 15 bahan mentah dipakai resep. **Fan-out** yang menentukan
  biaya rancangan ini: rata-rata **1,47** resep per bahan mentah, **maksimum
  4** — dan **1** resep bertingkat (komponen yang sendiri berjenis produksi),
  jadi batas "satu tingkat" yang pemilik pilih benar-benar terlewati fikstur,
  bukan cuma diklaim.

- **Sapuan situs tulis:** 14 `.update/.insert(ingredients)` di `src/`, **11**
  menyentuh `harga_beli`/`isi` — 9 di `modules/` (6 update + 3 insert, dua
  berkas) dan 2 di `seed/`. Kesembilan lewat SATU pintu, `catatHargaBahan`.

- **DETEKTOR PERTAMA SAYA BUTA, DAN ITU KETAHUAN SEBELUM DIPAKAI.** Sapuan
  versi satu memakai jendela teks yang hanya melihat KE DEPAN dari
  `.update(ingredients)`. Ia melaporkan 10 situs; yang benar 11. Yang hilang
  `PUT /bahan/:id/resep`, tempat objeknya dirakit ke variabel `setAtur`
  **sebelum** `.update` dipanggil — dan itu justru situs terpenting seluruh
  putaran ini (jalur centang persetujuan harga). Jendela simetris menemukannya.
  Pelajarannya masuk ke penjaga: `jejak-harga-bahan.test.ts` tidak memakai
  jendela byte sama sekali, melainkan fungsi pembungkus TERLUAR dari pohon AST.

- **Rancangannya: satu tabel, dan `ingredient_id` selalu berarti hal yang
  sama** — "garis waktu SIAPA baris ini". Itu yang membuat pembacaannya satu
  kueri tanpa join, termasuk untuk kejadian yang ASALNYA bahan lain: saat harga
  sebuah bahan bergerak, penulisnya **menyebar** satu baris `harga_bahan` ke
  tiap resep pemakainya, dengan biaya per batch yang sudah dihitung ulang.
  Merakitnya saat MEMBACA ditolak, dan alasannya bisa diperiksa: susunan resep
  hari ini bukan jawaban dari "resep apa saja yang memakai bahan X tiga bulan
  lalu", jadi riwayatnya akan menulis ulang masa lalunya sendiri tiap kali
  resepnya diubah.

- **`catatHargaBahan` TAK BERGANTUNG URUTAN PANGGIL.** Ia menghitung ulang
  biaya batch dari basis data, tapi harga bahan yang SEDANG berubah diambil
  dari argumennya, bukan dari baris DB. Versi yang membaca dari DB bekerja
  sempurna di lima situs dan diam-diam mencatat "Rp 0 → Rp 0" di situs yang
  memanggilnya sebelum `UPDATE`-nya jalan — tanpa satu pun galat. Dijaga
  penjaga statis, dan bukti merah H memerahkannya.

- **Simpan yang TAK menggeser apa pun tidak menulis baris**, dan ini bukan
  kerapian. Layar Resep mengirim SELURUH formulir tiap kali Simpan ditekan
  (mengganti satu foto ikut mengirim komponen, takaran, dan overhead yang sama
  persis). Tanpa penyaring itu, riwayat setahun berisi ratusan baris yang tak
  menerangkan apa-apa dan perubahan takaran yang sungguhan tenggelam di
  antaranya. Diuji lewat HTTP (§293), bukan dibaca dari kode.

### Empat hal yang ditemukan penjaga, bukan oleh saya

1. **PENJAGA TENANT SAYA PUTIHKAN SENDIRI — 9 situs kelas F jadi 6.**
   `kueri-terkurung-tenant` mengelompokkan kueri yang pengurungan tenantnya
   tak terbaca mekanis; `modules/bahan/routes.ts` terdaftar **9** situs yang
   sudah dipilah tangan. Sesudah putaran ini: **6**, tanpa satu pun dari
   ketiga kueri itu berubah. Sebabnya `catatHargaBahan(db, auth.company_id!, …,
   [{ ingredientId: id, … }])` punya bentuk yang SAMA PERSIS dengan sebuah
   verifikasi menurut `indukTerverifikasi` — callee Identifier, argumen memuat
   tenant DAN nama kunci saringnya — padahal ia MENULIS jejak dan tak pernah
   menolak apa pun. Komentar `indukTerverifikasi` sendiri sudah memperingatkan
   kelas ini ("satu kueri ber-`and(...)` di mana pun dalam badan fungsi akan
   memaafkan setiap kueri lain"); yang membuatnya terlihat bukan penalaran
   melainkan **angka yang turun di gerbang**. Diperbaiki dengan daftar
   `PENCATAT`, dan diberi bukti merahnya sendiri: pencatat sintetis → tetap
   `F`, verifikasi sintetis berbentuk sama → tetap `C`.

   Kalau saya cuma menurunkan angka terdaftar dari 9 ke 6 — yang paling mudah
   dilakukan dan terlihat "hijau" — tiga kueri yang selama ini menagih
   adjudikasi akan berhenti menagihnya, selamanya.

2. **§293 saya menembak dengan TOKEN MATI.** `verify-api-token.test.ts`
   menolak pemakaian `$KASIR` sesudah §105 (ganti password menaikkan
   `token_version`). Asersi saya "kasir tak boleh membaca riwayat → bukan 200"
   akan **lolos** dengan token mati — 401 juga bukan 200 — dan lolosnya tak
   menyatakan apa pun tentang penjaga peran yang sedang diuji. Diganti
   `$REISS105`.

3. **Periksa-lalu-tulis tanpa penahan di `POST /laporan-harga/:fakturId`.**
   Untuk menulis "dari berapa", saya menambahkan SELECT harga lama sebelum
   UPDATE-nya — dan `lomba-tulis` langsung menuduhnya KLAIM_BUTA. Nyata: dua
   laporan harga atas bahan yang sama bisa sama-sama membaca Rp 10, lalu
   masing-masing menulis mediannya sendiri; yang kalah tertimpa, dan jejaknya
   menyebut angka yang tak pernah jadi harga tersimpan. Ditutup `FOR UPDATE`
   pada SELECT itu — barisnya toh akan di-UPDATE beberapa baris di bawah, jadi
   kuncinya cuma diambil lebih awal.

4. **`1e-9` telanjang, di berkas yang komentarnya sudah menyebut nama kelas
   itu.** `packages/shared/src/ketersediaan.ts` menuliskan panjang-panjang
   kenapa `EPS_QTY = 1e-6` dan bahwa konstanta toleransi telanjang "sudah tiga
   kali jadi bug di repo ini". Perbandingan takaran saya mengetik `1e-9` — dan
   `1e-9` LEBIH KECIL daripada derau float pada besaran yang dipakai praktik
   (ULP `qty/isi` terukur 3,7e-9 pada qty 10⁸), jadi ia akan melaporkan
   "takarannya berubah" untuk takaran yang tak seorang pun sentuh. Diekstrak
   jadi `qtySama()` di `ketersediaan.ts`, memakai `EPS_QTY` yang sudah beralasan.

### Dan satu regresi PUTARAN LALU yang baru ketahuan sekarang

**"✓ Tersimpan" tak pernah bisa muncul sejak `15f7bfe`.** Putaran sebelumnya
memutuskan (atas permintaan pemilik) bahwa simpan yang berhasil MENGUNCI
kembali panel resep. Penanda hijau "✓ Tersimpan" berdiri di dalam blok
`sedangUbah`, berdampingan dengan tombol Simpan — jadi begitu `onSuccess`
memanggil `setMode("lihat")`, blok itu dilepas pada render yang SAMA dengan
yang membuat penandanya layak tampil. Ia tak pernah terlihat sekali pun.

Akibatnya bukan kosmetik: yang menyimpan resep tak mendapat konfirmasi apa
pun — panelnya cuma terkunci, dan diamnya **tak bisa dibedakan dari simpan
yang gagal tanpa suara**. Gerbang penuh putaran itu hijau seluruhnya; kedua
potongan kodenya memang benar dibaca terpisah.

Yang menemukannya lengan peramban putaran INI, yang menunggu "✓ Tersimpan"
sebagai penanda bahwa simpanannya selesai sebelum menghitung baris riwayat.
Perbaikannya: penandanya pindah ke blok mode BACA dan diikat ke resep yang
BENAR-BENAR disimpan (`terakhirSimpan === dipilih.id`) — `simpan.isSuccess`
telanjang bertahan sampai mutasi berikutnya, jadi tanda hijaunya akan menempel
di panel resep LAIN yang diklik sesudahnya. Dijaga `resep-baca-dulu.test.ts`
(letak penanda relatif terhadap kedua blok, plus ikatan idnya).

Kelasnya layak dicatat: **dua perubahan yang masing-masing benar, yang saling
meniadakan hanya pada urutan render**. Tak ada uji statis yang bisa
menemukannya, dan itulah harga yang dibayar untuk punya lengan peramban.

### Keputusan yang ditulis, bukan dibiarkan ditebak

- **Angka jejak yang TAK MUAT ditulis `null`, bukan dilempar.** `biayaBatch`
  bisa meluap secara aritmetika (takaran s/d `BATAS_QTY_RESEP` ≈10⁸ × harga s/d
  `BATAS_UANG` ≈10¹² = 10²⁰, jauh di atas `numeric(14,2)`). Melempar salah, dan
  salahnya bukan di jalur resep melainkan di **penyebaran**: satu laporan harga
  nota menyentuh belasan bahan, dan satu resep patologis akan menggagalkan
  seluruh nota — nota yang isinya benar, ditolak karena baris CATATAN-nya tak
  muat. Jejak tak boleh punya kuasa membatalkan peristiwa yang dicatatnya.
  Menjepit ke batas juga salah: ia menulis angka yang SALAH dan terbaca benar.
- **owner/admin saja** (keputusan pemilik), sejalan dengan layar yang
  memuatnya: angka biaya di halaman Resep memang sudah ditahan dari
  tim/kitchen/bar, dan riwayat yang menyebut rupiah di tiap barisnya akan
  membuka kembali persis yang ditutup di sana. Dijaga `requireRole` DAN
  `bolehLihat` di panelnya — dua pagar, karena yang satu di server dan yang
  lain menahan permintaan yang tak perlu dikirim.
- **`terpotong` MEDAN, bukan header.** Kedua riwayat di sebelahnya
  (`/bahan/:id/pembelian`, `/menu/:id/riwayat-harga`) memakai
  `X-Kakarut-Terpotong` justru karena build ponsel lama membaca balasannya
  `as List`. Pintu ini belum punya klien yang harus dijaga.
- **`beli_perlengkapan` tak punya garis waktu di sini**, dan itu batas yang
  sama seperti putaran tabel Permintaan Stok: `supplies` tabel yang berbeda,
  dan resep tak pernah memakainya.
- **Riwayat mulai dari nol saat tayang.** Tak ada isian surut dan tak mungkin
  ada: resep sebelum tanggal itu tak tersimpan di mana pun. Panelnya
  MENGATAKAN ini — daftar kosong yang diam terbaca sebagai "resep ini tak
  pernah disentuh siapa pun".

### Bukti merah

| | mutasi | memerahkan |
| --- | --- | --- |
| E | pencatat dicabut dari `PUT /bahan/:id` | penjaga statis "tiap pintu menulis jejak" |
| F | `kompLama` dipindah ke bawah `delete(ingredientComponents)` | "resep lama dibaca sebelum dihapus" |
| G | laporan harga menulis `ingredientLogs` langsung | "hanya jejak.ts yang menyisipkan" + penjaga pintu |
| H | fan-out membaca harga baru dari baris DB | "harga baru dari argumen, bukan DB" |
| I | pencatat sintetis di sebelah kueri tak terkurung | kelas F → C (daftar `PENCATAT`) |

Kelimanya dipulihkan **byte-per-byte** (`cmp`), dan harness-nya menolak mutasi
yang jangkarnya cocok ≠ 1 kali — pelajaran putaran yang lalu, tempat
`str.replace("", x, 1)` menyisipkan di posisi 0 dan merusak berkasnya.

### Cakupan yang DIAKUI tak penuh

- Penjaga statis memakai jendela sebesar **handler**, jadi dua tulisan dalam
  satu handler yang hanya SATU dicatat tetap lolos. Yang menutupnya §293
  verify-api, yang menghitung baris jejak yang benar-benar lahir dari tiap
  pintu lewat HTTP sungguhan — termasuk pintu laporan harga nota, yang pada
  jalan alami fikstur **tak pernah menyebar** (keempat bahan yang harganya
  disegarkan di sana kebetulan tak dipakai resep mana pun; diperiksa SQL, bukan
  diasumsikan). §293 karena itu membangun rantainya sendiri: bahan → resep →
  nota → laporan harga, dan menuntut biaya batch 3.000 → 3.750 yang dihitung
  tangan.
- Sapuan situs tulis dibatasi `src/modules/`; dua situs `seed/` sengaja di
  luar — fikstur, bukan peristiwa yang perlu diriwayatkan.

## Resep dibuka TERKUNCI — dan "boleh mengubah" dipisahkan dari "sedang mengubah" — web — 2026-09-04

- **Diminta pemilik repo**: *"resep ketika di klik ingin read only saja, dan
  ingin ada tombol edit untuk admin dan owner"*.

- **Keadaan sebelumnya**: panel detail resep langsung bisa diketik begitu
  resepnya diklik. Satu klik nyasar di medan takaran cukup mengubah HPP
  **setiap menu** yang memakai bahan itu — dan tak ada satu pun langkah sadar
  di antara "membuka resep untuk melihat" dan "mengubah angkanya".

- **Peran yang diminta SUDAH ADA**: `bolehUbah = role === "owner" || "admin"`
  (`ResepPage.tsx:242`), persis dua peran yang pemilik sebut. Yang belum ada
  tahap bacanya. Jadi putaran ini bukan menambah izin, melainkan **memisahkan
  dua hal yang selama ini satu bendera**.

- **DAN BENDERA ITU MENJAGA DUA HAL YANG BERBEDA** — ini bagian yang paling
  mudah salah, dan yang dijaga penjaganya. `bolehUbah` menjaga afordansi
  mengetik, TAPI JUGA kelihatan-tidaknya angka manajemen: kolom uang di daftar
  (`kolomDaftarResep`), harga per satuan di tiap baris bahan, total bahan baku
  sebelum overhead. Mengganti semuanya jadi `sedangUbah` akan membuat mode baca
  ikut **menyembunyikan harga dari owner yang cuma ingin melihat** — mode baca
  yang menyembunyikan justru yang ingin dilihat adalah mode baca yang orang
  lewati. Yang berpindah ke `sedangUbah` hanya 12 `disabled` + tiga afordansi
  (tambah bahan, hapus baris, peringatan takaran tak terbaca); yang menjaga
  angka tetap `bolehUbah`.

- **Dua cabang baca-saja SUDAH ADA dan tinggal dipakai ulang**: cara masak dan
  unggah foto sudah punya render alternatif untuk peran `tim`
  (`{bolehUbah ? <editor> : <tampilan>}`). Keduanya cukup diubah jadi
  `sedangUbah ?` — owner/admin dalam mode baca kini memakai tampilan yang sama
  persis dengan yang selama ini dilihat tim. **Nol markup baru** untuk dua
  bagian terbesar panelnya.

- **Keputusan pemilik, ditanyakan lebih dulu**: (a) keluar dari mode ubah
  dengan ketikan yang belum disimpan → **konfirmasi dulu**; (b) sesudah Simpan
  berhasil → **kembali ke tampilan baca**.

  Konfirmasinya hanya muncul bila drafnya **memang berubah** — potretnya
  diambil saat Edit ditekan, bukan saat draf disemai. Bedanya nyata: draf bisa
  saja sudah berbeda dari server karena pembulatan saat disemai, dan bertanya
  "buang perubahan?" kepada orang yang tak mengubah apa pun adalah cara
  tercepat membuat konfirmasi itu ditekan tanpa dibaca.

- **PINTU SAMPING ikut dijaga.** Tombol Batal bukan satu-satunya jalan keluar
  dari mode ubah — mengklik resep lain juga. `bukaDetail` karena itu lewat
  penjaga yang sama; tanpa itu ketikan hilang lewat pintu yang tak dijaga
  sementara pintu depan dijaga rapi. Ini pola yang sama dengan cacat
  "perbaikan cuma kena setengah layar" dua entri di atas, dan kali ini dicari
  sebelum dikirim, bukan sesudah.

- **Kesalahan premis di lengan e2e, ditemukan oleh merahnya sendiri.** Versi
  pertama mengklik baris pertama tabel resep — dan gagal, sebab resep teratas
  kebetulan **belum punya satu bahan pun**, jadi tak ada medan takaran untuk
  diperiksa terkunci. Merahnya benar tapi menuduh fiturnya, padahal yang salah
  pilihan fiksturnya. Diperbaiki dengan menurunkan premisnya dari server:
  `/bahan/resep-ringkas` memulangkan peta `id → jumlah bahan`, dan yang dipakai
  id pertama yang jumlahnya > 0.

- **Batas irisan penjaga yang hampir menipu**: `butaKomentar` **mengosongkan**
  komentar tanpa memendekkan berkasnya (posisi baris lain harus tetap), jadi
  irisan `indexOf + 200` yang saya tulis pertama tak sampai ke `setMode` yang
  cuma dua baris di bawahnya — terhalang blok penjelasan enam baris yang sudah
  jadi spasi. Angka yang pas-pasan lolos hari ini lalu diam-diam berhenti
  melihat apa pun begitu komentarnya tumbuh. Diperlebar, dan alasannya ditulis
  di tempatnya.

- **Empat bukti merah**, tiap satu dipulihkan byte-per-byte:

  | | mutasi | gagal di |
  | --- | --- | --- |
  | A | bawaannya `"ubah"` (klik langsung bisa diketik) | bendera & bawaan |
  | B | `sedangUbah` lupa memeriksa `bolehUbah` | bendera & bawaan |
  | C | pintu samping tak dijaga | PINTU SAMPING |
  | D | sesudah simpan tetap terbuka | terkunci lagi sesudah simpan |

  B layak disebut: tanpa `bolehUbah`, peran non-manajemen bisa membuka mode
  ubah lewat keadaan lokal — dan seluruh medan yang tadinya `disabled` karena
  peran jadi bisa diketik. Server tetap menolaknya, tapi layar yang menawarkan
  tombol yang selalu ditolak adalah layar yang berbohong.

- **Gerbang penuh**: verify-api **3.517/0** (nol perubahan server), npm test
  **237 berkas / 2.894 uji**, invarian **27/27**, Playwright **40 lolos**
  (dari 38). Tanpa rilis.

---

## RILIS 2026-09-04 — tiga putaran tayang, dan satu alarm palsu yang saya bunyikan sendiri — web + ponsel — 2026-09-04

- **Diminta pemilik**: *"rilis"*. Aturan berdirinya ("jangan dulu rilis apapun
  ke production ataupun staging kalo saya belum minta rilis") karena itu
  terpenuhi.

- **Yang tayang**, tujuh commit di web + satu di ponsel:

  | | commit | CI |
  | --- | --- | --- |
  | web → `production` | `48532a3` (merge) | **#493 hijau**, termasuk deploy |
  | ponsel → `Production` | `f429dba` (merge) | **#37 hijau** |

  Isinya: Menu & HPP bentuk ikon · detail faktur jadi halaman dokumen ber-URL ·
  Permintaan Stok bentuk tabel + rutenya berhalaman · perbaikan tautan bentuk
  kartu.

- **Gerbang dijalankan pada HASIL MERGE, bukan cabang kerja** — `ci.yml`
  sengaja tak memicu pada `pull_request`, dan repo ini sudah pernah melihat PR
  yang masing-masing hijau menghasilkan kegagalan saat digabung. Hasil merge
  web terbukti **byte-identik** dengan `claude` (`git diff --stat claude`
  kosong), lalu digerbang ulang di atasnya: verify-api **3.517/0**, npm test
  **236 berkas / 2.884 uji**, invarian **27/27**, Playwright **38 lolos**.

- **Dua repo didorong dalam selang dua menit**, sesuai syarat serentak yang
  ditulis putaran sebelumnya: `GET /rekomendasi/permintaan` berubah bentuk dan
  ponsel membacanya dengan cast keras. **Jendelanya belum benar-benar tertutup
  sampai APK di tiap perangkat diperbarui** — dan itu di luar kendali repo
  mana pun. Yang terjadi pada APK lama selama jendela itu: layar Permintaan
  Stok menampilkan **keadaan galat**, bukan data yang salah — `as List` atas
  `Map` melempar, dan `FutureProvider` menangkapnya. Diperiksa dua arah: APK
  baru melawan server lama juga melempar, bukan berbohong. Ditulis di stempel
  changelog-nya.

- **ALARM PALSU YANG SAYA BUNYIKAN SENDIRI, dan layak dicatat sebagai kelas.**
  Di tengah rilis saya melaporkan — keras, dan sebagai temuan mendesak — bahwa
  cabang `claude` repo ponsel "di-reset ke commit 25 Agustus dan commit saya
  hilang". **Itu keliru.** Yang basi ref pelacak lokal: `git fetch origin
  claude` hanya memperbarui `FETCH_HEAD`, **bukan**
  `refs/remotes/origin/claude`, jadi `git log origin/claude` menjawab dari
  salinan lama. `git ls-remote` — yang menanya remote-nya langsung —
  menunjukkan `claude` ada di `6cd7d88` sejak awal.

  Kelasnya: **menyimpulkan keadaan sistem lain dari cache lokal yang tak
  pernah diperiksa kesegarannya**. Persis bentuk yang sama dengan cacat
  `supBelum` di putaran sebelumnya (nama yang teresolusi ke tempat yang salah),
  dan dengan "gerbang yang tak dibaca bukan gerbang". Yang membedakan: di sini
  saya menemukannya dalam dua langkah, sebelum bertindak — `git push` menjawab
  "Everything up-to-date", yang **bertentangan** dengan kesimpulan saya, dan
  kontradiksi itu yang memaksa `ls-remote`. Petunjuk yang bertentangan dengan
  hipotesis lebih murah daripada bukti yang mendukungnya.

  Yang HARUS berbeda lain kali: `git ls-remote` (atau `git fetch --prune` yang
  memperbarui ref pelacaknya) **sebelum** menyimpulkan apa pun tentang keadaan
  cabang remote — bukan sesudah.

- **Stempel changelog** dipasang untuk kedua entri pada commit yang SAMA dengan
  penghapusannya dari `BELUM_TAYANG`; memisahkan keduanya adalah cara berkas
  itu pernah salah selama empat hari.

---

## Perbaikan yang cuma kena SETENGAH layar — dan dua gerbang yang setuju bahwa ia beres — web — 2026-09-04

- **Kenapa entri ini ada**: pemilik repo meminta *"cek bug perbaikan baru"*.
  Yang diperiksa pekerjaan saya sendiri dari putaran sebelumnya, dan ia memang
  bercacat.

- **CACATNYA**: perbaikan tautan ("tiap jalur menautkan ke halaman dokumen
  fakturnya, bukan ke daftarnya") **hanya kena bentuk TABEL**. Bentuk KARTU —
  yang **BAWAAN**, jadi yang paling sering dibuka orang — tetap menunjuk
  `/produksi` dan `/pembelian`, daftarnya. Terukur di peramban: kartu punya
  **NOL** tautan ke halaman dokumen faktur.

  Jadi klaim yang saya tulis di pesan commit, PR, dan entri ledger sebelumnya
  benar hanya untuk bentuk yang harus dipilih orang lebih dulu, dan salah untuk
  bentuk yang ia lihat saat membuka halamannya.

- **DUA GERBANG SETUJU BAHWA ITU BERES, dan tak satu pun pernah melihatnya** —
  ini bagian yang layak diingat:

  | gerbang | kenapa hijau |
  | --- | --- |
  | penjaga statis `tiap jalur menautkan ke FAKTURNYA` | ia hanya membaca `kolom-permintaan.tsx`; halamannya tak pernah dibuka |
  | lengan peramban `lencana jalur membuka HALAMAN DOKUMEN` | ia menekan `☰ Tabel` lebih dulu, jadi ia tak pernah menyentuh bentuk bawaannya |

  Keduanya menguji **jalan yang sama** dari dua arah, dan sama-sama melewatkan
  jalan yang lain. Dua gerbang yang hijau atas hal yang sama bukan dua gerbang.

- **Kelas cacatnya, ditulis supaya bisa dikenali lagi**: sebuah aturan
  diperbaiki di SATU dari DUA tempat yang merendernya, dan penjaganya menjaga
  *tempat yang diperbaiki* alih-alih *aturannya*. Asersi "berkas X menyebut
  pola yang benar" tak pernah bisa menangkap ini; yang bisa hanya "tak ada
  tempat lain yang boleh menentukannya sendiri".

- **Perbaikannya STRUKTURAL, bukan menyalin tautan ke tempat kedua**:
  `tautanJalur()` dan `IKON_JALUR` diekspor dari `kolom-permintaan.tsx`, prop
  `to` pada `Bagian` **dihapus** (tak ada pemanggil yang bisa menentukan tujuan
  sendiri lagi), dan `gayaBagian`/`gayaPerlengkapan` dinaikkan ke lingkup modul
  supaya kartu dan tabel memakai satu fungsi. `BagianPerlengkapan` ikut lewat
  fungsi yang sama, jadi batas "BP- tetap ke daftarnya" pun hidup di satu
  tempat.

- **DUA DUPLIKASI LAIN yang ikut ketahuan sepanjang jalan** — keduanya saya
  sendiri yang membuatnya di putaran sebelumnya, di putaran yang justru
  menghapus duplikasi di tempat lain:
  - terner label tahap ditulis **dua kali** byte-identik (`Bagian` dan
    `gayaBagian`) — kartu dan tabel bisa menyebut tahap yang sama dengan dua
    kata berbeda untuk faktur yang sama;
  - peta ikon jalur punya **dua rumah** (terner di halaman + `IKON_JALUR`).
  - Plus satu impor mati (`formatTanggalRingkas`); `noUnusedLocals` tak aktif
    di repo ini, jadi tak ada yang menagihnya.

- **Urutan kerjanya sengaja dibalik**: lengan peramban untuk bentuk kartu
  ditulis **lebih dulu** dan dijalankan terhadap kode yang masih bercacat —
  merahnya ("kartu tak punya satu pun tautan ke halaman dokumen faktur") adalah
  bukti cacatnya ADA, bukan sekadar dugaan dari membaca sumber. Baru sesudah
  itu diperbaiki.

- **Penjaganya diperluas dan dibuktikan bisa menuduh**: memasang kembali cacat
  aslinya (`to=` literal di kartu) → merah; menyalin balik terner labelnya →
  merah. Keduanya dipulihkan byte-per-byte.

- **Gerbang penuh**: verify-api **3.517 / 0**, npm test **236 berkas /
  2.884 uji**, invarian **27/27**, Playwright **38 lolos** (dari 37). Tanpa
  rilis.

---

## Permintaan Stok dapat bentuk TABEL — dan korelasi SQL tak berkualifikasi yang lolos invarian partisi — web + server + ponsel — 2026-09-03

- **Kenapa vena ini ada**: pemilik repo meminta *"permintaah stock juga ingin
  ada yang versi tabel"* — "juga" merujuk Riwayat Pengadaan, yang putaran
  sebelumnya diubah jadi tabel. Yang ditemukan saat mengukurnya menentukan
  sisanya, dan pemiliknya memutuskan mengambil semuanya sekaligus.

- **Keadaan sebelumnya**: `PermintaanStokPage.tsx` (414 baris) daftar kartu
  satu kolom di dalam `max-w-2xl`, nol `<table>`, nol saringan. Rutenya
  `GET /rekomendasi/permintaan` **tak membaca satu pun query param** dan
  memulangkan **array telanjang** berisi seluruh riwayat permintaan
  perusahaan; paginasinya 100% dipotong di klien.

- **Terukur lewat HTTP/SQL sebelum satu baris ditulis**:

  | | sebelum | sesudah |
  | --- | --- | --- |
  | permintaan di DB gerbang | 24 | 24 |
  | byte balasan | **11.790, SELALU** | 10.132 (`per_page=20`) |
  | per permintaan | ~491 B | — |
  | proyeksi @1.000 permintaan | **~491 KB tiap buka halaman** | tetap ~10 KB |
  | kueri | 3, **dua tanpa langit-langit** | 5, **semua berbatas** |

  Ikut diukur dan menentukan bentuk kolomnya: jalur non-null per permintaan
  **min 1, maks 4, rata 1,79** (dari 6 yang mungkin) — kolom "Isi" memang muat,
  dan itu diketahui sebelum kolomnya diketik, bukan sesudah.

- **TEMUAN UTAMA — korelasi SQL tanpa kualifikasi tabel, dan invarian yang
  TIDAK menangkapnya.** Subkueri perlengkapan ditulis
  `sp.rencana_id = ${productions.rencanaId}`; drizzle merendernya
  **`sp.rencana_id = "rencana_id"`** — tanpa kualifikasi. Di dalam
  `FROM supply_purchases sp`, `"rencana_id"` teresolusi ke **`sp.rencana_id`
  sendiri**, jadi syaratnya jadi `sp.rencana_id = sp.rencana_id`: selalu benar.
  `supBelum` berhenti bertanya *"permintaan INI perlengkapannya belum beres?"*
  dan mulai bertanya *"adakah SATU SAJA baris perlengkapan yang belum beres di
  seluruh perusahaan?"*.

  Hasilnya `berjalan: 24, selesai: 0` untuk populasi yang hitungan tangannya
  **17 / 7**. Dan yang **tidak** menangkapnya: **invarian partisi** —
  `24 + 0 + 0 = 24`, tetap tepat, sebab seluruh kesalahannya mendarat di satu
  ember. Yang menangkapnya perbandingan dengan hitungan tangan §0.
  **Itulah gunanya mengukur lebih dulu**, dan ini kali pertama di ledger ini
  sebuah invarian struktural terbukti tak cukup sendirian.

- **Aturan status pindah rumah** ke `packages/shared/src/permintaan-stok.ts`
  (kembaran `pengadaan.ts`, yang kepalanya sudah menuliskan polanya). Server
  memakai konstantanya untuk merakit predikat SQL; web untuk badge dan label
  ubin. Tanpa itu, ubin berbunyi "3 selesai" di atas daftar dengan 4 lencana
  selesai — populasi yang sama, layar yang sama, nol uji merah.

- **Sakelar bentuk diekstrak saat salinan KETIGA hendak lahir**
  (`components/SakelarTampilan.tsx`). Dua yang ada sudah menyimpang persis pada
  hal yang membuatnya terasa satu produk: Menu `text-xs`/`px-3 py-1` tanpa
  hover, Resep `text-sm`/`px-3 py-1.5` + `hover:` + `type="button"`. Tak satu
  pun perbedaan itu pernah diputuskan siapa pun. `type="button"` dari versi
  Resep dipakai keduanya — tanpanya sebuah `<button>` di dalam `<form>`
  bertipe `submit`, dan sakelar yang mengirim formulir tak meninggalkan gejala
  selain "kenapa halamannya reload".

- **Tautan tiap jalur dibetulkan** — dan ini ditemukan sambil membaca, bukan
  diminta. Tiap blok jalur SUDAH memegang `faktur_id`, tapi tautannya menunjuk
  `/produksi` atau `/pembelian`: **daftarnya**. Mengklik "🏭 Produksi · 3 bahan"
  mendaratkan orang di halaman 1 dari 4 dan menyuruhnya mencari sendiri faktur
  yang barusan ia klik. Kini ke halaman dokumen fakturnya — memakai ulang rute
  putaran kemarin, nol kerja server baru. **Batas yang disengaja**:
  `beli_perlengkapan` (BP-) TETAP ke daftarnya; fakturnya hidup di
  `supply_purchases` dan halaman dokumen hanya melayani `productions`.

- **Dua alarm saya sendiri yang SALAH, dikoreksi sebelum jadi pekerjaan.**
  Saya melaporkan bahwa PM-0012 punya tiga faktur produksi dan satu di
  antaranya tak dirender. Keliru: kueri saya tak mengupas baris ber-`asal_branch_id`
  (jalur `kirim`) lebih dulu, jadi saya menghitung faktur kirim sebagai bucket
  produksi. Diukur ulang dengan bucketing handler yang sebenarnya: **nol**
  rencana ber-bucket ketiga, **nol** rencana ber-dua-bucket-CK. Keduanya jalur
  kode yang ada tapi tak pernah terpakai — ditulis sebagai komentar batas di
  tempat pemetaannya, **bukan** dirombak. Rencana ini sempat menuliskan
  "diperbaiki lebih dulu"; yang benar mengukur ulang.

- **Penjaga `urutan-pemutus-seri` menemukan lubangnya sendiri.** Ia memvonis
  ORDER BY saya SERI padahal pemutus serinya ADA — sebab bentuk "agregat dulu,
  baru dipotong" memecah rantainya jadi dua, dan `grupTerpakai` hanya melihat
  satu rantai. Vonis itu bukan cuma salah, ia MAHAL: ia menyuruh menambahkan
  pemutus seri kedua pada kunci yang sudah unik, dan yang berikutnya belajar
  bahwa gerbang itu boleh ditawar. Pemindainya diajari mengenali
  `const X = db.select(…).groupBy(k).as(…)` lalu `.from(X)` — dan **dibuktikan
  masih bisa menuduh**: mencabut pemutus serinya memerahkannya lagi.

- **Ponsel diperbaiki di putaran yang sama** (keputusan pemilik). `as List`
  pada balasan yang kini `Map` akan melempar saat runtime. Sekalian: kedua
  lencana "permintaan berjalan" di Beranda & Kasir dulu menyaring `rows`
  sendiri — salinan KETIGA aturannya, dan salinan yang **menyimpang**: ia hanya
  melihat `kirim`/`produksi`/`beli`/`beli_produksi`, jadi permintaan yang sisa
  pekerjaannya di `produksi_cabang` atau `beli_perlengkapan` tak terhitung.
  Keduanya kini memakai `ringkas.berjalan`. Dan karena layar ponsel tak punya
  kendali halaman, ia meminta `per_page=200` **dan mengaku** lewat "Menampilkan
  N dari M" — daftar yang diam-diam berhenti di 200 membuat orang mengira
  permintaan lamanya sudah tak ada.

- **Delapan bukti merah**, tiap satu dipulihkan byte-per-byte (`cmp`):

  | | mutasi | gagal di |
  | --- | --- | --- |
  | A | `MAX(waktu)` → `MIN` | penjaga statis |
  | B | pemutus seri dicabut | penjaga statis ×2 |
  | C | `NOT EXISTS` → `bool_and` skalar | **`selesai` 7 → 0, invarian partisi false** |
  | D | urutan peta, bukan urutan kunci | penjaga statis |
  | E | `statusPermintaan` disalin balik | penjaga statis |
  | F | ubin dijumlahkan dari `rows` | lengan peramban |
  | G | pilihan sakelar tak ditulis | lengan peramban |
  | H | tautan jalur dikembalikan ke daftar | lengan peramban |

  **C yang paling berharga**: ia satu-satunya yang membuktikan invarian
  partisi memang bisa menuduh — dan sekaligus, dipadu temuan utama di atas,
  menunjukkan batasnya. Mutasi pertama saya untuk C memecahkan kuerinya
  sama sekali (500) — merah yang benar karena alasan yang salah; diulang
  dengan mutasi yang setia pada kelas cacatnya (`bool_and` atas himpunan
  kosong → NULL).

- **Bukti merah saya sendiri sempat merusak berkasnya.** Mutasi B mengganti
  barisnya dengan string KOSONG, dan `str.replace("", x, 1)` menyisipkan di
  posisi 0 — pemulihannya mendarat di baris pertama berkas. `cmp` yang
  menangkapnya. Harnessnya kini menolak mutasi yang salah satu sisinya kosong.

- **Batas yang diketahui, ditulis jujur**: jalur `/pembelian` bentuk tabel tak
  punya lengan peramban (kolom biaya, buku dana, supplier) — hanya verify-api
  §292 + penjaga statis. Sebabnya kuota `/auth/login` (10 per 5 menit per
  IP+email; sepuluh berkas spec sudah memakai akun owner), dan lengan putaran
  ini menumpang `pengadaan-tabel.spec.ts` karena itu. Perbaikan sesungguhnya
  masuk antrean di bawah.

- **Gerbang penuh**: verify-api **3.517 lolos / 0 gagal** (+9 dari §292),
  npm test **236 berkas / 2.882 uji**, invarian **27/27**, Playwright
  **37 lolos**. Ratchet `daftar-tanpa-langit-langit` **64 → 65** dengan alasan
  tertulis. Kontrak + entri changelog ponsel 🔴 WAJIB didaftarkan di
  `BELUM_TAYANG`. **Tanpa rilis** — dan untuk vena ini rilisnya WAJIB serentak
  dua repo: APK lama + server baru = layar Permintaan gagal.

---

## Detail faktur jadi HALAMAN dokumen — dan bukti merah yang membuktikan lengan `reload()` bukan kelebihan — web + server — 2026-09-03

- **Kenapa vena ini ada**: pemilik repo membuka modal Detail Produksi (PR-0137)
  dan meminta *"detail produksi ingin di buat form seperti form produksi dan
  page sendiri supaya bisa di print dan share"*. Tiga hal yang tak bisa
  diberikan sebuah modal, dan ketiganya jadi ukuran pekerjaan ini: URL yang
  bisa dikirim, kertas yang bisa dicetak, PDF yang bisa disimpan.

- **Keadaan sebelumnya**: `FakturDetailModal.tsx`, **509 baris**, merender 28
  medan, hanya bisa dibuka dengan mengklik baris di riwayat pengadaan. Tak
  punya URL, tak bisa dicetak, tak bisa dikirim.

- **Ukuran yang menentukan bentuknya** (basis data uji, `GET /produksi`
  `branch_id=all`, token owner):

  | | |
  | --- | --- |
  | faktur produksi | **62** |
  | per halaman | 20 → **4 halaman** |
  | balasan satu halaman | **~43.880 byte** |
  | balasan `GET /produksi/faktur/:id` | **9.729 byte** |

  `GET /produksi` **tak punya saringan `faktur_id` sama sekali** —
  parameternya cuma `branch_id`, `dari`, `sampai`, `tanggal`, `page`,
  `per_page`. Jadi halaman yang harus menemukan fakturnya sendiri menyisir
  sampai empat permintaan, dan faktur di halaman ke-4 tak bisa dibuka dari
  tautan tanpa memuat tiga halaman yang tak ada hubungannya. Itu satu-satunya
  alasan putaran ini menyentuh server; kalau saringannya ada, ini murni
  pekerjaan web.

- **Satu rute, dua jalur.** `buatRuteTambahStok(tipe)` melahirkan `/produksi`
  DAN `/pembelian`, jadi `GET {jalur}/faktur/:fakturId` melayani keduanya.
  `select` + join + pengayaannya (rak simpan, `qty_teks`, batch) diekstrak jadi
  `ambilBarisFaktur()` yang dipakai daftar DAN detail — dua `select` yang
  ditulis terpisah adalah dua bentuk baris yang pelan-pelan berbeda, dan badge
  di halaman detail berhenti cocok dengan badge di barisnya untuk faktur yang
  SAMA. **Kesetaraannya diukur, bukan diklaim**: verify-api §291 mengambil satu
  `faktur_id` dari daftarnya, menembak rute barunya, dan membandingkan kedua
  `rows` dengan `jq` deep-equal → `true`.

- **Gerbangnya sama persis dengan daftarnya**, dan itu inti keamanannya: rute
  per-id yang lebih longgar adalah pintu samping — `bar` membaca faktur
  `kitchen` hanya dengan menebak URL. Saringan divisi + penyaring faktur
  transfer diekstrak jadi `gerbangPengadaan(auth)`: **satu definisi, dua
  pemanggil**. Cabangnya dari **token**, bukan `?branch_id=` — untuk peran
  terikat barisnya harus menyentuh cabangnya (`branch_id` / `dari_branch_id` /
  `asal_branch_id`; tanpa dua yang terakhir faktur yang sudah dikirim hilang
  dari mata CK), untuk manajemen tak menyempit sama sekali sebab tautan tak
  boleh mati hanya karena pemilih cabang penerimanya sedang di tempat lain.
  Tak ada / bukan miliknya / di luar jangkauan perannya → **satu 404 yang
  sama**; membedakannya memberi tahu penebak URL bahwa fakturnya ADA.

- **LUBANG DI PENJAGA SAYA SENDIRI, yang bukti merahnya temukan.** Versi
  pertama asersi gerbang cuma memeriksa teks `condDivisi` ADA di irisan
  rutenya. Bukti merah 1 (mencabut saringan divisi jadi
  `const condDivisi: SQL[] = []`) **tetap HIJAU** — teks lamanya tinggal
  sebagai binding mati, dan penjaganya tak bisa membedakannya dari nilai yang
  dipakai. Saya sudah memastikan mutasinya benar-benar terpasang sebelum
  menyimpulkan, jadi yang salah memang penjaganya. **Asersi teks tak bisa
  membuktikan sebuah NILAI dipakai.** Perbaikannya struktural, bukan asersi
  yang lebih ketat: predikatnya diekstrak, dan yang dijaga sekarang
  bentuknya — tepat **1** definisi `ne(ingredients.divisiProduksi, auth.role)`,
  tepat **1** `eq(dokumenNomor.jenis, "transfer")`, tepat **2**
  `gerbangPengadaan(auth)`. Mencabutnya dari salah satu pintu berarti
  memanggil fungsi lain, dan itu terlihat. Sesudah diperbaiki, bukti merah 1
  gagal benar DAN lahir bukti merah kelima (predikat disalin ke dua tempat).

- **Modalnya DIHAPUS, bukan dibiarkan berdampingan.** 28 medan yang dirender
  di dua tempat adalah 28 medan yang akan berbeda — dan yang satu diperbaiki
  sementara yang lain tidak. Kelima aksinya ikut pindah **seluruhnya** (ubah
  tahap, Dokumen RAB/belanja, Laporan Harga, Dokumen kirim, Hapus/Batalkan);
  tombol yang dibuang tanpa rumah baru adalah kemampuan yang hilang
  diam-diam. Perakit `FakturGroup` (~60 baris turunan: status agregat, jejak
  terima terakhir, penanda kiriman/permintaan, divisi, total harga) diekstrak
  jadi `kelompokkanFaktur()` yang diekspor — satu aturan, dua pemakai.

- **Mesin cetaknya yang sudah ada, nol CSS baru**: `isi(cetak)` untuk layar dan
  kertas, `AreaCetak id="dokumen-print"` yang aturan `@media print`-nya sudah
  hidup di `index.css`, `buildBody()`/`unduhPdf()` dengan tiap sisipan data
  dilewatkan `lolosHtml`, plus ruang tanda tangan — itu yang membuatnya "form".
  `AreaCetak` sudah menuliskan alasannya sendiri: tanpa memportal ke luar
  `#root`, tinggi shell menentukan tinggi cetakan (terukur 8 halaman, 7 kosong,
  untuk satu struk).

- **Batas "share" yang dipilih pemilik, dan DIKATAKAN di layarnya**: tautannya
  untuk sesama karyawan — penerimanya tetap wajib login dan tetap tunduk peran
  & cabangnya. Tak ada tautan publik bertoken. Untuk ke luar, PDF-nya yang
  dikirim. Orang yang mengira ini tautan publik akan mengirimnya ke supplier
  dan baru tahu keliru saat supplier itu melihat layar login, jadi kalimatnya
  ada di halamannya, bukan cuma di komentar kode.

- **Lengan peramban ditumpangkan ke `pengadaan-tabel.spec.ts`, bukan berkas
  spec sendiri** — dan itu batas fisik, bukan selera. `/auth/login` dibatasi
  10 per 5 menit per (IP+email), cache sesi e2e hidup per-MODUL, dan Playwright
  menjalankan tiap berkas spec sebagai proses tersendiri. Dihitung saat
  putaran ini: **sepuluh** berkas sudah memakai akun owner — tepat di
  plafonnya. Berkas ke-11 memerahkan berkas MANA PUN yang berjalan terakhir
  dengan 429, kegagalan yang menuduh kode yang tak bersalah (persis yang
  terjadi putaran sebelumnya dan menggigit `stok-awal-gagal.spec.ts`).
  Subjeknya pun memang satu: "riwayat pengadaan, dan apa yang terjadi saat
  barisnya diklik". Penjaga statisnya memaku keberadaan ketiga lengan itu
  supaya rujukan silangnya tak bisa jadi basi.

- **Empat bukti merah peramban**, urutan **mutasi → build → RESTART server →
  uji** (tanpa restart, server menyajikan `index.html` yang di-cache saat boot
  dan tiap asersi gagal di tempat yang salah — pelajaran yang sudah dibayar dua
  kali), tiap satu dipulihkan **byte-per-byte** (`cmp`):

  | | mutasi | gagal di |
  | --- | --- | --- |
  | A | baris menavigasi tanpa id faktur | `toHaveURL` |
  | B | data diwarisi cache DAFTAR | **lulus sebelum `reload`, gagal sesudahnya** |
  | C | Salin tautan menyalin URL daftar | `toBe(URL benar)` |
  | D | gagal muat dirender dokumen kosong | kalimat "tidak bisa dibuka" |

  **B yang paling berharga**, dan ia menjawab pertanyaan yang biasanya tak
  pernah ditanyakan: apakah lengan `page.reload()` menambah sesuatu, atau cuma
  mengulang lengan sebelumnya? Mutasinya membuat halaman merakit detailnya dari
  cache `GET /produksi` yang dibaca layar riwayat. Hasilnya: **lulus** pada
  `dokumenMenyebut` yang pertama (baris 188) dan **gagal** pada yang kedua
  (baris 200), sesudah muat ulang. Cacat itu bekerja sempurna bagi orang yang
  mengklik dari riwayat dan runtuh tepat bagi orang yang menerima tautannya —
  satu-satunya orang yang fitur ini dibuat untuknya. Tanpa lengan `reload()`,
  cacat itu lolos.

- **Batas yang diketahui, ditulis jujur**: penjaga statisnya membaca teks
  sumber, jadi ia tak bisa mengatakan halamannya benar-benar tercetak rapi —
  tak ada asersi atas hasil `window.print()` di repo ini, dan e2e-nya pun tak
  menguji PDF-nya benar-benar terbuka. Yang dijaga: mesin cetaknya yang sudah
  terbukti dipakai (bukan yang baru), dan tiap sisipan data dilewatkan `esc()`.
  Lengan peramban juga tak menguji jalur `/pembelian` (kolom biaya, buku dana,
  supplier) — jalur itu hanya dijaga verify-api §291 dan penjaga statis.

- **Gerbang penuh** (DB nol → seed → verify-api → regen jejak → npm test →
  invarian → reset batas laju → Playwright): verify-api **3.508 lolos / 0
  gagal**, npm test **235 berkas / 2.856 uji**, invarian **27/27**, Playwright
  **34 lolos**. `rute-diketuk.txt` mencatat kedua rute baru (277 baris).
  Kontrak API + entri `CHANGELOG-API.md` didaftarkan di `BELUM_TAYANG` —
  belum tayang, masih di cabang `claude`. **Tanpa rilis**, sesuai aturan
  pemilik.

---

## Menu & HPP dapat bentuk IKON, dan pratinjaunya kartu kasir yang SAMA — bukan yang mirip — web — 2026-09-03

- **Kenapa vena ini ada**: pemilik repo meminta *"menu hpp ingin ada tampilan
  ikon juga untuk cek preview foto menu di kasir"*. Tujuannya ia sebut sendiri,
  dan tujuan itu yang menentukan seluruh bentuk pekerjaannya.

- **Keadaan sebelumnya**: `MenuDto` membawa `image_url` sejak lama dan server
  mengirimkannya di tiap `GET /menu` (`menu/service.ts:433`) — halaman Menu &
  HPP tak pernah sekali pun memakainya. Bukan medan yang kurang; medan yang
  tak pernah dibuka.

- **Yang membuat putaran ini lebih dari "tambah grid"**: pratinjau yang cuma
  MIRIP kartu kasir lebih buruk daripada tak ada pratinjau. Fotonya dipasang
  `object-cover` di kotak `h-20` — ia MEMOTONG sisi panjang, jadi kotak yang
  sedikit lebih pendek atau kolom grid yang sedikit lebih sempit menghasilkan
  potongan yang lain. Dan potongan itulah satu-satunya hal yang orang membuka
  halaman ini untuk memeriksanya. Pratinjau yang keliru soal potongan membuat
  orang mengunggah ulang foto yang sebenarnya sudah benar — kerugian yang tak
  akan pernah ia kenali sebagai bug.

  Maka kartunya bukan kartu baru: `KasirPage.tsx:1057-1093` diekstrak jadi
  `components/KartuMenuKasir.tsx` dan dipakai KEDUA layar, grid-nya memakai
  titik henti yang sama (2 → 3 → 4 kolom), dan penjaganya menuntut kelas
  `h-20 w-full` muncul di **tepat satu berkas** seluruh `apps/web/src`.

- **Tiga salinan `🍜` yang ditemukan sepanjang jalan**, semuanya berarti "foto
  belum ada": `KasirPage:1069`, `LihatMenuPage:268`, dan `MenuFormPage:498`
  (prop `placeholder`). Ketiganya kini `IKON_MENU_KOSONG`. Empat kemunculan
  lain (`Layout` ×2, `StokPage`, `RekomendasiBeliPage`) DIADILI dan sengaja
  dibiarkan: di sana emojinya label navigasi ("🍜 Menu & HPP") yang berarti
  "ini urusan menu", bukan "fotonya kosong" — mengikatnya ke konstanta yang
  sama berarti sidebar ikut berubah saat lambang foto-kosong diganti.

- **Chip "N tanpa foto"** menyaring menu yang fotonya belum ada. Hitungannya
  menghormati saringan lokasi/kategori/cari (chip ini pintu KERJA — angka yang
  lebih besar daripada yang bisa dibuka tombolnya adalah janji yang tak
  ditepati) tapi **tidak** menghormati saringannya sendiri, sebab kalau ikut,
  angkanya membeku begitu chipnya ditekan. Dan ia **tak dirender saat bacaannya
  gagal**: "0 tanpa foto" di atas daftar yang gagal dimuat terbaca sebagai
  "semua menu sudah berfoto" — aturan yang sudah ditulis panjang di
  `nilai-stok.test.ts`.

- **Yang TIDAK dikerjakan, beserta alasannya**: HPP & food cost sengaja tak
  ikut di kartu (pilihan pemilik saat ditanya) — kartu yang membawa angka
  manajemen berhenti jadi cermin layar kasir. Sisa porsi juga tidak: ia angka
  per-cabang, dan Menu & HPP bukan layar per-cabang; `StokBadge` memulangkan
  `null` saat porsinya tak diketahui, jadi yang terjadi bukan lencana kosong
  melainkan tak ada lencana. Penjaganya memaku bahwa halaman ini tak mengoper
  `stok=`, supaya tak ada yang kelak "melengkapinya" dengan angka karangan.

- **Nol perubahan server**: tak ada kontrak yang berubah, jadi tak ada entri
  `CHANGELOG-API.md` dan tak ada yang perlu distempel. verify-api tetap
  3.499/0 — angka yang sama persis dengan sebelum putaran ini, dan itu memang
  yang diharapkan.

- **Empat hal yang ditemukan gerbangnya, bukan saya** — dan tiga di antaranya
  membuat bukti merah saya sendiri tidak sah sampai diulang:

  1. **`prettier` bukan bagian repo ini.** Saya menjalankannya atas inisiatif
     sendiri dan ia memformat ulang seluruh `MenuListPage` — 424 baris berubah
     untuk perubahan yang seharusnya 122. Dikembalikan, lalu diulang tanpa
     pemformat. Diff yang membengkak bukan cuma berisik: ia bisa memutus
     irisan `indexOf` penjaga lain tanpa ada yang menyadarinya.
  2. **`StokBadge` ikut pindah rumah, dan `kasir-sisa-porsi-gagal.test.ts`
     MERAH karenanya** — bukan hampa, dan itu perbedaan yang menyelamatkan.
     Klaimnya tak berubah sedikit pun; alamatnya yang berubah. Penjaganya
     diarahkan ke rumah baru DAN ditambahi asersi bahwa `KasirPage` tak lagi
     mendefinisikannya sendiri.
  3. **Spek baru melewati langit-langit kuota login.** `/auth/login` dibatasi
     10 per 5 menit per (IP+email); **sepuluh** berkas spek memakai akun owner
     yang sama, satu login per berkas (tiap berkas satu worker, satu cache).
     Spek ke-sepuluh membuat `stok-awal-gagal.spec.ts` merah — berkas itu
     menembak `/auth/login` sendiri di samping `login()` layarnya, jadi ia
     butuh DUA jatah. Diperbaiki di sumbernya: ia kini memakai `sesiApi` yang
     ber-cache, yang sekaligus menghapus kegagalan bisu — `(await
     masuk.json()).token` tanpa memeriksa `.ok()` mengubah 429 jadi
     `TypeError: Cannot read properties of undefined`, di baris yang tak
     menyebut kuota sama sekali.
  4. **Dua bukti merah peramban saya SAH-SEOLAH-OLAH, dan sebenarnya tidak.**
     Keduanya "merah" — tapi pada asersi yang salah, sebab server menyajikan
     `index.html` yang di-cache saat boot: membangun ulang tanpa me-restart
     server membuat bundel ber-hash baru tak pernah dirujuk, halamannya kosong,
     dan SETIAP asersi gagal. Yang menyingkapnya justru ketidakcocokan
     kalimatnya — merah yang benar harus berbunyi asersinya sendiri. Diulang
     dengan urutan mutasi → build → **restart server** → uji, dan barulah
     keduanya berbunyi "kartu ikon tidak membuka layar ubah menu" dan "kotak
     fotonya bukan kotak kasir".

- **Terukur pada DB gerbang**: 104 menu aktif, **4 berfoto, 100 tanpa foto** —
  dan keempat yang berfoto seluruhnya buatan `verify-api.sh` & spek ini
  sendiri. Data seed repo ini tak memuat satu pun foto menu. Itu yang membuat
  spek peramban WAJIB menanam menunya sendiri: spek yang cuma membuka halaman
  lalu mencari `<img>` akan hijau di gerbang penuh (verify-api jalan lebih
  dulu) dan merah saat `npm run test:e2e` dijalankan sendiri — hijau karena
  sampah orang lain adalah bentuk hampa yang paling sulit terlihat.

- **Batas yang diketahui**: (1) penjaga statis membaca teks sumber, jadi ia tak
  bisa mengatakan pikselnya sama — yang mengukur itu spek peramban, dan
  keduanya sepasang; (2) kartu di Menu & HPP tak menampilkan sisa porsi,
  jadi pratinjaunya setara dalam FOTO & tata letak, bukan dalam seluruh isi
  kartu — disengaja, dan ditulis di komponennya; (3) `POST /menu` menuntut
  `mult` untuk menu reguler (400 "Menu reguler wajib punya mult"), yang
  ketahuan sebagai premis merah pada gerbang pertama, bukan dari membaca skema.

- **Untuk pemilik, kueri baca-saja di produksi** (kolom `deleted_at` TIDAK ada
  di tabel `menus` — arsipnya lewat `is_active`, diperiksa langsung di skema):

  ```sql
  select count(*) filter (where image_url is null) as tanpa_foto,
         count(*) as total_aktif
  from menus where is_active;
  ```

- **Bukti merah**: tujuh statis + tiga peramban, tiap satu dipulihkan
  byte-per-byte (`cmp`). Statis: kelas foto disalin balik ke `KasirPage` ·
  grid ikon dilebarkan · chip dirender walau gagal · `🍜` diketik ulang ·
  `tulisLokal` dicabut · bawaan diam-diam jadi ikon · pratinjau mengoper
  `stok=`. Peramban: pilihan bentuk tak bertahan · kartu tak bisa diklik ·
  kotak foto dikecilkan.

- **Gerbang**: typecheck · build · `npm test` 234 berkas / **2.836** uji
  (+1 berkas, +17 uji) · `verify-api.sh` **3.499 lolos, 0 gagal** (tak berubah
  — nol perubahan server) · `audit:invarian` 27/27 · Playwright **32 spek**
  (dari 30). `rute-diketuk.txt` diregenerasi — tak ada rute baru.

## Login menyebut ALASAN penolakannya — dan harganya keputusan pemilik, bukan kelalaian — web + server — 2026-09-03

- **Kenapa vena ini ada**: pemilik repo meminta dua hal dalam satu pesan —
  *"sesi anda berakhir silahkan masuk kembali cukup saja gitu"* dan *"kalo pas
  login ternyata tidak terdaftar / sebutkan alasan tidak terdaftarnya kenapaa"*.

- **Keadaan sebelumnya**: `POST /login` punya **empat** keadaan penolakan yang
  berbeda dan **satu** kalimat untuk semuanya — `"Email atau password salah"`.
  Diukur pada DB gerbang, berapa orang yang benar-benar berdiri di belakang
  masing-masing:

  | keadaan | baris di DB gerbang | yang ia baca dulu |
  | --- | --- | --- |
  | diundang, belum pernah mendaftar | **6** undangan `pending` tanpa baris `users` | "Email atau password salah" |
  | akun dinonaktifkan owner/admin | **8** `users.is_active = false` | "Email atau password salah" |
  | akun tombstone (`deleted_at`) | **2**, dan **keduanya** emailnya sudah diganti | (jatuh ke "tak terdaftar") |
  | password salah | — | "Email atau password salah" |

  Yang paling mahal baris kedua: delapan orang yang, saat mencoba masuk, dulu
  membaca kalimat yang menyebut password — lalu mereset passwordnya berulang
  kali tanpa hasil, sebab passwordnya memang tak pernah salah. Baris pertama
  hampir sama buruknya dengan arah terbalik: enam orang yang SUDAH diundang
  pemiliknya, tapi `POST /karyawan/undang` hanya menulis baris `invitations` —
  akunnya baru lahir saat mereka mendaftar sendiri. Yang mereka simpulkan dari
  layar: undangannya gagal, dan orang lain harus memperbaikinya.

- **Harganya disampaikan lebih dulu, dan pemilik memilih tetap.** Kalimat
  gabungan itu menutup **enumerasi akun**: orang luar tak bisa menempelkan
  daftar alamat lalu memanen mana yang punya akun di sistem ini. Memisahkannya
  membuka itu. Pemilik ditanya dengan biayanya disebut, dan jawabannya
  *"Sebutkan juga 'email tidak terdaftar'"*. Maka yang dikerjakan bukan
  menawar keputusan itu melainkan **menuliskannya di tempat yang akan dibaca
  orang berikutnya** — di `POST /login`, di `PESAN_LOGIN`, di kontrak API, dan
  di changelog ponsel — supaya tak ada yang "merapikannya" balik tanpa tahu apa
  yang sedang ia batalkan, dan sebaliknya tak ada yang menyangka ini
  kecelakaan. Penahan yang tersisa: `batasLogin`, 10 percobaan per 5 menit per
  (IP + email).

- **Yang TIDAK ikut berubah, dan itu batas yang dipilih**: `/forgot-password`
  tetap membalas `200 { ok: true }` yang identik untuk alamat dikenal maupun
  tidak. Pintu itu tak berpassword sama sekali — membocorkan keterdaftaran di
  sana berarti memberikannya cuma-cuma, tanpa batas laju per akun yang menahan.
  Dipaku dua kali: statis (`login-beralasan.test.ts` mengiris penangannya dan
  menuntut nol `HTTPException`, nol `message:`, satu `return c.json`) dan lewat
  HTTP (§290 membandingkan badan balasannya untuk kedua alamat).

- **Yang dikerjakan**:
  - `PESAN_LOGIN` di `packages/shared/src/constants.ts` — satu rumah untuk
    keempat kalimatnya. Bukan kerapian: web **membandingkan** kalimatnya untuk
    memutuskan kapan menawarkan tautan "Daftar", dan kalimat yang diketik ulang
    di layar akan bergeser sendiri — yang hilang diam-diam bukan tulisannya
    melainkan tautannya, tanpa satu uji pun merah. `LoginPage` sudah punya satu
    contoh cara itu gagal (`msg.includes("belum diverifikasi")`).
  - Empat cabang di `POST /login`, **semuanya tetap 401** — yang berubah
    kalimatnya, bukan kontraknya.
  - Kalimat yang punya jalan keluar **menunjukkannya**: "Email tidak
    terdaftar — periksa ejaannya, atau daftar dulu" + tautan `Daftar dengan
    email ini →` yang membawa alamatnya (`/daftar?email=`), dan `SignupPage`
    kini benar-benar membacanya. Tautan yang menjanjikan "email ini" lalu
    membuka formulir kosong berbohong, dan orangnya mengetik ulang alamat yang
    barusan ditolak — kesempatan kedua untuk salah ketik yang membuatnya sampai
    ke sana. Pada akun nonaktif kalimatnya menyebut **siapa yang harus
    dihubungi**; jalan keluarnya bukan reset password, dan menawarkan reset
    password justru yang membuat orang berputar-putar.
  - Kalimat sesi berakhir dipendekkan jadi *"Sesi Anda berakhir. Silakan masuk
    kembali."* Versi panjangnya menyebut ketiga sebabnya dalam kurung; ketiganya
    menuntut tindakan yang SAMA, dan dua di antaranya tak bisa ia perbaiki
    sendiri. Yang penting tetap ada: ia dikeluarkan karena SESUATU.
  - Tiga komentar yang jadi salah dibetulkan, bukan dibiarkan
    (`superadmin.ts` ×2 — termasuk `console.warn` yang kini **menginterpolasi**
    konstantanya, dan `ui.tsx` yang menerangkan tombol lihat-password dengan
    kalimat lama).

- **`sebab` terstruktur ikut, dan itu koreksi atas versi pertama saya sendiri.**
  Putaran ini mula-mula membuat layar login MEMBANDINGKAN kalimatnya untuk
  memutuskan kapan menawarkan tautan "Daftar". Itu bekerja, dan salah: repo ini
  sudah menuliskan jawabannya dua kali dengan alasan yang identik —
  `PenjualanGagal.sebab` (*"Teks pesan tak boleh jadi dasar keputusan itu — ia
  berubah kapan saja dan tak bisa diuji"*) dan `ApiError.data.kode` di
  `lib/api.ts`. Yang menyadarkan bukan pemikiran ulang melainkan pertanyaan
  ponsel: aplikasi ponsel ada di repo lain dan **tak bisa** membaca
  `PESAN_LOGIN` sama sekali, jadi satu-satunya cara ia ikut bercabang adalah
  menyalin kalimat lintas repo — persis kelas cacat yang putaran ini
  tegakkan aturannya. Maka keempat penolakan kini lewat `LoginDitolak extends
  HTTPException` yang membawa `sebab`, dan layar login bercabang atas kode itu,
  bukan atas kalimat. `throw` (bukan `return c.json`) disengaja: hanya jalur
  `throw` yang lewat `catatGalat`, dan penolakan masuk harus tetap tercatat di
  panel Log Galat — panel yang justru membuat pemilik melihat banjir 401.

- **Ponsel: TAK ADA perubahan kode, dan itu diperiksa, bukan diasumsikan.**
  `kakarut-mobile/lib/features/auth/login_page.dart` sudah menyetel
  `_error = e.message` lalu merendernya apa adanya, jadi keempat kalimat baru
  sampai ke layarnya tanpa satu baris pun disentuh. Yang belum: tombol "Daftar"
  di layar yang sama tak membawa alamatnya. Itu sengaja tak dikerjakan
  putaran ini — sebelum ada `sebab`, satu-satunya cara ponsel tahu kapan
  menawarkannya adalah menyalin kalimat lintas repo. Sesudah `sebab` ada,
  pekerjaan itu jadi kecil dan aman; ia masuk antrean, bukan diselundupkan ke
  putaran ini.

- **Batas yang diketahui**: (1) enumerasi terbuka — itu memang yang diminta,
  tapi ditulis di sini supaya tercatat sebagai keadaan, bukan sebagai
  kelalaian; (2) cabang `terhapus` praktis tak pernah terbaca — jalan yang
  menuliskannya ikut mengganti nama emailnya, jadi alamat aslinya jatuh ke
  "tak terdaftar" (yang justru jawaban benar: alamatnya bebas dipakai ulang).
  Cabangnya tetap ada sebagai jaring untuk tombstone dari jalan lain; (3)
  §290 memeriksa KALIMATNYA cuma sejauh "bisa dibedakan & menyebut sebabnya",
  bukan bunyi persisnya — bunyinya dipaku uji statis supaya skrip gerbang tak
  jadi salinan keempat yang menua sendiri. Yang dipaku persis justru
  **kodenya** (`email_tak_dikenal`, `password_salah`, `akun_nonaktif`): klien
  yang sudah dirilis bercabang atasnya, jadi kode yang diganti nama wajib
  terlihat sebagai gerbang merah; (4) `/register` dan
  `/resend-verification` tetap netral dan **tidak** diperiksa ulang putaran ini
  — keduanya permukaan enumerasi juga, dan sekarang keduanya lebih ketat
  daripada `/login` di sebelahnya. Ketimpangan itu disengaja (yang satu diminta
  pemilik, yang lain tidak) tapi belum pernah ditanyakan.

- **GERBANG YANG TAK DIBACA BUKAN GERBANG — dan itu saya, pada putaran ini
  juga.** Dua commit fikstur ponsel (`1e23e8e`, `39b0748`) didorong tanpa saya
  periksa hasil CI-nya. Keduanya MERAH, ±40 menit, tanpa ada yang tahu:
  `kunci_kontrak_server_test.dart` menuntut empat kunci kontrak baru
  diputuskan — `belum_sampai`, `harus_dikerjakan`, `terlambat`,
  `tertua_ditutup_pada` — dan keputusan itu memang belum pernah dituliskan.
  Fiksturnya benar; langkah keduanya yang terlewat, persis pola yang
  `ci.yml` ponsel sudah catat pernah terjadi sekali ("perintah itu hanya
  MENYEGARKAN fikstur; memutuskan nasib kunci barunya langkah kedua").
  Yang menangkapnya bukan putaran yang melahirkannya melainkan PERSIAPAN
  RILIS — jarak yang tak boleh diandalkan. Aturan "jangan pernah dorong
  gerbang merah" tak berguna bila hasilnya tak dilihat; yang kurang di
  resep saya adalah langkah "baca CI-nya sebelum lanjut", bukan disiplinnya.
  Diperbaiki di `98ce52d` (CI ponsel #34 hijau, 644 uji) — dan keempat asersi
  gerbangnya dijalankan ulang lebih dulu sebagai skrip yang meniru logikanya,
  sebab Flutter tak ada di lingkungan ini.

- **TAYANG 2026-09-03.** Web: merge `fc56d96` → `production`, CI #492 hijau
  bertiga (typecheck+unit test+build · verify-api+e2e+cakupan rute+invarian ·
  build image & picu redeploy Dokploy). Gerbang penuh dijalankan lebih dulu
  pada HASIL MERGE, bukan pada `claude` saja — `git diff claude production`
  kosong, dan angkanya sama persis: 2.819 uji · verify-api 3.499/0 ·
  invarian 27/27 · Playwright 30. Ponsel: merge `a0ea392` → `Production`,
  CI #35 hijau. Empat entri `CHANGELOG-API.md` distempel pada commit yang
  sama dengan penghapusannya dari `BELUM_TAYANG`.
  **Belum diverifikasi dari luar**: domain produksinya tak bisa dijangkau dari
  lingkungan ini (proxy 403 — kebijakan jaringan), jadi yang dilaporkan hijau
  adalah pekerjaan CI-nya, bukan bacaan `X-Kakarut-Build` dari situs hidup.

- **Bukti merah, enam, tiap satu dipulihkan byte-per-byte (`cmp`)**: satu pesan
  diketik ulang di server → 2 merah · `/lupa-password` mulai melempar 404
  "Email tidak terdaftar" → 1 merah · layar login kembali **mengendus**
  kalimatnya dengan `includes` → 1 merah · tautannya berhenti membawa emailnya
  → 1 merah · layar daftar berhenti membaca query-nya → 1 merah · kata
  "ENUMERASI" dihapus dari catatan sumbernya → 1 merah.

- **Gerbang**: typecheck · build · `npm test` 233 berkas / **2.819** uji
  (+1 berkas, +13 uji) · `verify-api.sh` **3.499 lolos, 0 gagal** (dari 3.477,
  §290 +22 lengan) · `audit:invarian` 27/27 · Playwright **30 spek** (dari 28).
  `rute-diketuk.txt` diregenerasi — tak ada rute baru.

## Riwayat pengadaan jadi TABEL, dan ringkasannya menghitung populasi — bukan halaman — web + server — 2026-09-03

- **Kenapa vena ini ada**: pemilik repo meminta dua hal atas halaman Produksi
  Bahan Baku — *"riwayat produksi ini ingin di ubah menjadi tabel"* dan *"buat
  summarynya di atas produksi yang harus di kerjakan dan sudah selesai"*.

- **Pengukuran yang menentukan seluruh bentuk pekerjaannya**, diambil sebelum
  satu baris pun ditulis:

  | | |
  |---|---|
  | `GET /produksi` `total` (faktur) | **61** |
  | faktur di halaman 1 (`per_page` bawaan 20) | **20** |
  | di antaranya BELUM selesai | **20 — kedua puluhnya** |

  Server memang mengurutkan faktur yang belum selesai lebih dulu
  (`routes.ts:2648`). Jadi ringkasan yang dijumlahkan klien dari baris yang
  tampil tak sekadar meleset: ia akan **selalu** berbunyi "0 selesai" sampai
  orangnya menelusuri ke halaman terakhir. Itu yang membuat putaran ini
  menyentuh server, dan alasannya ditulis lebih dulu supaya tak terlihat
  sebagai pelebaran ruang lingkup.

- **Angka sesudahnya, diukur lewat HTTP dan disilangkan dengan SQL tangan**:

  | | produksi | beli |
  |---|---|---|
  | total | 61 | 103 |
  | harus dikerjakan | **36** faktur / 73 bahan | **44** / 55 |
  | sudah selesai | **25** / 33 | **58** / 71 |
  | ditolak | 0 / 0 | **1** / 3 |
  | selesai tapi BELUM SAMPAI | **6** / 20 | 5 / 5 |
  | `harus + selesai + ditolak == total` | ✔ 61 | ✔ 103 |

  Jalur beli **cocok persis** dengan hitungan `GROUP BY` tangan atas basis data
  (44 / 58 / 1 dan 55 / 71 / 3); jalur produksi berbeda dari hitungan tangan
  hanya karena rutenya memang mengecualikan faktur transfer (`TF-`) dan
  mengurung per perusahaan.

- **Aturan "belum selesai" sudah ditulis TIGA kali sebelum putaran ini** —
  `Layout.tsx:150` (lencana nav), `TimBerandaPage.tsx:11` (salinan
  byte-per-byte), dan `TambahStokPage.belumSelesai()`. Ringkasan baru akan jadi
  salinan keempat. Kanonisnya pindah ke `@kakarut/shared/pengadaan.ts`, kedua
  salinan lain dibuang, dan servernya memakai himpunan yang sama.

- **KOREKSI atas dugaan awal saya, dan ia mengubah angkanya.** Saya sempat
  menyimpulkan "selesai" butuh dua rumus, sebab label produksi untuk tahap
  `menunggu` berbunyi *"✅ Selesai — masuk stok"* sementara label beli untuk
  tahap yang sama berbunyi *"🚚 Dikirim"*. Label produksi itu **aspirasi, bukan
  keadaan**: `POST /tahap` meng-auto-konfirmasi baris CK-lokal di dalam
  transaksi yang sama (`routes.ts:1276-1297`), jadi baris yang benar-benar
  DUDUK di `menunggu` hampir selalu work-order beralamat yang belum sampai.
  Servernya sendiri sudah memakai satu predikat untuk kedua jalur. Satu aturan,
  bukan dua — dan uji murni memakukannya supaya tak "diperbaiki" balik oleh
  siapa pun yang membaca labelnya saja.

- **Ubin keempat yang tak diminta, dan yang paling berharga**: *"selesai tapi
  belum sampai"* — **6 faktur / 20 bahan** pada jalur produksi. Tiga keadaan
  bersembunyi di balik status "selesai" yang tak akan disebut selesai oleh
  pemiliknya: hasil `untuk_cabang` yang sudah masuk stok CK tapi belum
  di-`kirim-hasil`, barang yang sudah dikirim tapi belum diterima cabang, dan
  kiriman menggantung. Semuanya stok yang tak bisa dipakai siapa pun sementara
  papan menyatakan pekerjaannya beres. Predikatnya disalin dari
  `stok/service.ts` (`qtyDiJalan`), bukan dikarang.

- **Populasi kartu → kolom.** Kartu lama merender **28 hal** (dihitung satu per
  satu dari sumbernya). Yang jadi kolom: dokumen+asal faktur, waktu, bahan+qty
  +sisa tugas, tahap+peringatan, lokasi/tujuan+pelaksana, divisi (produksi) /
  nilai+dana cair (beli), dibuat/diterima oleh, aksi. Yang **pindah ke modal
  detail** beserta rumah barunya: Dokumen RAB/belanja, Laporan Harga, Dokumen
  kirim — tombol yang dibuang dari baris tanpa tempat lain adalah kemampuan
  yang hilang diam-diam. Yang **tetap di baris**: Ubah Tahap dan Kirim —
  kiriman yang menunggu di CK adalah stok yang tak bisa dipakai siapa pun, dan
  dua klik untuk itu terlalu mahal.

- **Sepuluh sinyal turunan diekstrak lebih dulu**, sebelum satu kolom pun
  ditulis: `sinyalFaktur()`. Tabel desktop, kartu HP (`TabelResponsif` merender
  keduanya dari kolom yang sama), dan modal detail kini membaca sinyal yang
  SAMA — sepuluh `const` yang tertanam di dalam `.map` tak bisa dipakai bertiga
  maupun diuji. Modal detail memakainya juga untuk menilai kelayakan ketiga
  tombol yang pindah; dua penilaian terpisah akan menampilkan tombol berbeda
  untuk faktur yang sama.

- **`qty_teks` yang selama ini diabaikan**: server mengirimnya (dan
  `docs/API-CONTRACT.md` mencantumkannya), tapi `StokMasukRow` tak pernah
  mendeklarasikannya dan layarnya merakit ulang `formatAngka(qty) + satuan`
  sendiri — medan itu ada persis untuk mencegah itu. Kolom Bahan kini
  memakainya.

- **Detektor DIBUKTIKAN bisa menuduh — EMPAT kali, dipulihkan byte-per-byte**:
  `menunggu` dipindah ke sisi selesai → uji murni merah · satu kolom diganti
  namanya → penjaga urutan merah · `galat` dicabut dari tabel → penjaga merah ·
  **PERAMBAN**: ubin dialihkan menghitung `grup`, dibangun ulang, server
  dinyalakan ulang → spek "ubin tak berubah saat pindah halaman" merah karena
  angkanya berbeda dari agregat server.

- **Gerbangnya sendiri menemukan LIMA hal**, dan tiap satunya penjaga yang
  bekerja: (1) lima ekspresi `sql<number>` di subkueri baru tak bercast — tiba
  sebagai string saat dijalankan; (2) ratchet `daftar-tanpa-langit-langit`
  63 → 64, dinaikkan **beralasan** dan pemindainya SENGAJA tak ditumpulkan
  (melebarkan polanya ke `bool_or|bool_and` akan membungkam
  `penjualan/routes.ts:161` yang memang daftar baris); (3) registri
  `kueri-terkurung-tenant` 4 → 5 situs beralasan; (4) fikstur kontrak ponsel
  basi; (5) `jangkar-iris` menolak jangkar `indexOf` uji baru saya karena
  jalurnya dirakit template dan tak bisa ia telusuri — jalurnya ditulis literal.

- **Batas yang jujur**: `StokMasukPage`/`StokMasukRow` masih dideklarasikan
  LOKAL di halamannya, bukan di `packages/shared`. Hanya `RingkasPengadaan` +
  `PasanganHitung` yang dipindah (medan barunya), sebab memindahkan seluruh
  DTO baris berarti ~40 kunci kontrak baru sekaligus — putaran tersendiri, masuk
  antrean. Dan e2e-nya menyentuh jalur owner saja; peran kitchen/bar yang juga
  membuka `/produksi` belum punya spek.

- **Gerbang**: typecheck · `npm test` 232 berkas / **2.806** uji (+1 berkas,
  +18 uji) · build · `verify-api.sh` **3.477 lolos, 0 gagal** (dari 3.466,
  §289 +11 lengan) · `audit:invarian` 27/27 · Playwright **28 spek** (dari 25).

## Antrean putusan selisih kas: 26 menunggu, yang tertua 12 hari, dan nol tanda di luar halamannya sendiri — web + server — 2026-09-03

- **Kenapa vena ini ada**: pemilik repo membuka Operasional Cabang, melihat
  *"Selisih kas menunggu keputusan Anda (26)"* dengan baris tertua ditutup
  **22 Agustus**, lalu menulis: *"selisih tidak ada notif harus di putuskan."*

- **Sebabnya tertulis, dan itu yang membuat entri ini bukan sekadar fitur
  kurang.** `docs/mobile/CHANGELOG-API.md` menjawab pertanyaan tim ponsel
  *"apakah owner perlu notifikasi?"* dengan: *"Ya — `GET /shift/selisih?status=
  menunggu` adalah sumber badge-nya… Web memakai endpoint yang sama dan
  mem-poll tiap 60 detik **saat halaman Operasional terbuka**."* Kalimat
  terakhir itu celahnya: "notifikasi" dilingkupi, sadar dan tercatat, sebagai
  lencana yang hanya hidup DI DALAM halaman yang seharusnya ia ingatkan. Tak
  ada yang keliru di jalannya; yang keliru lingkupnya, dan lingkup itu tak
  pernah ditinjau ulang selama antreannya menumpuk.

- **Dan di web lencananya bahkan tak pernah dipasang** — padahal ponsel sudah
  punya (`kasir_page.dart`, `badgeMerah(selisihMenunggu)`). Panel di halamannya
  sendiri justru dibangun sangat hati-hati: ia membedakan "gagal terbaca" dari
  "kosong" (`OperasionalPage.tsx:51-65`) dan mengaku saat daftarnya terpotong.
  Kehati-hatian penuh pada satu permukaan, nol permukaan lainnya.

- **Populasi sapuan: 49 `NavLink` di sidebar, 13 tapak `badgeOranye`, 9 nama
  lencana berbeda.** Dipilah tangan jadi (a) tautan katalog — menu, resep,
  bahan, member, laporan: tak menunggu keputusan siapa pun, lencana tak
  bermakna; (b) tautan ANTREAN — produksi, beli, beli perlengkapan, pesanan,
  meja, pengajuan cuti, kebersihan, stok, penerimaan: semuanya berlencana; dan
  (c) **selisih kas** — antrean yang menunggu keputusan owner, satu-satunya di
  kelompok (b) yang angkanya tak pernah keluar dari halamannya. Kini 10 nama
  lencana.

- **Diukur lewat HTTP + SQL pada DB hasil gerbang**, bukan dibaca dari kode:

  | | |
  |---|---|
  | antrean `?status=menunggu` | **19** menunggu · 20 pas · 2 disetujui · 1 ditolak |
  | shift tertutup kandidat (`selisih_status` NULL/menunggu) | **39** |
  | `GET /shift/selisih?status=menunggu` | 41–66 ms · **4.581 byte** |
  | `GET /shift/selisih/ringkas` | 36–42 ms · **96 byte** |

  Beban servernya IDENTIK — keduanya memanggil `antreanSelisih` yang sama, dan
  `rekapWindow` di dalamnya 2+ kueri per baris. Yang dihemat jaringan (48×) dan
  nominal kas tiap shift yang tak perlu ikut ke setiap halaman. **Batas yang
  jujur**: pada 39 kandidat biayanya ~30 ms; ia tumbuh linier terhadap jumlah
  shift tertutup, dan di langit-langit `AMBIL_SELISIH` (200) menjadi ~150 ms
  per pollingan. Pembatchan `rekapWindow` jadi satu agregat masuk antrean —
  **tidak** dikerjakan di sini, sebab angkanya belum menuntutnya.

- **Ketiga medannya disilangkan dengan daftarnya sendiri**, bukan dengan angka
  mati: `menunggu` 19 == panjang daftar 19; `tertua_ditutup_pada` identik
  dengan `min(ditutup_pada)`; `terlambat` identik dengan hitungan ulang atas
  daftar itu memakai ambang yang sama.

- **Ambangnya dibuktikan MENGGIGIT, ujung ke ujung**: satu shift yang benar-
  benar ada di daftar menunggu dimundurkan 5 hari lewat SQL →
  `terlambat` **0 → 1** dan `tertua_ditutup_pada` bergeser ke **2026-08-29**;
  dipulihkan → kembali 0. Sasarannya diambil dari jawaban RUTENYA SENDIRI,
  bukan dari tebakan SQL — percobaan pertama memundurkan shift yang ternyata
  berstatus "pas" dan tak berpengaruh apa pun.

- **Satu perhitungan, dua pintu.** `antreanSelisih` diekstrak dari handler
  daftarnya; `GET /shift/selisih/ringkas` memakai fungsi yang sama. Aturan
  "menunggu" TIDAK BISA jadi `count(*)` di SQL — statusnya diturunkan dari
  selisih yang HIDUP (`kas_sistem` dihitung ulang tiap dibaca), dan komentar
  `routes.ts:411-434` sudah menuliskan akibatnya: penjualan bertanggal mundur
  dari sinkron offline mengubah shift "pas" jadi kurang 40.000 tanpa kolomnya
  bergerak. Menulis ulang aturan itu untuk sebuah lencana = dua tempat yang
  akan berselisih pendapat soal shift yang sama.

- **Ambang terlambat = fungsi, bukan perbandingan yang diketik ulang.**
  `SELISIH_TERLAMBAT_HARI = 3` + `selisihTerlambat()` di `@kakarut/shared`,
  dipakai server (menghitung) dan web (menulis kalimatnya). Pemiliknya memilih
  3 hari; ia juga menolak tampilan umur per baris dan email otomatis, jadi
  yang dipasang hanya dua permukaan agregat.

- **Detektor DIBUKTIKAN bisa menuduh — LIMA kali, semuanya dipulihkan
  byte-per-byte (`cmp`)**:

  1. `/operasional` dikembalikan jadi `linkClass` → penjaga statis merah 2 uji.
  2. Gerbang kueri dilonggarkan (buang `manajemenGuard`) → merah 1.
  3. Galat tak lagi diteruskan ke `badgeOranye` → merah 1.
  4. `>` jadi `>=` pada ambangnya → merah pada asersi "tepat di ambang".
  5. **PERAMBAN**: lencana + kartu dicabut, dibangun ulang, server dinyalakan
     ulang → kedua spek Playwright merah pada elemen yang tak ditemukan.

- **Gerbangnya sendiri yang menemukan EMPAT hal, bukan saya** — dan tiap
  satunya penjaga yang bekerja persis seperti maksudnya:

  1. `verify-api-token.test.ts`: §288 memakai `$KASIR`, token yang sudah
     DICABUT di §105. Asersi 403-nya akan hijau karena sebab yang salah (401).
     Diganti `$REISS105`.
  2. `potong-berpenanda.test.ts`: memindahkan `.limit()` ke `antreanSelisih`
     memisahkannya dari penandanya, jadi situs yang tadinya BERPENANDA terbaca
     SENYAP. Diadjudikasi beralasan — bentuk yang sama dengan
     `modules/kebersihan/routes.ts` yang sudah lebih dulu ada di daftar itu:
     batas di pembantu, penanda di pemanggil, dan di pemanggil itulah ia
     dinilai. Kedua pemanggilnya memang mengatakannya (`HEADER_TERPOTONG` dan
     medan `terpotong`).
  3. `kunci-satu-kontrak.test.ts`: fikstur kontrak ponsel basi — 4 kunci
     `RingkasSelisihDto` diregenerasi ke repo ponsel.
  4. `cakupan-rute.test.ts`: rute baru tak pernah diketuk. `rute-diketuk.txt`
     diregenerasi dari `JEJAK_RUTE` pada jalan gerbang yang sama.

- **Batas yang tersisa, ditulis jujur.** `AMBIL_SELISIH` = 200 shift tertutup
  TERBARU, dan "pas" berbagi kolom `selisih_status` NULL dengan "menunggu" —
  jadi antrean tua bisa terdorong keluar oleh shift-shift "pas" yang lebih
  baru. Di DB gerbang `terpotong` = `false` (39 kandidat), tapi pada penyewa
  sungguhan yang sudah setahun beroperasi ambang itu bisa tersentuh, dan saat
  itu terjadi `menunggu` pun jadi BATAS BAWAH. Karena itu `terpotong`
  dipulangkan dan dirender ("+" pada lencana, kalimat pada kartunya) alih-alih
  disimpulkan sendiri oleh pembacanya.

- **Antrean baru dari putaran ini**: (1) pembatchan `rekapWindow` jadi satu
  agregat per shift — biayanya linier hari ini dan hanya itu yang menahan
  pollingan lebih rapat; (2) repo ponsel, `shift_repository.dart:54`
  `catch (_) { return 0; }` menelan semua galat jadi nol pada provider yang
  memberi makan lencana selisih — persis "lencana gagal ≠ lencana nol" yang
  sudah ditegakkan repo itu sendiri lewat `badgeAsync`.

- **Gerbang**: typecheck · `npm test` 231 berkas / **2.788** uji (+1 berkas,
  +9 uji) · build · `verify-api.sh` **3.466 lolos, 0 gagal** (dari 3.457,
  §288 +9 lengan) · `audit:invarian` 27/27 · Playwright **25 spek** (dari 23).

## Central Kitchen ditawarkan sebagai lokasi menu — dapur yang tak berjualan, dan angka yang menjawab pertanyaan yang tak pernah diajukan — web — 2026-09-03

- **Kenapa vena ini ada**: pemilik repo mengirim tangkapan layar Menu & HPP
  dengan *"Tampil di lokasi: 🏭 Central Kitchen"* terpilih dan judul **"Menu &
  HPP (13 dari 40)"**, lalu menulis: *"menu dan hpp ini tidak ada di central
  kitchen karna central kitchen tidak berjualan… berbeda dengan resep yang ada
  lokasi produksinya."* Keberatannya benar sampai ke struktur datanya.

- **SELURUH sistem sudah menganut aturan itu — kecuali satu baris.** Server
  menolak menyimpan lokasi menu non-store (**400** *"Hanya cabang store
  (kasir/POS) yang bisa jadi lokasi menu"*, `menu/routes.ts:177`), dipaku
  `verify-api.sh` §52. Formulir menu memakai `tipe === "store"` di empat tapak
  dan bahkan MEMBUANG id non-store sebelum menyimpan. Sidebar tak menaruh
  `/menu` di `BOLEH_CK`, jadi divisi Central Kitchen tak bisa membuka halaman
  ini sama sekali — sementara `/resep` dan `/bahan` ADA di sana, persis
  pembedaan yang ditulis pemilik.

  Yang menyimpang `MenuListPage.tsx:69`: `b.tipe !== "kantor"`. Itu predikat
  **lama**. Commit `b3237cc` (17 Juli 2026, *"menu store-only"*) mengubah
  formulirnya dari `!== "kantor"` jadi `=== "store"` dan **melewatkan halaman
  daftarnya**. Bentuk yang diperingatkan berkas ini di paragraf pembukanya:
  aturannya sudah dipikirkan dan ditulis, penjaganya dipasang di satu pintu,
  pintu kedua ke keadaan yang sama dibiarkan terbuka — dua tahun, tanpa satu
  pun uji merah (`apps/web/e2e/` tak punya spek menu; `apps/server/test/` tak
  punya penjaga lokasi menu).

- **Kontras resep vs menu — dua model, karena dua pertanyaan.** Lokasi produksi
  resep enum `ingredients.produksi_di` (`'ck' | 'cabang'`, NOT NULL, default
  `ck`) — CK di sana sebuah **mode**, dan id cabang CK tak pernah tersimpan
  pada resep; cabang produsen yang benar-benar disimpan
  (`ingredient_produksi_branches`) justru **wajib store** juga. Lokasi menu
  tabel gandeng `menu_branches` berisi `branch_id` sungguhan. "Dibuat di mana"
  dan "dijual di mana" tak pernah boleh dijawab satu bentuk.

- **Populasi — sapuan A: 90 penyebutan literal tipe cabang di 22 berkas**
  `apps/web/src` (`"store"`/`"central_kitchen"`/`"kantor"`, di luar deklarasi
  tipe). Dipilah tangan jadi **penjualan** (wajib store-only) vs
  **stok/produksi/peran/navigasi** (CK memang sah: transfer, dashboard, tahap,
  perlengkapan, detail bahan, karyawan, faktur). Menyimpang: **1**.

- **Populasi — sapuan B: 13 pemanggil `/menu` & `/menu/ketersediaan`** (10 web,
  3 ponsel), tiap satu ditelusuri "id cabang apa yang BISA dibawanya". Sapuan
  ini yang membuktikan server tak perlu diubah, dan jawabannya tak seperti
  dugaan awal:

  - `StokPage:76,81` MEMANG bisa membawa id CK (`useCabangData()` dari Kantor
    menawarkan cabang non-kantor) — tapi keduanya `enabled: tab === "menu"`,
    dan `bolehStokMenu` (`StokPage:58`) memaksa tab keluar dari "menu" untuk
    CK/kantor. Tak pernah menyala.
  - `TambahStokDariMenuPage:222,226` memakai `tujuanId`, dan daftar tujuannya
    store aktif saja (`:200`).
  - `LihatMenuPage:83` mengirim cabang aktif, tapi `/menu/lihat` tak ada di
    `BOLEH_CK` dan disembunyikan navigasi saat `dCk`.
  - `KasirPage` + ponsel `kasir_repository`: cabang kasir, dan kasir di CK
    ditolak server (**400**, `users/routes.ts:138`).
  - Ponsel **punya** halaman Menu & HPP (`menu_hpp_page.dart`, "versi baca"),
    dan ia **nol penyaring lokasi** — `GET /menu?semua=true` tanpa `branch_id`.
    Tak tersentuh cacat ini.

  Jadi tak satu pun klien bisa mengirim `branch_id` CK ke `/menu`. Cacatnya
  murni di DAFTAR PILIHAN, bukan di permintaannya.

- **Ukurannya, diukur lewat HTTP + SQL atas DB hasil gerbang** (satu menu
  dibatasi ke cabang store lebih dulu — tanpa itu keempat angkanya sama-sama 96
  dan pengukurannya HAMPA):

  | pertanyaan | jawaban server |
  |---|---|
  | katalog penuh (`GET /menu`) | **96** |
  | `?branch_id=<store Pusat>` | **96** |
  | `?branch_id=<Central Kitchen>` | HTTP **200** → **95** |
  | menu TANPA pembatasan lokasi | **95** |
  | himpunan CK == himpunan tanpa-pembatasan | **YA** |

  Artinya panel akan menuliskan **"95 dari 96"** di bawah 🏭 Central Kitchen —
  bentuk yang persis sama dengan "13 dari 40" milik pemilik. Angka yang
  benar-benar ada, menjawab pertanyaan yang tak pernah diajukan: sembilan puluh
  lima itu "menu tanpa pembatasan lokasi", bukan "menu yang dijual di dapur
  pusat". Dan HPP-nya tak pernah dihitung per cabang (`hitungHpp` tak menerima
  `branchId`; `loadKatalog` hanya `companyId`), jadi seluruh kolom angkanya
  identik di lokasi mana pun — pemilihnya tak pernah mengubah satu rupiah pun.

- **Perbaikannya satu rumah, bukan satu baris.** `bolehJadiLokasiMenu` +
  `opsiLokasiMenu` di `BranchContext.tsx` (sebelah `labelCabang`), dipakai
  daftar DAN formulir. **Dua fungsi, sengaja**: daftar pilihan wajib membuang
  cabang nonaktif, jalur SIMPAN tak boleh — server (`validateRefs`) hanya
  memeriksa perusahaan + tipe, jadi menyaring `is_active` saat menyimpan akan
  menghapus pembatasan lokasi menu yang cabangnya sedang dinonaktifkan
  sementara, diam-diam MELEBARKANNYA ke semua cabang. Perilaku hari ini
  dipertahankan persis.

- **Detektor DIBUKTIKAN bisa menuduh — tiga kali, semuanya dipulihkan
  byte-per-byte (`cmp`)**:

  1. `MenuListPage:69` dikembalikan ke `!== "kantor"` → penjaga statis merah 2
     uji, tuduhannya menyebut barisnya utuh: `MenuListPage.tsx: const
     lokasiOpsi = cabang.filter((b) => b.is_active && b.tipe !== "kantor");`
  2. `bolehJadiLokasiMenu` dilebarkan jadi `!== "kantor"` → uji "rumah aturannya
     berbunyi store" merah. Melebarkan helper melebarkan seluruh pemakainya
     sekaligus, jadi nilainya dipaku DI RUMAHNYA, bukan di tiap layar.
  3. Bukti merah PERAMBAN: revert + build + nyalakan ulang server → spek
     Playwright merah dengan isi dropdown apa adanya —
     `["Semua lokasi", "🏪 Pusat", "🏭 Central Kitchen", "🏪 Cabang 2"]`.

- **Penjaganya melarang BENTUKNYA, bukan ejaannya.**
  `apps/server/test/lokasi-menu-hanya-store.test.ts` (5 uji) tak melarang
  `!== "kantor"` — pelarangan ejaan selalu bisa dilangkahi ejaan lain. Ia
  melarang berkas mana pun di `apps/web/src/pages/menu/` MENULIS ATURANNYA
  SENDIRI: nol literal tipe cabang, kecuali yang terdaftar di `DIADILI` beserta
  alasannya (hari ini satu: `LihatMenuPage:80` `divisi === "kantor"`, yang
  DIVISI kerja, bukan penyaring daftar cabang). Uji kedua menuntut tiap entri
  `DIADILI` masih cocok dengan kodenya, supaya daftarnya tak jadi kuburan.

- **Batas detektornya, jujur.** Pemindainya hanya melihat
  `apps/web/src/pages/menu/`. `StokPage:58` menulis aturan yang SAMA di luar
  jangkauan itu, sebagai pengecualian (`!== "central_kitchen" && !== "kantor"`)
  — benar hari ini, dan komentarnya sendiri berbunyi *"central_kitchen →
  produksi bahan, TIDAK jual menu"*. **Sengaja tidak diubah**: `selTipe` di sana
  bisa `undefined` selagi `/cabang` dalam perjalanan, dan hari ini `undefined`
  berarti tab Stok Menu TAMPIL; mengalirkannya lewat helper akan membalik itu
  jadi tersembunyi-lalu-muncul. Menyatukannya menuntut keputusan tersendiri soal
  kasus `undefined` — masuk antrean, bukan diselundupkan ke putaran ini.

- **Server sengaja TIDAK diubah.** `GET /menu?branch_id=<CK>` tetap **200** dan
  memulangkan himpunan tanpa-pembatasan; yang keliru pertanyaannya, bukan
  permintaannya, dan sapuan B menunjukkan tak ada klien yang bisa mengajukannya.
  Yang ditambahkan `verify-api.sh` §52 **+4 lengan** yang MENULISKAN janji itu
  hitam-di-atas-putih (dengan premis dibuktikan lebih dulu: katalog penuh harus
  lebih besar dari himpunan tanpa-pembatasan, atau asersinya lolos hampa),
  supaya mengubahnya kelak jadi keputusan sadar, bukan kelalaian.

- **Data warisan — diukur, tidak ditebak, dan tidak dimigrasi buta.** Sebelum 17
  Juli 2026 CK BOLEH disimpan sebagai lokasi menu; menu yang lokasinya hanya CK
  tak terlihat di kasir mana pun dan ditolak **400** saat dijual, tanpa pesan.
  Di DB hasil gerbang: **0 baris** `menu_branches` menunjuk cabang non-store,
  **0 menu** aktif yang seluruh lokasinya non-store. Untuk produksi, dua kueri
  **baca-saja** diserahkan ke pemilik alih-alih migrasi — menghapus baris begitu
  mengubah menu dari "tak terlihat" jadi "tampil di SEMUA cabang store", dan itu
  perubahan katalog nyata pada data yang tak pernah dilihat sesi ini.

- **Cakupan sisi lain**: `aria-label="Tampil di lokasi"` dipasang pada
  pemilihnya — perbaikan aksesibilitas yang sekaligus memberi spek Playwright
  pengait yang stabil (halaman ini punya dua `<select>`: satu di sidebar).

- **Gerbang**: typecheck · `npm test` 230 berkas / **2.779** uji (+1 berkas, +5
  uji) · build · `verify-api.sh` **3.457 lolos, 0 gagal** (dari 3.453) ·
  `audit:invarian` 27/27 · Playwright **23 spek** (dari 22).

- **Catatan jalannya**: spek e2e pertama merah karena PREMIS, bukan asersi —
  `POST /auth/register` ternyata **tidak** membuat perusahaan (`company_id` &
  `role` masih null sesudah verifikasi), jadi `POST /company/mode` menolak
  **403**. Usahanya lahir di `POST /onboarding/perusahaan`, yang memulangkan
  token baru berisi `company_id` + peran `owner`. Kegagalan itu MENJATUHKAN
  `stok-awal-gagal.spec.ts:66` yang tadinya hijau; sesudah spek diperbaiki
  keduanya hijau di gerbang penuh — merah ikutan, bukan sebab sendiri, dan
  dicatat apa adanya. Satu lagi: membangun ulang web selagi server hidup membuat
  aset lama **404** dan halaman kosong — bukti merah peramban wajib mengikuti
  urutan gerbang (bangun → nyalakan → uji).

## Panel galat: ponsel mengaku siapa dirinya, dan "Masalah berbeda" berhenti berbohong (312 vs 200) — server + web + ponsel — 2026-09-03

- **Kenapa vena ini ada**: lanjutan langsung dari entri di bawah. Pemilik repo
  bertanya *"cek bagian mobile — apakah sudah punya galat log di superadmin?"*

- **Jawabannya TIDAK, dan itu keputusan yang sudah tertulis.** Akun super admin
  bahkan ditolak masuk ke aplikasi ponsel (`auth_controller.dart:118`, *"Akun
  super admin tidak didukung di aplikasi. Gunakan web."*); nol berkas layar
  super admin di `lib/`; nol tembakan `/admin/*` (8 kecocokan `grep` semuanya
  kalimat antarmuka "owner/admin", bukan jalur). Keputusannya terdaftar di
  `docs/mobile/PROMPT-AUTH-ONBOARDING.md` ("Yang TIDAK perlu dibangun di
  mobile") dan di fikstur `kunci-belum-dibaca.txt` — *"bukan 'belum',
  melainkan bukan untuk perangkat itu"* — dengan ratchet yang menegakkannya.
  **Tidak dibalik.** Pemilik memilih dua temuan lain dari pemeriksaan yang sama.

- **Temuan 1 — ponsel tak pernah menyebut dirinya (ponsel).** `BaseOptions`
  hanya menyetel `Content-Type`; sapuan seluruh repo menemukan nol penyetelan
  `User-Agent`. Yang sampai ke server bawaan `dart:io` — `Dart/3.12 (dart:io)`,
  sama untuk tiap versi, tiap perangkat, tiap sistem. Kolom yang baru dirender
  di panel karena itu cuma bisa menjawab "ponsel atau web" dan berhenti di situ.
  Kini `Kakarut/<versi> (<os>; <versi os>)`, tanpa dependensi baru: `dart:io`
  memberi platformnya, dan versinya konstanta yang **dijaga tak boleh hanyut**
  dari `pubspec.yaml`.

- **Temuan 2 — "Masalah berbeda" salah DUA kali, dan diukur (server+web).**
  `jumlah_kelompok: rows.length`, sementara `rows` dipotong `LIMIT_KELOMPOK`
  DAN disaring. Diukur lewat HTTP pada DB hasil gerbang:

  | saringan | `jumlah_kelompok` | baris tampil |
  |---|---|---|
  | `semua` | **312** | 200 |
  | `4xx`   | **312** | 200 |
  | `5xx`   | **312** | 2 |

  Sebelum perbaikan angka itu akan terbaca **200 / 200 / 2** — kartu melaporkan
  200 masalah untuk 312 yang sebenarnya ada, lalu **anjlok ke 2** begitu tab
  "Galat server" ditekan. Ketiga kartu lain sengaja tak ikut tersaring;
  komentar di atas kuerinya sendiri menuliskannya, dan kartu keempat melanggar
  aturan itu sepuluh baris di bawahnya. Kini dihitung `count(distinct sidik)`
  di kueri ringkasan yang sama — nol pemindaian tambahan. Header
  `x-kakarut-terpotong: 200` terkirim dan dirender: pemotongannya nyata pada DB
  itu, bukan hipotesis.

- **GERBANG LAMA MENGARAHKAN SELURUH BENTUK PERBAIKANNYA**, dan ini bagian yang
  paling layak dicatat. Lima penjaga menuntut berturut-turut, tiap tuntutan
  benar: (1) `pemotongan-terungkap` menolak panggilan `potongLarik` bersarang
  yang argumennya tak terbaca → panggilannya dirapikan; (2) penjaga yang sama
  menuntut layarnya MEMBACA header → `ErrorLogPage` memasang `bacaTerpotong`;
  (3) `potong-berpenanda` menandai entri adjudikasi lama jadi kuburan →
  diperbarui, dan alasan lamanya ternyata KELIRU ("tak ada angka yang mengecil
  karena potongan" — padahal kartu itu justru mengecil); (4)
  `daftar-tanpa-langit-langit` menuduh kueri berbatas sebagai tanpa-batas; (5)
  `changelog-stempel-rilis` dari putaran sebelumnya menagih entri tak berstempel.

- **Batas pemindai yang ditemukan sambil lalu**: `daftar-tanpa-langit-langit`
  kehilangan jejak `.limit()` bila ada komentar menyela di TENGAH rantai kueri,
  lalu menuduh kueri berbatas. Diuji dua arah (komentar di dalam rantai →
  merah; dipindah ke atas rantai → hijau). Tidak dibungkam dengan menaikkan
  DASAR; letak komentarnya dipindah dan sebabnya ditulis di tempat itu supaya
  tak dikembalikan orang berikutnya. Pemindainya sendiri belum diperbaiki —
  batas yang diketahui, dicatat di sini.

- **Bukti merah**: `jumlah_kelompok` dikembalikan ke `rows.length` → 1 merah;
  `LIMIT_KELOMPOK + 1` → `LIMIT_KELOMPOK` → 2 merah (penjaga baru + registri
  pintu); semua dipulihkan byte-per-byte. Ponsel: uji di-commit merah dulu,
  **tapi merahnya BUKAN yang direncanakan** — CI #29/#30 gagal di `analyze`
  karena `library;` kutaruh sesudah impor, jadi tak satu uji pun sempat
  berjalan. Merah karena kompilasi, bukan karena perilaku; kedua kalinya bentuk
  ini muncul di repo ini, dan ditulis apa adanya alih-alih diklaim sebagai
  bukti yang bukan.

- **Gerbang**: typecheck · npm test 229 berkas / 2.774 · build · verify-api
  **3.453**/0 (naik 4: lengan §142 baru) · audit:invarian 27/27 · Playwright 22.

---

## 1.744 penolakan 401 di panel galat: satu sesi mati = ~14 baris, dan pemalsuan tanda tangan tenggelam di antaranya — server + web + ponsel — 2026-09-03

- **Kenapa vena ini ada**: BUKAN dari antrean — pemilik repo membuka panel Log
  Galat super admin dan bertanya "kalau ini galat apa?". Layarnya: **1.744
  penolakan 4xx dalam 7 hari, NOL 5xx, 157 kelompok**, seluruhnya
  `401 Token tidak valid atau kedaluwarsa`.

- **Jawabannya bukan bug, dan itu bagian pentingnya.** Token hidup 12 jam tanpa
  refresh (`JWT_EXPIRES_IN`, ditulis di `API-CONTRACT.md`), jadi tiap sesi mati
  tepat waktu — takdir setiap orang yang memakai aplikasi ini dua kali sehari.
  Yang perlu diperbaiki bukan penolakannya, melainkan tiga hal yang tersembunyi
  di baliknya.

- **MEKANISMENYA DIBUKTIKAN DARI DATA PEMILIK SENDIRI, bukan dari tebakan.**
  Dugaan pertamaku salah bentuk: kusangka polling yang merembes sesudah token
  mati. Yang benar **kipas serentak** — `refetchOnWindowFocus` tak pernah diset
  (jadi bawaan react-query `true`) dengan `staleTime` global 10 detik, sehingga
  satu tab yang kembali difokuskan menembakkan SELURUH kueri yang terpasang
  dalam satu tick. Buktinya ada di panel itu juga: `/company` dan `/cabang`
  duduk BERDAMPINGAN dengan `/kategori` di KasirPage tapi **nol** di log —
  bedanya cuma `staleTime` 5 menit (`KUNCI_MASTER`). **Sebaran 401 mengikuti
  garis masa-basi, bukan garis interval.** Aritmetiknya menutup: 1.744 ÷ 7 ≈
  249/hari ÷ ~14 ≈ 18 ledakan/hari, dan `/auth/me` 113 ÷ 7 ≈ 16/hari — rute itu
  praktis penghitung sesi-mati. Gugus jam 07.50/07.51/07.53 pada tiga hari
  berturut-turut = sesi semalam yang ditemukan mati saat toko dibuka.

- **Temuan 1 — pemalsuan tanda tangan tak dapat dibedakan (server).**
  `requireAuth` menangkap `catch {` TANPA mengikat galatnya, jadi
  `TokenExpiredError` dan `JsonWebTokenError: invalid signature` menulis baris
  yang identik sampai ke `sidikGalat`. Pengamanan `algorithms: ["HS256"]`
  dipasang dua baris di atasnya khusus untuk menolak serangan itu, lalu
  buktinya dibuang sebelum ada yang sempat membacanya. Kini dua kalimat, dua
  sidik jari. §287 +4 asersi (3.445 → 3.449).

- **Temuan 2 — alamat yang tercatat adalah PROXY, dan jatah ditanggung bersama
  (server).** Seluruh alamat di panel berada di rentang milik satu CDN.
  `TRUST_PROXY_HOPS` bawaan 1 sementara rantai `X-Forwarded-For` 2 entri.
  Bukan cuma kolom log: `ipKlien` mengunci **empat pembatas laju yang berkunci
  alamat saja** (register 20/jam, guest 30/5mnt, reset 20/15mnt, verif), jadi
  penyewa yang tak berhubungan berbagi jatah. **Pemeriksa setelannya buta pada
  kasus ini** — ketiga tuduhannya menjangkau hops=0, hops-tanpa-XFF, dan
  rantai-lebih-pendek; keadaan production tak memenuhi satu pun. Ditambah
  tuduhan keempat yang simetris. Nilainya sendiri milik pemilik (Dokploy).

- **Temuan 3 — 401 yang ditelan diam-diam (ponsel).** `_revalidasiLatar` hanya
  menangani 304 dan 2xx; `validateStatus` memulangkan true untuk semua status,
  jadi 401 tak melempar DAN tak masuk cabang mana pun. Di sinyal jelek layar
  menyajikan cache seolah baik-baik saja, token mati tak pernah dihapus, dan
  siklusnya berulang tanpa batas. Sesi mati yang tak pernah mengumumkan
  kematiannya — kasir mengira dirinya bekerja.

- **Perbaikannya menghapus SEBAB, bukan membungkam instrumen.** Menyaring 401
  keluar dari `error_logs` sempat kupertimbangkan dan ditolak: preseden repo
  ini sudah memutuskannya di kelas yang sama persis
  (`lencana-beli-tak-menembak-403`, 403 × 211 untuk lencana yang tak pernah
  dirender) — *"layar menyesuaikan diri pada pintu, bukan sebaliknya."* Jadi
  kedua klien kini memeriksa `exp` SEBELUM mengirim. Palang sekali-jalan saja
  tak cukup dan itu inti rancangannya: keempat belas permintaan berangkat
  sebelum balasan pertama tiba.

- **Jam perangkat tidak dipercaya begitu saja.** Web mempelajari selisih jam
  dari header `Date` tiap balasan dan menyimpannya (supaya muat-ulang pagi hari
  sudah tahu jam server sebelum permintaan pertamanya berangkat); ponsel sudah
  punya `waktuServer()` sejak lama untuk menstempel perintah offline — bahannya
  tersedia dan belum pernah dipakai untuk ini. Selisih basi menyembuhkan diri
  sendiri karena balasan LOGIN ikut memperbaruinya, jadi berputar di layar
  login tak mungkin terjadi.

- **GERBANGNYA MEMBETULKANKU DUA KALI.** (1) Jalan pertama masih meloloskan
  satu `/cabang`: begitu `saveAuth(null)` jalan, kueri yang tersisa di tick
  yang sama berangkat TELANJANG dan dibalas "Perlu login (token tidak ada)" —
  kelas pesan lain, baris log yang sama sia-sianya. Palangnya kini ikut menahan
  susulan. (2) Versi pertama spec e2e-nya sendiri cacat: menanam sesi lewat
  `addInitScript`, yang menanam ulang tiap navigasi sehingga ujinya berputar
  antara `/kasir` dan `/login` tanpa menguji apa pun — ditemukan justru oleh
  bukti merahnya.

- **Bukti merah**: `catch {` dikembalikan → 2 asersi merah; cabang proxy
  keempat dicabut → 2 merah; angka tetap menggantikan panjang rantai → 1 merah;
  spec e2e dijalankan terhadap bundel SEBELUM perubahan → 3 permintaan ber-sesi
  (`/company`, `/cabang`, `/auth/me`) dengan token mati. Semua dipulihkan
  byte-per-byte (`cmp`). Ponsel: uji di-commit merah lebih dulu (CI #27 —
  analyze lolos, 631 hijau, 6 uji pemasangan merah), lalu dibayar.

- **Yang TIDAK diklaim**: 1.744 itu tak bisa dipilah per pengguna — penolakan
  terjadi SEBELUM `c.set("auth")`, jadi barisnya anonim. Berapa orang yang
  mengalaminya tak diketahui, dan datanya memang tak ada. Panel kini merender
  user-agent supaya setidaknya "web atau ponsel" bisa dijawab.

- **Sisa untuk pemilik**: setel `TRUST_PROXY_HOPS` sesuai panjang rantai
  sebenarnya di Dokploy — kode hanya membuat nilainya yang salah jadi terlihat.

---

## Putaran PONSEL: layar verifikasi yang meminta token sementara suratnya mengirim kode, jeda yang ditulis klien, sesi dari `/register` yang dibawa ke layar kode, dan 401 yang bisu — ponsel — 2026-09-02

- **Kenapa vena ini ada**: antrean ledger + pemetaan cakupan 2026-09-02 —
  sisi ponsel adalah yang paling lama tak disentuh, dan tiap butirnya sudah
  TERUKUR di putaran server sebelumnya: surat verifikasi dipimpin KODE 6
  angka sejak 2026-08-31 (§281 memaku `POST /auth/verify-email {email,
  kode}`; jalur `{token}` tetap hidup untuk tautan), server menahan jeda
  kirim ulang **120 detik** dan menyebutnya di `retry_after_detik` (§281),
  `/register` memulangkan SESI bila akun sudah aktif dan password cocok
  (§284/§285, rilis 10b0882), dan 401 di luar login mematikan sesi seketika
  (§287). Ponsel belum membaca satu pun dari keempatnya. Diputuskan pemilik
  repo: putaran terpisah, sesudah vena sesi.

- **Populasi — 5 berkas `lib/features/auth/` + 1 titik di `core/`**, dibaca
  seluruhnya, bukan disapu regex: `verifikasi_email_page.dart` (layar kode),
  `register_page.dart`, `login_page.dart`, `lupa_password_page.dart`,
  `auth_controller.dart` (pemilik sesi; `onUnauthorized`), dan
  `core/api_client.dart:539` (tempat 401 memanggilnya). Cara hitung kedua:
  `grep -l "auth_controller\|verifyEmail\|resendVerification" lib` → 5
  berkas yang sama.

- **Metode & batasnya, ditulis lebih dulu**: Flutter **tak terpasang** di
  mesin ini, jadi pengukuran ponsel hanya bisa lewat uji Dart yang
  dijalankan CI (push ke `claude`, ±3 menit per jalan). Kontrak HTTP-nya
  TIDAK diukur ulang di sini — ia sudah dipaku §281/§284/§285/§287 di repo
  server dan tayang; yang diukur adalah apa yang dikirim dan ditampilkan
  layarnya. Uji widget merekam BADAN yang dikirim ke `post()` (kelas
  `_ApiPerekam extends ApiClient`), lalu melempar `ApiException` sebelum
  `setSession` — sesi (secure storage) sengaja tak disentuh uji.

- **Diukur sebelum diperbaiki (kode 2026-09-02, dibaca baris per baris)**:

  | | sebelum | sesudah |
  |---|---|---|
  | kalimat layar | "salin token di tautan, lalu tempel di bawah" | "Kode 6 angka sedang dikirim ke … (berlaku 60 menit)" — tautan tetap disebut |
  | apa pun yang diketik | dikirim `{token}` | 6 angka → `{email, kode}` · 64 hex → `{token}` · selain itu **tak dikirim**, dikatakan |
  | jeda kirim ulang | `_mulaiCooldown(30)` — angka klien | `retry_after_detik` dari balasan (**120**); cadangan `kJedaKirimUlangBawaan` hanya bila server diam |
  | jeda saat layar dibuka sesudah daftar | 0 — tombol tampak siap | `jedaAwal` dari balasan `/register`, hitung mundur sudah berjalan |
  | balasan `/register` berisi `token` | dibawa ke layar kode | `balasanDaftarMemuatSesi` → `setSession` + "Akun ini sudah aktif — Anda langsung dimasukkan." |
  | 401 di luar login | `logout(bersihkanData:false)`, **tanpa kalimat** | `alasanKeluarProvider` ditulis dulu; layar login mengucapkannya (kotak kuning), dihapus begitu orangnya bertindak |
  | lupa password | "tautan reset **sudah** dikirim" | "**sedang** dikirim … (berlaku 1 jam)" — sejajar web |

  Semua aturan murninya (`bentukVerifikasi`, `jedaKirimUlang`,
  `balasanDaftarMemuatSesi`, tiga kalimat) dikumpulkan di
  `verifikasi_bentuk.dart` supaya DIUJI tanpa widget.

- **Penjaga**: `verifikasi_kode_test.dart` (5 uji widget: 6 angka →
  `{email,kode}`; 64 hex → `{token}`; 5 angka → tak dikirim + kalimat "6
  angka"; kirim ulang → "Kirim ulang dalam 120s" dari balasan palsu
  `retry_after_detik: 120`; `jedaAwal: 120` → hitung mundur sejak dibuka) ·
  `sesi_berakhir_ponsel_test.dart` (4 pemindai sumber: `onUnauthorized`
  menulis sebab LALU `logout(`; layar login membaca provider itu; layar
  daftar memanggil `balasanDaftarMemuatSesi(`; tak ada `_mulaiCooldown(30)`
  dan pembacaan `retry_after_detik` hidup di controller) ·
  `verifikasi_bentuk_test.dart` (murni). Uji di-commit LEBIH DULU
  (`ac445c0`), perbaikannya menyusul (`020fd0a`, `e07b98e`).

- **Bukti merah — dan apa yang TIDAK dibuktikannya, ditulis jujur**: CI #16
  pada commit uji memerah di **`flutter analyze`**, bukan di `flutter test`:
  *"The named parameter 'jedaAwal' isn't defined"* — uji widget menyebut
  parameter yang belum ada. Job berhenti di sana; `flutter test` **tidak
  pernah berjalan** pada kode lama. Jadi yang terbukti adalah bahwa ujinya
  tak bisa hijau pada kode lama (ia bahkan tak terkompilasi), BUKAN bahwa
  tiap asersinya menuduh perilaku yang salah. Untuk empat pemindai sumber,
  kemampuan menuduhnya terbaca dari kode lama (`_mulaiCooldown(30)` ada,
  `alasanKeluarProvider` tak ada); untuk lima uji widget, kemampuan itu
  belum pernah DIJALANKAN. Tak dibayar dengan jalan CI tambahan — biaya
  menit Actions adalah keputusan pemilik repo — dan dicatat sebagai batas.

- **Gerbang ponsel menangkap dua hal di jalan pertamanya**: (1) log CI #16
  juga memuat satu **info** — `dangling_library_doc_comments` pada kepala
  `verifikasi_bentuk.dart` — dan `flutter analyze` di CI memerah pada info
  sekalipun; perbaikan 020fd0a tak menyentuhnya, jadi CI #17 merah di analyze juga.
  Dibayar `e07b98e` (komentar kepala jadi komentar biasa). (2) Riverpod
  3.x: `StateProvider` hanya ada di `legacy.dart`; sebab keluar ditulis
  sebagai `Notifier<String?>` seperti sembilan pemberitahu lain di repo ini —
  ketahuan dari pubspec sebelum di-push, bukan dari CI.

- **Anggapan rencana yang salah, dicatat**: rencana menulis "ratchet
  `kunci-belum-dibaca.txt` menyusut: `retry_after_detik` dkk. kini dibaca".
  Tidak: `kunci-kontrak-server.txt` dihasilkan dari antarmuka `types.ts`,
  dan balasan `/auth/*` (`token`, `kode`, `retry_after_detik`,
  `dev_verify_kode`) **bukan** DTO di sana — ratchet itu tak pernah melihat
  vena ini, tak menyusut, dan tak bisa menjaganya. Batas detektor yang
  sudah ada, bukan temuan baru.

- **Gerbang**: CI ponsel `claude` #19 hijau — sesudah #18 merah karena SATU `unused_import` (impor pembantu di layar login yang tak dipakai; kalimatnya sudah dibawa nilai provider) · `Production` #20 hijau (merge `acf4f2f`, pohon identik dengan `claude`: `git diff claude Production` kosong).
  `flutter test` **599 → 615** uji (CI #14 → #19). Tak ada perubahan server;
  tak ada entri CHANGELOG-API.

- **Batas yang ditulis jujur**: tak ada uji widget untuk layar daftar & login
  (jalur `/register` → sesi dan kotak kuning dijaga pemindai sumber, bukan
  perilaku yang dijalankan); deep link tautan verifikasi belum ada di ponsel
  — "token 64 hex" hanya lewat tempel manual ke kotak yang sama; papan
  ketik angka mengutamakan kode, tempel tetap bisa. `X-Kakarut-Terpotong`
  di delapan rute (tugas berikutnya di antrean) tak disentuh putaran ini.

---

## Daur hidup SESI — yang kedaluwarsa ditolak, yang dicabut mati seketika, dan layar login yang akhirnya MENGATAKANNYA — server + web — 2026-09-02

- **Kenapa vena ini ada**: pemetaan cakupan 2026-09-02 — `JWT_EXPIRES_IN`
  (12 jam) ada, tapi tak satu uji pun pernah menembak token yang
  benar-benar kedaluwarsa (lengan `TokenExpiredError` di `requireAuth` belum
  pernah dijalankan gerbang); nonaktif hanya diuji di pintu LOGIN, bukan pada
  sesi yang sudah ada; dan apa yang dilihat orang saat sesinya mati belum
  pernah diukur di browser. Yang sudah dijaga sebelumnya: ganti/reset password
  mencabut token lama (4292, 4306), keanggotaan diarsip → 401 (§141),
  ganti peran TIDAK mencabut sesi (6076).

- **Populasi**: `auth/session.ts` (tanda tangan, klaim `tv`),
  `middleware/auth.ts:29-68,96-114` (empat pintu 401: token tak ada/tak sah/
  kedaluwarsa, baris user dihapus/nonaktif, `tv` bergeser, keanggotaan
  diarsip/perusahaan nonaktif), tiga penulis `tokenVersion` (profil,
  admin reset, reset-password), `web/lib/api.ts:146` (cabang 401),
  `LoginPage.tsx`, ponsel `api_client.dart:539` + `auth_controller.dart:41`.

- **Metode (Aturan 6), §287 — 13 asersi**: token kedaluwarsa dibuat dengan
  MENANDATANGANI ULANG payload token owner (sub, tv — bukan diketik) memakai
  `JWT_SECRET` yang sama, `exp` 60 detik yang lalu. PASANGAN: payload persis
  sama dengan exp di depan → 200 (yang ditolak memang `exp`), tanda tangan
  asing → 401. Karyawan baru → sesi hidup → dinonaktifkan → diaktifkan lagi →
  diarsipkan. `JWT_SECRET` ada di env job CI dan di prosedur gerbang lokal;
  premisnya dipaku.

- **Hasil server: BENAR di semua lengan.** Kedaluwarsa → 401 "…kedaluwarsa";
  nonaktif → sesi yang SUDAH ADA mati seketika (401 "tidak berlaku lagi");
  diaktifkan lagi → token yang SAMA hidup lagi tanpa login ulang (pencabutan
  nonaktif bisa dibalik — dicatat, bukan dituduh); diarsipkan → 401.

- **Alat ukurku salah dua kali, keduanya dicatat**: (1) jalan pertama §287
  memerah tiga asersi menuduh server tak mencabut sesi — `POST /karyawan`
  memulangkan `user_id`, bukan `id`; PATCH-nya menembak `/karyawan/` kosong
  (404 "Tidak ditemukan"). Premis "karyawan tercipta" kini memaku panjang
  id-nya. (2) e2e-nya menanam token sampah lewat `addInitScript` — yang
  berjalan pada TIAP muat dokumen — jadi sesudah dilempar ke /login ia
  menanam ulang, aplikasi berputar /login → /dashboard → /login. Ditanam
  sekali lewat `evaluate`.

- **TEMUAN, di WEB — 401 yang bisu**: `api.ts` menghapus sesi lalu
  `window.location.href = "/login"` dan `throw new ApiError("Sesi
  berakhir…")` — lemparan yang tak pernah dibaca siapa pun, sebab dokumennya
  sudah dibuang. Token kedaluwarsa (12 jam), password diganti di perangkat
  lain, akun dinonaktifkan: semuanya berakhir di layar login tanpa satu
  kalimat, terbaca sebagai "aplikasinya mengeluarkan saya tanpa sebab".
  Terukur: token sampah → /login, `getByText(/Sesi Anda berakhir/)` →
  *element(s) not found*. Dibayar: pemindahan membawa `?sesi=berakhir`
  (satu-satunya yang selamat dari perpindahan dokumen penuh), halaman login
  membacanya dan mengucapkan kalimat dari rumah `lib/pesan-sesi.ts`; nama
  query & nilainya konstanta bersama di kedua sisi.

- **Bukti merah yang mengajari**: pemeriksaan `!u.isActive` dicabut dari
  `requireAuth` → §287 **TIDAK merah** — dan itu benar: nonaktif = arsip
  (satu status, `users/routes.ts:608`), jadi pintu KEDUA (`memberships.
  archived_at`, `auth.ts:114`) tetap menutupnya. Asersinya menjaga
  KEADAAN, bukan satu baris kode; bukti merahnya dituntut mencabut KEDUA
  pintu → merah (dicatat di bawah). Kedaluwarsa diabaikan
  (`ignoreExpiration`) → §287 merah · sebab dibuang dari pemindahan →
  penjaga statis DAN e2e merah · kotak di halaman login dicabut → statis
  merah. Semua dipulihkan byte-per-byte.

- **Penjaga**: §287 (13) · e2e `sesi-berakhir.spec.ts` (Playwright 19 → 20)
  · `sesi-berakhir-beralasan.test.ts` (4: rumah kalimat ada, pemindahan
  membawa sebab dari konstanta, halaman login membacanya, tak ada string
  lepas). Kontrak: bagian Autentikasi menuliskan umur & pencabutan sesi.

- **Batas yang ditulis jujur**: 401 dari penyegaran latar (`segarkanSesi`)
  masih melempar orangnya di tengah mengetik — kini dengan sebab, tanpa
  menyimpan isi formulir dan tanpa kembali ke halaman semula; ponsel
  (`onUnauthorized → logout`) juga bisu — antre di putaran ponsel; umur 12
  jam tanpa refresh token adalah keputusan, bukan temuan.

- **Gerbang penuh HIJAU**: typecheck bersih · `npm test` **220 berkas / 2671 uji** ·
  `verify-api.sh` **3445 lolos, 0 gagal** · `audit:invarian` 27/27 · Playwright
  **20/20**.

---

## Kebenaran ANGKA LAPORAN — lima rute dibandingkan hitungan tangan, empat halaman dibandingkan servernya — server + web — 2026-09-02

- **Kenapa vena ini ada**: pemetaan cakupan 2026-09-02 — kelima rute
  `/laporan/*` diketuk `verify-api.sh` (56 asersi) tapi hanya BEP (§171) yang
  angkanya dibandingkan terhadap NILAI YANG DIHITUNG TANGAN dari data yang
  dibuat skrip; laporan harian, menu laris, lama pesanan, pembelian hanya
  dicek bentuk/sifat parsialnya. Di web, `LaporanMenuLarisPage`,
  `LaporanDurasiPesananPage`, `LaporanPembelianPage`, `GrafikTransaksiPerJam`,
  `LaporanTabs` tak pernah disentuh satu uji pun. Angka laporan adalah yang
  dibaca pemilik warung untuk memutuskan; salah di sini tak pernah "terlihat
  salah" — cuma berbeda dari yang diingat orang.

- **Populasi**: 5 rute server (`laporan/routes.ts:74-669`), 6 berkas halaman
  laporan web, 1 DTO (`LaporanHarian`). Ponsel membaca `LaporanHarian`
  (`operasional_models.dart:566`) — dicatat, tak digarap.

- **Metode (Aturan 6), §286 baru — 43 asersi**: cabang + kasir + bahan + dua
  menu BARU supaya tak satu pun nota seksi lain ikut terhitung (versi pertama
  memakai cabang §170 dan angkanya tercemar; nama-nama diberi akhiran waktu
  supaya seksinya bisa dijalankan ulang di DB yang sama saat dikembangkan).
  Bahan Rp5.000/pcs → HPP menu A 5.000/porsi; PB1 10%. Tiga nota (diskon
  persen & nominal, tunai & QRIS), refund SEBAGIAN (A×1 dari S1) dan PENUH
  (S3), sajian S1/S2 diselesaikan, faktur beli 10 pcs @1.000. Angka
  harapannya ditulis tangan di komentar skrip dari rumus `service.ts:589-621`
  dan `refund.ts`.

- **Hasil server: SEMUA COCOK.** omzet 48.000 · diskon 7.800 · PB1 4.020 ·
  HPP 10.000 (porsi yang direfund ikut menyusut) · laba 30.200 · transaksi 3
  (nota yang direfund penuh tetap satu nota) · refund 46.200/2 · tunai
  2/27.720, QRIS 1/16.500, Σ per metode 44.220 = omzet − diskon + PB1 · item
  terjual A 2/40.000, B 1/8.000, Σ = omzet · per jam Σ = kartu, ember jam WIB
  saat ini · konsumsi bahan 2 pcs · menu laris = item terjual, total 3/48.000 ·
  durasi 3 baris (A 2, B 1), rata global = rata seluruh riwayat ±1 dtk,
  tercepat ≤ median ≤ terlama · pembelian 10.000 / 1 faktur / 1 item / 1
  supplier. PASANGAN: `branch_id=all` ≥ cabang; kasir → 403 (dua bentuk).

- **Dua harapanku sendiri yang salah, dan keduanya dicatat di skripnya
  (bukan dihapus)**: (1) kukira pembelian di cabang sendiri bisa "diterima 7
  dari 10" lalu diprorata — terima-sebagian hanya ada di jalur KIRIMAN
  CK→cabang (§52b), yang bukan `tipe='beli'`; untuk pembelian sendiri, tahap
  `menunggu` = barang tiba & stok masuk. Laporan 10.000 BENAR, harapanku
  yang 7.000. (2) kukira kasir membaca laporan cabangnya — `/laporan/*`
  `requireRole("owner","admin")` (app.ts:188); 403 adalah jawabannya, dan
  matriks izin sudah menutupnya sejak 2026-08-25. Tuduhan yang ditulis hati-hati
  dan dibuktikan salah oleh pengukuran, seperti sebelumnya.

- **TEMUAN, di KLIEN — satuan yang tercampur**: `LaporanPage` menulis
  *"sebelum refund, omzetnya {omzet + total_refund}"*. `omzet` KOTOR (Σ
  subtotal) sedangkan `total_refund` nominal BERSIH (diskon sudah dipotong,
  PB1 ditambah). Terukur pada data §286: layar **94.200** untuk omzet sebelum
  refund **92.000** (48.000 + 20.000 + 24.000). Dibayar dari servernya:
  `omzet_sebelum_refund = Σ COALESCE(subtotal_asal, subtotal)` — jangkar
  `subtotal_asal` diisi sekali pada refund pertama (`refund.ts:125`), jadi
  COALESCE-nya persis "subtotal seperti sebelum refund mana pun". Layar
  mencetaknya, tak merakit. Kontrak + Lampiran A + CHANGELOG 🟢 + fikstur
  kunci ponsel (didaftarkan belum dibaca, beralasan; CI ponsel).

- **Penjaga**: (1) e2e `laporan.spec.ts` (2 kasus; Playwright 17 → 19):
  kartu Omzet/Transaksi/Diskon/HPP/Estimasi Profit/PB1, kaki tabel per jam,
  kalimat refund, dan tab Menu Terlaris / Pembelian / Lama Pesanan = balasan
  API untuk periode & cabang yang sama. Sesi DISUNTIK dari API
  (`masukLewatSesi`), bukan lewat layar login — kuota login 10/5 menit sempat
  habis pada jalan ketiga dan menyamar jadi "masih di /login"; `sesiApi`
  diekspor dari util alih-alih disalin. (2) `laporan-tak-menghitung-ulang.test.ts`:
  aritmetika atas medan angka balasan (`.omzet/.total/.qty/.jumlah/…`) di
  `pages/laporan/*.tsx` wajib terdaftar beralasan berkunci `berkas:pengenal`
  (kunci nomor baris ditolak, sesuai aturan 2026-09-01); TIGA situs sah — Σ
  per jam yang dicetak untuk dicocokkan (`totalTransaksi`, `omzetGrafik`;
  yang kedua dihoist dari JSX inline supaya bernama), komparator urutan
  `items`, tinggi batang `tinggi`. Daftar dijaga dua arah. Pembacanya diuji
  dengan sumber palsu (Aturan 7).

- **Bukti merah, dipulihkan byte-per-byte**: kalimat lama `omzet +
  total_refund` dipasang lagi → penjaga statis merah (`LaporanPage.tsx:baris-194`)
  DAN e2e merah (angka layar ≠ server) · `omzet_sebelum_refund` dicabut dari
  server → §286 merah (42 lolos, 1 gagal).

- **Batas yang ditulis jujur**: `rata_detik` global dihitung dari rata per
  menu yang sudah dibulatkan (`routes.ts:529`) — meleset ≤ 1 detik, diuji
  dengan toleransi itu, TIDAK "diperbaiki" sebab tak terukur bedanya; pemindai
  klien leksikal (pembantu di luar berkas laporan tak terlihat); durasi diuji
  atas urutan, bukan nilai mutlak (jam dinding); kedaluwarsa/target durasi
  tak disentuh; ponsel belum menampilkan kalimat refund — bila kelak, wajib
  membaca medan ini.

- **Gerbang penuh HIJAU**: typecheck bersih · `npm test` **219 berkas / 2667 uji** ·
  `verify-api.sh` **3435 lolos, 0 gagal** · `audit:invarian` 27/27 · Playwright
  **19/19** · CI ponsel #14 hijau.

---

## Lupa/reset password dilihat dari BROWSER — dua layar yang tak pernah disentuh uji apa pun — web + server — 2026-09-02

- **Kenapa vena ini ada**: pemetaan cakupan 2026-09-02 (modul × rute × uji ×
  ledger) menemukan `ForgotPasswordPage` dan `ResetPasswordPage` tak pernah
  disentuh e2e, tak pernah disebut pemindai, tak pernah disebut ledger — dan
  itu jalur MASUK: orang yang terkunci dari akunnya. Sisi servernya sudah
  diketuk §97 (token bekas 400, token ngawur 400, tautan mengikuti host).
  Yang belum pernah diukur: apa yang dilihat orang **sesudah** 400 itu.

- **Populasi**: 2 halaman web, 2 pintu server, 1 jalur akibat (403 di
  `LoginPage`). Ponsel punya `lupa_password_page.dart` dengan klaim yang sama;
  reset-nya memang lewat tautan web — dicatat, tidak digarap di sini.

- **Metode (Aturan 6)**: spec Playwright ditulis DULU dan dijalankan terhadap
  kode yang belum diubah — 4 kasus, tiap kasus akun segar lewat API
  (`register` + `verify-email` dengan `dev_verify_kode`; email unik per jalan
  supaya ember `batasLupa` 6/15 menit dan ember login, keduanya berkunci
  email, tak pernah tersentuh). **Sebelum perbaikan: 2 merah dari 4.**

- **Temuan 1 — reset berhasil, lalu tak bisa masuk.** Akun yang belum
  terverifikasi → lupa password → tautan di inbox-nya → password diganti →
  layar berkata *"Silakan masuk"* → `/login` menjawab **"Email belum
  diverifikasi. Cek email Anda atau minta kode verifikasi baru."** (tangkapan
  Playwright). Orang itu BARU SAJA membuktikan kepemilikan inbox-nya lewat
  tautan yang hanya pernah dikirim ke alamat yang tercatat — standar bukti
  yang persis sama dengan kode verifikasi. Komentar §97 lama bahkan menuliskan
  cacatnya sebagai prasyarat uji: *"daftar + verifikasi email dulu (login
  setelah reset butuh email terverifikasi)"*. Dibayar: `/reset-password`
  mengisi `emailVerifiedAt` lewat `coalesce(…, now())` di transaksi yang sama
  — penulis ke-7 `emailVerifiedAt`, disengaja dan berkomentar; akun yang sudah
  terverifikasi tak bergeser stempelnya. Balasan tetap `{ ok: true }`.

- **Temuan 2 — tautan mati tanpa jalan keluar.** Token bekas/kedaluwarsa →
  server 400 → halaman menampilkan galat merah **dan formulirnya tetap
  hidup**; tombol "Minta tautan baru" hanya ada bila `?token=` kosong sama
  sekali. Terukur: `getByRole("link", { name: "Minta tautan baru" })` →
  *element(s) not found*. Dibayar: galat yang memuat "tidak valid /
  kedaluwarsa" (kalimat milik server) mengganti formulir dengan jalan keluar
  yang sama seperti keadaan tanpa token.

- **Temuan 3 — klaim surat inline, kelas babak 3 yang luput dari
  populasinya.** *"tautan atur ulang password sudah dikirim"* ditulis di
  `ForgotPasswordPage` sendiri; gerbang `janji-surat-tak-berlebih` tak
  melihatnya karena populasinya hanya layar yang memanggil
  `register(`/`kirimUlangVerifikasi(`. Dibayar: `PESAN_LUPA` di rumah bersama
  (*"Jika alamat ini terdaftar, tautan … sedang dikirim … (berlaku 1 jam)"*),
  populasi gerbang diperluas ke `"/auth/forgot-password"` (3 → 4 layar), dan
  aturan satu-jalan disebut NAMANYA (`PESAN_DAFTAR`, `PESAN_KIRIM_ULANG`) —
  sebab `PESAN_LUPA` memang bercabang, dan itu sah: balasan netral
  anti-enumerasi, bukan layar tunggu kode. Ia dapat aturannya sendiri: wajib
  bersyarat, wajib menyebut masa berlaku, dilarang "sudah dikirim".

- **Penjaga**: e2e `lupa-password.spec.ts` (4 kasus, 13 → 17 Playwright);
  §97b di `verify-api.sh` (+6 asersi: premis belum terverifikasi 403, tautan
  tetap dikirim, reset ok, login sesudahnya **200**, PASANGAN password lama
  401 dan token bekas 400); `janji-surat` 14 → 15 asersi.

- **Bukti merah, semuanya dipulihkan dari salinan**: `coalesce` dicabut +
  server dinyalakan ulang → langkah §97b menjawab **403** dan e2e kasus 2
  merah · klaim "sudah dikirim" ditulis inline lagi → `janji-surat` merah ·
  `PESAN_LUPA` diubah jadi "sudah dikirim" → merah. Temuan 2 punya buktinya
  dari pengukuran sebelum perbaikan (kode asli = perbaikan dicabut).

- **Alat ukurnya sendiri salah sekali, dan itu dicatat**: asersi
  `toHaveCount(0)` untuk teks "belum diverifikasi" puas SEKETIKA pada layar
  yang belum sempat menjawab — hijau tanpa menguji apa pun, tepat di jalan
  pertama. Urutannya dibalik: URL dulu (yang menunggu), baru teksnya. Dan
  kasus 1 versi pertama membuka tautan bekas SESUDAH masuk — rute publik
  hanya hidup tanpa sesi, jadi ia dialihkan ke onboarding dan spec-nya
  menuduh hal yang salah; langkahnya dipindah ke sebelum masuk.

- **Gerbang penuh pertama MERAH 5 — di §281, seksi yang tak kusentuh, dan
  bukan bug.** Pendaftaran §97b adalah yang ke-21 pada ember `batasRegister`
  (20/IP/jam) yang dibagi SELURUH skrip; §281 menerima **429** (satu-satunya
  di log server) dan lima asersinya memerah — "tak memulangkan kode 6 angka",
  "kirim ulang tak memberi kode baru", "akunnya kini tak bisa masuk" — tanpa
  satu pun menyebut kuota. Dua hal dibayar: §97b memakai ember sendiri
  (`X-Forwarded-For: 203.0.113.97`, seperti §284/§285), dan premis §281 kini
  menyebut STATUS pendaftarannya (`V == 200`, dengan keterangan bahwa 429
  berarti ember bersama habis). Batas yang tersisa dan diketahui: tiap seksi
  baru yang mendaftar tanpa ember sendiri masih bisa menghabiskan jatah seksi
  di belakangnya — kini setidaknya tuduhannya menyebut sebab yang benar.

- **Batas yang ditulis jujur**: kedaluwarsa 1 jam tak bisa ditunggu e2e —
  dijaga §97 lewat token BEKAS saja (lengan `expiresAt` belum pernah diukur);
  pemindai kalimatnya leksikal; ponsel belum disentuh.

- **Gerbang penuh HIJAU**: typecheck bersih · `npm test` **218 berkas / 2660 uji** ·
  `verify-api.sh` **3395 lolos, 0 gagal** · `audit:invarian` 27/27 · Playwright
  **17/17**.

---

## Akun yang sudah aktif LANGSUNG DIMASUKKAN dari `/register` — dan layar daftar kembali SATU jalan — web + server — 2026-09-02

- **Babak keempat dari satu laporan, dan yang pertama lahir dari PENOLAKAN
  pemilik repo atas perbaikanku sendiri.** Babak 3 memperbaiki layar dengan
  kalimat DUA cabang (*"jika alamat ini baru … jika akunnya sudah aktif,
  langsung Masuk"*) plus tombol *"Akun sudah aktif?"*. Pemilik repo menolaknya:
  *"kalo sudah aktif langsung login biar tidak membingungkan user apalagi ini
  halaman awal user untuk coba aplikasi ini."* Alasannya benar, dan dicatat di
  sini sebagai **keputusan desain yang dicabut** — bukan tuduhan, tapi kelasnya
  sama: sesuatu yang kutulis dengan yakin, dibuktikan salah, dan dibalik
  terang-terangan. Aturan gerbang babak 3 ("tiap kalimat menyebut KEDUA
  kemungkinan") ikut DIBALIK, bukan dilonggarkan diam-diam.

- **Yang benar: keadaan "sudah aktif" ditangani SEBELUM layar tunggu.**
  `POST /auth/register` untuk akun terverifikasi dengan password yang COCOK
  kini memulangkan **sesi** (bentuk sama dengan `/login`) + `sudah_aktif:
  true`. Web menyimpannya lewat `setSession` yang sama dengan login — bukan
  cara kedua yang pelan-pelan menyimpang — dan `SignupPage` menampilkan
  *"Akun ini sudah aktif — Anda langsung dimasukkan"* 1,2 detik lalu
  mengarahkan ke tujuan yang sama dengan halaman Masuk. Kalimat tunggu kode
  kembali satu arah; tombol jalan kedua dan `AJAKAN_MASUK` dicabut.

- **Bukan kebocoran baru, dan syaratnya ditulis di kodenya supaya tak
  melonggar**: yang dibocorkan `/register` kini **TEPAT SAMA** dengan yang
  dibocorkan `/login` — keberadaan akun hanya terungkap kepada pemegang
  password yang benar. Password salah tetap dijawab netral, identik
  byte-per-byte dengan email baru. Ember `batasRegister` (20/IP/jam) bahkan
  lebih ketat daripada ember login untuk menebak password lewat pintu ini.
  Akun BELUM terverifikasi tak pernah diberi sesi dari sini walau passwordnya
  cocok — kodenya dikirim, verifikasi tetap wajib, persis `/login` yang
  menolaknya 403.

- **Terukur lewat HTTP sungguhan (§285, ditulis ulang jadi dua paruh)**:
  daftar → verifikasi lewat rutenya → daftar ULANG. (a) password sama →
  `token` ada, `sudah_aktif == true`, baris riwayat tetap `tak_dicoba /
  akun_terverifikasi` (keputusan "tak dikirimi" tetap tercatat walau orangnya
  dimasukkan). (b) `PasswordSalah999!` → badan identik dengan email yang belum
  pernah ada, tanpa token, tanpa kode. **§284 +1**: akun belum terverifikasi +
  password cocok → `token == null`.

- **Riwayat kirim email pindah rumah**: dari halaman Sistem & Migrasi (harus
  digulir lewat 100+ migrasi; pemilik repo mencarinya di Log Galat) ke
  **sub-item sidebar pertama** di bawah Pengaturan Email
  (`/superadmin/email/riwayat`, `RiwayatEmailPage.tsx`). Datanya tetap dari
  `GET /admin/sistem` — tak ada kontrak yang berubah. Induknya diberi `end`
  supaya keduanya tak menyala bersamaan.

- **Temuan saat memindahkannya, kelas "penjaga memeriksa salinannya
  sendiri"**: peta label `SEBAB` disalin utuh ke halaman baru — lengkap dengan
  `email_sudah_terdaftar`, sebab yang sudah DICABUT di server sehari
  sebelumnya — dan tak ada yang menuduh. Gerbang `otp-senyap-tercatat` memang
  memeriksa peta, tapi peta di berkas ujinya sendiri, bukan peta yang dilihat
  orang. Kini dijaga dua arah terhadap `RiwayatEmailPage.tsx` (tiap sebab
  berlabel, tak ada label kuburan), pembacanya diuji dengan sumber palsu
  (Aturan 7), dan bukti merahnya: satu kuburan + satu sebab tanpa label → merah.

- **Klaim "ada bug akun tiba-tiba terverifikasi" DIJAWAB, dan bukan bug.**
  Pemilik repo mendaftar sendiri SEBELUM 31 Agustus dan tak pernah menerima
  surat, tapi akunnya terverifikasi. Sebabnya bisa ditunjuk barisnya: migrasi
  `0065_stormy_zarda.sql` (tayang 2026-07-22) dengan sengaja — dan berkomentar
  — menandai SEMUA akun yang sudah ada sebagai terverifikasi, supaya pemasangan
  verifikasi email tak mengunci akun lama. Akun itu ikut tersapu. Enam penulis
  `emailVerifiedAt` disapu (`users/routes.ts:209` owner membuat karyawan,
  `admin-tenants/routes.ts:138`, `auth/superadmin.ts:75`, seed/tamu,
  `verify-email`, backfill 0065): semuanya sengaja, tak satu pun jalur yang
  menandai akun tanpa keputusan. Dicatat supaya pembaca berikutnya tak membuka
  ulang pertanyaan yang sama.

- **Gerbang `janji-surat-tak-berlebih` ditulis ulang ke aturan satu jalan (14
  asersi)**: kalimat tunggu kode dilarang memuat `Jika` / `sudah aktif` /
  `Masuk` (batas kata — *"Masukkan kodenya"* bukan cabang, dan itu diuji);
  `PESAN_SUDAH_AKTIF` wajib ada; `SignupPage` wajib membaca `"token" in` dan
  memakainya; `AuthContext` wajib menyimpan sesi lewat `setSession`; tak satu
  layar pun boleh memuat *"Akun sudah aktif?"* atau `AJAKAN_MASUK`. **Bukti
  merah LIMA arah**, tiap-tiapnya dipulihkan byte-per-byte dari salinan:
  kalimat bercabang dipasang lagi → merah · tombol jalan kedua kembali → merah ·
  `SignupPage` berhenti membaca `"token" in` → merah · `AuthContext` berhenti
  menyimpan sesi → merah · peta label web membawa kuburan → merah.

- **Gerbang penuh pertama MERAH 1 — dan bukan oleh putaran ini.** §279 (dua
  kirim berpapasan) membaca kode `400 200`: kedua permintaan berjalan
  BERURUTAN, yang kedua ditolak saringan `siap`, bukan lengan 409 yang
  diuji. Kelas yang sama persis dengan §280d yang sudah distaging ulang
  2026-09-01. Diperlakukan sama: loop sampai 8 percobaan, berhenti begitu tak
  ada 400; tiap percobaan butuh faktur kiriman BARU, dan porsinya dihitung dari
  saldo cabang yang terbaca supaya kekurangannya ≤ 5 butir — staging ulang tak
  menghabiskan stok CK. **Harness lima kasus** membuktikan loopnya tak bisa
  menghijaukan penjaga yang rusak: berpapasan langsung → 1 percobaan · dua
  kali meleset → 3 percobaan, porsi naik · `200 200` (penjaga rusak) → TIDAK
  diulang dan asersinya merah · delapan kali meleset → premis terstaging
  merah · faktur kiriman tak lahir → berhenti, premis terbit merah. Dijalankan
  ulang dari seed segar: **3384 lolos, 0 gagal** — §279 berpapasan di
  percobaan pertama (kode `200 409`), jadi loopnya belum pernah dibutuhkan di
  jalan hijau; yang dibuktikan harness adalah perilakunya saat dibutuhkan.

- **Ponsel tak diubah putaran ini, dan alasannya diukur**: bentuk sesi bukan
  DTO di `types.ts`, jadi fikstur kunci ponsel tak bergeser;
  `register_page.dart` hanya membaca `dev_verify_url`, jadi balasan sesi cuma
  membawanya ke layar kode lama — perangkap ponsel TETAP ADA dan sudah antre
  sebagai putaran terpisah; antreannya kini menyebut `token` di balasan
  `/register` juga. Entri CHANGELOG-API 🟡 ditulis, distempel begitu tayang.

- **Batas yang ditulis jujur**: pemindai gerbangnya leksikal — ia menjaga
  bentuk (kata yang dilarang, pengenal yang wajib ada), bukan apakah
  pengalihannya benar-benar terjadi di browser; jalur HTTP-nya dijaga
  §284/§285, jalur browsernya belum punya uji e2e. Satu-satunya keadaan yang
  masih tak terwakili layar — akun aktif + password SALAH — memang tak boleh
  dibedakan dari email baru, dan pemegangnya cuma punya tautan kecil "Sudah
  punya akun? Masuk".

- **Gerbang penuh HIJAU**: typecheck bersih · `npm test` **218 berkas / 2659
  uji** · `verify-api.sh` **3384 lolos, 0 gagal** · `audit:invarian` 27/27 ·
  Playwright **13/13**. Dijalankan DUA kali dari seed segar: pada cabang kerja
  (`480e983`) dan pada hasil merge (`10b0882`, §279 berpapasan di percobaan
  pertama dua-duanya).

- **Tayang**: merge `10b0882` → `production`, CI #483 hijau (PR #215). Entri
  CHANGELOG-API distempel sesudahnya. Ponsel: `Production` sudah memuat
  `1e4365c` (ahead 0) — tak ada rilis ponsel yang menyertai.

---

## TERJAWAB: bug OTP bukan bug email — layar yang menjanjikan surat yang tak akan datang — web + server — 2026-09-01

- **Babak ketiga dari satu laporan, dan yang terakhir.** Instrumen babak kedua
  (riwayat percobaan kirim email) menjawabnya dalam **satu baris**, dibaca
  pemilik repo dari panelnya sendiri:

  ```
  <alamat>   verifikasi-email   Tidak dikirim   "Akun sudah terverifikasi — tak perlu kode lagi"
  ```

  **Tak ada bug pengiriman email.** Akunnya sudah terverifikasi — kemungkinan
  besar oleh kode yang berhasil semalam itu — dan server BENAR menolak
  menerbitkan kode baru. Penyedianya Gmail SMTP, pengirimnya alamat yang
  berbeda dari yang mendaftar; tak satu pun dari hipotesis email terbukti,
  dan tak perlu.

- **Yang salah layarnya, dan bentuknya lingkaran tanpa ujung.** Tiga layar
  MENGKLAIM satu hal yang tak selalu benar — *"kami sudah mengirim kode 6
  angka"*, *"Kode baru sudah dikirim"* — lalu mendorong orangnya ke layar
  tunggu; `/resend-verification` dari sana juga no-op untuk akun terverifikasi
  (`routes.ts:688`) sambil menampilkan kalimat yang sama. Tak satu pun layar
  menyebut jalan keluarnya: **Masuk**. Pemilik repo terjebak di situ dua hari.

- **Kendalanya nyata dan dihormati**: respons server sengaja identik
  byte-per-byte untuk email terdaftar dan tidak. Mengatakan *"akun ini sudah
  terverifikasi"* membuka kembali enumerasi. Server karena itu **tak diubah
  sedikit pun** (dipaku PASANGAN §285). Yang diubah: kalimat yang
  MENGASUMSIKAN satu kemungkinan diganti kalimat yang MENYEBUT keduanya —
  *"Jika alamat ini baru, kodenya sedang dikirim. Jika akunnya sudah aktif,
  tidak ada kode yang dikirim — langsung Masuk saja"* — dan tautan Masuk
  disejajarkan dengan tombol kode, bukan lagi abu-abu kecil di bawahnya.
  Satu rumah: `web/src/lib/pesan-verifikasi.ts`, sebab tiga salinan yang
  menyimpang sudah menggigit di jalur yang sama (hitung mundur `LoginPage`).

- **Dan satu celah lagi ditemukan di jalur yang sama, satu lapis lebih dalam:
  "Terkirim" yang belum tentu terkirim.** Jawaban penyedia dibuang di KEDUA
  cabang `kirimEmail`. `sendMail` nodemailer **resolve walau penerimanya
  ditolak** (`info.rejected`), jadi pada Gmail SMTP yang dipakai pemilik repo,
  penerima yang ditolak tercatat "Terkirim". Balasan Resend `{id}` juga
  dibuang, jadi baris "Terkirim" tak bisa dicocokkan ke pesan mana pun di
  catatan penyedia. Kini: `rejected` tak kosong → **gagal** dengan alamatnya
  disebut; `messageId`/`id` disimpan di kolom baru `pesan_id` dan tampil di
  panel — jembatan ke catatan penyedia (pada Gmail: pantulan *"Mail Delivery
  Subsystem"* di kotak masuk pengirim). **"Terkirim" kini berarti penyedianya
  menerima alamat itu**, bukan "panggilannya tak melempar".

- **Gerbang baru** `janji-surat-tak-berlebih.test.ts` (10 asersi): tiga layar
  peminta kode disapu mekanis — dilarang menulis klaim "sudah dikirim" inline,
  wajib mengimpor rumahnya, dan tiap kalimat di rumah itu wajib menyebut DUA
  kemungkinan (`Jika` ×2) dan jalan keluar `Masuk`; layar bukan-Masuk wajib
  menautkan `/login`; `penerimaDitolak` diuji murni (dua bentuk bercampur,
  kosong, dan alamat yang tak boleh jadi `[object Object]`). **Bukti merah
  tiga arah** + **§285 merah** saat pintu `akun_terverifikasi` berhenti
  mencatat.

- **Detektornya salah sekali lagi, dan lagi-lagi diperbaiki bukan
  didaftarkan**: aturan "wajib menautkan /login" menuduh `LoginPage` — yang
  jelas tak perlu menautkan dirinya sendiri. Aturannya ditulis ulang menurut
  NIATNYA (orang yang terjebak harus punya jalan keluar yang terlihat), dan
  halaman Masuk memenuhinya dengan cara paling sederhana: ia sudah di sana.

- **§285** mereproduksi keadaan pemilik repo PERSIS lewat HTTP — daftar,
  verifikasi lewat rutenya (bukan `UPDATE users`), daftar ulang — dan memaku
  tiga hal: barisnya `tak_dicoba / akun_terverifikasi`, balasannya identik
  dengan email yang belum pernah ada, dan `forgot-password` untuk akun itu
  MEMANG mencoba mengirim (satu-satunya jalur surat yang tersisa baginya).

- **Merah palsu ketiga hari ini, buatanku sendiri, dan dicatat**: aset
  ber-hash memerah karena aku mem-build web SESUDAH server menyala — server
  melayani `index.html` lama yang menunjuk aset yang sudah tak ada. CI
  membangun web SEBELUM menyalakan server; urutan prosedur lokalku yang salah,
  dan prosedur di rencana diperbaiki: **build dulu, baru server**.

- **Batas yang ditulis jujur**:
  - pemindai gerbangnya leksikal — ia menjaga BENTUK kalimat (dua `Jika`, kata
    `Masuk`), bukan mutunya; mutu dijaga mata manusia;
  - `pesan_id` jembatan, bukan jawaban: nasib sesudah "diterima penyedia"
    (delivered/bounced) tetap hanya terbaca di catatan penyedia;
  - **ponsel** punya perangkap layar yang sama DAN masih pada alur token lama;
    digarap terpisah atas keputusan pemilik repo, dan kalimat baru ini ikut
    dipasang di sana saat itu.

- **Gerbang penuh HIJAU**: typecheck bersih · `npm test` **218 berkas / 2651
  uji** · `verify-api.sh` **3380 lolos, 0 gagal** · `audit:invarian` 27/27 ·
  Playwright 13/13.

---

## Surat yang tak pernah DICOBA dikirim — server + web — 2026-09-01 — **LAPORAN BUG NYATA (lanjutan)**

- **Putaran sebelumnya menjawab pertanyaan yang salah, dan itu ketahuan dari
  laporan berikutnya.** Perbaikan pagi ini membuat KEGAGALAN kirim berbunyi
  (`kirimEmailDiam`, `email_keadaan`, temuan `email_gagal_kirim`). Ia bekerja.
  Lalu pemilik repo melapor lagi:

  | pengamatan | artinya |
  |---|---|
  | "Kirim Test Email" ke alamat X **sampai** | penyedia, `from`, kotak masuk X sehat |
  | kode OTP ke X **tak sampai**, **tak ada di spam** | bukan penyaringan, bukan alamat |
  | build baru **sudah hidup** | instrumennya aktif |
  | panel **tak menampilkan** `email_gagal_kirim` | **tak ada kiriman yang GAGAL** |

  Yang tersisa hanya satu kemungkinan: **suratnya tak pernah dicoba dikirim.**

- **Panel yang diam punya DUA tafsir yang berlawanan** — "semua berhasil" dan
  "tak ada yang pernah dicoba" — dan tak ada cara memilih di antaranya. Itulah
  kebutaan yang membuat diagnosis hari ini makan satu putaran penuh dan
  berakhir pada dugaan, bukan bacaan. Aturan barunya: **alat yang cuma bisa
  melaporkan KEGAGALAN tak bisa membedakan "berhasil" dari "tak pernah
  terjadi".**

- **Populasi terukur: TUJUH pintu** di `auth/routes.ts` yang membalas 200
  *"kami telah mengirim KODE verifikasi 6 digit. Cek email Anda"* tanpa pernah
  menyentuh penyedia email, dan **ketujuhnya meninggalkan NOL jejak**:
  `/register` pada email yang sudah ada · `/register` yang kalah balapan
  `users_email_unique` · jarak 120 detik di `kirimKodeVerifikasi` · dan empat
  cabang `/resend-verification` (`!user`, `deletedAt`, `!isActive`,
  `emailVerifiedAt`). Yang terakhir paling mahal: sekali `emailVerifiedAt`
  terisi, alamat itu **permanen diam selamanya** — tak ada rute yang
  mengosongkannya. Sebagai pembanding, `/forgot-password` cuma punya SATU.

- **Terukur lewat HTTP + Postgres sungguhan**, satu alamat, dua pendaftaran
  berurutan:

  | | daftar #1 (email baru) | daftar #2 (email sama) |
  |---|---|---|
  | kode terbit | **203623** | **tak ada** |
  | baris token di DB | 2 | **tetap 2** |
  | balasan HTTP | *"…Cek email Anda"* | **identik byte-per-byte** |
  | jejak yang ditinggalkan | 1 baris log | **NOL** |

- **Tindak, tiga bagian**:
  1. **Instrumen** — tabel cincin `email_percobaan` (200 baris terakhir):
     waktu · konteks · tujuan · hasil (`terkirim`/`gagal`/**`tak_dicoba`**) ·
     sebab · penyedia · pesan. Ditulis dari SATU tempat (`mail/service.ts`),
     dibaca lewat `GET /admin/sistem`, dirender di panel super admin sebagai
     **catatan, bukan temuan** — baris "tidak dikirim" yang sah adalah keadaan
     normal, dan mewarnainya merah akan membuat panel diabaikan. Alamat tujuan
     disimpan UTUH atas keputusan pemilik repo.
  2. **Perangkapnya dihapus** — `/register` pada akun yang **aktif dan belum
     terverifikasi** kini MENGIRIM kodenya. Badan responsnya tak berubah
     sedikit pun (`dev` sengaja tak diisi di cabang itu), jadi enumerasi tetap
     tertutup; penjaganya juga tak berubah (`batasRegister` 20/IP/jam + jarak
     120 detik per akun), dan `/resend-verification` sudah menawarkan kemampuan
     yang sama persis kepada siapa pun yang tahu alamatnya.
  3. **Pengerasan** — surat kini punya versi TEKS-POLOS, dan cabang Resend
     meneruskan `text` (sebelumnya membuangnya diam-diam, jadi setiap surat
     yang keluar adalah surat HTML-saja). Web `LoginPage` mendapat hitung
     mundur kirim ulang yang sudah lama dimiliki `VerifikasiEmailPage` —
     rumahnya kini satu, `lib/jeda-verifikasi.ts`.

- **Ukuran sesudah**, dibaca lewat balasan `GET /admin/sistem` sendiri
  (Aturan 6, bukan `SELECT`):

  ```
  reset-password    tak_dicoba  email_tak_dikenal      bukan.siapa.siapa@contoh.id
  verifikasi-email  tak_dicoba  akun_terverifikasi     terahokiindonesia@gmail.com
  verifikasi-email  tak_dicoba  email_tak_dikenal      tidak.ada.sama.sekali@contoh.id
  verifikasi-email  tak_dicoba  penyedia_belum_diatur  jalur1c…@contoh.id   ← daftar #2
  verifikasi-email  tak_dicoba  penyedia_belum_diatur  jalur1c…@contoh.id   ← daftar #1
  ```

  Dua baris untuk alamat yang sama membuktikan **kedua pendaftaran mencoba
  mengirim** — yang kedua itulah perbaikannya.

- **Gerbang baru** `otp-senyap-tercatat.test.ts` (12 asersi): tiap **lengan
  rantai `if/else` yang salah satu lengannya MENGIRIM** wajib berakhir pada
  salah satu dari dua hal — mengirim, atau `catatTakDicoba` dengan sebab dari
  serikat `SebabTakDicoba`; jumlah situsnya dipaku (12); tiap sebab beralasan,
  dua arah, tanpa entri kuburan; dan ketiga hasil (`terkirim`/`gagal`/
  `tak_dicoba`) wajib benar-benar ditulis.

- **Detektornya salah sekali, dan salahnya diperbaiki bukan didaftarkan.**
  Versi pertama menyaring cabang berdasarkan pengenal (`user`, `existing`,
  `deletedAt`, …) dan langsung menuduh **LIMA** cabang yang sah — penjaga
  login, penjaga `/verify-email`, penjaga `/reset-password` — yang semuanya tak
  ada urusannya dengan surat. Penyaringnya diganti ke bentuk yang tepat:
  **rantai yang salah satu lengannya mengirim**. Tuduhan palsu lebih merusak
  gerbang daripada diam; ia mengajari orang mendaftarkan pengecualian sampai
  daftarnya berhenti berarti.

- **Gerbangnya menemukan kosakata mati milikku sendiri**: `email_sudah_terdaftar`
  masuk ke serikat `SebabTakDicoba` sebelum sempat dipakai — sisa dari asumsi
  bahwa mendaftar ulang memang tak boleh mengirim. Asumsi itu justru
  perangkapnya. Dicabut, dan sebabnya ditulis di tempatnya.

- **Bukti merah, empat arah**: satu pintu berhenti mencatat → 2 asersi merah ·
  `/register` kembali tak mengirim → jumlah situs bergeser, merah ·
  `hasil: "terkirim"` berhenti ditulis → merah · dan di `verify-api`,
  perbaikannya dicabut → **§284 merah 2 asersi**.

- **Satu asersi §284 sempat HIJAU di jalan merahnya sendiri** dan itu diperbaiki,
  bukan dibiarkan: "barisnya menyebut percobaan" tetap benar tanpa perbaikan,
  sebab baris terbaru masih milik pendaftaran PERTAMA. Kini ia menuntut
  barisnya **BARU** juga. *Hijau yang benar tanpa menguji apa pun adalah bentuk
  hijau yang paling mahal.*

- **§284 seluruhnya lewat HTTP, tanpa satu sentuhan pun ke psql** — versi
  pertamanya memundurkan `created_at` lewat basis data untuk melewati penjaga
  jarak, dan itu melanggar sifat yang §252 tuliskan sebagai kelebihan skrip itu.
  Diganti dengan cara yang lebih jujur DAN lebih realistis: **kodenya dibunuh
  dengan lima tebakan salah**, persis seperti orang yang salah ketik lima kali
  lalu mendaftar ulang. Kuota `batasRegister` dihindari lewat alamat sendiri
  (`X-Forwarded-For`), sebab kepala berkas itu sendiri mencatat ia berjalan
  tepat di tepi 20/IP/jam.

- **Batas yang ditulis jujur**:
  - pemindai gerbangnya **leksikal**, bukan pengurai TypeScript — ia hanya
    melihat rantai `if/else` yang salah satu lengannya memanggil pengirim.
    Keputusan yang disembunyikan di dalam pembantu tak terlihat olehnya; itu
    sebabnya jumlah situsnya ikut dipaku;
  - `email_percobaan` **cincin 200 baris** — ia menjawab "beberapa jam
    terakhir", bukan arsip;
  - **penyebab pasti di produksi tetap belum dikonfirmasi.** Putaran ini
    menghapus perangkap yang paling cocok dengan buktinya DAN memasang alat
    yang membuat jawabannya terbaca dalam sekali lihat bila ternyata bukan itu.
    Itu dinyatakan apa adanya.

- **Gerbang penuh HIJAU**: typecheck bersih · `npm test` **217 berkas / 2641
  uji** · `verify-api.sh` **3371 lolos, 0 gagal** · `audit:invarian` 27/27 ·
  Playwright 13/13.

---

## Kegagalan kirim email yang tak terdengar di mana pun — server — 2026-09-01 — **LAPORAN BUG NYATA**

- **Bukan dari sapuan.** Pemilik repo melaporkannya di tengah putaran lain:
  *"user tidak lagi menerima email otp, padahal semalam berhasil 1×"*. Entri
  ini dicatat apa adanya sebagai vena karena bentuknya persis bentuk yang
  dicari berkas ini — dan karena gerbang yang seharusnya menangkapnya SUDAH
  ADA, lalu meloloskannya.

- **Terukur lewat HTTP + Postgres sungguhan**, satu akun baru, penyedia email
  yang menolak:

  | langkah | jawaban | kenyataan |
  |---|---|---|
  | `POST /auth/register` | `200 "…kami telah mengirim KODE verifikasi 6 digit. Cek email Anda"` | surat GAGAL terkirim |
  | `POST /auth/resend-verification` | `200 {ok:true}` | tak ada kiriman sama sekali (tertahan jeda 2 menit) |
  | baris `email_verification_tokens` | **2** | sistem yakin kodenya terbit |
  | baris log yang menyebut sebabnya | **0** | — |

  Nol. Penyedianya menolak dan tak ada satu pun tempat di sistem — respons,
  log, maupun panel super admin — yang bisa memberi tahu pemiliknya kenapa.
  Yang bisa dilakukannya cuma menebak, dan itulah yang sedang terjadi saat
  laporan ini masuk.

- **Populasinya: 5 pemanggil `kirimEmail` di luar rumahnya.** Empat menelan
  galatnya (`verifikasi email`, `reset password`, `undangan karyawan`,
  `peringatan cadangan`), satu menampilkannya (`POST /admin/sistem/smtp/test-email`,
  400 berpesan). Dari keempat penelan itu, **tiga benar-benar bisu** — tanpa
  log, tanpa penghitung, tanpa apa pun; yang keempat (peringatan cadangan)
  sudah menulis `console.error` sendiri. **Idiomnya sudah ada di repo ini,
  cuma tak dipakai di tiga pintu yang paling mahal.**

- **KENAPA GERBANG YANG ADA MELOLOSKANNYA — ini temuan sebenarnya.**
  `galat-ditelan-beralasan.test.ts` sudah menghitung ketiga situs itu, dan
  mendaftarkannya: `modules/auth/routes.ts` 2 · `modules/users/routes.ts` 1.
  Ia lolos karena gerbang itu menuntut **alasan yang tertulis**, dan alasannya
  memang tertulis rapi:

  > `catch { /* best-effort: jangan gagalkan permintaan bila email error */ }`

  Alasan itu **benar**. Yang tak pernah dipisahkan darinya adalah keputusan
  KEDUA yang menempel diam-diam: *"…dan karena itu tak usah memberi tahu siapa
  pun"*. Catatan kejujuran gerbang itu sendiri sudah menuliskan batas ini —
  *"yang dijaga berkas ini adalah adanya KEPUTUSAN yang tertulis, bukan
  mutunya"* — dan hari ini batas itu menagih ongkosnya.

  **Aturan barunya, dinamai:** *alasan tertulis ≠ kabar tersampaikan.*

- **Kenapa galatnya TIDAK dipulangkan ke peminta.** Tiga dari lima pintu itu
  (`/register`, `/resend-verification`, `/forgot-password`) sengaja menjawab
  byte-per-byte sama untuk email yang terdaftar dan yang tidak; surat hanya
  dikirim untuk akun yang ADA dan belum terverifikasi, jadi penanda
  `email_gagal` di badan respons akan menjawab persis pertanyaan yang rute-rute
  itu susah payah tutup. Arah keluar kabarnya memang harus **ke operator**.
  Itu keputusan, bukan kelalaian, dan ditulis di kodenya.

- **Tindak**:
  - satu rumah bersama `kirimEmailDiam(pesan, konteks)` — log ber-konteks +
    hasil boolean; keempat pintu memakainya, termasuk peringatan cadangan yang
    dulu punya salinan `try/catch`-nya sendiri;
  - pencatatan hasil kirim dipasang **di `kirimEmail`**, satu pintu yang
    dilewati SEMUA pengiriman — bukan di masing-masing pemanggil, supaya
    pemanggil berikutnya tak bisa lupa;
  - tabel `email_keadaan` (satu baris): kapan sukses terakhir, kapan & kenapa
    gagal terakhir, dan **kegagalan beruntun**. Di database, bukan di memori:
    kegagalan email ditemukan berhari-hari kemudian, oleh orang yang membuka
    panel karena ada yang mengeluh — dan deploy menghapus ingatan proses;
  - temuan panel `email_gagal_kirim` (KRITIS) di `periksaSetelan`, **memuat
    pesan penyedianya apa adanya**. Temuan yang cuma berkata "email gagal"
    mengembalikan persis tebak-tebakan yang hendak dihapusnya.

- **Ukuran sesudah**, jalur yang sama, penyedia yang sama-sama menolak:

  ```
  log server   EMAIL GAGAL [verifikasi-email] ke <alamat>: Resend gagal (403): …
  email_keadaan  gagal_beruntun=1  gagal_penyedia=resend  gagal_pesan="Resend gagal (403): …"
  panel          KRITIS · email_gagal_kirim · "Pengiriman email GAGAL"
  ```

  **PASANGAN** (jalur sah tetap bekerja): satu kiriman berhasil lewat SMTP
  sungguhan ke sink lokal → surat mendarat (`Subject: Kode verifikasi
  Terakasir`), `gagal_beruntun` **1 → 0**, temuan panel **hilang** (5 → 4
  temuan). Diukur, bukan diasumsikan.

- **Gerbang baru** `email-gagal-terdengar.test.ts` (14 asersi): registri siapa
  boleh memanggil `kirimEmail` telanjang **beserta alasannya**, larangan entri
  kuburan di registri itu, keharusan tiap pemakai `kirimEmailDiam` menyebut
  konteksnya sebagai literal kebab-case, tiap pintu memakai konteks yang
  menamai dirinya, dan semantik `temuanEmailGagal` (termasuk: baris warisan
  berkolom kosong tak boleh jadi `"null"` di layar).

- **Bukti merah, tiga arah**: (1) satu pintu dikembalikan ke `kirimEmail`
  telanjang → 3 asersi merah; (2) konteks diganti variabel → 2 merah;
  (3) `temuanEmailGagal` dilumpuhkan → 6 merah. Instrumennya sendiri diuji
  (Aturan 7): deklarasi fungsinya tak boleh terhitung sebagai panggilan, prosa
  yang mengutip bentuk terlarang tak boleh menuduh, koma di dalam objek pesan
  tak boleh memecah argumen.

- **Perbaikan ini nyaris melucuti gerbang LAIN, diam-diam.** Aturan
  `email-berbatas` di `penjaga-semua-pintu.test.ts` mencari `await kirimEmail(`;
  begitu empat pintu berpindah ke `kirimEmailDiam`, keempatnya lenyap dari
  sapuannya sekaligus dan berkas itu tetap **hijau** sambil berhenti menjaga
  apa pun. Polanya dilebarkan jadi `await kirimEmail(?:Diam)?\(` dan rumah
  bersamanya didaftarkan beralasan. Kelas yang sama sudah punya namanya di
  sesi ini: *alat ukur yang menumpang pada bentuk kode lain bisa berubah jadi
  hiasan tanpa yang memakainya tahu.*

- **Batas yang ditulis jujur**:
  - ini **bukan antrean kirim ulang**. Surat yang gagal tetap hilang; yang
    dijamin cuma bahwa kegagalannya **berbunyi**;
  - `email_keadaan` satu baris untuk seluruh pemasangan — ia tak bisa
    membedakan "Resend menolak alamat tenant A" dari "SMTP tenant B mati",
    karena penyedianya memang setelan platform, bukan setelan tenant;
  - penyebab sebenarnya di produksi pemilik repo **belum terlihat dari sini**
    dan sengaja tidak ditebak di ledger ini. Yang dikirim putaran ini adalah
    alat yang membuatnya bisa dibaca dalam sekali lihat — plus jalan keluar
    yang sudah ada hari ini tanpa deploy: tombol **Kirim Test Email** di panel
    super admin, yang memang menampilkan galat penyedianya apa adanya.

- **Gerbang penuh HIJAU**: typecheck bersih · `npm test` 216 berkas / 2625 uji ·
  `verify-api.sh` **3362 lolos, 0 gagal** · `audit:invarian` 27/27 ·
  Playwright 13/13.

  Satu merah palsu terjadi di tengah dan dicatat supaya tak terulang: server
  lama dari pengukuran (berkunci Resend bogus) masih memegang port 3000, jadi
  server baru mati saat bind dan **41 asersi `verify-api` merah** karena jalur
  `dev_verify_kode` memang mustahil hijau di server itu. Bukan kode yang salah,
  melainkan premis yang tak diperiksa — `ss` tak ada di PATH shell itu,
  sehingga perintah pembunuh prosesnya **gagal tanpa suara**. Bentuk yang sama
  dengan vena yang sedang digarap, di alat kerjaku sendiri.

- **DAN MERAH PALSU KEDUA, di gerbang hasil-merge saat rilisnya** — kali ini
  bukan salah prosedurku melainkan cacat instrumennya, jadi dibayar sebagai
  perbaikan: `PASANGAN §280: yang kalah tetap dibalas 409` memerah dengan
  `kode: 200 400`. Blok itu menembak dua `POST /shift/tutup` latar SEKALI lalu
  langsung menilai; di mesin senggang ia memang berlomba — **terukur 12 dari 12
  putaran menghasilkan `200 409`** — tapi di tengah suite penuh penjadwalnya
  sesekali menjalankan keduanya BERURUTAN, dan yang kedua tertahan
  `shiftTerbuka()` lalu dibalas `400`. Komentar di blok itu sendiri sudah
  menuliskan bahwa `400` adalah "jawaban yang benar, tapi bukan jalur yang
  sedang dijaga" — ia cuma tak pernah menindaklanjutinya.

  Perbaikannya: balapannya **distaging ulang sampai benar-benar berpapasan**
  (maks 8 percobaan), dan jumlah percobaannya IKUT DINILAI sebagai premis —
  supaya pengulangan itu tak bisa diam-diam menelan kegagalan yang sesungguhnya.
  Yang membuatnya aman: pengulangan **hanya** dipicu `400`. Diuji atas empat
  keadaan palsu — `200 409` hijau di percobaan 1 · `200 400` **merah sebagai
  premis** sesudah 8 percobaan · `200 500` dan `200 200` **merah di percobaan
  1**, tak pernah diulang. Pelanggaran sungguhan tak bisa diputar sampai hijau.

  Kelasnya sudah bernama di sesi ini: *gerbang yang menuduh karena kalender /
  baris / penjadwal berpindah mengajari pembacanya mengabaikan gerbang.* Ini
  kejadian ketiga, dan yang pertama yang penyebabnya bukan kalender atau nomor
  baris melainkan **CPU yang sibuk**.

---

## Gerbang yang tak bisa dijalankan — ponsel — 2026-09-01

- **Yang menghalangi bukan gerbang merah, melainkan IZIN.** Tiga commit
  menumpuk di `claude` repo ponsel tanpa pernah sekali pun dilewati gerbang,
  dan tak ada jalan membukanya dari lingkungan tempat commit-commit itu lahir:
  - Flutter SDK tak terpasang di sini — `flutter analyze`/`flutter test`
    mustahil dijalankan lokal;
  - `workflow_dispatch` dijawab **403 "Resource not accessible by
    integration"**. Diagnosisnya bisa ditunjuk, bukan ditebak: **push berhasil**
    (`contents: write` ada) dan **daftar run terbaca** (`actions: read` ada);
    yang ditolak hanya `dispatches` — jadi yang kurang persis `actions: write`.

- **Yang membukanya bukan menambah izin, melainkan MEMINDAHKAN PEMICUNYA.**
  Daftar izin sebuah GitHub App ditentukan penerbitnya, bukan pemasangnya —
  jadi "beri izin Actions" belum tentu ada tombolnya. Pemicu push, sebaliknya,
  ada di dalam repo itu sendiri: `branches: [Production, claude]`.

- **DAN INI MEMBALIK SEBAGIAN KESEPAKATAN**, jadi ditulis di kepala berkasnya
  bukan diselundupkan. `Production`-saja bukan kelalaian: `ci.yml` repo web
  menuliskan sebabnya — *"atas permintaan pemilik repo untuk menekan pemakaian
  menit Actions"*. Yang berubah bukan pendapat soal biaya, melainkan satu fakta
  yang **tak berlaku di repo web**: suite web bisa dijalankan lokal, suite
  ponsel tidak. Diputuskan pemiliknya, dengan biayanya disebut lebih dulu (±3
  menit Actions per push).

- **`paths-ignore` SENGAJA TIDAK DIPASANG.** Ia akan menghemat menit pada push
  docs-saja, tapi `on.push` hanya punya SATU blok — saringan itu ikut melewati
  gerbang pada `Production` juga. Gerbang yang bisa dilewati diam-diam bukan
  penghematan.

- **PREMIS RUN DIPERIKSA SEBELUM WARNANYA DIPERCAYA**, dan itu bukan
  kerewelan: "hijau" bisa saja run `Production` lama yang tak menguji apa pun.
  Terukur pada run **#4**: `event=push` · `head_branch=claude` ·
  `head_sha=846a44d` — sama persis dengan commit yang barusan didorong. Push
  yang MENAMBAHKAN pemicunya itulah yang memicunya (GitHub membaca berkas
  workflow dari commit yang didorong).

- **BATAS YANG DIAKUI:**
  - Gerbangnya kini berjalan, tapi ia tetap **tak bisa dijalankan dari mesin
    ini** — yang berubah cuma siapa yang memicunya. Perubahan ponsel apa pun
    dari sesi seperti ini tetap harus menunggu CI, bukan diukur lokal.
  - Tak ada gerbang yang menjaga pemicu ini tetap ada. Repo ponsel tak punya
    uji atas berkas CI-nya sendiri; menghapus `claude` dari daftar cabang akan
    mengembalikan keadaan lama tanpa satu pun asersi berubah warna.
  - Ia menggerbangi `claude`, bukan cabang kerja lain. `workflow_dispatch`
    tetap satu-satunya jalan untuk cabang selain kedua itu — dan jalan itu
    masih tertutup bagi sesi ini.

- **DAN GERBANGNYA MENGGIGIT PADA JALAN PERTAMANYA.** Run #4 merah: **598
  lolos, 1 gagal** — dan yang menuduh adalah gerbang kontrak repo ponsel
  sendiri:

  ```
  ❌ kunci_kontrak_server_test.dart: kunci kontrak yang tak disentuh wajib tercatat
     Expected: empty
       Actual: ['riwayat_terpotong']
  ```

  **Tuduhannya benar, dan sasarannya aku.** Fikstur kunci kontrak kusegarkan
  sehari sebelumnya dengan perintah yang dicetak gerbang server — tapi perintah
  itu hanya **MENYEGARKAN FIKSTUR**; memutuskan nasib kunci barunya adalah
  langkah KEDUA, dan langkah itu terlewat. Persis bentuk yang uji itu ada untuk
  mencegah: medan baru lahir di `types.ts` tanpa satu pihak pun wajib
  memutuskan *"ponsel ikut membaca ini atau tidak"*.

  Tiga commit ponsel menumpuk berminggu-minggu tanpa gerbang; **begitu
  gerbangnya menyala, ia langsung menemukan sesuatu.** Itu bukan kebetulan —
  itu ukuran berapa lama sebuah pintu dibiarkan terbuka.

- **Diputuskan, bukan didiamkan**: `riwayat_terpotong` didaftarkan di
  `kunci-belum-dibaca.txt` dengan **kelompok dan alasannya sendiri**, bukan
  ditumpangkan ke `rows_terpotong` di atasnya — sebab bedanya penting. Kartu
  supplier memang tak punya layar di ponsel; laporan Lama Pesanan **punya**
  (`durasi_detik`, `lewat_target`, `target_detik`, `bertarget` semuanya sudah
  dibaca `lib/`, dipaku SENTINEL di uji yang sama). Jadi ini bukan fitur yang
  belum ada, melainkan **satu kalimat yang belum dikatakan**.

- **Hijau, lalu tayang.** Run **#5** (`event=push`, `head_sha=4942376`):
  `flutter analyze` bersih · `flutter test` **599 lolos**. Merge `claude` →
  `Production` (`16aa8b4`), pohon hasil merge **identik** dengan yang
  digerbangi (`git diff` kosong). **Rilis ponsel PERTAMA yang gerbangnya
  berjalan SEBELUM merge**, bukan sesudah mendarat di `Production`.

- **Berkas:** `kakarut-mobile/.github/workflows/ci.yml` (`846a44d`) ·
  `test/fikstur/kunci-belum-dibaca.txt` (`4942376`). Repo web **tak disentuh** —
  `ci.yml`-nya tak pernah menyebut ponsel, jadi tak ada kalimatnya yang jadi
  salah.

---

## Kunci daftar-beralasan yang bergeser — server (uji) — 2026-09-01 — dibayar KEEMPAT kalinya, lalu DIJAGA

- **Venanya lahir dari rilis kemarin.** Gerbang hasil-merge memerah di tengah
  rilis, dan salah dua penyebabnya bukan produk melainkan `DIPILAH` di
  `query-punya-rumah` yang berkunci `berkas:NOMOR BARIS`: vena pemotongan
  menambah komentar di atas dua situs, entrinya bergeser **26 dan 10 baris**,
  dan dua asersi memerah tanpa satu pun perilaku berubah. Nomornya kuperbarui
  dan **kudaftarkan sebagai vena** — ini pembayarannya.

- **POPULASI: 39 daftar adjudikasi tangan** di `apps/server/test`
  (`DIPILAH_TANGAN`, `TERBUKA_SENGAJA`, `DIKECUALIKAN`, `BELUM_TERBUKTI`, …).
  Disapu mekanis lewat pohon sintaks, **dua bentuk** — objek harfiah
  (`Record<string, …>`) dan pasangan larik (`new Map([[k, v]])`) — sebab repo
  ini memakai keduanya, dan menyapu satu saja akan menyatakan berkas yang
  justru membusuk tak punya kunci sama sekali. **327 kunci harfiah** terbaca di
  **34 berkas**.

- **TEMUAN: 1 daftar / 4 entri** berkunci nomor baris — seluruhnya
  `query-punya-rumah.test.ts`. Plus **1 komentar** di `bentuk-balasan.test.ts`
  yang *meresepkan* `berkas:baris` untuk daftar yang hari ini masih kosong —
  undangan bagi entri berikutnya untuk lahir busuk.

- **DAN INI TANDA TANGANNYA, LAGI.** Aturannya sudah ditulis di **empat**
  berkas, dan sudah dibayar **tiga** kali sebelum hari ini:
  - `pelaku.test.ts:63` — *"versi pertama memakai nomor baris dan langsung
    membusuk: menambahkan satu komentar…"*
  - `util/urutan.ts:126` — *"Putaran 27 membayar pembusukan kunci bernomor
    baris untuk KEDUA kalinya (satu baris `import` menggeser 1228 jadi 1229 dan
    dua gerbang memerah)."*
  - `util/mutasi-web.ts:105` — *"sudah dibayar dua kali… Sekali cukup."*
  - `util/kolom-numerik.ts:46` — *"Kuncinya bukan nomor baris."*

  Empat berkas menuliskan aturannya. **Nol yang menegakkannya.** Aturannya
  sudah dipikirkan, ditulis, dikomentari panjang — penjaganya dipasang di
  beberapa pintu, dan pintu lain ke keadaan yang sama dibiarkan terbuka.

- **PERBAIKAN.** `DIPILAH` dikunci `berkas:NAMA PARAMETER`
  (`modules/stok/routes.ts:hari`), kunci yang menempel pada HAL yang
  diadjudikasi: ia berpindah hanya bila parameternya sendiri berganti nama —
  dan itu memang saat keputusan lama layak ditinjau ulang. Keunikannya
  **dipaku premis tersendiri**: kunci stabil yang tak unik adalah cacat kedua,
  satu entri diam-diam memaafkan dua bacaan.

- **GERBANG BARU** `kunci-daftar-tak-bergeser.test.ts` — melarang BENTUK
  `…​.(ts|tsx|dart|sh|md):<angka>` sebagai kunci daftar, di seluruh
  `apps/server/test`.

- **DETEKTOR DIBUKTIKAN BISA MENUDUH, dua arah:**
  - atas **kode sungguhan**, sebelum diperbaiki: ia menuduh tepat **4 situs**,
    yang persis sama dengan yang membusuk kemarin;
  - atas **sumber sintetis**: kedua bentuk (objek & Map) tertuduh, dan kunci
    stabil di sebelahnya TIDAK ikut tertuduh.

- **BUKTI MERAH + PASANGAN — dan pasangannya yang paling menentukan:**
  1. satu kunci dikembalikan ke nomor baris → gerbang baru merah menyebut
     berkas, baris, dan kuncinya;
  2. **satu komentar disisipkan di atas situs `hari`** — penyebab persis yang
     membusukkannya empat kali. Dengan kunci LAMA: `query-punya-rumah` merah
     **2 asersi** ("tanpa batas yang terlihat" + "sudah tak ada situsnya").
     Dengan kunci BARU: **12/12 hijau**. Itu perbedaan yang sedang dibeli.

- **BATAS YANG DIAKUI, ditulis jujur:**
  - Yang disapu **kunci HARFIAH** saja. Kunci yang dirakit saat berjalan
    (`` `${berkas}:${baris}` ``) tak terlihat — dan bentuk itu ADA di repo ini
    (`urutan.ts`, `mutasi-web.ts`, `bendera-hapus.ts` sudah memakai medan
    `kunci` yang stabil justru karena pernah membusuk). Yang menahannya tetap
    keputusan penulisnya, bukan gerbang ini.
  - Lingkupnya `apps/server/test`, bukan uji ponsel/web di repo lain.
  - Ia melarang **bentuk** `…:<angka>`, bukan menjamin kunci penggantinya
    bagus. Kunci stabil yang tak unik adalah cacat lain, dan tiap daftar wajib
    memaku keunikannya sendiri — `query-punya-rumah` kini melakukannya.

- **Berkas:** `test/kunci-daftar-tak-bergeser.test.ts` (baru) ·
  `test/query-punya-rumah.test.ts` (kunci + premis keunikan) ·
  `test/bentuk-balasan.test.ts` (bentuk kunci diperbaiki sebelum entri
  pertamanya lahir). **Tak ada kode produk yang disentuh.**

- **Gerbang:** typecheck bersih · `npm test` **2.611** (215 berkas) · build web
  · `verify-api.sh` **3.362 lolos / 0 gagal** (DB segar) · cakupan rute **274
  cocok** · `audit:invarian` **27/27** · Playwright **13/13**.

---

## RILIS — dan prosedur hasil-merge yang membayar dirinya sendiri, lagi — 2026-09-01

- **Tayang di `production`**: `b6432f7`, memuat tiga putaran (selisih susulan
  bisa diputuskan · dua utang balapan terakhir · delapan pemotongan senyap
  terakhir). **CI run #479 hijau seluruhnya** — `quality`, `verify-api`, dan
  `deploy` (image GHCR terbangun, redeploy Dokploy terpicu 02:16:31Z).

- **PROSEDURNYA MEMBAYAR DIRINYA SENDIRI, DAN INI KALI KEDUA.** `ci.yml`
  menuntut seluruh suite dijalankan atas HASIL MERGE sebelum didorong. Hasil
  merge itu **identik isinya** dengan `claude` (`git diff` kosong), jadi yang
  merah bukan kegagalan gabungan — melainkan **kalender**. Rilis pagi ini hijau
  pada 2026-08-31; jalan berikutnya pukul 08:56 WIB tanggal **2026-09-01**, dan
  **sembilan asersi absensi memerah**. Didorong tanpa langkah itu, CI di
  `production` yang akan merah dan deploy tertahan.

- **Tiga blok, satu keluarga**: asersi yang benar hanya bila hari ini jatuh di
  tempat tertentu pada kalender.
  - **§143 cuti** — tanggal dipatok 05/06. Mitigasi yang sudah ada hanya
    menutup sisi "hari ini KEBETULAN tanggal 5/6"; sisi sebaliknya terbuka —
    pada tanggal 1, tanggal 05/06 ada di **masa depan**, dan rekap sengaja
    berhenti menilai di hari ini. `cuti` 0, bukan 2.
  - **§200 shift malam** — skenarionya dimundurkan supaya kedua capnya sudah
    lewat, dan pada tanggal 1 sebelum pukul 11 kemunduran itu **menyeberangi
    pergantian bulan**. Kasir malamnya dibuat baru, jadi keanggotaannya
    bertanggal hari ini — dan rekap bulan lalu menyaringnya keluar **dengan
    benar** (`bergabung <= akhir bulan`). Enam asersi menuduh produk yang
    justru bekerja.
  - **§143 saringan aktif/arsip** — karyawan ujinya juga dibuat hari ini, ikut
    tersaring saat blok cuti pindah ke bulan lalu.

- **Yang diperbaiki BUKAN dilonggarkan.** Aturannya ditulis sebagai SYARAT,
  bukan tanggal ajaib: ketiga tanggal cuti wajib sudah lewat, bukan hari ini,
  satu bulan, saling eksklusif — dari tanggal 10 ke atas bulan berjalan,
  sebelum itu bulan lalu. Dua premis baru memakukannya. Di §200, pada
  hari-hari penyeberangan yang diuji **bukan nihil** melainkan aturan
  penyaringnya sendiri: barisnya tak ada di bulan lalu **dan** ada di bulan
  berjalan. Sisa seksi — semantik cap lintas-hari, INTI-nya — jalan tiap hari.

- **Dua asersi yang MEMANG bicara bulan berjalan** ("tanggal masa depan tak
  dinilai", "bulan tak valid jatuh ke bulan berjalan") kini mengambil rekapnya
  sendiri. Memakai rekap bulan lalu membuat keduanya **hampa** — benar tanpa
  menguji apa pun, dan itu bentuk hijau yang paling mahal.

- **Temuan kedua, dari memeriksa kesiapan rilis**: entri changelog **"Angka
  BIAYA hanya untuk manajemen"** terdaftar "belum di-merge" padahal **sudah
  tayang sejak `6ceef83` (2026-08-27)** — dibuktikan dari `production` sendiri
  (`GET /stok/nilai` ada di sana). Kepala CHANGELOG sudah menuliskan akibatnya
  lebih dulu: *"mobile akan mengira fitur yang sudah aktif belum bisa
  dipakai."* Empat hari changelog berkata salah dengan percaya diri.
  Distempel; paruh "belum di-merge" pada `BELUM_TAYANG` kini kosong, dan
  **batasnya ditulis**: daftar itu menahan LUPA MENSTEMPEL, bukan STEMPEL YANG
  TERLAMBAT DICABUT — entri yang sudah terdaftar tak pernah ditanya lagi.

- **Ponsel: BELUM tayang, dan sebabnya izin, bukan gerbang merah.** Fikstur
  kunci kontrak (`LaporanDurasiPesanan|riwayat_terpotong`) sudah di-commit dan
  didorong ke cabang `claude` ponsel (`ef04956`). Gerbangnya **tak bisa
  dijalankan**: Flutter tak terpasang di mesin ini, dan
  `workflow_dispatch` ditolak **403 "Resource not accessible by integration"**
  — token aplikasinya tak punya `actions: write` di repo itu. Tiga commit
  ponsel yang menunggu **belum pernah** dilewati CI (ketiga run CI ponsel yang
  ada semuanya dari push ke `Production`). Merge tanpa gerbang tidak dilakukan.

- **Gerbang pada hasil merge:** typecheck bersih · `npm test` **2.607** (214
  berkas) · build web · `verify-api.sh` **3.362 lolos / 0 gagal** (DB segar) ·
  cakupan rute **274 cocok** · `audit:invarian` **27/27** · Playwright
  **13/13**. Lalu CI `production` #479 mengulanginya dan hijau.

---

## Delapan pemotongan senyap terakhir — dan lubang yang perbaikannya akan memperbesar 8× — server + web — 2026-08-31 — `MAKS_UTANG` 8 → 0

- **Vena ini sudah empat putaran berjalan**, dan sisanya tinggal 8 situs
  `utang` di 4 berkas. Aturannya sudah ditulis panjang di
  `modules/customer/routes.ts:50`, rumahnya sudah ada (`src/lib/potong.ts`),
  idiomnya sudah dipakai belasan kali. Yang tersisa: memakainya di pintu yang
  belum. Tanda tangan yang sama lagi.

- **TERUKUR lewat HTTP, satu pintu utuh** — `GET /shift`, riwayat UANG, yang
  paling tajam dari kedelapannya. 51 shift tertutup disuntik ke satu cabang,
  dan **premisnya dibuktikan dari balasan rutenya sendiri** (0 → 50 baris),
  bukan dari `SELECT count(*)`:

  ```
  sebelum : 50 baris · tanpa header · tanpa medan
  sesudah : 50 baris · X-Kakarut-Terpotong: 50
  ```

  Lima puluh baris tanpa satu pun tanda tak bisa dibedakan dari "cabang ini
  memang belum pernah menutup shift sebelum itu". Owner yang menggulir sampai
  bawah membaca daftar yang habis sebagai riwayat yang habis.

- **Kedelapan pintu, satu idiom** — tujuh berbalasan larik telanjang memakai
  `potongLarik` + header (bentuk larik SENGAJA tak berubah jadi objek: build
  ponsel lama membacanya `as List`); satu berbalasan objek memakai kunci badan:

  | pintu | batas | cara |
  |---|---|---|
  | `GET /shift` | 50 | header |
  | `GET /stok/exp` | 300 | header (`LIMIT` di templat `sql`) |
  | `GET /stok/opname/riwayat` | 200 | header |
  | `GET /stok/opname` | 200 | header |
  | `GET /perlengkapan/opname/riwayat` | 100 | header |
  | `GET /perlengkapan/beli` | 200 | header |
  | `GET /perlengkapan/kiriman` | 50 | header |
  | `GET /laporan/durasi-pesanan` | 200 | `riwayat_terpotong` |

  Tujuh layar web ikut menampilkannya, dengan kalimat yang berbeda per layar —
  spanduk yang berbunyi sama di tujuh tempat adalah spanduk yang orang berhenti
  membaca.

### Lubang yang putaran ini akan memperbesar 8×, ditutup lebih dulu

- Sudah ada aturan mekanis untuk medan DTO (*"tiap penanda `terpotong` wajib
  dibaca web"*). **Tak ada padanannya untuk header** — dan justru bentuk
  header-lah yang bertambah tujuh di sini. Gerbang baru: tiap rute yang
  memanggil `potongLarik` wajib (a) mengambil `BATAS + 1`, dan (b) punya
  pembaca di layar.

- **Gerbang itu langsung menemukan dua pintu LAMA yang tak berpembaca**, dan
  keduanya dicatat apa adanya, bukan dibereskan diam-diam:
  - `GET /stok/opname` — **tak ada klien sama sekali**: tak satu layar web
    memanggilnya, dan `docs/API-CONTRACT.md` pun tak menyebutnya. Ia hanya
    diketuk verify-api. Headernya tetap dipasang; entrinya menyebut faktanya.
  - `GET /stok/penyesuaian` — **hanya-ponsel**: ada di kontrak, tak ada di web.
    Headernya dikirim sejak lama dan sisi ponselnya belum merendernya — utang
    yang memang sudah terdaftar di berkas ini.

- **Gerbangnya salah tiga kali sebelum satu tuduhan pun sah**, dan tiap
  kekeliruan mengajarinya satu bentuk:
  1. jalur dicocokkan utuh → `AnalisisHargaPage` yang SUDAH membaca headernya
     tertuduh, sebab web menulis `/menu/${row.id}/riwayat-harga` bukan
     `/menu/:id/…`. Diperbaiki: dicocokkan per potongan literal;
  2. tanpa batas segmen, `/stok/opname` cocok dengan `/stok/opname/riwayat`
     yang memang sudah dibaca — rute yang benar-benar tak berpembaca
     dinyatakan "sudah dibaca" oleh tetangganya sendiri;
  3. syarat se-BERKAS → `StokPage.tsx` menyebut `/stok/opname` sebagai tautan
     navigasi DAN memakai `bacaHeader` untuk `/stok/exp`. Diperbaiki:
     `bacaHeader` dicari di PANGGILAN yang sama, jendelanya dipotong sampai
     `api(` berikutnya — bukan sekian ratus aksara, sebab batas yang bergeser
     saat kodenya tumbuh adalah cara gerbang berhenti berlaku tanpa ada yang
     memutuskan begitu.

- **`BATAS + 1` dipaku terpisah**, dan itu bukan kelebihan: `potongLarik`
  memasang headernya hanya bila `rows.length > batas`, jadi kueri yang
  mengambil TEPAT `batas` membuat penandanya tak pernah menyala sementara
  gerbang "sudah pakai potongLarik" tetap hijau. **Satu karakter cukup untuk
  mengembalikan seluruh cacat yang putaran ini bayar.**

### Dua koreksi atas catatan lama, ditulis bukan diwarisi

- **Alasan utang `laporan` SALAH.** Ia berbunyi *"statistik lama-pengerjaan per
  menu dihitung dari 200 baris sajian terakhir"*. Tidak: `per_menu`, `jumlah`,
  dan `rata_detik` lahir dari agregat `GROUP BY` yang **tak dibatasi**. Yang
  dipotong hanya `riwayat` — dan itu tetap salah selama ia diam, sebab
  `jumlah` tampil tepat di atasnya. Layarnya kini menautkan keduanya
  ("menampilkan 200 dari 1.284"), pola yang sama dengan `ShiftDetailModal`.

- **`Number()` mentah di layar**, dan gerbang `angka-input` yang benar. Pola
  `bacaHeader` yang kusalin ke enam layar memuat `Number(h.get(...))`, dan
  aturan rumah melarang `Number()` mentah di `.tsx` — aturan yang benar, sebab
  `Number()` di layar hampir selalu berarti isian pengguna sedang diurai tanpa
  penjaga. Jawabannya bukan mengecualikan, melainkan **satu rumah**:
  `bacaTerpotong` di `lib/api.ts`, dan **kedelapan** salinan (termasuk empat
  yang sudah ada sebelum putaran ini) dipindah ke sana.

- **Gerbang `query-punya-rumah` memerah karena baris bergeser** — entrinya
  berkunci `berkas:baris`, dan dua entri bergeser 26 dan 10 baris. Nomornya
  diperbarui, gerbangnya tidak dilonggarkan; kelemahan kuncinya ditulis di
  berkasnya dan **didaftarkan sebagai vena tersendiri** di bawah. Repo ini
  sudah memilih kunci BERKAS + JUMLAH di gerbang lain justru karena ini.

- **BUKTI MERAH — tiga, satu per gerbang baru:**
  1. `+ 1` dicabut dari `GET /shift` → *"mengambil SATU BARIS LEBIH"* merah;
  2. `potongLarik` diganti `rows.slice` di `GET /perlengkapan/kiriman` →
     *"DIPAKU: tujuh pintu…"* merah menyebut rutenya;
  3. `bacaHeader` dicabut dari layar `/stok/exp` → *"potongannya sampai ke
     layar"* merah.

- **BATAS YANG DIAKUI, ditulis jujur:**
  - **Yang diukur lewat HTTP satu pintu, bukan delapan.** Ketujuh lainnya
    memakai pembantu yang sama persis dan dipaku uji statis. Menyuntik 300
    baris di sembilan pintu akan memperlambat gerbang demi satu bit.
  - §283 menjaga sisi **penandanya jujur** (diam saat daftarnya memang
    pendek) — sisi terpotongnya milik uji statis. Peringatan yang menyala
    tanpa sebab adalah peringatan yang orang belajar abaikan, dan gerbang
    statis tak bisa melihat bentuk kegagalan itu.
  - "Dibaca layar" berarti ADA berkas web yang menyebut jalurnya dan memakai
    `bacaHeader` di panggilan yang sama. Ia **tidak** membuktikan spanduknya
    benar-benar dirender.
  - `MAKS_UTANG` 0 tak berarti tak ada pemotongan lain — `slice`/`take` murni
    di JS tetap di luar populasi yang disapu `util/potong.ts`.
  - **Fikstur kunci kontrak di repo ponsel** (`../kakarut-mobile/test/fikstur/
    kunci-kontrak-server.txt`) ikut disegarkan supaya gerbangnya hijau di
    mesin yang punya kedua repo. Perubahan itu **belum di-commit di repo
    ponsel** — ia butuh PR-nya sendiri di sana.

- **Berkas:** `modules/shift/routes.ts` · `stok/routes.ts` ·
  `perlengkapan/{service,routes}.ts` · `laporan/routes.ts` ·
  `packages/shared/src/types.ts` · `lib/api.ts` (+`bacaTerpotong`) · tujuh
  layar web · `test/{potong-berpenanda,pemotongan-terungkap,query-punya-rumah,
  changelog-stempel-rilis}.test.ts` · `scripts/verify-api.sh` (§283, 20 asersi)
  · `docs/API-CONTRACT.md` (header didokumentasikan — ia tak pernah ada di
  kontrak, juga untuk `/sampah` yang memakainya sejak lama) ·
  `docs/mobile/CHANGELOG-API.md` (🟡).

- **Gerbang:** typecheck bersih · `npm test` **2.607** (214 berkas) · build web
  · `verify-api.sh` **3.363 lolos / 0 gagal** (DB segar) · cakupan rute **274
  cocok** · `audit:invarian` **27/27** · Playwright **13/13**.

---

## Dua utang balapan terakhir — satu DIBAYAR, satu DICABUT — server — 2026-08-31 — `MAKS_UTANG` 2 → 0

- **Entri venanya sendiri yang menagih peninjauan**, dan alasannya tertulis:
  keduanya didaftarkan **sebelum `lomba.ts` bisa menembus `db.transaction`**,
  jadi kelasnya dinilai dengan mata yang lebih buruk daripada yang sekarang.
  Repo ini sudah sekali membayar harga karena tidak meninjau ulang
  (`tibaBeliPerlengkapan`: `utang` dengan alasan *"hasilnya tak pernah
  dilihat"*, padahal penjaganya sudah ada lima minggu sebelumnya).

- **Keduanya ternyata bukan hal yang sama, dan itu inti putaran ini:**

  | situs | yang sebenarnya menahan | putusan |
  |---|---|---|
  | `admin-tenants` `jalankan` | `companies_slug_unique` + `users_email_unique`, diterjemahkan **per indeks** jadi 409 | **tuduhan DICABUT** |
  | `pastikanSuperAdmin` | `users_email_unique` — **secara kebetulan** | **utang DIBAYAR** |

---

### 1. `pastikanSuperAdmin` — utang yang memang utang

- **Indeksnya menjaga aturan yang SALAH.** `users_email_unique` menjaga "satu
  user per email"; aturan di sini "paling banyak satu super admin aktif".
  Keduanya berimpit **hanya** selama seluruh instance membaca
  `SEED_SUPERADMIN_EMAIL` yang sama.

- **TERUKUR atas Postgres sungguhan** — 8 ronde, tiap ronde dua panggilan
  serentak dari keadaan nol super admin, dan premisnya dibuktikan tiap ronde
  (jumlah baris dibaca ulang, bukan diasumsikan):

  ```
  3/8  bersih
  4/8  yang kalah ditolak 23505 users_email_unique → index.ts mencetak
       "Gagal memastikan super admin: Failed query: insert into users …"
  1/8  yang kalah membaca emailDipakai SESUDAH yang menang commit lalu
       mencetak kalimat yang KELIRU: "email … sudah dipakai akun lain —
       lewati pembuatan otomatis"
  0/8  jumlah barisnya salah
  ```

  **Lima dari delapan boot menutup dengan galat atau dengan kalimat yang
  salah** — di satu-satunya tempat pemilik sistem bisa membacanya. Datanya
  tak pernah rusak; yang rusak apa yang DIKATAKAN log boot. Yang 1/8 itu
  bentuk terburuknya: bukan diam, melainkan **percaya diri dan salah**.

- **Sesudah `kunciAntrean(tx, "super-admin")`: 8/8 bersih**, nol galat, nol
  kalimat menyesatkan, jumlah baris tetap 1. Kunci yang sama jenisnya dengan
  yang sudah dipegang tetangganya `backfillEmployeeCode` **di boot yang sama** —
  persis jawaban yang entri utangnya sendiri tunjuk.

### 2. `admin-tenants` `jalankan` — tuduhan DICABUT, dan alasan lamanya salah

- Balapannya **sudah** ditahan sejak lama, dan **sudah** diukur lewat HTTP:
  §213 verify-api menembak tiga pembuatan tenant kembar → *"TAK ADA 5xx"*,
  *"tepat SATU tenant lahir"*. Yang kalah menerima **409 per indeks** ("slug
  sudah dipakai" vs "email sudah terdaftar"), bukan 500.

- Yang tak terbaca **penjaganya**, bukan penjagaan: `.catch(bentrokUnikPada …)`
  menempel di situs **panggil**, satu lingkup di luar fungsi yang tertuduh, dan
  `lomba.ts` berlingkup satu fungsi. `.catch`-nya dipindahkan ke dalam badan
  `jalankan` — **perilaku identik**, kelasnya jadi `BENTROK`, entri tangannya
  lenyap. Sama bentuknya dengan dua situs `F` yang keluar dari `DIPILAH_TANGAN`
  putaran lalu: yang berubah siapa yang bisa membaca buktinya.

- **Alasan lamanya dicatat sebagai SALAH, bukan dihapus diam-diam**: *"kecil
  bukan ditahan"* — ia ditahan, dan sudah diukur, sejak sebelum kalimat itu
  ditulis.

### 3. Aturannya ditulis di DATA — `audit:invarian` 26 → **27**

`paling banyak SATU super admin aktif`
(`GREATEST(count(*)-1, 0) FROM users WHERE is_super_admin AND deleted_at IS NULL`).
Uji statis bisa menagih kuncinya TERTULIS; hanya baris ini yang menjawab
**berapa akun yang benar-benar lahir**, dan CI menjalankannya SESUDAH
verify-api di atas basis data yang sudah dilewati 3.344 asersi. Nol super admin
sengaja **bukan** pelanggaran (basis data yang belum di-boot pun sah); yang
dilarang akun kedua.

---

- **BUKTI MERAH — tiga, satu per gerbang:**
  1. `kunciAntrean` dicabut → *"provisi super admin memegang kuncinya"* **dan**
     *"tiap periksa-lalu-tulis tanpa penahan sudah diadjudikasi"* merah;
  2. `.catch` dikembalikan ke situs panggil → *"pembuatan penyewa terbaca
     BENTROK"* + uji adjudikasi merah;
  3. satu baris super admin kedua disisipkan ke DB → `audit:invarian`
     **26 sehat, 1 dilanggar**; dihapus lagi → 27/27.

  Dua asersi struktural itu ADA justru karena menghapus entri dari `daftar`
  saja tak menahan apa pun: tanpa keduanya, pencabutan penjaga hanya
  memerahkan uji "sudah diadjudikasi" — pesan yang menyuruh MENDAFTARKANNYA
  kembali, bukan mengembalikan penjaganya.

- **Gerbang kedua yang menagihku, dan ia benar**: `penjaga-semua-pintu`
  memerah dengan *"`dasar` tak menyimpan entri yang sudah tak berlaku"* —
  entri `superadmin.ts` di daftar «bentrok-unik» jadi basi begitu pintunya
  tertutup. Alasan lamanya pantas dibaca penerusnya sebab ia BENAR pada bagian
  yang diukurnya dan MELESET pada yang tidak: *"satu di antaranya mencatat
  galat lalu lanjut — akunnya tetap tepat satu."* Jumlah akunnya memang selalu
  satu; "mencatat galat lalu lanjut" bukan satu-satunya cara gagal.

- **BATAS YANG DIAKUI, ditulis jujur:**
  - **Tak ada seksi verify-api baru, dan tak bisa ada**: `pastikanSuperAdmin`
    berjalan di BOOT — tak ada pintu HTTP yang mencapainya. Gerbangnya
    STRUKTURAL (kelas `KUNCI` dipaku) + **DATA** (invarian ke-27). Sisi HTTP
    pembuatan penyewa dijaga §213, yang dijalankan ulang sebagai pasangan dan
    tak bergeser satu jawaban pun.
  - Pengukuran 8 ronde hidup di scratchpad, bukan di `scripts/` — ia
    MENGHAPUS baris `users`, dan skrip perusak yang bisa salah sasaran tak
    pantas tinggal di repo. Prosedurnya: kosongkan super admin → dua
    `pastikanSuperAdmin(db)` serentak → baca ulang jumlah barisnya.
  - `MAKS_UTANG` kini **0**, dan nol itu berarti: tiap situs
    periksa-dulu-baru-tulis di `src` entah memegang penahan yang terbaca
    mesin, entah terdaftar `sah` beserta alasannya. Ia TIDAK berarti tak ada
    balapan tersisa di luar populasi yang disapu `lomba.ts` — lingkupnya tetap
    satu fungsi, dan nama tabel tetap dibandingkan sebagai teks argumen.

- **Berkas:** `modules/auth/superadmin.ts` (kunci antrean + transaksi) ·
  `modules/admin-tenants/routes.ts` (`.catch` pindah ke dalam `jalankan`) ·
  `scripts/audit-invarian.ts` (invarian ke-27) · `test/lomba-tulis.test.ts`
  (dua entri dihapus, `MAKS_UTANG` 2 → 0, +2 premis struktural) ·
  `test/penjaga-semua-pintu.test.ts` (entri basi dihapus).

- **Gerbang:** typecheck bersih · `npm test` **2.582** (214 berkas) · build web ·
  `verify-api.sh` **3.344 lolos / 0 gagal** (DB segar) · cakupan rute **274
  cocok** · `audit:invarian` **27/27** · Playwright **13/13**.

- **Utang balapan tersisa: 0.**

---

## Utang DIBAYAR: selisih yang muncul SESUDAH shift ditutup — dan alat ukur §280 yang ikut mati karenanya — server — 2026-08-31

- **Utang ini kudaftarkan sendiri putaran lalu**, di bagian "BATAS YANG
  DIAKUI" entri `execPenjualan`, dengan kalimat yang sudah menyebut angkanya:
  *"menolak 400 … Terukur 20 dari 20."* Kewajiban pertama karena itu bukan
  membaca kode melainkan **mengukur ulang lewat HTTP**, di basis data segar
  yang baru di-seed.

- **Tanda tangannya, lagi, dan persis kata per kata seperti yang ditulis di
  kepala berkas ini**: aturannya sudah dipikirkan, ditulis, dan dikomentari
  panjang — `statusSelisih` punya 24 baris komentar yang menjelaskan kenapa
  status harus diturunkan dari angka HIDUP dan bukan dari kolom beku. Penjaga
  itu dipasang di **dua** pintu (DTO shift dan antrean `GET /shift/selisih`);
  pintu **ketiga** ke keadaan yang sama — `POST /:id/selisih/putuskan` —
  dibiarkan membaca kolom bekunya.

- **TERUKUR lewat HTTP sebelum apa pun disentuh** (satu shift, satu penjualan
  11.000):

  ```
  tutup PAS       {"status_selisih":"pas","selisih":0,"kas_sistem":100000}
  sinkron susulan {"kode":201,"susulan":true}
  layar sesudah   {"status_selisih":"menunggu","selisih":-11000,"kas_sistem":111000}
  antrean owner   GET /shift/selisih?status=menunggu → baris ini ADA (1)
  owner menekan   400 {"error":"Shift ini tak punya selisih kas yang perlu diputuskan"}
  ```

  Owner melihat baris yang menuntut keputusannya, menekannya, dan **ditolak
  rutenya sendiri**. Kekurangan 11.000 itu tak bisa ditutup siapa pun — bukan
  ditunda, melainkan tak punya jalan sama sekali.

- **SESUDAH perbaikan, skenario yang sama:**

  ```
  owner menekan   200 → status_selisih "disetujui"
  layar akhir     selisih_disetujui_oleh "Owner Basooopa", selisih_diputus_pada terisi
  menekan lagi    409
  ```

- **Perbaikannya menurunkan kelayakan dari aturan yang hidup**, bukan menambah
  cabang khusus: rutenya memanggil `rekapWindow` lalu `statusSelisih` — dua
  fungsi yang SAMA dengan yang dipakai layar dan antrean — sehingga ketiga
  pintu tak bisa lagi berselisih tanpa ketiganya ikut berubah. Dua efek ikutan
  yang disebut apa adanya:
  - shift yang **belum ditutup** kini dijawab "Shift ini belum ditutup", bukan
    "tak punya selisih kas" — dua sebab berbeda dulu jatuh ke satu pesan yang
    salah untuk salah satunya;
  - guard balapan keputusan-ganda dilonggarkan jadi
    `selisih_status IS NULL OR = 'menunggu'`. Tanpa itu jalan buntunya cuma
    **pindah** dari penjaga di atas ke `WHERE` — dan bukti merah di bawah
    menunjukkan bentuk kegagalannya persis: 409, bukan 400.

- **YANG PALING MAHAL DARI PUTARAN INI BUKAN CACATNYA, MELAINKAN APA YANG
  DIRUSAK PERBAIKANNYA.** §280b — gerbang balapan yang kupasang putaran lalu —
  membaca kolom beku `selisih_status` **lewat rute ini**: 400 = NULL, 200 =
  "menunggu". Sesudah perbaikan, rute itu menjawab **200 di kedua keadaan**,
  jadi syarat `PUT=400` di dalam `LANGGAR280` menjadi **mustahil** dan
  gerbangnya berubah jadi hiasan — hijau selamanya, tanpa satu asersi pun
  berubah warna dan tanpa satu baris pun di §280 disentuh. Diukur, bukan
  disimpulkan: shift yang rekap penutupannya melewatkan penjualannya dijawab
  **200**.

  > Alat ukur yang menumpang pada perilaku rute lain bisa berubah jadi hiasan
  > tanpa satu baris pun di seksi yang memakainya disentuh.

  Alat ukurnya diganti dengan yang membaca boolean itu **langsung**:
  `selisih_alasan`, ditulis penutupan persis dari `perluAcc`
  (`perluAcc ? (selisih_alasan || catatan) : null`), jadi shiftnya ditutup
  dengan `catatan`. Terukur di kedua sisi, satu penjualan 11.000:
  `rekap menghitung → selisih_alasan "probe280"` · `penjualan susulan →
  selisih_alasan NULL` — sementara `status_selisih` berbunyi "menunggu" di
  **keduanya**, dan itulah sebabnya medan DTO itu tak bisa dipakai.

- **BUKTI MERAH — tiga, dan yang ketiga menjaga alat ukurnya sendiri**
  (tiap kali: kode dicabut → DB segar → verify-api penuh):
  1. penurunan `statusSelisih` diganti `row.selisihStatus ?? "pas"` (perilaku
     lama) → **5 asersi §282 merah**, seluruh premisnya tetap hijau;
  2. pelonggaran guard balapan dicabut → **4 asersi §282 merah**, dan
     kegagalannya berbunyi **409** — jalan buntunya memang pindah ke `WHERE`,
     persis seperti yang ditulis komentarnya;
  3. kunci baris shift di `POST /shift/tutup` dicabut → **§280b merah dengan 3
     pelanggaran** memakai alat ukur BARU. Tanpa langkah ketiga ini, "§280b
     tetap hijau" hanya berarti alat ukurnya diganti, bukan bahwa ia masih
     bisa menuduh.

- **PASANGAN — pengetatan/pelonggaran tak boleh menutup atau melubangi jalan
  yang sah:** shift yang benar-benar "pas" tetap **400** · shift yang belum
  ditutup tetap **400**, dengan alasan yang menyebut sebab sebenarnya ·
  memutuskan **dua kali** tetap **409** · §152 (alur selisih kas yang sudah
  ada) tetap hijau seluruhnya.

- **Efek samping yang menguntungkan, dan diperiksa bukan diterima**: dua situs
  kelas `F` di `modules/shift/routes.ts` KELUAR dari `DIPILAH_TANGAN` di
  `kueri-terkurung-tenant.test.ts` — panggilan `rekapWindow(db, row.companyId,
  …)` membuat pengurungan tenant-nya terbaca MESIN sebagai kelas C. Alasan
  tulisan tangannya tidak berubah isinya; yang berubah cuma siapa yang bisa
  membacanya. **`F` 50 → 48.** Yang menagihnya bukan aku melainkan uji
  "daftar pilahannya masih ADA — bukan kuburan berkas basi", yang memerah
  karena berkasnya berhenti punya situs F.

- **BATAS YANG DIAKUI, ditulis jujur:**
  - §282 mengukur **satu** shift per keadaan, bukan tangga; ia menjaga
    kesepakatan antar pintu, bukan balapan. Balapannya milik §280.
  - Alat ukur `selisih_alasan` membaca `perluAcc` **hanya bila shiftnya
    ditutup dengan `catatan`** — dan kedua seksi yang memakainya memang
    menutup begitu. Ditutup tanpa `catatan`, medannya NULL di kedua keadaan
    dan alat ukurnya buta. Ini tertulis di kepala §280 supaya penulis
    berikutnya tak menghapus `catatan`-nya sebagai "kerapian".
  - Pintu keempat ke keadaan yang sama belum disapu mekanis: tak ada gerbang
    yang menagih "setiap pembaca `selisih_status` memakai `statusSelisih`".
    Yang ada baru §282, yang menjaga kesepakatan antara antrean dan rute
    keputusan — dua pintu, bukan seluruh populasi.

- **Berkas:** `modules/shift/routes.ts` (kelayakan diturunkan dari
  `rekapWindow` + `statusSelisih`; 400 "belum ditutup" dipisahkan; guard
  balapan menerima `IS NULL`) · `scripts/verify-api.sh` (§282 baru — 15
  asersi; §280b/c alat ukurnya diganti + kepala seksinya menuliskan sebabnya)
  · `test/kueri-terkurung-tenant.test.ts` (`shift/routes.ts` keluar dari
  daftar tangan, `F` 50 → 48).

- **Gerbang:** typecheck bersih · `npm test` **2.580** (214 berkas) · build web
  · `verify-api.sh` **3.344 lolos / 0 gagal** (DB segar) · cakupan rute **274
  cocok** · `audit:invarian` 26/26 · Playwright **13/13**.

---

## Utang DIBAYAR: balapan `execPenjualan` — penjaganya ada, dipasang di pintu yang tak melewatinya — server — 2026-08-31

- **Entrinya sendiri menyebut batasnya**: *"Jalur ini memang sudah dijaga
  `client_ref` di tingkat antrean, tapi penahan itu ada di LUAR fungsi ini dan
  tak terbaca dari sini."* Hari ini penahan itu **bisa** ditunjuk — klaim
  atomik `INSERT … onConflictDoNothing().returning()` di `syncRoutes`. Tapi
  `client_ref` menjaga dari perintah **kembar**, dan tak menjaga apa pun dari
  **shift yang ditutup di tengah eksekusi**. Kalimat entrinya benar; sebabnya
  yang belum lengkap.

- **BENTUKNYA — dan `penjualan/service.ts:150` sudah menuliskan aturannya
  sendiri**, lengkap: *"`FOR SHARE` di sini betul-betul menggigit —
  `POST /shift/tutup` menutup lewat UPDATE biasa, yang menunggu kunci ini
  lepas. Tanpa itu shift bisa tertutup di sela pencarian dan penyimpanan."*
  Kunci itu berada **di dalam `if (!shiftId)`** — cabang jalur ONLINE. Jalur
  sinkron SELALU mengisi `shiftId`, jadi ia melewatinya seluruhnya. Penjaganya
  ada, ditulis, dikomentari, dan dipasang di pintu yang bukan pintu yang
  membutuhkannya. Vena ini persis bentuk yang berkas ini ada untuk mencari.

- **DUA CACAT DARI SATU BENTUK, dan hanya satu perlu balapan.** `execPenjualan`
  menandai shiftnya SEBELUM penjualannya ada, dari `closedAt` yang sudah
  dibaca. **Diukur lewat HTTP sebelum satu baris diubah:**

  |  | sebelum | sesudah |
  |---|---|---|
  | (a) perintah DITOLAK `createSale` → `ada_transaksi_susulan` | **true** (dengan **0** transaksi) | **false** |
  | (b) 20 penutupan berpapasan → penjualan luput rekap DAN tanpa penanda | **11 / 20** | **0 / 20** |
  | (b) rekap penutupan sempat menghitung penjualannya | **0 / 20** | — |

  (a) tak butuh balapan sama sekali: `createSale` melempar (menu tak ada, bill
  sudah dibayar), penandanya sudah terlanjur tertulis, dan **tak ada yang
  pernah mencabutnya**. Shift berbunyi "ada transaksi susulan" selamanya tanpa
  satu pun. (b) adalah balapan melawan penutupan shift — uangnya masuk shift,
  rekap penutupan tak menghitungnya, dan penanda yang ADA justru untuk
  memperingatkan itu tetap diam.

- **KOLOM BEKUNYA DIBACA LEWAT `POST /:id/selisih/putuskan`**, dan itu
  satu-satunya cara melihatnya dari HTTP: 400 = `selisih_status` NULL (rekap
  penutupan TIDAK menghitung penjualannya), 200 = "menunggu" (ia
  menghitungnya). `status_selisih` di DTO tak bisa dipakai — ia diturunkan dari
  angka HIDUP, jadi kedua keadaan itu terbaca sama persis.

- **PERBAIKANNYA MEMASANG KUNCI YANG SUDAH DITULIS BASIS KODE INI, di pintu
  yang melewatinya** — dan menutup sisanya di pintu kedua:
  - `createSale` mengunci baris shift dari pemanggil `.for("update")` (bukan
    `share`: baris itu mungkin ia TULIS, dan dua pemegang share yang naik ke
    tulis adalah deadlock — yang di jalur ini berarti perintah tercatat `gagal`
    dan penjualannya hilang permanen). Ongkos berurutannya nol: `branches`
    sudah dikunci `FOR UPDATE` di awal transaksi yang sama.
  - penandanya ditulis **di dalam transaksi penjualan**, jadi ia ikut batal
    bila penjualannya batal; hasilnya dipulangkan supaya pemanggil melaporkan
    TULISAN, bukan bacaannya sendiri.
  - `POST /shift/tutup` memegang kunci baris itu **dari sebelum rekap sampai
    sesudah penutupan** (`rekapWindow` menerima eksekutor, idiom yang sama
    dengan `capHariSebelumnya`). Tanpa ini sisanya tetap terbuka: rekap dibaca
    sebelum `closed_at` ditulis, dan penjualan bisa mendarat di antaranya.
  - **Tak ada 409 di jalur ini**, dan itu disengaja: `sync/routes.ts:338`
    menuliskan alasannya — uang tunainya sudah diterima kasir, menolak berarti
    uang itu tak punya jejak sama sekali. Yang diperbaiki penandanya, bukan
    penerimaannya.

- **BERAPA YANG DITAHAN MASING-MASING KUNCI, diukur terpisah** — sebab
  "dua-duanya dipasang lalu nol" tak memberi tahu siapa yang bekerja:

  | konfigurasi | pelanggaran / 20 |
  |---|---|
  | tanpa kunci (semula) | **11** |
  | hanya kunci `/shift/tutup` | **1** |
  | kedua kunci | **0** |

- **GERBANG STATIS: sapuan diadu berdampingan atas populasi yang sama** —
  69 situs, sebelum → sesudah: `KLAIM_BUTA` **6 → 5**, `KUNCI` **23 → 24**,
  `BENTROK` 17 → 17, `KLAIM` 20 → 20, `TELANJANG` 3 → 3. Diffnya tepat dua
  baris: `execPenjualan` **HILANG** dari sapuan (ia tak lagi menulis `shifts`
  sama sekali), dan `POST /tutup` **MUNCUL** sebagai situs baru yang lahir
  `KUNCI`. Angka yang turun karena kodenya pindah rumah disebut demikian, bukan
  dibaca sebagai satu balapan yang lenyap. `MAKS_UTANG` **3 → 2**.

- **KELAS SITUS SAJA TAK CUKUP DI SINI, dan itu ditemukan saat bukti merahnya
  dijalankan.** `createSale` sudah berkelas `KUNCI` karena `branches` dikunci
  di baris pertamanya — kunci baris SHIFT bisa dicabut tanpa menurunkan
  kelasnya sedikit pun. Maka ditambah dua uji **struktural** (AST, bukan
  regex): tiap `.from(shifts)` di `createSale` wajib membawa `.for(`, dan
  penulisan `closedAt: new Date()` wajib berada di dalam callback
  `db.transaction` yang memuat `.for("update")` **dan** `rekapWindow(tx`.
  Ketiganya dibuktikan merah satu per satu.

- **GERBANG DINAMIS §280 — dan versi pertamanya adalah HIASAN.** Ditembak
  barengan dengan `&` polos, penutupan **menang 8 dari 8**: perintah sinkron
  harus lewat batas laju, ledger, dan klaim atomik lebih dulu. Dijalankan atas
  kode SEBELUM perbaikan, §280b tetap **hijau** — gerbang yang tak pernah bisa
  merah tidak menyatakan apa pun, dan itu persis yang kutulis pertama kali.
  Diukur ulang: jendela berbahayanya antara shift DIBACA (±10 md) dan penjualan
  DISIMPAN (±20 md) — selebar pangkalnya sendiri. Maka penutupannya kini
  ditunda menurut **tangga geometris** (rasio ±1,65) dari 4 md sampai 150 md,
  yang pasti memuat satu anak tangga di dalam jendela selebar itu, di mesin
  cepat maupun lambat. **Tangganya sendiri diperiksa** (Aturan 7): ia wajib
  menyeberang — ada anak tangga tempat penutupan masih menang DAN ada tempat
  rekapnya sudah menghitung. Tanpa kedua premis itu, "nol pelanggaran" cuma
  berarti tangganya meleset.

- **Bukti merah, dijalankan bukan diasumsikan.** Atas `src` yang dikembalikan
  ke keadaan sebelum perbaikan: §280a merah (`penanda: 1`, harusnya 0) dan
  §280b merah (**3** pelanggaran) — dengan ketiga premisnya tetap hijau.
  Sesudah perbaikan: 0 dan 0, premis penyeberangan 2 dan 6.

- **PASANGAN** (tiap pengetatan bisa menutup jalan yang sah): penjualan susulan
  sungguhan tetap 201 dan tetap menyalakan penandanya · penjualan yang sudah
  TERHITUNG rekap penutupan tetap TIDAK ditandai (penandanya tak jadi cerewet)
  · dua penutupan berpapasan tetap 200 & **409** · seluruh alur kasir, rekap,
  dan selisih yang sudah dipaku verify-api tetap hijau.

- **BATAS YANG DIAKUI, ditulis jujur:**
  - `POST /:id/selisih/putuskan` menolak **400** untuk shift yang selisihnya
    baru muncul SESUDAH ditutup (kolom bekunya NULL) — padahal layar dan
    antrean `GET /shift/selisih?status=menunggu` menampilkannya sebagai
    "menunggu", sebab keduanya memakai `statusSelisih` yang hidup. Owner
    melihat baris yang perlu diputuskan lalu ditolak rutenya. **Terukur 20 dari
    20** di seluruh pengukuran vena ini. Ini bukan cacat vena ini — ia sisa
    dari putaran `statusSelisih`, yang memperbaiki tampilan dan antreannya
    tetapi tidak rute keputusannya. **Didaftarkan sebagai utang tersendiri.**
  - `lomba.ts` tetap berlingkup satu fungsi; nama tabel tetap dibandingkan
    sebagai teks argumen.
  - §280b membuktikan invariannya bertahan **pada jendela yang tangganya
    seberangi**; ia tak membuktikan tak ada jendela lain.

- **Berkas:** `modules/penjualan/service.ts` (kunci + penanda di dalam
  transaksi) · `modules/shift/routes.ts` (kunci baris shift membungkus rekap +
  penutupan; `rekapWindow` menerima eksekutor) · `modules/sync/routes.ts`
  (penanda dilaporkan dari tulisan) · `modules/penjualan/routes.ts` (bentuk
  respons online tak berubah) · `test/lomba-tulis.test.ts` (entri dihapus,
  `MAKS_UTANG` 3 → 2, +2 uji struktural) · `scripts/verify-api.sh` (§280,
  15 asersi).

- **Gerbang:** typecheck bersih · `npm test` **2.575** (214 berkas) ·
  `verify-api.sh` **3.313 lolos / 0 gagal** (DB segar) · `audit:invarian`
  26/26. Playwright tak dijalankan di commit ini: `apps/web` tak tersentuh.

- **Utang balapan tersisa: 2** — pembuatan penyewa (`admin-tenants`) dan
  `pastikanSuperAdmin`.

---

## Utang DIBAYAR: balapan `POST /kirim/:fakturId` — dan gerbangnya menangkap perbaikanku SENDIRI — server — 2026-08-31

- **Utang ini lahir putaran lalu**, saat `lomba.ts` diajari menembus
  `db.transaction`. Entrinya sendiri menyebut batasnya: *"Ditulis dari kodenya,
  BELUM diukur lewat HTTP."* Kewajiban pertama karena itu **mengukur**, bukan
  memperbaiki — persis pelajaran `tibaBeliPerlengkapan`, tempat catatan tak
  terukur berdiri tiga putaran sebagai temuan sebelum ternyata keliru.

- **Bentuknya**: klaim UPDATE-nya berbunyi `status = 'menunggu'` — dan itu
  BUKAN keadaan yang berubah saat pengiriman. Yang berubah `branch_id` &
  `dikirim_at`; statusnya TETAP `'menunggu'` di cabang tujuan (di sana ia
  berarti "menunggu diterima"). Predikatnya tetap benar sesudah pengiriman
  pertama. Permintaan BERURUTAN sudah tertahan saringan `siap`; yang lolos
  hanya yang berpapasan. `catatHasilIdempoten` tak menutupnya — ia MENCATAT
  hasil sesudah kerjanya selesai, bukan mengklaim sebelum.

- **TERUKUR, dua permintaan serentak, di KEDUA pintu** (`/produksi/kirim` dan
  `/pembelian/kirim` — satu kode, dua rute):

  | | sebelum | sesudah |
  |---|---|---|
  | kode balasan | **200 & 200** | **200 & 409** |
  | jejak faktur "Dikirim ke …" | **2** | **1** |
  | `jumlah_baris` dilaporkan | 7 & 7 (dari BACAAN) | 7 (dari TULISAN) |

- **Batas kerusakannya ikut diukur, dan disebut supaya tak terbaca lebih besar
  dari adanya**: barisnya **tidak** berganda (7 → 7), `dari_branch_id` tetap
  satu (COALESCE di `kolomPindahCabang` memang menahannya), stok tidak dobel.
  Yang rusak **JEJAKNYA** — dan buku faktur yang menulis "dikirim" dua kali
  adalah catatan yang menuduh orang.

- **Perbaikannya menambah PREDIKAT, bukan pemeriksaan**: `isNull(dikirimAt)` —
  penanda KEBERANGKATAN yang skemanya sendiri sebut demikian, dan satu-satunya
  kolom yang benar-benar berubah saat pengiriman. `.returning()` + nol baris →
  **409 bernama** (400 di rute ini sudah berarti "tak ada yang siap dikirim";
  menyamakannya membuat klien tak bisa membedakan dua keadaan). `jumlah_baris`
  kini dari baris yang benar-benar pindah.

- **BATAS GERBANG STATIS, ditemukan saat bukti merahnya dijalankan**:
  `isNull(dikirimAt)` dicabut → `lomba-tulis.test.ts` **tetap hijau**. Ia
  membuktikan hasil klaimnya DIPERIKSA; ia tak bisa menilai apakah
  PREDIKATNYA cukup. Hanya §279 yang menangkapnya — dan itu alasan lapis
  dinamisnya ada, bukan pelengkap.

---

### Dan gerbang §277 menangkap perbaikanku SENDIRI dari dua putaran lalu

- **`catatAbsen` yang kubetulkan dua putaran lalu ternyata belum benar.**
  Menjalankan gerbang penuh memerahkan §277: `keluar → keluar → masuk → masuk`.
  Diukur: **5 dari 25** putaran empat-ketukan-serentak melanggar alternasi.

- **Kuncinya benar; JAM-nya yang salah.** `waktu` dibiarkan jatuh ke bawaan
  kolom `now()` — yang di Postgres adalah waktu **transaksi DIMULAI**, bukan
  waktu barisnya ditulis. Urutan transaksi dimulai TIDAK sama dengan urutan
  kunci diberikan: empat permintaan bisa memulai pada t1<t2<t3<t4 lalu mendapat
  giliran dalam urutan lain. Keputusannya berselang-seling dengan benar — tiap
  pemegang kunci membaca cap terakhir yang sudah ter-commit — tapi `waktu` yang
  tersimpan mengurutkannya kembali ke urutan MULAI. Dibaca ulang menurut
  `waktu`, alternasinya patah lagi:

      masuk@41.340 → masuk@41.347 → keluar@41.348 → masuk@41.350

- **Perbaikannya**: stempel diambil DI DALAM kunci (`new Date()` sesudah
  `kunciAntrean` kembali), dan `waktu` selalu disebut alih-alih jatuh ke
  bawaan. **Sesudah: 0 dari 50** putaran melanggar, dengan premis "empat baris
  lahir" terpenuhi **50/50**.

- **Ini pelajaran yang mahal dan layak ditulis besar**: sebuah penahan bisa
  BENAR dan hasilnya tetap salah, karena yang dibaca ulang bukan urutan
  keputusan melainkan urutan sebuah KOLOM. Kunci menyerialkan keputusan; ia tak
  menyerialkan jam. Dan yang menemukannya bukan pembacaan ulang melainkan
  gerbang dinamis yang kupasang sendiri di putaran itu — **satu-satunya alasan
  cacat ini tak ikut terkirim adalah karena §277 dijalankan, bukan dipercaya.**

---

- **Angka**: `utang` balapan **4 → 3** · situsnya `KLAIM_BUTA → KLAIM` ·
  jejak faktur dari dua kirim serentak **2 → 1** · pelanggaran alternasi absen
  **5/25 → 0/50**.

- **PASANGAN**: seluruh alur kirim berurutan yang sudah dipaku verify-api tetap
  hijau (3.298 asersi), termasuk `tiba lagi → 400`, penerimaan cabang, dan
  saldo CK/cabang sesudah kirim-terima.

- **Gerbang**: `typecheck` bersih · `npm test` **2.572** (214 berkas) ·
  **`verify-api.sh` 3.298 lolos / 0 gagal** (DB segar; §279 baru, 6 asersi) ·
  `audit:invarian` **26/26**. **Playwright tidak dijalankan** — `apps/web` tak
  tersentuh.

- **Utang balapan tersisa: 3** — `execPenjualan`, pembuatan penyewa,
  `pastikanSuperAdmin`. Ketiganya ditulis SEBELUM `lomba.ts` bisa menembus
  transaksi, jadi layak ditinjau ulang sebagai pekerjaan tersendiri.

---

## Utang `tibaBeliPerlengkapan` DICABUT — dan detektornya yang dibayar — server (uji) — 2026-08-31

- **Yang diminta**: membayar utang balapan kedua. Catatan putaran 24
  menuliskannya begini:

  > *"UTANG. Klaimnya ADA — `WHERE id = ? AND status IN (menunggu, diproses)` —
  > tapi hasilnya tak pernah dilihat, jadi yang kalah balapan tetap dibalas
  > sukses."*

- **Kalimat itu keliru, dan `git log -S` yang membuktikannya.** Pemeriksaan
  `if (dikunci.length === 0) throw SUDAH` lahir di commit `7a8eb02`,
  **2026-07-20** — lima minggu SEBELUM utangnya dicatat (2026-08-27). Keadaan
  yang digambarkannya tak pernah ada pada saat ditulis.

- **DIUKUR LEWAT HTTP sebelum apa pun disimpulkan** — dua
  `POST /perlengkapan/beli/:id/tiba` benar-benar bersamaan atas satu faktur,
  tiga kali berturut-turut:

  | | kode balasan | mutasi `masuk` bertambah |
  |---|---|---|
  | apa adanya hari ini | **200 & 400** (3 dari 3) | **1** |

  Yang kalah **ditolak**, dan stok bertambah **sekali**. Utangnya karena itu
  **DICABUT, bukan dibayar** — menambal kode yang sudah benar supaya angkanya
  turun adalah cara paling halus untuk berbohong pada ledger sendiri.

- **Tapi tuduhannya BUKAN mengada-ada — dan sebabnya jauh lebih berharga
  daripada situsnya.** `lomba.ts` menghitung sebuah panggilan hanya bila
  pembungkus TERDEKATNYA adalah fungsi yang sedang dinilai. Klaim yang dijaga
  itu hidup di dalam `db.transaction(async (tx) => …)` — fungsi BERSARANG.
  Dari sudut pandang `tibaBeliPerlengkapan`, penjaganya **tak ada**; yang
  tersisa di mata pemindai cuma satu `update` jinak di luar transaksi. Dari
  situ lahir tuduhan yang kalimatnya menggambarkan baris yang lain.

- **KEBUTAAN ITU SISTEMIS, dan terukur**: dari **73** callback transaksi di
  `src`, **31** memuat `.update(` langsung di dalamnya, dan **17** di antaranya
  memegang klaim yang DIPERIKSA (`returning` + `if`/`throw`) — tersebar di
  `penerimaan` (4), `pesanan` (4), `perlengkapan` (3), `penjualan`, `produksi`,
  `open-bill`, `company`. Sapuan 58 situs putaran 24, di tiap fungsi yang
  menaruh penjaganya di dalam transaksi, menilai **hanya sisa penulisan di
  luarnya**.

- **Yang dibayar putaran ini karena itu INSTRUMENNYA**: `fungsiPembungkus`
  menembus callback `.transaction(` (dan **hanya** itu — `.map(…)` /
  `Promise.all` benar-benar berjalan di konteks lain), dan callback transaksi
  berhenti dinilai sebagai situs tersendiri supaya satu balapan tak dihitung
  dua kali.

- **Sapuan diadu berdampingan atas populasi yang sama** — cara yang sama
  dipakai saat instrumennya naik ke pohon sintaks:

  | | lama | baru |
  |---|---|---|
  | situs | 58 | **69** |
  | `KUNCI` | 22 | 23 |
  | `BENTROK` | 12 | **17** |
  | `KLAIM` | 16 | **19** |
  | `KLAIM_BUTA` | 5 | **7** |
  | `TELANJANG` | 3 | 3 |

- **Mata yang lebih baik MENAIKKAN tuduhan, dan itu hasil yang sah.** Satu
  dicabut (`tibaBeliPerlengkapan` → `KLAIM`), **tiga baru terlihat**, dan
  ketiganya dipilah tangan:

  | situs | kelas | dasar |
  |---|---|---|
  | `POST /reset-password` | **sah** | dua pemakaian tautan yang sama oleh pemegang tautan yang sama; di setiap urutan tautannya berakhir mati |
  | `POST /verify-email` | **sah** | `emailVerifiedAt` ditulis `?? new Date()` (idempoten) + seluruh tautan dimatikan sekaligus |
  | `POST /kirim/:fakturId` | **utang** | predikat `status='menunggu'` TETAP benar sesudah kiriman pertama, jadi permintaan kedua mencocokkan baris yang sama lagi → jejak faktur "Dikirim ke X" KEDUA, dan `jumlah_baris` dilaporkan dari BACAAN awal |

  Kunci daftar `admin-tenants` ikut berubah `transaction` → `jalankan`: yang
  tertuduh kini fungsi yang MENULISKAN transaksinya, dan itu nama yang benar.

- **`MAKS_UTANG` tetap 4 — dan itu justru yang jujur.** Satu dicabut, satu baru
  terlihat. Angka yang tak bergerak di sini lebih berarti daripada angka yang
  turun: komposisinya berubah, dan keduanya disebut namanya.

- **Bukti merah dua arah, dijalankan bukan diasumsikan.** Pemeriksaan
  `dikunci.length === 0` dicabut →
  - gerbang statis merah: `modules/perlengkapan/service.ts:1295
    [tibaBeliPerlengkapan] KLAIM_BUTA tabel=supplyPurchases`;
  - **§278 merah dengan angka yang persis digambarkan catatan putaran 24**:
    kode **200 & 200**, dan **stok CK bertambah 14, bukan 7**.

  Jadi catatan lama benar tentang BENTUK kegagalannya, dan keliru hanya tentang
  apakah penjaganya ada. Itu ditulis di sini utuh — bukan dihapus diam-diam.

- **Premis instrumen baru dibuktikan di fikstur** (4 uji): klaim diperiksa di
  dalam `tx` → `KLAIM` · tanpa pemeriksaan → tetap `KLAIM_BUTA` · `kunciAntrean`
  di dalam `tx` → `KUNCI` · **PASANGAN**: callback non-transaksi (`.map`) tak
  ikut dihitung, dan callback transaksi tak dihitung DUA kali.

- **§278 verify-api** (4 asersi): premis status faktur · tepat satu diterima ·
  yang kalah **ditolak** · stok bertambah tepat sekali qty. Ia memaku hasil
  pengukuran supaya klaim yang keliru tak bisa lahir lagi tanpa ketahuan.

- **Batas yang tetap diakui**: `lomba.ts` menilai per FUNGSI, jadi kunci yang
  dipegang PEMANGGIL tetap tak terlihat · nama tabel tetap dibandingkan sebagai
  teks argumen · callback selain `.transaction(` tetap di luar lingkup, dan itu
  disengaja · entri `POST /kirim/:fakturId` ditulis dari KODENYA, **belum
  diukur lewat HTTP**, dan itu disebut di entrinya sendiri.

- **Gerbang**: `typecheck` bersih · `npm test` **2.572** (214 berkas, +5 uji) ·
  **`verify-api.sh` 3.292 lolos / 0 gagal** (DB segar; §278 baru) ·
  `audit:invarian` **26/26**. **Playwright tidak dijalankan** — `apps/web` tak
  tersentuh. **Tak satu baris pun kode PRODUK berubah** (`git status` atas
  `apps/server/src` kosong): yang dibayar catatannya dan alat ukurnya.

---

## Utang DIBAYAR: balapan `catatAbsen` — server — 2026-08-31

- **Kenapa entri ini ada**: putaran 24 menyapu 58 situs periksa-dulu-baru-tulis,
  menutup dua, dan memilah sembilan sisanya jadi **4 `sah`** + **5 `utang`**
  yang jumlahnya dipaku `MAKS_UTANG = 5` **dengan syarat tertulis bahwa batas
  itu wajib TURUN**. Ini putaran pertama yang membayarnya — dan yang membuatnya
  layak dicatat bukan perbaikannya melainkan bahwa batasnya benar-benar turun.

- **Bentuknya**, `modules/absensi/routes.ts` — tiga langkah tanpa transaksi dan
  tanpa penahan apa pun: **baca** cap terakhir → **putuskan** tipe berikutnya
  (`capAbsenBerikutnya`, alternasi murni) → **tulis**. Skema mengonfirmasi tak
  ada jaring: `attendances` cuma punya `id` primary key + dua indeks BIASA.

- **TERUKUR LEWAT HTTP SEBELUM SATU BARIS DIUBAH** — dua `POST /absensi/saya`
  **serentak** ber-`client_ref` berbeda, dari keadaan "belum absen", diulang
  tiga kali:

  | | deret cap | rekap `keluar` |
  |---|---|---|
  | **sebelum** (3 dari 3) | `masuk → masuk` | **null** |
  | **sesudah** (3 dari 3) | `masuk → keluar` | terisi |

  Orangnya tercatat **datang dan tidak pernah pulang**. Empat ketukan serentak,
  kasus yang membuka putaran ini: `masuk → keluar → keluar → masuk` sebelum,
  `masuk → keluar → masuk → keluar` sesudah. Cap sejenis berurutan **1 → 0**.

- **KLAIM PUTARAN 24 DIPERIKSA, BUKAN DIULANG.** Catatan lama menulis *"rekap
  absen yang dipakai menghitung kehadiran ikut salah"*, dan aku sempat menduga
  itu berlebihan — rekap memakai `min(waktu) filter (tipe='masuk')` /
  `max(...) filter (tipe='keluar')`, dan agregat min/max bisa saja selamat dari
  cap ganda. **Diukur: tidak selamat.** Dua `masuk` tanpa `keluar` membuat
  `max(...) filter (tipe='keluar')` memulangkan **null**, dan hari itu tampil
  sebagai hadir tanpa jam pulang. Catatan putaran 24 benar apa adanya.

- **Kenapa idempotensi yang sudah ada TIDAK menutupnya**: kedua rute memang
  berklaim `client_ref` (`denganKlaimIdempoten`), dan itu menutup pengiriman
  ULANG permintaan yang sama. Ketukan ganda di kios bersama — atau ponsel yang
  menyinkronkan cap offline saat orangnya menekan tombol kios — adalah dua
  permintaan yang memang BERBEDA: dua `client_ref`, dua klaim, dua-duanya lolos.
  Itu sebabnya penahannya harus di `catatAbsen`, bukan di pintunya: keempat
  pemanggilnya (`absensi/routes.ts` ×2, `sync/routes.ts` ×2) lewat satu fungsi.

- **Perbaikannya memakai penahan yang sudah ada, bukan yang baru**:
  `db.transaction` + `kunciAntrean(tx, "absen", companyId, branchId, userId)`.
  `lib/kunci.ts` tak disentuh — ia sudah menuliskan persis kasus ini: *"aturan
  yang melarang baris BARU … barisnya belum ada saat diperiksa, jadi tak ada
  yang bisa dipegang `FOR UPDATE`"*.

- **INDEKS UNIK DIPERTIMBANGKAN DAN DITOLAK, dengan alasan**: alternasi tak
  bisa ditulis sebagai kesamaan kolom — seseorang boleh punya banyak pasang
  masuk/keluar dalam sehari — jadi tak ada tupel yang bisa dijadikan unik.
  Migrasi skema karena itu **tidak** dilakukan; catatan utang lama menyebut
  "tak punya indeks unik" sebagai gejala, bukan sebagai resep.

- **KUNCINYA TANPA TANGGAL, dan itu disengaja**: sesi hadir melintasi tengah
  malam (`sesiHadirTerbuka` + `BATAS_LINTAS_HARI_JAM`), jadi lingkup
  invariannya (perusahaan, cabang, orang). Cap pukul 00:30 yang menutup sesi
  kemarin harus menunggu giliran yang sama dengan cap yang membukanya.
  `capHariSebelumnya` ikut menerima `tx` — bacaan yang memutuskan tapi terjadi
  di LUAR kunci membuat penahannya cuma hiasan.

- **DUA GERBANG UNTUK SATU ATURAN**, dan yang kedua bukan hiasan:

  | lapis | menjawab | tak bisa dielakkan dengan |
  |---|---|---|
  | `test/lomba-tulis.test.ts` | kuncinya **tertulis** | menulis kode berbeda |
  | **§277** `verify-api.sh` | kuncinya **menahan** | menulis penalaran yang salah |

  Gerbang statis tak bisa membuktikan sebuah penahan benar-benar menahan; §277
  menembak empat permintaan BENAR-BENAR bersamaan (`&` lalu `wait`) dan
  menyusun deretnya dari balasan rutenya sendiri.

- **`MAKS_UTANG` 5 → 4**, dan entri `catatAbsen` dihapus dari daftar. Gerbangnya
  sendiri yang menyuruh: begitu kuncinya dipasang ia memerah dengan
  *"catatAbsen: sudah tak tertuduh — hapus entrinya"* — daftar pengecualian
  yang basi ditolak sekeras pelanggaran.

- **Bukti merah dua arah, dijalankan bukan diasumsikan**: kunci dicabut →
  gerbang statis merah menyebut `modules/absensi/routes.ts:222 [transaction]
  TELANJANG tabel=attendances`, **dan** §277 merah menyebut deretnya:
  `keluar -> masuk -> masuk -> keluar`. **PASANGAN**: ketukan berikutnya tetap
  MEMBALIK tipe cap terakhir — kunci menyerialkan, ia tak mengubah aturannya.

- **SATU GERBANG LAIN MENANGKAPKU, dan ia benar**: `verify-api-token.test.ts`
  menolak §277 versi pertama karena memakai `$KASIR`, yang **mati** sejak §105
  mengganti password kasir dan menaikkan `token_version`. Kegagalan token mati
  MENYAMAR jadi *"harusnya 200, dapat 401"* — bug produk palsu — dan gerbang
  itu ada persis untuk itu. Ia menangkapku dalam 227 ms, sebelum satu detik
  Postgres terpakai.

- **Batas yang diakui**: kunci ini menyerialkan `catatAbsen` saja. Penulisan
  `attendances` dari jalur lain (bila kelak lahir) tak ikut tertahan kecuali ia
  memakai kunci bernama sama — dan itu alasan kuncinya DIBERI NAMA, bukan
  ditanam di satu tempat · jeda-minimum antar-ketukan **tidak** ditambahkan:
  sesudah perbaikan ketukan ganda menghasilkan `masuk` lalu `keluar`, dan
  apakah itu yang diinginkan produk adalah keputusan tersendiri, bukan bagian
  dari utang ini.

- **Gerbang**: `typecheck` bersih · `npm test` **2.567** (214 berkas) ·
  **`verify-api.sh` 3.288 lolos / 0 gagal** (DB segar; §277 baru, 3 asersi) ·
  `audit:invarian` **26/26**. **Playwright e2e tidak dijalankan** — `apps/web`
  tak tersentuh satu baris pun (`git status` sebagai buktinya).

- **Utang balapan tersisa: 4** — `tibaBeliPerlengkapan`, `execPenjualan`,
  pembuatan penyewa, `pastikanSuperAdmin`.

---

## Penulisan yang GAGAL di layar — web — 2026-08-31 — **BERSIH** (10 tuduhan dicabut)

- **Kenapa vena ini ada**: putaran 19–22 menutup sisi BACA di layar — `useQuery`
  yang gagal menyamar jadi "tidak ada". Instrumennya dibangun untuk itu
  (`test/util/kueri-web.ts`, AST atas `.tsx`). Sisi TULIS tak pernah kebagian,
  dan bentuk kegagalannya lebih sunyi: **`useMutation` yang gagal tidak
  melempar dan tidak merender apa pun** — `onSuccess` sekadar tak jalan.
  Tombolnya ditekan, tak ada yang berubah, tak ada yang dikatakan. Di
  `kueri-web.ts`, `useMutation` muncul SATU kali, cuma sebagai petunjuk bahwa
  sebuah berkas punya tombol simpan.

- **Populasi**: **124 pengikatan `useMutation`** di **64 berkas** (nol yang tak
  bernama) · **tak ada jaring pengaman global** — `main.tsx:12` menyetel
  `defaultOptions: { queries: … }` saja, tanpa `MutationCache` ber-`onError`.

  | kelas | jumlah |
  |---|---|
  | `TERLIHAT` (galatnya sampai ke JSX) | **115** |
  | `ONERROR` | **8** |
  | `SENYAP` | **1**, terdaftar beralasan |

- **HASILNYA BERSIH — dan angka itu baru sah SESUDAH detektornya dibetulkan,
  sebab generasi pertamanya menuduh SEPULUH pintu yang benar.** Yang dicabut:
  empat di `PenerimaanPage`, tiga di `MejaPage`, dua di `OnboardingPage`, satu
  di `BahanPage`. Ini pencabutan terbesar sejak putaran 25.

- **Kenapa salah**: repo ini sudah memecahkan kelas ini dengan idiom yang
  LEBIH BAIK daripada `<ErrorText error={x.error}/>` telanjang. `lib/galat.ts`
  menyediakan

      galatTerbaru(...mutasi: { error: unknown; submittedAt: number }[])

  yang menerima **objek mutasinya**, bukan `.error`-nya, lalu memulangkan galat
  aksi yang paling BARU ditekan — supaya dua tombol di satu layar tak berebut
  satu slot pesan. Dipakai persis di ketiga berkas yang kutuduh
  (`PenerimaanPage:269`, `MejaPage:295`, `OnboardingPage:133`). Pemindai yang
  hanya kenal `x.error` melihatnya sebagai kesunyian. **Penjaganya ada di
  tempat yang tak dilihat pemindai** — pelajaran putaran 25, dibayar lagi.

- **Yang kesepuluh beda lagi, dan itu bentuk keempat yang sah**:
  `BahanPage.hapusBanyak` membawa kegagalannya di **nilai SUKSESNYA** —
  `Promise.allSettled` atas satu DELETE per bahan, lalu daftar id yang gagal
  dipulangkan dan `onSuccess` menyusunnya jadi kalimat per-bahan. Mutasi itu
  tak pernah menolak, jadi `.error`-nya memang selalu kosong. Terdaftar
  beralasan, `MAKS_UTANG = 1`.

- **DIUKUR DI PERAMBAN, dengan kegagalan yang DIPAKSA SECARA NYATA** — bukan
  `page.route` yang memalsukan balasan: mejanya dihapus lewat API SESUDAH layar
  memuat daftarnya, lalu tombol hapus di layar ditekan. Itu balapan yang
  sesungguhnya (dua orang, dua perangkat), dan server menjawab 404 aslinya.
  Premis "mejanya memang tampil" dibuktikan lebih dulu. **Kalimat kegagalannya
  muncul.** Bukti merahnya dijalankan, bukan diasumsikan: `<ErrorText>` dicabut
  dari `MejaPage` → spec-nya memerah tepat di asersi itu; dikembalikan → hijau.

- **TIGA CACAT DI ALAT UKUR SENDIRI, ditemukan karena spec barunya dijalankan
  bersama tetangganya** (Aturan 7):

  | cacat | bagaimana ketahuan |
  |---|---|
  | suite e2e duduk PERSIS di langit-langit kuota login (10 per IP+email per 5 menit) | menambah satu spec → `stok-awal-gagal` memerah dengan `TypeError: … reading 'length'`, yaitu **429 yang menyamar jadi bentuk data** |
  | `masukLewatSesi` menyusun sesi dari `/profil`, yang **bukan** bentuk `AuthState` | sesi tanpa `company_id`/`branch_id`/`sub` → `/pengaturan/meja` memantul ke `/dashboard`, dan premisnya runtuh tanpa satu galat pun |
  | 2 worker, cache sesi hidup per MODUL | tiap worker membayar login lagi; kuotanya habis walau cache-nya benar |

  Yang kedua paling tajam: `sesiApi` di berkas yang SAMA sudah menuliskan
  *"Badan login SUDAH berbentuk `AuthState` … tak perlu disusun ulang dari
  /profil"* — dan `masukLewatSesi` menyusunnya ulang dari `/profil`. **Komentar
  dan kode bertentangan di satu berkas**, dan yang salah kodenya.

- **Yang diperbaiki karena itu bukan kode produk melainkan alat ukurnya**:
  `masukLewatSesi` memakai `AuthState` apa adanya · `playwright.config.ts`
  dipatok `workers: 1` dengan alasan tertulis (kuota login DAN spec yang
  berbagi satu basis data yang dimutasi).

- **Bukti merah dua arah** pada pohon SUNGGUHAN: `<ErrorText>` dicabut dari
  `MejaPage` → gerbang unit merah menyebut ketiga mutasinya
  (`toggle`, `hapus`, `simpanTataLetak`) DAN spec peramban merah di asersinya.
  **PASANGAN**: `useQuery` tak ikut masuk populasi (sisi BACA punya gerbangnya
  sendiri) · `x.isPending`/`x.mutate(…)` yang mengalir ke JSX **tidak**
  membebaskan — kalau iya, gerbang ini membebaskan hampir semua situs.

- **Batas detektor, ditulis jujur**: aliran ditelusuri dalam SATU berkas — galat
  yang dioper sebagai prop ke komponen di berkas lain terbaca `TERLIHAT` tanpa
  diperiksa ujungnya · `alert()`/`console.error` tidak dihitung "terlihat" ·
  `mutateAsync` di dalam `try/catch` bentuk kelima yang TIDAK dikenali (nol di
  repo saat ini) · hanya `useMutation` yang diikat ke nama yang masuk populasi.

- **Gerbang**: `typecheck` bersih · `npm test` **2.567** (214 berkas, +11 uji) ·
  **`verify-api.sh` 3.285 lolos / 0 gagal** (DB segar) · `audit:invarian`
  **26/26** · **Playwright 11/11 hijau** (DB segar; dijalankan karena
  `apps/web` tersentuh). **Tak satu baris pun kode PRODUK berubah** —
  `apps/web/src` dan `apps/server/src` sama-sama tak tersentuh: putaran ini
  menambah gerbang dan membetulkan alat ukur.

---

## Tulisan yang tak menyentuh satu baris pun — server — 2026-08-31 — **BERSIH**

- **Kenapa vena ini ada**: putaran 28 bertanya *"baris mana yang
  DIPULANGKAN"*. Dualnya tak pernah ditanyakan: **berapa baris yang benar-benar
  DISENTUH, dan adakah yang memeriksanya?** `UPDATE … WHERE id = $1 AND
  company_id = $2` yang tak cocok baris apa pun BUKAN galat bagi Postgres — ia
  sukses dengan `rowCount = 0`. Kalau rutenya lalu membalas `{ ok: true }`,
  orang yang menekan Simpan diberi tahu bahwa perubahannya tersimpan atas baris
  yang tak pernah disentuh. Tak ada gejala, tak ada galat, tak ada cara menebak
  dari layar.

- **Populasi, terhitung dari pohon sintaks**: **161 penulisan** Drizzle lewat
  `db`/`tx` (**120** `update` · **41** `delete`) →

  | kelas | jumlah | dasar |
  |---|---|---|
  | `DILIHAT` | **79** | hasilnya diikat/dikembalikan/dipakai |
  | `DIJAGA` | **39** | hasilnya dibuang, tapi ada penolakan 404 di fungsinya |
  | `BUTA` | **43** | hasilnya dibuang, tak ada penjaga terlihat |

  Dari 123 penulisan yang ada di berkas rute, **23** berkelas `BUTA`.

- **HASILNYA: BERSIH — dan satu angka menjelaskan seluruhnya:**

      penulisan BUTA yang `where`-nya menyebut PARAMETER RUTE: 0

  Ke-23 itu semuanya menulis ke baris yang **tidak dipilih pemanggil**:
  `auth.company_id` dari token, daftar id yang barusan dibaca sendiri, baris
  token yang sudah divalidasi, sesi opname yang sedang dibuat. Nol baris di
  situ normal — impor CSV massal, hapus-lalu-sisip (UPSERT), retensi, backfill
  — bukan kegagalan.

- **DIUKUR LEWAT HTTP, seluruh populasi, bukan disimpulkan dari kode.** Ke-54
  rute pengubah ber-parameter ditembak dengan UUID acak (yang pasti tak ada di
  basis data mana pun):

  | jawaban | jumlah |
  |---|---|
  | 404 / 400 / 403 | **54** |
  | **2xx** | **0** |

  Daftar rutenya **diturunkan dari sumber** (`app.ts` → prefiks mount ×
  `modules/*/routes.ts` → metode + jalur ber-`:param`), bukan diketik — daftar
  yang diketik adalah cara rute berikutnya lahir tanpa dijaga, kesalahan yang
  sudah dibayar tiga putaran berturut-turut.

- **Yang berubah karena itu bukan kodenya, melainkan siapa yang menjaganya.**
  Ke-54 pintu benar hari ini sebab tiap penulisnya ingat; tak ada satu pun
  gerbang yang menjaganya tetap begitu, dan "ingat" adalah persis yang gagal di
  pintu ke-55. Vena ini memasang dua lapis untuk satu aturan:

  | lapis | menjawab | tak bisa dielakkan dengan |
  |---|---|---|
  | `test/tulisan-hasilnya-dilihat.test.ts` (10 uji) | bentuk KODE | menulis kode berbeda |
  | §276 `verify-api.sh` (3 asersi, 54 tembakan) | perilaku SUNGGUHAN | menulis penalaran yang salah |

- **Aturan yang dipaku bukan angka sembarangan melainkan INVARIAN**: *pemanggil
  tak boleh bisa MENAMAI baris bagi penulisan yang hasilnya tak diperiksa siapa
  pun.* Selama itu benar, "id tak dikenal" tak pernah bisa dijawab "tersimpan".
  Menuduh ke-43 `BUTA` akan salah — sebagian besar memang massal — dan gerbang
  yang menuduh impor CSV adalah gerbang yang ditutup orang.

- **Bukti merah, dua arah, pada pohon SUNGGUHAN**: penjaga
  `DELETE /kategori/:id` dicabut dan `where`-nya diganti `c.req.param("id")` →
  gerbang unit merah menyebut `modules/kategori/routes.ts:110
  delete(menuCategories)` · penjaganya saja dicabut lalu ditembak lewat HTTP →
  **§276 merah dan MENYEBUT rutenya**: `DELETE/kategori/:id(200)`.
  **PASANGAN**: rute itu ternyata **dijaga dua kali** (409 "masih dipakai
  menu", lalu 404) — pencabutan pertama tak cukup untuk memerahkannya, dan itu
  ketahuan justru karena bukti merahnya dijalankan alih-alih diasumsikan.

- **PASANGAN yang menentukan**: §276 tak boleh "lolos" karena semua
  permintaannya ditolak lebih awal (token rusak, prefiks salah, server mati).
  Satu rute pengubah dengan id SUNGGUHAN wajib tetap berhasil — dan itu
  diasersi tersendiri. Tanpa pasangan ini, sapuan yang menembak alamat yang
  keliru akan terbaca sebagai kebersihan sempurna.

- **Kelas kedua yang disapu di putaran yang sama, juga BERSIH**: **efek yang
  tak bisa di-rollback DI DALAM transaksi** — email, `fetch`, tulisan berkas,
  timer. Populasi **72** panggilan `.transaction(`, **0** pelanggaran. Sebuah
  email yang terkirim di dalam transaksi yang kemudian gagal tak bisa ditarik
  kembali; di repo ini bentuk itu tak ada.

- **Batas detektor, ditulis jujur**: penjaga dicari di FUNGSI PEMBUNGKUS
  TERLUAR — sengaja longgar, sebab menuduh handler yang penjaganya beberapa
  baris di atas lebih mahal daripada membebaskan lalu memilah tangan;
  konsekuensinya penjaga yang tinggal di pembantu bersama tak terlihat ·
  `rowCount` tak dilacak, hanya "nilainya dipakai atau tidak" · **SQL mentah
  (`db.execute(sql\`UPDATE …\`)`) bukan populasi ini** dan punya jalur sendiri ·
  §276 memakai token OWNER saja; peran lain tak disapu.

- **Gerbang**: `typecheck` bersih · `npm test` **2.556** (213 berkas, +10 uji) ·
  **`verify-api.sh` 3.285 lolos / 0 gagal** (DB segar; §276 baru) ·
  `audit:invarian` **26/26**. **Playwright e2e tidak dijalankan** — `apps/web`
  tak tersentuh satu baris pun, dan `src` server pun tidak: putaran ini menambah
  GERBANG, bukan mengubah perilaku.

---

## Urutan yang tidak MENENTUKAN, dan baris yang dipilihnya — server — 2026-08-31

- **Kenapa vena ini ada**: putaran 23 menghitung 86 pemotongan dan bertanya
  *berapa* baris yang dibuang; putaran 27 memberi tiga pintu berhalaman satu
  rumah `per_page`. Keduanya melewati pertanyaan yang menempel persis di
  sebelahnya: **`LIMIT n` memulangkan n baris yang MANA?**

- **POLA-META, KEENAM KALINYA — dan yang paling telanjang sejauh ini.**
  Gerbangnya sudah ada (`test/urutan-pemutus-seri.test.ts`, 98 baris) dan
  komentarnya sudah menuliskan aturannya DAN sumber serinya dengan benar:

  > *"`now()` di Postgres STABIL PER TRANSAKSI, jadi seluruh baris yang lahir
  > dalam satu transaksi berbagi `created_at` yang persis sama."*

  Lalu kodenya hanya melihat `.orderBy(` yang **dalam 500 karakter** berikutnya
  memuat `.offset(`, dan menghitung **KOMA** sebagai pengganti keunikan.

  | | |
  |---|---|
  | pengurutan di `src` | **143** (107 `.orderBy(` + 36 `ORDER BY` mentah) |
  | yang MEMOTONG (limit/offset serantai) | **52** (41 Drizzle + 11 templat `sql`) |
  | **yang dijaganya** | **2** |
  | ambang premisnya sendiri | `>= 2` — persis seluruh populasi yang dilihatnya, jadi kebutaannya tak bisa ketahuan dari dalam |

- **Populasi & kelas, sebelum → sesudah**: `TOTAL` **6 → 52** · `SERI`
  **46 → 0** · templat `sql` yang terlihat **0 → 11** · pintu ber-`OFFSET` **2**,
  satu di antaranya SERI.

- **TERUKUR LEWAT HTTP, pada data yang dibuktikan terbaca lebih dulu.**
  `GET /produksi` — pintu yang putaran 27 baru saja beri `per_page` — mengurut
  `MAX(CASE WHEN status NOT IN (…)) DESC, MIN(waktu) DESC`: dua kunci, keduanya
  **agregat**, tak satu pun unik; kunci GRUP-nya (`COALESCE(faktur_id, id)`)
  tak ada di `ORDER BY`. Gerbang lama meluluskannya karena komanya satu.

  60 faktur dengan `waktu` identik — persis bentuk yang ditulis jalur
  konfirmasi massal (`produksi/routes.ts:1288`: satu `new Date()` untuk semua
  barisnya). **Premisnya dibuktikan dari balasan rutenya sendiri lebih dulu**:
  `total: 60`, 60 baris terkirim, keenam puluh nomornya terbaca.

  | `per_page` | `total` dikatakan | terkumpul | **faktur BERBEDA** | **HILANG** |
  |---|---|---|---|---|
  | 5 | 60 | 60 | **56** | **4** |
  | 10 | 60 | 60 | **59** | **1** |
  | 20 | 60 | 60 | 60 | 0 |

  Menelusuri **seluruh** halaman sampai habis memulangkan 56 faktur berbeda
  dari 60 yang diakuinya sendiri. Empat tak muncul di halaman mana pun,
  sementara yang lain muncul dua kali — tanpa satu galat pun. Sesudah pemutus
  serinya dipasang: **60/60/60/60, hilang 0, ganda 0**, di keempat ukuran
  halaman.

- **Serinya bukan kebetulan langka, dan itu ditelusuri bukan diduga**: satu
  `POST` "Tambah Stok dari Menu" (`rekomendasi/rencana.ts:670–737`) melahirkan
  sampai **LIMA faktur berbeda dalam satu transaksi** — `now()` stabil per
  transaksi, jadi kelimanya seri sempurna pada `MIN(waktu)` DAN pada bendera
  statusnya.

- **Yang paling mahal justru yang tak pernah terlihat gerbang lama**: sebelas
  `ORDER BY` di dalam templat `sql`, enam di `stok/service.ts` — dan tiga di
  antaranya `ORDER BY so.created_at DESC LIMIT 1` yang memilih **BASELINE
  SALDO STOK**. Aturan yang sama disalin ke tiga pintu (`service.ts:82`,
  `:362`, `:607`, plus `routes.ts:299`), dan di ketiganya "opname terakhir"
  tak tertentu saat dua opname disetujui pada instan yang sama. Deret event
  FIFO (`:740`) juga: walk-nya menyusun **HPP** dari urutan itu.

- **Tuduhan lain yang jawabannya dipakai untuk MEMUTUSKAN**: `resolveBranchId`
  (`middleware/auth.ts:270`) memilih cabang bawaan pemilik dengan
  `ORDER BY branches.createdAt LIMIT 1` — dan `company/routes.ts:91–110`
  membuat **tiga cabang dalam satu transaksi**. Satu-satunya pintu sumbu cabang
  (vena putaran 16–17) memilih bawaannya sembarang. Ditambah cap absen terakhir
  (3 salinan) dan shift berjalan (2).

- **Detektornya sendiri salah EMPAT kali, dan keempatnya ketahuan dari bukti
  merah — bukan dari membaca ulang**:

  | cacat | bagaimana ketahuan |
  |---|---|
  | `grupTerpakai` memakai `includes`: kunci grup `k` dinyatakan hadir di dalam `MAX(waktu)` sebab kata *waktu* memuat huruf **k** | fikstur `h.ts` harusnya SERI, dijawab TOTAL |
  | `[…] as const` membungkus lariknya `TSAsExpression` — dua situs `...urutan` yang sudah diperbaiki tetap tertuduh | keduanya bertahan SERI sesudah diperbaiki |
  | `GROUP BY COALESCE(a, b)` dipecah `split(",")` jadi dua kunci palsu, jadi kunci grupnya tak pernah cocok lagi | `sampah/routes.ts` tetap SERI sesudah diperbaiki |
  | komentar SQL tak dibuang: `-- … LIMIT memilih …` terbaca sebagai klausa | batas dilaporkan bernama `memilih` |

  Keempatnya kini punya ujinya sendiri. Yang keempat paling perlu diingat:
  **pemindai yang bisa dibingungkan komentar bisa dibungkam dengan komentar.**

- **ALAT UKURNYA SENDIRI SALAH DUA KALI, dan verify-api yang menangkapnya**
  (Aturan 7). §275 generasi pertama menghitung `rows` sebagai satuan paginasi
  dan melaporkan *"7 faktur muncul di dua halaman"* atas paginasi yang
  sebenarnya benar — `total` menghitung FAKTUR, `rows` mengirim satu baris per
  item, jadi satu faktur memakai delapan baris di halaman yang sama. Asersi
  kedua mengadu peringkat faktur dengan urutan BARIS, padahal barisnya diambil
  kueri KEDUA yang mengurut `waktu ASC, id ASC`. Keduanya diperbaiki: tiap
  halaman di-dedup dulu, dan yang dipaku kontrak kueri kedua.

- **Bukti merah pada pohon SUNGGUHAN, dua arah**: `keyExpr` dicabut dari
  `produksi` → merah menyebut berkas, baris & kedua kuncinya · `, e.ev_id ASC`
  dicabut dari deret FIFO → merah menyebut `stok/service.ts:740` — jalur
  `sql` mentah yang gerbang lama **tak pernah bisa lihat**.

- **PASANGAN**: pengurutan yang **tidak** memotong tak ikut dituduh (seri pada
  daftar yang dipulangkan utuh cuma soal tampilan) · kueri beragregat yang
  menyebut kunci grupnya tetap hijau · indeks unik **parsial**
  (`uniqueIndex(...).where(...)`) tidak dihitung membuat total · `MAX(id)`
  bukan `id`.

- **Perbaikannya tak boleh mengubah yang terlihat**, dan itu dipaku: kunci
  PERTAMA tak disentuh di satu pun dari 46 situs; §275 memaku urutan baris
  `GET /produksi` tetap menaik menurut waktu, bentuk balasannya tetap, dan
  saldo stok tetap terbaca.

- **Batas detektor, ditulis jujur**: hanya kunci TELANJANG menyumbang keunikan
  — agregat & templat dicatat sebagai ekspresi · indeks unik parsial diabaikan
  · JOIN tak dimodelkan, jadi tupel unik sebuah tabel bisa membebaskan terlalu
  cepat pada kueri yang menggandakan baris · sisi `sql` mentah diresolusi lewat
  NAMA kolom saja, tanpa tahu alias mana menunjuk tabel mana · pengurutan yang
  dilakukan di JS sesudah kueri bukan populasi ini · `ORDER BY` yang dirakit di
  luar templat `sql` tak terlihat.

- **§275 verify-api** (8 asersi): menelusuri seluruh halaman `produksi` &
  `penerimaan` dengan `per_page=2` → tiap satuan TEPAT SEKALI · nol yang muncul
  di dua halaman · himpunan halaman kecil == sekali ambil · tiga PASANGAN.

- **Gerbang**: `typecheck` bersih · `npm test` **2.546** (212 berkas) ·
  **`verify-api.sh` 3.282 lolos / 0 gagal** (DB segar; §275 baru) ·
  `audit:invarian` **26/26**. **Playwright e2e tidak dijalankan** — `apps/web`
  tak tersentuh satu baris pun (`git status` sebagai buktinya).

---

## Masukan dari QUERY tak punya rumah — server — 2026-08-27

- **Kenapa vena ini ada**: repo ini sudah menghabiskan satu vena penuh
  menertibkan masukan dari **BADAN** — 97 `zValidator("json", …)`, 112 skema
  `.strict()`, batas angka bersama di `lib/batas-angka.ts`, gerbangnya sendiri
  (`badan-tak-menerima-kunci-asing.test.ts`), dan seksi verify-api §240 yang
  memakunya. Pintu **QUERY** tak pernah kebagian.

  | pintu masuk | skema | gerbang | batas bersama |
  |---|---|---|---|
  | badan (`json`) | **97** `zValidator` | ya | ya |
  | **query** | **0** `zValidator` | tidak | tidak |

  Dan query di aplikasi ini menyetir hal yang mahal: `branch_id`, rentang
  tanggal, `page`/`per_page`, `status`, `limit`.

- **Populasi**: **47 pembacaan `c.req.query(...)`**. Dua di antaranya sudah
  punya rumah — `branch_id` lewat `resolveBranchId` (putaran 16) dan tanggal
  lewat `lib/tanggal-query.ts` (venanya sendiri, dengan komentar yang mengukur
  36 pembacaan). Sisanya menjaga dirinya sendiri, **sebagian besar dengan
  BENAR** — dan justru itu yang menyamarkan masalahnya: aturan yang dipegang
  tiga penulis berbeda akan menjadi tiga aturan.

- **TERUKUR lewat HTTP — satu permintaan yang sama, `per_page=500`, ke tiga
  pintu berhalaman:**

  | pintu | dibatasi di | dikatakan? |
  |---|---|---|
  | `GET /penerimaan/riwayat` | **100** | ya (`per_page: 100`) |
  | `GET /produksi` | **200** | ya (`per_page: 200`) |
  | `GET /transfer-stok` | **200** | **tidak** — balasannya tak memuat `per_page` |

  Bawaannya pun bertiga sendiri-sendiri: **20, 20, 50**.

- **Rumah baru `lib/halaman-query.ts`, dan ia SENGAJA tidak menyeragamkan
  angkanya.** Menaikkan batas sebuah pintu mengubah apa yang dilihat klien,
  dan itu keputusan pemilik pintunya — bukan efek samping sebuah refaktor.
  Yang diseragamkan **cara membacanya**: satu tempat yang tahu bahwa
  `per_page=abc`, `per_page=-5`, `per_page=1e9`, dan `per_page` yang hilang
  semuanya harus mendarat di angka yang masuk akal. Tiap pintu tetap
  **menyebut** `bawaan` & `maks`-nya — dan gerbangnya menuntut keduanya
  disebut, sebab batas yang tak terlihat adalah batas yang pelan-pelan berbeda
  dari batas tetangganya. Kembarannya `lib/tanggal-query.ts`, yang membuktikan
  bentuk ini benar.

- **Satu UTANG putaran 23 dibayar sekalian**: `GET /transfer-stok` ternyata
  **tidak berhalaman sama sekali** — ia menerima `per_page` tapi tak punya
  `offset`; ia daftar ber-langit-langit. Jadi yang benar di situ bukan nomor
  halaman melainkan **penanda pemotongan** (idiom putaran 23): ambil
  `perPage + 1`, potong, kirim `rows_terpotong`. `MAKS_UTANG` gerbang
  pemotongan turun **9 → 8** — batas yang tak pernah turun berhenti jadi batas.

- **Angka sebelum → sesudah**: tiga salinan aturan halaman **3 → 1 rumah** ·
  pintu yang memotong tanpa mengatakannya **1 → 0** · `Number(c.req.query(…))`
  telanjang: **4**, semuanya terdaftar beralasan dan tiap alasannya bisa
  ditunjuk (klem ada, hanya di baris/objek berikutnya — di luar jangkauan
  pemindai yang berlingkup satu pernyataan).

- **Gerbang lama menangkap perubahanku TIGA kali, dan ketiganya benar**:
  `potong-berpenanda` menuntut entri `transfer` dihapus begitu dibayar ·
  `bendera-hapus-disaring` memerah **dua kali** karena entrinya dikunci
  `berkas:baris`, dan satu baris `import` yang kutambahkan menggeser 1228 jadi
  1229. Kuncinya diganti jadi `berkas tabel<induk>` — **pembusukan kunci
  bernomor baris sudah dibayar sekali di `pelaku.test.ts`, dan sekali cukup**.

- **Bukti merah pada pohon SUNGGUHAN, dua arah**: `Number(c.req.query("ambil"))`
  baru tanpa klem → merah menyebut berkas & barisnya; mengembalikan klem
  sebaris di `transfer` (menggantikan rumahnya) → **dua** premis merah
  sekaligus. **PASANGAN**: param query yang bukan angka (`q`, `status`, `sesi`)
  tak ikut dituduh — bahaya sebuah ANGKA adalah besarnya, dan menuduh semuanya
  akan membuat gerbang ini ditutup orang alih-alih dipatuhi.

- **Premisnya dibuktikan di FIKSTUR, bukan di pohon**: sesudah halaman pindah
  ke rumahnya, tak ada lagi klem sebaris di `modules/` — dan itu memang
  tujuannya. Premis yang bersandar pada "kebetulan masih ada contohnya" akan
  diam-diam berhenti membuktikan apa pun begitu contohnya diperbaiki.

- **Batas detektor, ditulis jujur**: hanya angka yang disapu (`Number(...)` di
  sekitar `c.req.query`); teks & enum sengaja di luar populasi · lingkupnya
  satu PERNYATAAN, jadi klem di baris berikutnya tak terlihat — dan keempat
  entri daftarnya persis kasus itu · `zValidator("query")` tetap nol, dan itu
  pilihan: rumah kecil yang dipakai lebih murah daripada skema yang tak dipakai.

- **§274 verify-api**: batas tiap pintu berlaku DAN dikatakan · `per_page=abc`
  jatuh ke bawaan bukan 500 · `per_page=-5` → 1 · `page=0` → 1 · `page=abc`
  → 1 · `transfer` membawa `rows_terpotong`, dan daftar yang muat tak dituduh
  terpotong.

- **Gerbang**: `typecheck` bersih · `npm test` **2.535** (212 berkas) ·
  **`verify-api.sh` 3.274 lolos / 0 gagal** (DB segar; §274 baru: 9 asersi) ·
  `audit:invarian` **26/26**. **Playwright e2e tidak dijalankan** — `apps/web`
  tak tersentuh satu baris pun (`git status` sebagai buktinya).

---

## Bentuk balasan yang ditentukan TABELNYA, bukan penulisnya — server — 2026-08-27

- **Kenapa vena ini ada**: enam putaran menutup satu keluarga di sisi
  KELUARAN — bacaan yang gagal, yang terpotong, penulisan tanpa penahan,
  penulisan ke baris terbuang. Yang belum pernah ditanyakan sama sekali:
  **apa yang MASUK ke balasan tanpa ada yang memilihnya?**

- **Populasi**: **298 situs `c.json`** di ≥25 berkas · `DISEBUT` **220**
  (objek literal / hasil pembantu) · `KOLOM` **72** (dari `select({ … })`
  berkolom eksplisit) · **`BARIS_PENUH` 6** · **`RAHASIA` 0**.

- **Taruhannya bukan teoretis**: basis data ini menyimpan
  `users.password_hash`, `smtp_settings.password`, token undangan MENTAH, dan
  dua tabel `token_hash`. Satu `c.json(user)` di rute baru mengirim hash bcrypt
  seluruh akun. Yang menjaga hal itu tidak terjadi, sampai putaran ini:
  **tidak ada apa-apa** — hanya kebiasaan menulis DTO dengan tangan.

- **Aturan B bersih, dan itu DITELUSURI bukan dianggap.** Delapan kandidat
  yang ditandai penelusuran kasar semuanya bermuara di `buatSesi`
  (`auth/session.ts:42`), yang merakit `payload` kolom demi kolom; dan
  `smtpDto` (`admin-system/routes.ts:44`) mengirim
  `has_password: Boolean(row?.password)` — penandanya, bukan rahasianya.
  Keduanya contoh yang benar, dan gerbangnya wajib membiarkan keduanya hijau —
  itu salah satu uji PASANGAN-nya.

- **Enam situs diperbaiki, dan semuanya jinak HARI INI**:
  `company` ×2, `admin-tenants`, `customer` ×2, `penjualan`. `companies`,
  `customers`, dan `sales` memang tak punya kolom rahasia. Yang diperbaiki
  bukan kebocoran melainkan **ketiadaan keputusan**: bentuk balasannya
  mengikuti bentuk TABEL, jadi satu kolom yang ditambahkan besok — catatan
  internal, penanda tagihan, apa pun — ikut terkirim ke semua klien tanpa satu
  baris kode pun berubah dan tanpa satu orang pun memutuskannya.

- **PENGUKURAN yang membuktikan perbaikannya benar adalah bahwa ia TAK
  MENGUBAH APA PUN.** `src/db/kolom-publik.ts` dibuat dari kolom yang hari ini
  sudah terkirim, lalu dipasang lewat `.select(KOLOM_…)` / `.returning(KOLOM_…)`:

  | | |
  |---|---|
  | kunci `GET /company` sebelum | 22 |
  | kunci `GET /company` sesudah | **22, identik** (`diff` kosong) |

  Perbaikan yang mengubah balasan adalah perbaikan yang salah. Yang berubah
  cuma satu: mulai sekarang penambahan kolom harus **disengaja** untuk sampai
  ke luar.

- **PEMINDAINYA SALAH TIGA KALI, dan ketiganya tertangkap oleh dua cara
  menghitung yang tak cocok** — bukan oleh membaca pemindainya:

  | # | cacat | bagaimana ketahuan |
  |---|---|---|
  | 1 | hanya mengenal `select()` telanjang, buta pada **`returning()` telanjang** — yang sama luasnya | sapuan teks melaporkan 3 situs, AST melaporkan 2 |
  | 2 | uji keterkandungan **terbalik**: simpul rantai membentang seluruh rantainya, jadi `.update(T)` adalah KETURUNAN `returning()`, bukan leluhurnya | jumlahnya berubah 2 → 4 sambil dua situs `select()` diam-diam pindah kelas jadi "KOLOM" |
  | 3 | rantai yang jadi **badan callback** (`tanpaBentrok(() => …returning())`) berhenti di panahnya, barisnya tak pernah terikat nama | satu situs `customer` tetap "KOLOM" padahal bentuknya sama persis dengan tetangganya |

  Angka akhirnya **6**, dan tiap angka sebelumnya (2, 4, 5) adalah pemindai
  yang rusak dengan cara berbeda.

- **Daftar kolom rahasia DIBACA DARI SKEMA, bukan diketik** — `pgTable` diurai,
  nama kolom dicocokkan `password|secret|token|hash|apikey`. Hasilnya **5
  tabel** (`users`, `invitations`, `smtpSettings`, `passwordResetTokens`,
  `emailVerificationTokens`), cocok persis dengan daftar yang kubuat tangan
  saat pengintaian — dua cara menghitung yang sepakat. Daftar yang diketik
  adalah cara kolom rahasia BERIKUTNYA lahir tanpa dijaga; kesalahan itu sudah
  dibayar dua putaran berturut-turut, saat gerbang menuduh `potongLarik` lalu
  `kunciBackfillKode` karena regexnya hafal nama lama.

- **Angka sebelum → sesudah**: `BARIS_PENUH` **6 → 0** · `RAHASIA` **0 → 0**,
  dan nol yang kedua itu kini **dijaga**, bukan diharapkan. `MAKS_UTANG = 0`:
  aturan B tak punya pengecualian yang sah.

- **Bukti merah pada pohon SUNGGUHAN, dua arah**: mencabut `KOLOM_COMPANY`
  dari `GET /company` → merah (aturan A); mengganti
  `c.json(await buatSesi(user))` jadi `c.json(user)` di `/auth/login` → merah
  (aturan B) **dan** uji PASANGAN-nya ikut merah, persis seperti seharusnya.
  **PASANGAN**: `select({ … })` berkolom tak dituduh · DTO yang dirakit di
  tempat tak dituduh · `buatSesi` & `smtpDto` yang SUNGGUHAN tetap hijau.
  **CAKUPAN** dipaku: ≥200 situs, ≥25 berkas, ≥150 `DISEBUT`, ≥50 `KOLOM`,
  ≥4 tabel rahasia — dan tabel biasa (`sales`, `companies`) wajib TIDAK ikut
  tertandai, supaya polanya tak diam-diam melebar jadi menuduh semuanya.

- **§273 verify-api**: 18 kunci `GET /company` dipaku satu per satu (kunci yang
  hilang berarti kontrak yang dicabut diam-diam) · balasan login tak memuat
  `password_hash` maupun `token_version` · **PASANGAN**: login tetap
  memulangkan tokennya · SMTP mengirim `has_password`, bukan `password`.

- **Batas detektor, ditulis jujur**: penelusuran asal berlingkup satu fungsi —
  baris yang melewati pembantu di berkas lain tak terlihat, dan justru itulah
  yang membuat `buatSesi` aman di matanya (yang sampai ke `c.json` hasil
  pembantunya, bukan barisnya) · `SELECT *` di SQL mentah tak disapu aturan A ·
  pola nama kolom rahasia adalah heuristik yang sengaja LEBAR (`token`
  menangkap `tokenVersion` yang bukan rahasia — tabelnya memang perlu dijaga).

- **Gerbang**: `typecheck` bersih · `npm test` **2.527** (211 berkas) ·
  **`verify-api.sh` 3.265 lolos / 0 gagal** (DB segar; §273 baru: 23 asersi) ·
  `audit:invarian` **26/26**. **Playwright e2e tidak dijalankan** — `apps/web`
  tak tersentuh satu baris pun (`git status` sebagai buktinya).

---

## Menulis ke baris yang sudah DIBUANG — server — 2026-08-27

- **Kenapa vena ini ada, dan ini yang paling pantas dicatat**: gerbang audit
  ini SENDIRI punya pintu yang dilewatinya tanpa alasan tertulis.
  `test/util/bendera-hapus.ts` menyapu bendera "baris ini tidak berlaku lagi"
  dan doc-nya menyebut taruhannya terang-terangan — *"yang ikut terhitung
  adalah UANG …, STOK …, dan ATRIBUSI KERJA"* — lalu di baris 146:

  ```ts
  if (menulis) return "MENULIS";   // ← rantai yang menulis: berhenti di sini
  ```

  `MENULIS` tak pernah dituduh, dan **tak ada satu kalimat pun** yang
  menjelaskan kenapa boleh begitu. Kali **KELIMA** berturut-turut pola yang
  sama muncul — gerbang jujur, buta pada bentuk yang justru dilewatkan catatan
  pengecualiannya sendiri — dan kali ini gerbangnya lahir dari audit ini juga.

- **Angka pengecualian itu sendiri menyesatkan**: `MENULIS` = **3**, dan dua di
  antaranya modul Tempat Sampah yang memang pekerjaannya. Terlihat sepele —
  sampai disadari bahwa `situsDrizzle` berangkat dari `.from()`/`.join()`, jadi
  `db.update(productions).where(…)` polos **tak pernah jadi situs sama sekali**.
  Yang dilewatkan bukan 3, melainkan **36 penulisan**, **19** di antaranya
  tanpa satu sebutan pun benderanya.

- **Populasi sesudah sisi penulisan disapu**: **40 situs tulis** —
  `TULIS_MENYARING` **20** · `TULIS_DIJAGA` **14** · `TULIS_SAMPAH` **2** ·
  **`TULIS_TELANJANG` 1**. Sisi bacaan ikut membaik: `MENYARING` 71 → **72**,
  `TELANJANG` 29 → **28**.

- **HASILNYA BERSIH, dan itu kesimpulan yang harus dibayar mahal.** Empat
  tuduhan berturut-turut dicabut sesudah ditelusuri — tiap pencabutan
  mengajari pemindainya satu bentuk penjagaan yang memang dipakai repo ini:

  | tuduhan | kenapa salah | yang dipelajari |
  |---|---|---|
  | 5 penulisan `produksi/routes.ts` | syaratnya dirakit di `const kunci = and(…, isNull(deletedAt))` lalu `.where(kunci)` | telusuri variabel — mata yang **sudah** dipakai sisi bacaan (`LEWAT_VARIABEL`) |
  | penulisan bersarang di `produksi` | saringannya di badan handler, penulisannya beberapa lapis di dalam `transaction(…map(…))` | lingkupnya fungsi **TERLUAR**, bukan terdekat |
  | `users/service.ts`, `seed/guest.ts` | backfill & seed memang menyentuh baris lama apa adanya | wewenang dikenali dari nama FUNGSI, bukan cuma nama berkas |
  | **4 pintu papan dapur** (`pesanan/routes.ts`) | `pastikanKartu` — penjaga bersama dengan `isNull(sales.deletedAt)` — dipanggil sebagai baris PERTAMA tiap handler yang mengubah (:571, :682, :766, :835) | kenali penjaga bersama se-berkas |

- **TERUKUR lewat HTTP sungguhan** — penjualan dibuang ke Tempat Sampah, lalu
  tombol dapur ditekan pada barisnya:

  | | |
  |---|---|
  | papan pesanan memuatnya | **tidak** (0 kartu — sisi bacaan memang menyaring) |
  | `POST /pesanan/penjualan/:id/item/:itemId/status` | **404** "Pesanan tidak ditemukan" |
  | status baris sesudahnya | **tak berubah** (`dikerjakan`) |
  | baris `pesanan_logs` tertulis | **0** |

  Inilah kenapa keempat tuduhan itu dicabut, bukan diperbaiki: kodenya sudah
  benar, dan yang salah adalah pemindaiku.

- **SATU perbaikan, dan ia soal SIAPA yang memegang jaminannya**:
  `autoFileRakCabang` menata rak untuk daftar id yang dikirim pemanggilnya.
  Ketiga pemanggilnya hari ini mengoper id dari `.returning()` penulisan yang
  syaratnya sudah menyaring — jadi alasannya benar, dan sudah **terdaftar
  beralasan** di gerbang lama. Tetap dibayar: jaminannya ada di PEMANGGIL,
  sementara fungsi itu menerima daftar id apa adanya, dan pemanggil KEEMPAT
  yang mengambil id dari tempat lain akan diam-diam memindahkan baris terbuang
  ke rak. Kini ia menyaring sendiri di kedua kuerinya — dan gerbang lamanya
  langsung menuntut entri daftarnya dihapus, yang memang dilakukan.

- **`TULIS_TELANJANG` yang tersisa: 1**, terdaftar beralasan.
  `produksi/routes.ts:1228` — syaratnya ADA dan justru paling teliti di berkas
  itu (`conds` memuat `isNull(productions.deletedAt)`), tapi sampai ke situ
  sebagai **parameter** (`const { conds } = k`), bukan deklarasi lokal, jadi
  penelusuran variabelnya buntu. Batas "berlingkup satu fungsi" yang sudah
  ditulis, bekerja persis seperti yang ditulis.

- **Bukti merah, pada pohon SUNGGUHAN**: mencabut `isNull(productions.deletedAt)`
  dari `autoFile` → tertuduh; mencabut panggilan `pastikanKartu` dari papan
  pesanan → **keempat** pintunya tertuduh sekaligus. **PASANGAN**: Tempat
  Sampah tak pernah dituduh (memulihkan & menghapus-permanen adalah
  pekerjaannya) · ketiga bentuk penjagaan diterima (syarat langsung, lewat
  variabel, lewat bacaan hulu) · penulisan telanjang buatan tetap tertuduh.
  **CAKUPAN** dipaku: ≥30 situs tulis, dan tiap kelas aman wajib berpenghuni —
  nol di situ berarti instrumennya rusak, bukan repo-nya bersih.

- **Batas detektor, ditulis jujur**: penjaga yang dipanggil dari BERKAS LAIN
  tak terlihat · syarat yang datang sebagai parameter tak terlihat (dan itulah
  satu-satunya entri daftarnya) · nama tabel dibandingkan sebagai teks.

- **Gerbang**: `typecheck` bersih · `npm test` **2.517** (210 berkas) ·
  **`verify-api.sh` 3.245 lolos / 0 gagal** (DB segar) · `audit:invarian`
  **26/26**. **Playwright e2e tidak dijalankan** — `apps/web` tak tersentuh
  satu baris pun (`git status` sebagai buktinya).

---

## Periksa-dulu-baru-tulis: siapa yang menahan saat dua orang bersamaan — server — 2026-08-27

- **Kenapa vena ini ada**: repo ini punya **21 berkas uji** yang menyebut
  `FOR UPDATE`, advisory lock, atau balapan — dan tiap satunya menguji **SATU
  pintu**. Yang tak pernah ada: sapuan atas seluruh populasi. Halaman pertama
  ledger ini menulis kenapa itu penting: *"Tak satu pun ditemukan dengan
  membaca kode; semuanya muncul dari menyapu seluruh populasi lalu memisahkan
  yang menyimpang."*

- **Aturannya, lagi-lagi, sudah ditulis lengkap** — di `src/lib/kunci.ts`,
  beserta ketiga jawaban sahnya:

  > *"Pola 'periksa dulu, baru tulis' hanya aman bila ada sesuatu untuk
  > DIKUNCI. … Indeks unik menutup celah itu bila aturannya bisa ditulis
  > sebagai kesamaan kolom … Yang TIDAK bisa: aturan bertindih rentang
  > tanggal. Untuk itu kuncinya harus diambil atas NAMA aturan."*

  Dan `modules/pengajuan/routes.ts:337` menamai yang keempat: *"Idiomnya sudah
  baku di basis kode ini — lihat persetujuan penyesuaian opname: UPDATE
  bersyarat status + periksa barisnya + 409/404."*

- **Populasi**: **58 fungsi di 32 berkas** yang MEMBACA lalu MENULIS **tabel
  yang sama** (baca tabel A lalu tulis tabel B bukan balapan — penulisannya
  atomik, dan induk yang terhapus bersamaan hanya membuatnya gagal FK).
  `KUNCI` **21** · `BENTROK` **12** · `KLAIM` **16** · `KLAIM_BUTA` **5** ·
  `TELANJANG` **4**.

- **TEMUAN, dan ia tanda tangan sesi ini dalam bentuk paling murni.** Tiga
  fungsi mengerjakan pekerjaan yang sama persis — mengisi kode unik-per-
  perusahaan saat boot & seed, dengan keunikan dijamin sebuah `Set` yang hidup
  di dalam SATU proses:

  | pengisi kode | advisory lock | indeks unik |
  |---|---|---|
  | `backfillEmployeeCode` (users) | **ya**, dengan komentar *"dua instance server yang boot bersamaan tak mengisi kode ganda"* | **ya** (`memberships_company_kode_uq`) |
  | `backfillKodeBahan` | **tidak** | **tidak** |
  | `backfillKodeMenu` | **tidak** | **tidak** |

  Komentar kolomnya bahkan menuliskan jaminan yang tak berlaku: *"kode produk
  ringkas … unik per company **via generator**"*.

- **TERUKUR, bukan dinalar** (basis data seed, 232 bahan, 0 kode ganda):

  | | sebelum | sesudah |
  |---|---|---|
  | dua `backfillKodeBahan` serentak | terisi **232 + 230** | terisi **232 + 0** |
  | kode ganda dalam satu perusahaan | **2** (`BB264`, `BB238` — masing-masing dua bahan) | **0** |

  Dan ini bukan keadaan langka: penyebaran repo ini memutar instance baru
  sebelum yang lama berhenti, jadi dua boot yang bertindih adalah keadaan
  NORMAL.

- **Perbaikannya memakai rumah yang sudah ada**: `kunciBackfillKode` di
  `src/lib/kunci.ts` — satu tempat, dengan angka pengukurannya tertulis di
  situ, supaya pengisi kode KEEMPAT tak lahir tanpa penahan.

- **PEMINDAINYA SALAH TIGA KALI, dan ketiganya tertangkap dengan membaca
  situs yang dituduhnya** — bukan dengan membaca pemindainya:

  | # | tuduhan | kenapa salah |
  |---|---|---|
  | 1 | `POST /stok/opname/sesi/:id/acc` | ia memulangkan `{ ok, jumlah: updated.length }` — untuk operasi borongan, mengabarkan BERAPA yang kena lebih jujur daripada melempar. Dan pintu ini justru yang **dirujuk** `pengajuan/routes.ts` sebagai contoh baku. |
  | 2 | `backfillKodeBahanTx` — **perbaikanku sendiri** | regex penahannya hanya kenal `kunciAntrean`, bukan `kunciBackfillKode` yang baru lahir. Sekarang pembantunya dikenali dari BENTUK nama (`kunci…(`), bukan dari daftar nama — daftar nama adalah cara gerbang menuduh pembantu berikutnya. |
  | 3 | `POST /shift/kunci-hitungan` | ia membaca ULANG sesudah klaimnya, dan komentarnya sudah menulis alasannya: *"yang kalah balapan harus melaporkan nominal yang BENAR-BENAR tersimpan, bukan yang ia kirim."* Idiom KELIMA, yang gerbangnya lalu diajari. |

- **TUDUHAN YANG DICABUT sesudah ditelusuri**: `catatRealisasiDana`
  (`faktur_dana`, uang) terlihat telanjang — baca total, hitung selisih,
  sisipkan. Ditelusuri ke KEDUA pemanggilnya: keduanya berjalan sesudah klaim
  tahap faktur (`WHERE status = <yang dibaca> AND qty = <yang dibaca>` +
  `returning` + 409 `status_berubah`), jadi permintaan kedua kalah di situ dan
  tak pernah sampai. Batas "berlingkup satu fungsi" yang sudah ditulis, bekerja
  persis seperti yang ditulis.

- **Angka sebelum → sesudah**: tertuduh **11 → 9** (dua backfill dikunci) ·
  dari 9 sisanya **4 `sah`** (alasannya bisa ditunjuk) dan **5 `utang`** yang
  jumlahnya dipaku `MAKS_UTANG` dengan syarat batasnya wajib TURUN.

- **Utang yang diakui, berangka, dengan nama** (5): `catatAbsen` — cap absen
  berikutnya ditentukan dari cap terakhir yang dibaca, dan `attendances` tak
  punya indeks unik apa pun · `tibaBeliPerlengkapan` — klaimnya ADA tapi
  hasilnya tak dilihat, jadi yang kalah tetap dibalas sukses · `execPenjualan`
  · pembuatan penyewa · `pastikanSuperAdmin`, yang tetangganya di berkas
  sebelah sudah menunjukkan jawabannya.

- **Bukti merah pada pohon SUNGGUHAN, dua arah**: mencabut kunci dari
  `backfillKodeBahan` → merah (`expected 'KLAIM_BUTA' to be 'KUNCI'`); fungsi
  baru yang membaca lalu menyisipkan tabel yang sama → merah menyebut berkas,
  baris, kelas, dan tabelnya. **PASANGAN**: baca tabel A lalu tulis tabel B
  bukan balapan · keempat penahan diterima · klaim yang hasilnya tak dilihat
  TETAP tertuduh · klaim yang dibaca ulang diterima. **CAKUPAN** dipaku: ≥45
  situs, ≥25 berkas, dan tiap kelas aman wajib ≥10 anggota — nol di salah
  satunya berarti pemindainya buta, bukan repo-nya bersih.

- **Batas detektor, ditulis jujur**: lingkupnya satu FUNGSI, jadi kunci yang
  dipegang PEMANGGIL tak terlihat (dan itulah yang membuat tuduhan
  `catatRealisasiDana` lahir) · nama tabel dibandingkan sebagai TEKS argumen,
  jadi alias & subquery di SQL mentah tak terlihat · "hasilnya diperiksa"
  dinilai dari pengenal yang muncul di `if`/`throw`/`c.json` di fungsi yang
  sama.

- **Gerbang**: `typecheck` bersih · `npm test` **2.509** (210 berkas) ·
  **`verify-api.sh` 3.245 lolos / 0 gagal** (DB segar) · `audit:invarian`
  **26/26**. **Playwright e2e tidak dijalankan** — `apps/web` tak tersentuh
  satu baris pun (`git status` sebagai buktinya).

---

## Daftar yang DIPOTONG, dan terbaca sebagai lengkap — server + web — 2026-08-27

- **Kenapa vena ini ada**: empat putaran terakhir mengejar satu kelas di tiga
  permukaan klien — **bacaan yang GAGAL menyamar jadi "tidak ada"**. Saudara
  kandungnya hidup satu lapis lebih hulu, di kontrak server→klien, dan belum
  pernah disapu sama sekali: **bacaan yang TERPOTONG menyamar jadi LENGKAP.**

- **Aturannya bukan karanganku — ia sudah ditulis panjang**, di
  `modules/customer/routes.ts:50`, dan menyebut dua sisi:

  > *"`.limit(300)` yang polos akan menjawab 'Total belanja Rp 3.000.000'
  > untuk member yang sebenarnya sudah belanja Rp 40.000.000 — angka salah
  > yang kelihatan wajar. … Memotong daftar TANPA menyediakan pencarian di
  > server membuat member ke-301 tak bisa ditemukan sama sekali."*

  Penjaganya dipasang di **satu** pintu. Pintu lain ke keadaan yang sama
  dibiarkan terbuka — tanda tangan sesi ini, untuk kesekian kalinya.

- **Populasi** (`.limit()` Drizzle **dan** `LIMIT` di templat `sql`):
  **86 situs di 36 berkas** · `SATU` (ambil satu baris) **46** ·
  `BERPENANDA` **11** · `HALAMAN` **2** · **`SENYAP` 27**.

- **PEMINDAINYA SALAH LIMA KALI SEBELUM BENAR SEKALI**, dan tiap kesalahan
  akan mengirimku memperbaiki kode yang sudah benar. Ini bagian paling
  berguna dari putaran ini, jadi ditulis lengkap:

  | # | cacat | akibatnya kalau dipercaya |
  |---|---|---|
  | 1 | `namaProperti()` dari `ast.ts` sengaja hanya melayani `MemberExpression`; kupanggil untuk `Property` → `undefined` | **BERPENANDA = 0** padahal enam pintu memakai idiomnya |
  | 2 | `CallExpression` `.limit()` membentang SELURUH rantai, jadi `n.start` menunjuk `db.select(` | tiap baris meleset **10–20 baris** ke atas |
  | 3 | `LIMIT` di SQL mentah tak disapu | `stok/service.ts` terbaca **tak punya pemotongan sama sekali**, padahal ada tiga — satu di antaranya 20.000 event FIFO |
  | 4 | kunci `total` dihitung sebagai tanda paginasi | **pembebasan palsu**: `sampah` memotong 300 lalu memulangkan kunci `total` yang di situ berarti **rupiah** |
  | 5 | hanya kenal SATU cara mengatakan "terpotong" | menuduh `sampah`, yang mengabarkannya lewat **header** `X-Kakarut-Terpotong` — dan header itu **dibaca kedua klien** |

  Yang membetulkan (5) bukan pembacaan melainkan satu pertanyaan: *kalau
  memang senyap, kenapa dua klien punya kode untuk membacanya?* Tiap kali,
  yang menangkap cacatnya adalah **ketidakcocokan angka antara dua cara
  hitung** — grep tangan vs AST — bukan mata.

- **TIGA idiom untuk satu aturan, dan itu sendiri temuan.** Kunci badan
  `*_terpotong` (objek), header `X-Kakarut-Terpotong` (larik telanjang), dan
  sejak putaran ini pembantu bersama `potongLarik`. Keduanya yang pertama
  sudah ada dan sudah dipakai; yang belum ada rumahnya. `HEADER_TERPOTONG`
  dulu tetapan **privat** di `sampah/routes.ts` — dipindah (bukan disalin) ke
  `src/lib/potong.ts` begitu pintu kedua membutuhkannya.

- **Kenapa header, bukan kunci badan**: tiga dari empat pintu yang diperbaiki
  memulangkan **larik telanjang**, dan bentuk itu tak boleh berubah — tujuh
  build ponsel yang pernah rilis membacanya `as List`, dan repo ini **tak
  punya gerbang versi klien** (pelajaran `TataLetakBody` yang sudah tercatat).
  Header lewat begitu saja pada klien yang tak memintanya.

- **PENGUKURAN lewat HTTP sungguhan, kode lama vs kode baru, DATA YANG SAMA**
  (`GET /menu/:id/riwayat-harga`, 60 perubahan harga di basis data):

  | | sebelum | sesudah |
  |---|---|---|
  | baris di basis data | 60 | 60 |
  | baris terkirim | 50 | 50 |
  | `X-Kakarut-Terpotong` | **tidak ada** | **50** |
  | yang hilang tanpa sepatah kata | **10** | 0 |

  **Premisnya dibuktikan** (Aturan 6): baris suntikan terbaca dari balasan
  **rutenya sendiri** (`harga_baru = 10002`), bukan dari `SELECT count(*)`.

- **Empat pintu diperbaiki, dan tiap satunya punya SAUDARA yang sudah benar** —
  itulah yang membuatnya jelas bukan keputusan, melainkan kelalaian:

  | pintu | saudaranya yang sudah benar | akibat potongannya |
  |---|---|---|
  | `GET /shift/selisih` | `GET /shift/:id` (`transaksi_terpotong`) | **antrean putusan selisih kas**: "tinggal 50" atas antrean yang lebih panjang, dan yang paling lama menunggu justru yang paling mudah terlupakan |
  | `GET /menu/:id/riwayat-harga` | `GET /bahan/:id/riwayat-harga` (`lots_terpotong`) | riwayat harga pendek terbaca sebagai "harga menu ini tak pernah diubah sebelum itu" |
  | `GET /stok/penyesuaian` | — | antrean tinjauan; layarnya menghitung berapa yang siap disetujui **dari daftar itu** |
  | `GET /supplier/:id/kartu` | `GET /customer/:id` (`transaksi_terpotong`) | separuh aturannya sudah benar (`total_belanja` dihitung di SQL tanpa batas) — jadi total BENAR di atas daftar yang PENDEK, dan orang yang menjumlahkan daftarnya mengira pembukuannya yang salah |

- **`/shift/selisih` butuh DUA sebab pemotongan disebutkan**, dan yang kedua
  tak terlihat dari panjang hasilnya: penyaringan status terjadi SESUDAH
  query, jadi baris yang lolos saring bisa tertinggal di luar `AMBIL_SELISIH`
  dan tak pernah sampai untuk dihitung. Komentar di atas `.limit`-nya sudah
  menalar soal itu — lalu potongan terakhirnya dibuang tanpa sepatah kata.

- **Angka sebelum → sesudah**: `SENYAP` **27 → 23** · `BERPENANDA` **11 → 15**.
  Dari 23 yang tersisa: **14 `sah`** (alasannya struktural dan bisa ditunjuk)
  dan **9 `utang`** yang jumlahnya kini dipaku `MAKS_UTANG` dengan syarat
  batasnya wajib TURUN begitu terbayar.

- **Utang yang diakui, berangka, dengan nama** (9 situs): riwayat sesi & baris
  opname (`stok` ×3, `perlengkapan` ×3) · riwayat shift tertutup ·
  statistik lama-pengerjaan per menu (`laporan`) · `transfer` yang berhalaman
  di query tapi balasannya tak memuat total.

- **Satu situs dibebaskan dengan alasan yang ditulis**: `stok/service.ts:741`
  memotong 20.000 event FIFO dengan idiom `+1` yang benar — penandanya dirakit
  di fungsi **pemanggil** (`:833`). Pemindai ini berlingkup satu fungsi, dan
  situs inilah yang membuat batas itu perlu ditulis.

- **Bukti merah pada pohon SUNGGUHAN, dua arah**: `.limit(77)` baru yang tak
  terdaftar → merah menyebut berkas & barisnya; entri daftar yang situsnya
  sudah diperbaiki → merah (`sudah tak ada situsnya — hapus entrinya`).
  **PASANGAN**: `.limit(1)`/`LIMIT 1` bukan pemotongan · ketiga idiom diterima ·
  kunci `total` SENDIRIAN bukan tanda paginasi · `page`/`per_page` diterima ·
  kata LIMIT di komentar bukan situs · barisnya menunjuk `.limit`, bukan awal
  rantai. **CAKUPAN** dipaku: ≥75 situs, ≥55 Drizzle, ≥12 SQL mentah, ≥30
  berkas, dan lima berkas ber-idiom disebut namanya.

- **Tiga gerbang lain ikut menangkap perubahanku**, dan ketiganya benar:
  `daftar-tanpa-langit-langit.test.ts` memaku teks balasan `/sampah` (jangkarnya
  diperbarui **beserta alasannya** — menuntut ejaan `HEADER_TERPOTONG` di
  berkas itu justru akan menghukum pemindahannya ke rumah bersama) ·
  `lampiran-dto-utuh.test.ts` (Lampiran A disegarkan) ·
  `kunci-satu-kontrak.test.ts` — fikstur kontrak di repo **ponsel** jadi basi
  begitu `rows_terpotong` lahir. Fikstur itu diregenerasi; ia data kontrak,
  bukan fitur, dan membiarkannya merah berarti mendorong gerbang merah.

- **Batas detektor, ditulis jujur**: pemotongan yang terjadi murni di JS
  (`slice`, `take`) tanpa `.limit()` maupun `LIMIT` **tidak terlihat** ·
  lingkup pencarian penandanya satu FUNGSI, jadi penanda yang dirakit dua
  fungsi jauh butuh adjudikasi tangan · `adaAgregat` PETUNJUK triase, bukan
  vonis.

- **Sisi ponsel dicatat sebagai utang, bukan diklaim beres**: `GET
  /stok/penyesuaian` hanya dibaca ponsel, dan header `X-Kakarut-Terpotong`
  yang kini dikirimnya belum dirender layar Penyesuaian Stok. `api_client.dart`
  sudah punya jalurnya (dipakai layar Sampah), jadi yang kurang perenderannya.

- **Gerbang**: `typecheck` bersih (server+web) · `npm test` **2.498**
  (209 berkas) · build web ✔ · **`verify-api.sh` 3.245 lolos / 0 gagal**
  (DB segar; §272 baru: 11 asersi) · `audit:invarian` **26/26** ·
  Playwright e2e **10/10**. Repo ponsel: `flutter test --no-pub` **599 hijau**
  sesudah fikstur kontraknya diregenerasi.

- **Gerbang KELIMA menagih keputusan lintas repo, dan itu benar**:
  `kunci_kontrak_server_test.dart` di repo ponsel menolak kunci kontrak baru
  yang tak diurai DAN tak dicatat. `rows_terpotong` dicatat di
  `kunci-belum-dibaca.txt` beserta alasannya — ponsel tak punya layar kartu
  supplier sama sekali, jadi ini fitur yang belum ada, bukan kunci yang
  dilewatkan.

- **Commit**: Cabang `claude`; fikstur & catatan
  kontrak di `mohteja/kakarut-mobile@314b521`.

---

## `.value` polos: antrean offline yang tak terbaca — mobile — 2026-08-27

- **Kenapa vena ini ada**: utang yang kucatat sendiri berangka putaran lalu —
  *"`.value` polos pada `AsyncValue` membuang galat dengan cara yang persis
  sama dan belum disapu; 102 situs di 39 berkas."* Putaran ini membayarnya, dan
  yang ditemukan letaknya **lebih dalam** dari situs-situs itu.

- **PREMISNYA DIJALANKAN, BUKAN DIINGAT (Aturan 7).** Seluruh penggolongan
  vena ini berdiri di atas satu perbedaan yang **tak terlihat dari bentuk
  kodenya**. Dibaca dari sumber riverpod 3.3.2 lalu **dijalankan** di
  `ProviderContainer` sungguhan:

  | keadaan | `.value ?? kosong` | `asData?.value ?? kosong` | `hasError` |
  |---|---|---|---|
  | muat PERTAMA gagal | **kosong** | **kosong** | true |
  | refresh gagal, data lama ada | data **BASI** | **kosong** | true |

  Jadi `asData` runtuh pada SETIAP kegagalan; `.value` runtuh hanya pada muat
  pertama, dan pada refresh yang gagal ia menyajikan data basi tanpa ada yang
  diberi tahu. Dua kebohongan, satu kelas — dan angkanya sekarang dipaku
  `test/nilai_async_semantik_test.dart`, jadi riverpod yang berubah (atau
  ingatanku yang salah sejak awal) memerahkan uji, bukan diam-diam
  menggeser kesimpulan.
  Ikut terukur di situ: **`is AsyncError` salah** — sesudah muat pertama yang
  gagal kelas konkretnya `AsyncLoading` dengan `hasError` true. `lib/` memang
  tak memakai bentuk itu sekali pun (0 dari 104), dan sekarang itu punya
  alasan, bukan kebetulan.

- **Populasi**: `.value` polos pada provider yang **TERBUKTI** ber-`AsyncValue`
  — 78 provider dibaca dari deklarasinya sendiri, bukan ditebak dari namanya —
  **101 situs**, ber-`??` **44**, bawaannya runtuh **40**.
  Sebarannya: `authControllerProvider` 63 · `cabangListProvider` 12 ·
  `printerControllerProvider` 6 · `syncQueueProvider` 5 · `companyProvider` 4 ·
  `ketersediaanProvider` 4.

- **TEMUAN — dan ia tak ada di satu pun dari 40 situs itu.**
  `SyncQueueController.build()` menjawab blob antrean yang tak bisa didekripsi
  dengan `catch (_) { return []; }`. Blob itu dienkripsi dengan kunci di secure
  storage; **kunci itu terikat perangkat, SharedPreferences tidak**. Restore
  backup Android, keystore yang direset, atau pemasangan ulang yang menyisakan
  preferensi meninggalkan pasangan yang tak cocok — dan `SecureBox._kunci()`
  menjawab kunci yang hilang dengan **MEMBUAT KUNCI BARU**.

  Terukur, satu penjualan **Rp150.000** berstatus `pending` di penyimpanan:

  | | sebelum | sesudah |
  |---|---|---|
  | antrean terbaca | **0 perintah** | 0 perintah |
  | `hasError` | **false** | false |
  | blob aslinya | ditimpa `_persist` berikutnya | **diselamatkan** |
  | dialog logout | **diam** | memperingatkan |

  Dialog itu ada **justru** untuk memperingatkan bahwa antrean offline DIBUANG
  saat keluar — komentarnya menuliskan aturannya. Ia membaca `pending == 0`,
  dan nol itu punya dua sebab yang di layar terlihat sama.

- **Dan `hasError` yang tetap `false` adalah bagian yang pantas dinamai.**
  Penjaga yang kupasang putaran lalu memaafkan situs yang membawa `hasError`
  penerima yang sama. Di sini kegagalannya **tak pernah sampai ke
  `AsyncValue`** — ia sudah ditelan satu lapis di bawah. Ini kali **keempat
  berturut-turut** sebuah gerbang yang jujur buta pada bentuk yang dilewatkan
  catatan pengecualiannya sendiri, dan kali ini gerbangnya milikku sendiri,
  berumur satu putaran. Gerbang `galat_ditelan` juga tak melihatnya: badan
  `catch`-nya **tidak kosong** (`return [];`), dan gerbang itu hanya menyapu
  yang kosong.

- **Perbaikannya**: blob yang tak terbaca **dipindahkan** ke
  `kakarut.sync_queue.rusak` (bukan ditimpa) dan tanggalnya dicatat;
  `antreanRusakProvider` membuatnya bisa ditanyai layar; `SyncBanner` melukis
  pita merah `_PitaAntreanRusak`; dialog logout menolak diam. Tetap
  memulangkan daftar **kosong** dengan sengaja: melempar akan mematikan
  seluruh antrean — perintah BARU pun tak bisa masuk, dan kasir kehilangan
  mode offline sepenuhnya. Kosong + penanda yang terlihat lebih baik daripada
  macet total ATAU diam.

- **Tiga perbaikan lain, semuanya "kalimat yang salah", bukan sekadar angka
  yang hilang**: gerbang buka-kasir offline memisahkan *"tidak ada bukti
  absen"* dari *"status absen tak terbaca"* — kalimat lamanya menyuruh orang
  yang SUDAH absen untuk absen lagi, di jam paling sibuk, dengan jalan keluar
  yang tak akan menolongnya · kartu pengajuan cuti tak lagi menulis kalimat
  ajakan biasa saat hitungannya gagal · kedua `.value` di `sync_banner`
  lewat `baca()`.

- **Rumah bersama**: `lib/core/nilai_async.dart` — `baca(v, kosong)`
  memulangkan `(nilai, gagal, basi)`. `gagal` = bawaannya benar-benar dipakai;
  `basi` = ada data lama tapi penyegaran terakhirnya gagal. Kedua keadaan itu
  yang selama ini hilang, dan keduanya lahir langsung dari tabel premis di
  atas.

- **TUDUHAN YANG DICABUT, dan pencabutannya lebih berguna dari tuduhannya.**
  `openBillListProvider` ×2 — gerbang *"satu meja dine-in = satu bill"* —
  awalnya kubaca sebagai temuan paling mahal putaran ini: daftar yang gagal
  terbaca ⇒ gerbang lolos ⇒ bill kedua di meja yang sudah terisi ⇒ satu
  tertinggal tak tertagih. Dibaca ke server: `open-bill/routes.ts:509`
  menguncinya di dalam transaksi (`SELECT … FOR UPDATE`) lalu membalas **409
  berkode `bill_berjalan` beserta `bill_id`**, dan klien menangkapnya di
  `kasir_page:2740` untuk langsung menggabungkan pesanan ke bill itu. Yang
  hilang percakapan yang lebih enak, bukan bill yang tak tertagih. Bukan
  temuan.

- **Detektor**: gerbang `as_data` digabung jadi SATU rumah `nilai_async` yang
  menyapu **kedua pintu** — salinan yang dibiarkan berbeda dari saudaranya
  adalah cara kelas ini tumbuh kembali (pelajaran `buta_komentar` di repo yang
  sama). Tiap situs yang tersisa runtuh wajib terdaftar dengan **KELAS**-nya:
  `sah` (alasannya struktural dan bisa **ditunjuk**) atau `utang` (masih
  runtuh, diakui). Utangnya **dihitung** dan dipaku `maksUtang = 8`, dan
  batasnya wajib turun begitu terbayar — batas yang tak pernah turun berhenti
  jadi batas.

- **Pengecualian terbesar dipaku pada PREMISNYA, bukan disalin 18 kali.**
  18 situs `authControllerProvider` bersandar pada satu fakta: `main.dart`
  menggerbangi seluruh aplikasi dengan `.when(data:, loading:, error:)` dan
  hanya memulangkan layar dalam pada cabang `data:` dengan sesi bukan-null.
  Fakta itu punya ujinya sendiri — mengubah bentuk gerbang itu memerahkan
  suite, yang berarti seseorang harus membaca ulang ke-18 pengecualian itu.
  Menyalin kalimat yang sama ke 18 berkas tak membuat adjudikasinya lebih
  teliti, hanya lebih panjang.

- **KELOLOSAN PEMINDAI, ditemukan dan diukur**: bawaan
  `const <String, MenuStokDto>{}` terpotong di koma **di dalam `<>`** —
  `_operan` berhenti di `,` kedalaman nol dan `<`/`>` bukan kurung — sehingga
  terbaca `const <String`, tak cocok pola runtuh, dan situsnya lolos
  **diam-diam**. Satu situs (`tambah_stok_menu_page.dart:294`), tanpa apa pun
  yang memberi tahu. Sesudah lompatan generik dipasang: **44 → 46 tertuduh**.
  Ini bentuk yang sama dengan under-report putaran 19 & 21: daftar pola selalu
  kurang panjang, dan yang menemukannya bukan pembacaan melainkan
  ketidakcocokan angka antara dua cara hitung.

- **Angka sebelum → sesudah**: tertuduh pintu `.value` **46 → 40** (6 dibawa
  ke `baca()` / `hasError`) · tertuduh pintu `asData` tetap **10** · dari 40
  yang terdaftar, **32 `sah`** dan **8 `utang`** yang jumlahnya kini dipaku.

- **Utang yang DIAKUI, berangka, dengan nama** (8 situs): peta sisa porsi
  `ketersediaanProvider` ×4 + `ketersediaanCabangProvider` ×1 — hilangnya
  menghapus badge stok DAN peringatan *"⚠️ Melebihi sisa stok"*; `mejaStatus`
  ×1 — semua meja tampak bebas; `statusBarisPesanan` ×1 — tiap baris tampak
  belum dikerjakan; `printerController` ×1 — daftar printer tiket menghilang.

- **Bukti merah, pada pohon SUNGGUHAN, tiga arah**: situs `.value` baru yang
  tak terdaftar → merah menyebut berkas & barisnya; salinan **KETIGA** dari
  penerima yang terdaftar 2 kali → merah (`terdaftar 2, sekarang 3`); dan
  **mengubah bentuk gerbang sesi di `main.dart`** → merah. **PASANGAN**: idiom
  `.when(error:)` tak tersentuh · `.value` pada provider BUKAN-`AsyncValue`
  (`cartProvider`, `apiClientProvider`) tak dituduh · situs yang membawa
  `hasError`-nya hijau (lewat `.`, `?.`, `!.`) · bawaan yang menyebutkan
  dirinya (`-1`, sebuah pesan) bukan keruntuhan · antrean yang SEHAT terbaca
  utuh dan tak menyalakan penanda rusak. **CAKUPAN** dipaku: ≥30 situs
  `asData`, ≥80 situs `.value`, ≥25 berkas, ≥60 provider terdeteksi.

- **Gerbang keempat ikut menangkap perubahanku**: `galat_ditelan_test.dart`
  memerah begitu `_simpanRusak` menambah satu `catch` di `sync_queue.dart`
  (2 → 3) — dan entrinya diperbarui **beserta alasannya**: menyimpan catatan
  bahwa penyimpanan gagal, lalu penyimpanan catatan itu sendiri gagal.

- **Batas yang ditulis**: pencarian `hasError` berlingkup satu **berkas**,
  bukan satu fungsi · hanya bentuk `?? …` yang dituduh · `.value` polos hanya
  terlihat bila penerimanya `ref.watch(P)`/`ref.read(P)` — `.value` pada
  variabel lokal ber-`AsyncValue` dan pada provider yang dirakit lewat
  perantara **tidak terlihat** · pemindai leksikal, bukan pengurai Dart.

- **Gerbang**: `flutter analyze lib test` **bersih** · `flutter test --no-pub`
  **599 hijau** (dari 585; 14 uji baru). **Repo server tak tersentuh** kecuali
  ledger ini — jadi `typecheck`, `npm test`, dan `verify-api` tidak dijalankan,
  dengan `git status` sebagai buktinya.

- **Commit**: `mohteja/kakarut-mobile@cbb0aa5` di cabang `claude`.

---

## `asData`: pintu keluar yang membuang galat — mobile — 2026-08-27

- **Kenapa vena ini ada**: tiga putaran terakhir menutup satu kelas di web —
  bacaan yang gagal menyamar jadi "tidak ada", sebagai kalimat, sebagai angka
  & lencana, lalu sebagai formulir kosong yang bisa disimpan. Permukaan
  ketiga, **aplikasi ponsel**, belum pernah disapu instrumen sesi ini sama
  sekali. Kelasnya ada di sana, dengan bentuk yang khas Dart.

- **Bentuknya, dan kenapa ia berbeda dari saudaranya di web**: aplikasi ini
  memakai idiom yang **terstruktur**. `AsyncValue.when(data:, loading:,
  error:)` MEMAKSA cabang galat ditulis, dan idiom itu dihormati **69 kali**
  (hanya 2 di antaranya merender `SizedBox.shrink`, dan keduanya hiasan layar:
  baris chip kategori, pemilih cabang). Yang bocor bukan jalan utamanya
  melainkan **pintu keluarnya**:

  ```dart
  ref.watch(pengajuanMenungguProvider).asData?.value ?? 0
  ```

  `asData` bernilai `null` pada **loading MAUPUN error**. Satu `?? 0` di situ
  menghapus perbedaan antara "tak ada yang menunggu" dan "tak berhasil
  ditanya" — kembaran Dart persis dari `(data ?? []).length` yang putaran 19
  tutup di `Layout.tsx`.

- **PENGUKURAN (Aturan 6 di permukaan ini)**: bukan status internal
  `AsyncValue`, melainkan **teks yang muncul di layar**, dibaca dengan
  memompa widget-nya. Ekspresi yang dipakai `kasir_page.dart` saat itu, apa
  adanya:

  | provider | teks di layar | lencana |
  |---|---|---|
  | SEHAT | `[Pengajuan, 3]` | 1 |
  | GAGAL | `[Pengajuan]` | **0** |

  Pembandingnya disimpan permanen di `test/lencana_gagal_test.dart` sebagai
  `_LencanaLama` — tanpa itu, "sudah diperbaiki" tak punya angka.

- **Populasi**: `asData` **40 situs di 12 berkas** · ber-`??` **36** ·
  bawaannya **runtuh** (tak terbedakan dari bacaan sehat yang memang kosong:
  `0`, `const []`, `''`, `false`) **35** · runtuh **dan** tanpa keadaan gagal
  yang terbaca di mana pun: **13**. Sebarannya: `kasir_page.dart` 17 ·
  `dashboard_page.dart` 9 · `dashboard_tim.dart` 4.

- **TEMUAN 1 — kelompok notifikasi beranda kasir & manajemen (12 situs).**
  Kembar persis lencana `Layout.tsx`: penerimaan menunggu, kiriman
  perlengkapan, SO menunggu ACC, permintaan berjalan, pengajuan cuti, selisih
  kas, area kotor, pesanan dikerjakan. Semuanya lenyap tanpa sepatah kata.
  Di `dashboard_page`/`dashboard_tim` bentuknya lebih buruk: `BarisAksi`
  melukis **"—"** untuk nol MAUPUN gagal, jadi layarnya secara aktif
  menyatakan "tak ada".

- **TEMUAN 2 — status absen, di DUA beranda.** `asData?.value ?? const []`
  ⇒ daftar kosong ⇒ `sudahAbsen = false` ⇒ kartu amber **"Anda belum absen
  masuk"**, sama persis dengan keadaan sehat. Bukan lencana yang hilang
  melainkan pernyataan yang salah tentang orang yang sedang membacanya.

- **TEMUAN 3 — spanduk kiriman perlengkapan** (`perlengkapan_stok_page`).
  Hilang tanpa sepatah kata, dan badan layarnya milik provider **LAIN**
  (`perlengkapanListProvider`), jadi galatnya tak muncul di mana pun di layar
  itu.

- **TEMUAN 4 — ditemukan oleh gerbangnya sendiri, bukan oleh mata.**
  `selisihMenunggu` sudah kubetulkan pembacaannya, tapi `gagal:`-nya tak
  kusalurkan ke lencananya. Yang menunjuknya rancangan aturan pasangan
  (`hasError` penerima yang sama) saat gerbangnya ditulis — 13 tertuduh, dan
  satu di antaranya perbaikanku sendiri yang setengah jadi.

- **Perbaikannya, dan kenapa BUKAN nol**: `badgeAsync` / `badgeAsyncDari` di
  `core/widgets/badge_angka.dart` — SATU tempat yang membedakan "tak ada yang
  menunggu" dari "belum tahu". Saat gagal yang dilukis **pil abu bertanda
  `!`**, sengaja bukan `BadgeAngka(angka: 0)`: aturan yang sudah bernama di
  ledger ini, *"lencana gagal ≠ lencana nol"* — menampilkan nol saat gagal
  justru memperkuat kebohongan yang sedang diperbaiki. `loading` tetap
  memulangkan `null`: lencana yang berkedip tiap penyegaran 30 detik akan
  mengajari orang mengabaikannya.

- **Angka sebelum → sesudah**: situs runtuh-tanpa-pasangan **13 → 10** ·
  situs yang kini menyalurkan `hasError`-nya ke layar **0 → 15** ·
  populasi `asData` tetap **40** (yang berubah bukan jumlahnya, melainkan
  apakah kegagalannya sampai ke mata).

- **Sepuluh yang TETAP runtuh, didaftarkan beralasan — bukan disembunyikan.**
  Tiap satunya dibaca tangan; alasannya tertulis di `test/as_data_test.dart`
  dan ditagih dua arah:
  `ref.read(menuListProvider)`/`(mejaListProvider)` ×4 — tabel pencarian untuk
  MELENGKAPI nama; `muatBill` sengaja jatuh ke nama & harga yang TERKUNCI di
  bill-nya sendiri, dan komentarnya menjelaskan kenapa (baris yang hilang dari
  keranjang akan terhapus dari bill saat disimpan) · `tempatAsync`/`rakAsync`
  ×2 di dua layar opname — `_itemVisible` jatuh **terbuka** dan kartu "Semua
  tempat" tetap membawa jumlah item PENUH, jadi layarnya tak pernah terbaca
  sepi · `penyesuaian_page` — hanya menyetir penghitung di bilah judul,
  sedangkan badan layarnya `async.when` atas provider yang SAMA melukis
  galatnya tepat di bawahnya · `kategoriBahanProvider` — chip SARAN untuk
  kolom yang tetap diketik bebas · `penyimpananProvider` — dropdown yang
  kosongnya sudah punya arti tertulis di `helperText`-nya sendiri ("Biarkan
  kosong = rak yang sudah ada TIDAK diubah") · `analisis_harga_page` —
  tombolnya hanya ada bila ada pilihan, dan pilihan cuma bisa lahir dari
  cabang `data:` provider yang sama.

- **Detektor**: `test/util/as_data.dart` + `test/as_data_test.dart`, mengikuti
  konvensi yang sudah ada di repo ponsel (`galat_ditelan`: sapuan teks atas
  sumber yang komentarnya dibutakan `buta_komentar`, daftar per-berkas
  beralasan, ditagih dua arah). Yang dituduh bukan `asData`-nya melainkan
  **pasangan bawaan-yang-runtuh TANPA `hasError` penerima yang sama** di
  berkas itu.

- **Bukti merah, pada pohon SUNGGUHAN** (bukan hanya fikstur suntikan):
  1. situs `?? 0` baru yang tak terdaftar → merah, menyebut berkas & barisnya;
  2. salinan **KETIGA** dari penerima yang terdaftar 2 kali → merah
     (`terdaftar 2, sekarang 3`) — **pendaftaran bukan amnesti**.
  **PASANGAN**: idiom `.when(error:)` yang benar tak tersentuh sama sekali ·
  situs yang membawa `hasError`-nya tetap hijau (lewat `.`, `?.`, dan `!.`) ·
  bawaan yang MENYEBUTKAN dirinya (`-1`, sebuah pesan) bukan keruntuhan ·
  `asData?.value` tanpa `??` tak meruntuhkan apa pun · prosa di komentar bukan
  situs. **CAKUPAN** dipaku: pemindai wajib menemukan ≥30 situs di ≥8 berkas.

- **Batas yang ditulis, dan ketiganya penting**:
  1. pencarian `hasError` berlingkup **satu BERKAS**, bukan satu fungsi —
     penerima bernama pendek (`v`, `async`) bisa berpasangan dengan `hasError`
     milik blok lain di berkas yang sama;
  2. hanya bentuk `?? …` yang dituduh — `asData?.value` yang dipakai sebagai
     nilai nullable dilewati, begitu pula `…asData?.value != null`;
  3. **`.value` polos pada `AsyncValue`** (tanpa `asData`) membuang galat
     dengan cara yang persis sama dan **belum disapu** — **102 situs di 39
     berkas**. Dicatat berangka sebagai utang, bukan diklaim bersih.
  Satu lagi yang jujur disebut: bawaan `const NilaiStokRingkas(nilai: 0, …)`
  di `stok_page.dart:136` **lolos** pola "runtuh" karena ia sebuah objek —
  padahal Rp0 di layar juga tak terbedakan dari sehat. Aturannya sengaja tidak
  dilebarkan ke sembarang objek; situs itu dicatat di sini.

- **Negatif bersih yang diukur putaran ini dan layak dicatat**, supaya tak
  disapu ulang: cabang `error:` mobile (69, hanya 2 senyap dan keduanya
  hiasan) · kedaluwarsa cache mobile (kriterianya **tertulis** — "cache
  dipakai sebagai IZIN bertransaksi wajib kedaluwarsa" — dan diterapkan pada
  `/shift/aktif` dengan angka yang dicocokkan ke toleransi susulan server) ·
  daftar putih cache disk (6 endpoint, tiap pengecualian beralasan) ·
  `config/env.ts` (divalidasi zod saat boot) · `kolom-numerik.ts`
  (kelengkapannya ditagih dua arah, entri basi ditolak) · SQL mentah (60
  pernyataan, 26 tanpa `company_id`, semuanya terkurung transitif lewat
  `branchId` atau infrastruktur global) · `rute.ts` vs tabel Hono sendiri
  (276 vs 275, bedanya hanya `GET /health` — utang AST itu **dicabut**,
  berangka).

- **Gerbang**: `flutter analyze lib test` **bersih** · `flutter test --no-pub`
  **585 hijau**. **Repo server tak tersentuh** kecuali ledger ini — jadi
  `typecheck`, `npm test`, dan `verify-api` tidak dijalankan, dengan
  `git status` sebagai buktinya.

- **Commit**: `mohteja/kakarut-mobile@62709b2` di cabang `claude`.

---

## Bacaan gagal yang MENGISI FORMULIR — dan spinner yang tak pernah berhenti — web — 2026-08-27

- **Kenapa vena ini ada**: putaran lalu menutup bentuk ANGKA dan menyisakan
  utang yang kucatat sendiri, berangka — **47 situs `LAIN`**, *"dicatat
  berangka, bukan diklaim bersih."* Putaran ini membayarnya, dan di dalamnya
  ada dua kelas yang keduanya nyata; satu di antaranya **merusak**, bukan
  sekadar menyesatkan.

- **Pola yang pantas dinamai, sebab ini kali KETIGA berturut-turut**: sebuah
  gerbang yang JUJUR — batasnya tertulis — ternyata buta pada bentuk yang
  justru dilewatkan oleh catatan pengecualiannya sendiri. Kali ini
  `spinner-abadi.test.ts`, yang menulis:

  > `// Bukan dari useQuery (mis. state lokal) → bukan urusan penjaga ini.`

  Pengecualian itu benar untuk state yang benar-benar lokal, dan **keliru
  justru ketika state itu hanya pernah diisi dari data kueri**. Gerbang yang
  sama sudah menuliskan pelajarannya dua paragraf di atas baris tersebut:
  *"penjaga yang cuma mengunci SATU penulisan dari sebuah kesalahan memberi
  rasa aman yang lebih berbahaya daripada tak ada penjaga sama sekali."*

- **TEMUAN 1 — formulir terisi dari bacaan yang gagal (MERUSAK).**
  `StokAwalPage` memuat saldo pembuka ke formulir lewat efek; bacaan gagal ⇒
  efek tak jalan ⇒ formulir **kosong**, tak terbedakan dari "belum pernah
  diisi". Terukur di peramban:

  | | |
  |---|---|
  | tersimpan di basis data | **90 baris** saldo pembuka |
  | `GET /stok/awal` dibalas 500 | **0 input terisi** |
  | kalimat kegagalan di layar | **tak satu pun** |
  | tombol simpan | **tetap ada** |

  Yang terjadi berikutnya bukan kebingungan melainkan **pekerjaan**: orang
  mengetik ulang saldo yang sudah ada, dan `POST /stok/awal` mengganti baris
  lama beserta tanggalnya — baseline yang putaran 18 sudah tunjukkan menyetir
  seluruh pelaporan stok. Tiga saudaranya sekelas: `SupplierBahanModal`
  (simpan melepas SELURUH supplier bahan), `ResepPage` (efeknya **aktif**
  memanggil `setLangkah([])` saat bacaan gagal, lalu Simpan Resep menulis
  kosong itu), `MenuFormPage`/`LihatMenuPage`.

- **TEMUAN 2 — spinner abadi lewat dua bentuk yang tak terlihat.**
  `UbahBahanBakuPage:137` — `if (isLoading || rows === null) return <Spinner/>`
  dengan `rows` hanya diisi efek dari `bahan`: bacaan gagal ⇒ berputar
  selamanya, tanpa kalimat dan tanpa apa pun yang bisa ditekan.
  Dan `MenuFormPage:289` — `if (!bahan || !kategori || (id && !menuEdit))` —
  regex gerbang lama memakai `[^)]*`, yang **tak bisa melewati kurung dalam**,
  jadi barisnya **tak pernah COCOK**: bukan diloloskan beralasan, melainkan
  tak terlihat sama sekali.

- **Tuduhan yang DICABUT**: `SmtpPage:102` (`!form`) tertangkap pemindai, lalu
  dibaca tangan — ia didahului `if (!data) return <SpinnerAtauGalat …/>` dua
  baris di atasnya, dan komentarnya menjelaskan penantian itu memang berakhir
  dalam satu render. Bukan temuan.

- **Angka sebelum → sesudah**: `ISI_FORM` **5 → 0** · penjaga spinner
  tertuduh **3 → 0** · `GALAT` **101 → 107** · `LAIN` **47 → 43** ·
  `PILIHAN` 15 → 10.

- **Batas yang ditulis, dan ia penting**: `LAIN` berarti *"tak cocok dengan
  satu pun bentuk klaim yang DIKENAL"* (kalimat, angka, formulir) — **bukan**
  "terbukti tak berbahaya". Angkanya dipaku uji supaya penyusutannya terlihat
  dan pertumbuhannya ditanyai, bukan supaya ia dianggap beres. Badan
  `useEffect` dibaca sebagai TEKS, bukan pohon — cukup untuk bentuk "setter
  dipanggil di efek yang bergantung pada data", dan tak lebih.

- **Menahan simpan adalah perbaikannya, bukan kelonggaran**: menyimpan DI ATAS
  bacaan yang gagal persis kerusakan yang dicegah. `StokAwalPage` dan
  `SupplierBahanModal` menahan tombolnya; `ReceiptModal` **tidak** — menolak
  mencetak struk karena kopnya gagal dimuat akan menahan transaksi yang
  uangnya sudah diterima, jadi yang dipasang peringatan di layar, memakai
  aturan yang sudah bernama di ledger ini: *"jatuh ke bawaan itu jujur HANYA
  bila balasannya menyebut apa yang dipakai."*

- **Gerbang keempat ikut menangkap perubahanku**: `semai-sekali.test.ts`
  menuntut efek penyemai terdaftar; menambahkan `langkahGagal` ke deps
  `ResepPage` memerahkannya sampai entrinya diperbarui **beserta alasannya**.

- **Gerbang**: `typecheck` bersih (server+web) · `npm test` **2.485** (208
  berkas) · build web ✔ · Playwright e2e **10/10** (dua uji baru: gagal &
  PASANGAN-nya) · `audit:invarian` 26/26. **`verify-api` tidak dijalankan** —
  `apps/server/src` tak tersentuh satu baris pun (`git status` sebagai
  buktinya).

---

## Gagal memuat ≠ NOL: bentuk ketiga yang tak pernah dipertimbangkan — web — 2026-08-27

- **Kenapa vena ini ada**: `gagal-muat-bukan-kosong.test.ts` sudah ada, dan ia
  gerbang yang JUJUR — ia menuliskan batasnya sendiri, dan batas itu benar
  untuk dua bentuk yang dipikirkannya: **KALIMAT** (`(x ?? []).length === 0` →
  *"Belum ada supplier"*) dijaga, dan **DAFTAR PILIHAN** (`.map()` di dropdown)
  **sengaja dilewati** dengan alasan yang tepat — *"daftar pilihan yang kosong
  tak MENGKLAIM apa pun."*

  Ada bentuk **KETIGA**, dan alasan pengecualian itu tak berlaku untuknya:
  **ANGKA**. Lencana yang lenyap *memang* mengklaim sesuatu — **"tidak ada yang
  menunggu."**

- **Instrumen AST untuk pertama kalinya diarahkan ke `apps/web`** (ia mengurai
  TSX). Populasi: **163 situs `useQuery`**.

- **TEMUAN, diukur di PERAMBAN sungguhan** (satu pengajuan menunggu,
  `page.route()` membalas 500):

  | | lencana "Rekap Absen" |
  |---|---|
  | jaringan sehat | **"1"** |
  | `/pengajuan?status=menunggu` → 500 | **LENYAP** |

  Dan pencarian atas seluruh layar untuk kata *gagal/error/coba lagi*:
  **0 kecocokan**. Tak satu pun kalimat menyebutkan kegagalan itu. Ini di
  `Layout.tsx` — komponen yang tampil di **setiap** layar, dengan
  `refetchInterval` **30–60 detik**: gangguan jaringan sesaat membuat beban
  kerja hilang dari pandangan, lalu kembali, tanpa satu tanda pun.

  Kesembilan lencana navigasi meruntuhkan kegagalan jadi nol dengan empat
  bentuk berbeda — `(x ?? []).length`, `x?.kotor ?? 0`,
  `x?.rows.filter(…).length ?? 0`, dan `hitungBelum(x?.rows)` yang berakhir
  `.size`.

- **Dua batas mesin lama dicabut, dan keduanya membuatnya melaporkan kebersihan
  yang tak ada**:
  1. ia **REGEX** (`const { … } = useQuery(`) → buta pada `const q = useQuery(…)`;
  2. aturan `?? []`-nya menuntut koalesens menempel **langsung** pada nama
     `data` → tiap balasan berbentuk `{ rows: … }` lolos. `TransferStokPage`
     merender *"Belum ada transfer stok."* saat gagal, dan gerbang lama tak
     pernah melihatnya — kelas yang justru jadi alasan gerbang itu dibuat.

- **Tiga kebutaan detektor BARU, ditemukan sebelum satu tuduhan ditulis** —
  dan ketiganya arah yang berlawanan, jadi keduanya harus dikejar:
  1. **Under-report**: versi pertama melaporkan 11 situs; lima lencana
     `Layout.tsx` lain memakai bentuk yang tak ada di daftar polanya. Aturannya
     ditulis ulang dari BENTUK (ke mana `data` mengalir), bukan dari daftar
     pola — sebab daftar pola selalu kurang. Rantai opsional & tanda kurung
     juga harus dilewati saat menghitung lompatan, dan satu lompatan ke
     pembantu lokal (`hitungBelum`) ditambahkan.
  2. **Over-report**: `some`/`every`/`find` sempat dihitung sebagai angka, dan
     itu menuduh `SatuanSelect` (memilih apakah nilai terpilih perlu jadi
     `<option>`) dan `StokAwalPage` (`if (!tersimpan) return`). Keduanya
     keputusan internal. Dicabut.
  3. **Garis yang memisahkan keduanya**: angkanya harus **SAMPAI KE MATA** —
     dirender di JSX. Tanpa garis itu tiap hitungan internal jadi tertuduh, dan
     tuduhan palsu yang ditulis akan dipercaya.

- **Angka sebelum → sesudah**: `ANGKA` **24 → 3** · `GALAT` **76 → 97** ·
  `KALIMAT` **1 → 0** · `PILIHAN` 16 (pengecualiannya **tetap**, alasannya
  dipindahkan apa adanya). Yang diperbaiki 21 situs di 10 berkas; yang paling
  mahal: peringatan *"N menu akan melewati ambang food cost"* di
  `LaporanHargaModal` yang dulu **lenyap** saat perhitungannya gagal, dan
  `(N faktur)` + `Rp` pengeluaran di `TambahStokPage`.

- **Tiga sisa terdaftar beralasan**, dan ketiganya keputusan internal: pemilih
  menu dasar varian, penyaring bahan di picker, dan satu yang justru **contoh
  bentuk yang benar** — `const n = ringkas ? (ringkas[b.id] ?? 0) : null`,
  yang sudah membedakan "belum tahu" dari nol.

- **Kenaikan instrumen dibuktikan tak melonggarkan**: aturan regex lama
  dipertahankan sebagai fungsi (`kalimatLama`) dan dijalankan ulang di gerbang
  — ia wajib tetap menemukan **nol**, sama seperti sebelum putaran ini. Pin
  lama (kontrak `TabelResponsif` + sembilan jangkar per-berkas) **tak
  disentuh**.

- **Gerbang**: `typecheck` bersih (server+web) · `npm test` **2.479** (208
  berkas) · build web ✔ · Playwright e2e **8/8** (dua uji baru) ·
  `audit:invarian` 26/26. **`verify-api` TIDAK dijalankan** — `apps/server/src`
  tak tersentuh satu baris pun (`git status` sebagai buktinya), penerapan
  aturan repo ini, bukan jalan pintasnya.

---

## KAPAN: ruas keempat, dan aturan yang hidup di satu pintu saja — server — 2026-08-27

- **Kenapa vena ini ada**: tiga ruas sudah punya gerbang — `companyId`
  (putaran 13 & 14), `branchId` (16), `userId` (17). Yang keempat menentukan di
  PERIODE mana sebuah baris hidup, dan ia punya bentuk paling telanjang dari
  tanda tangan sesi ini: **aturannya sudah dipikirkan, ditulis, dan
  dikomentari — di SATU pintu.** `modules/sync/routes.ts` menolak waktu
  kejadian yang tak masuk akal dengan angka dan alasan (`SKEW_MENIT` 5,
  `MAKS_UMUR_HARI` 30/7, *"mengubah stok jauh ke belakang justru berbahaya"*);
  `MAKS_UMUR_HARI`, `SKEW_MENIT`, dan kalimat "waktu kejadian di masa depan"
  **tak muncul di satu berkas lain pun**, sementara istilah "waktu kejadian"
  dipakai empat berkas lain yang MENGONSUMSInya tanpa membatasinya.

  Dan `verify-api` sendiri sudah menuliskan pengakuannya, bertahun jauh sebelum
  putaran ini: *"tanggal masa depan ditolak? tidak — hanya format divalidasi"*.

- **Populasi**: 59 tabel → **49 ber-kolom waktu**, **102 kolom**, **150
  penulisan** (105 dari jam server). Yang datang dari KLIEN: **10 medan**, dan
  **tepat 1** yang benar-benar dibatasi. Sesudah: `KEJADIAN` 3 · `RENCANA` 5 ·
  `TERDAFTAR` 2 · **`TELANJANG` 9 → 0**.

- **TEMUAN — tiga akibat, diukur lewat HTTP + DB sebelum satu baris diubah**:

  | | sebelum |
  |---|---|
  | `POST /stok/awal` `tanggal:"2099-01-01"` | **201**. Layar Stok melaporkan saldo **500**; kartu stok hari yang sama melaporkan **saldo_awal 0, saldo_akhir 0** |
  | `PATCH faktur` `prod_date:"2099-06-01"` + `exp:"1900-01-01"` | **200**. Lot yang tiba hari ini tercatat diproduksi 2099 dan kedaluwarsa 1900 |
  | `GET /pesanan?tanggal=bukan-tanggal` | **500** "Terjadi kesalahan pada server" |

  Yang pertama adalah yang paling tenang: **dua tampilan stok yang sama
  berselisih seluruh saldonya, dan tak ada yang memberi tahu siapa pun** —
  baseline dicari `opname_date < ${dari}`, dan tahun 2099 tak pernah cocok.
  Sesudah: ketiganya **400 bernama** (`"tanggal: Tanggal kejadian tidak boleh
  di masa depan"`), dan jalur sah tetap 201/200 dengan kedua tampilan stok
  yang kini SEPAKAT.

- **Perbaikan — rumah untuk aturan yang sudah ada**:
  `lib/waktu-kejadian.ts`. `/sync` **memakainya**, bukan menyimpan salinan.
  Dua bentuk, sebab ada DUA jenis waktu dan menyamakannya akan salah:
  **KEJADIAN** (sudah terjadi — tak boleh maju) dan **RENCANA** (berlaku ke
  depan — justru harus boleh maju, yang dijaga langit-langitnya).

- **Dua kali uji PASANGAN menangkap batas yang KETERLALUAN — dan keduanya
  bukan hasil pembacaan ulang melainkan gerbang yang menyala**:
  1. `stok/awal` dibatasi setahun ke belakang → §"stok awal" yang sudah lama
     menembak saldo pembuka bertanggal **2020-01-01** jadi merah. Sisi lampau
     dilonggarkan jadi sepuluh tahun; yang terukur rusak sisi masa depannya,
     dan mengetatkan sisi yang tak rusak hanya memutus alur nyata.
  2. Cuti dibatasi setahun ke depan → §212 yang mengajukan cuti bertanggal
     **2027** jadi merah. Langit-langitnya dinaikkan; yang dijaga "1970" dan
     "9999", bukan kebijakan cuti.

- **Batas yang ditulis**: saringan ini berjalan di **Zod — sebelum
  `company_id`, apalagi zona waktunya, diketahui**. Zona nyata membentang
  UTC−12..+14, jadi batasnya diberi **slack satu hari** di kedua ujung, dan
  penyimpangan satu hari memang lolos. Yang dijaga di sini "2099" dan "1900",
  bukan "besok". Gerbang `batas-hari-zona` menuntut alasan untuk jembatan
  UTC-nya, dan alasan itu ditulis di daftar `DIIZINKAN`-nya — bukan
  didiamkan.

- **Dua medan tetap TERDAFTAR beralasan, dan alasannya dipaku ke kode**:
  `pesanan.tanggal` (SARINGAN papan, bukan nilai tersimpan — melihat papan
  kemarin itu wajar) dan `sync.waktu` (dibatasi di HANDLER-nya oleh
  `pastikanWaktuKejadian`, sebab batasnya bergantung `tipe` perintah yang tak
  terlihat dari skema medannya — dan uji memeriksa panggilan itu masih ada).

- **Pemindahan rumah TIDAK melonggarkan apa pun, dan itu dipaku dua kali**:
  angka 5 menit / 30 hari / 7 hari diuji langsung, dan §271 memaku **KALIMAT**
  penolakan `/sync` pada balasan §99 yang sudah ada — kontrak ponsel
  membacanya, dan memindahkan aturan adalah tempat paling mudah untuk
  diam-diam mengubah katanya.

- **Satu pin yang terbukti rapuh, diperbaiki sekalian**: daftar adjudikasi
  putaran lalu (`TAK_MENYEGARKAN`) dikunci per NOMOR BARIS, dan menambahkan
  satu komentar di atas situsnya sudah cukup membuat entri yang benar tampak
  asing. Kini dikunci per **berkas + kolom yang diubahnya** — kunci yang
  menyebut APA, bukan DI MANA.

- **Gerbang**: `typecheck` bersih (server+web) · `npm test` **2.471** (208
  berkas) · `verify-api` **3.234 lolos, 0 gagal** (§271, 14 asersi) · rekaman
  cakupan rute **identik, 274** · `audit:invarian` 26/26 · build web ✔ ·
  Playwright e2e **6/6**. Satu kesalahan proses tercatat: e2e sempat merah
  seluruhnya karena server dijalankan SEBELUM build web terakhir — `index.html`
  lama menunjuk aset yang sudah berganti hash (404). Urutan yang benar sudah
  tertulis di ledger ini dan tetap terlanggar; bukan kode, tapi dicatat.

---

## SIAPA yang melakukannya: ruas ketiga, dan `diubah_oleh` yang menyebut orang keliru — server — 2026-08-27

- **Kenapa vena ini ada**: tiga kolom menentukan sebuah baris milik siapa dan
  lahir dari siapa. `companyId` dijaga dua arah (putaran 13 & 14), `branchId`
  sejak putaran 16. Yang ketiga — **`userId`/pelaku** — menopang SELURUH jejak
  audit aplikasi ini (`pesananLogs`, `fakturLogs`, `stockOpnames.disetujuiBy`,
  `shifts.openedBy`, `productions.updatedBy`) dan tak satu pun uji pernah
  menagihnya.

- **Populasi, dihitung**: 59 tabel → **24 ber-kolom pelaku**, **30 kolom**.
  Penulisannya (`insert` + `update`) **96**:
  `TOKEN` 56 · `PARAMETER` 20 · `E` 14 · `NULL` 3 · `TURUNAN` 2 · `KLIEN` **1**.

- **Arah pertama BERSIH, dan bersihnya berangka**: tak ada pelaku yang dipungut
  dari permintaan kecuali **satu** yang memang harus — `PUT /penyimpanan/:id`
  menugaskan PETUGAS rak, dan daftar orangnya memang dipilih manajemen. Ia
  terdaftar beralasan, dan **alasannya dipaku ke kodenya**: uji memeriksa bahwa
  tiap id divalidasi `memberships` seperusahaan + belum diarsip + jumlahnya
  cocok. Kalau validasi itu hilang, alasannya berhenti benar dan gerbangnya
  merah — bukan alasan tulisan tangan yang basi diam-diam.
  Dari 14 pembantu pembawa pelaku, **13 DIBUKTIKAN** lewat graf panggilan; satu
  (`catatAbsen`) terdaftar beralasan dan alasannya menarik: absensi KIOS memang
  mencatat atas nama karyawan yang **kode**-nya diketik di perangkat bersama,
  bukan atas nama pemegang token. Grafnya tak dipaksa mengatakan sebaliknya.

- **TEMUAN — arah kedua, dan ia menyentuh uang.** `updatedBy` **dilihat
  manusia**: `produksi/routes.ts:2626` memulangkannya sebagai `diubah_oleh` dan
  `apps/web/src/pages/produksi/TambahStokPage.tsx` merendernya. Aturannya
  ditulis di satu pintu — `PATCH /pembelian/faktur/:key` membuka `set`-nya
  dengan `updatedBy: auth.sub`, dengan komentar yang menjelaskan kenapa —
  **dan pintu lain ke keadaan yang sama tidak**.

  Terukur lewat HTTP, dua pengguna sungguhan, bukti dari DTO yang dirender:

  | | qty | total_harga | harga_tebakan | diubah_oleh |
  |---|---|---|---|---|
  | owner buat + PATCH | 10 | 50.000 | false | **Owner Basooopa** |
  | pengguna KEDUA naikkan tahap qty 14 | **14** | **70.000** | **true** | **Owner Basooopa** ← |

  Layar menyebut orang yang menulis Rp50.000 sebagai penulis Rp70.000. Dan
  `harga_tebakan` yang ikut berbalik menentukan apakah angka itu masuk kolam
  median harga acuan perusahaan — jadi yang salah nama bukan catatan sepele.
  Sistemnya bahkan **tahu** siapa pelakunya: `diterima_oleh` (`confirmedBy`)
  menyebutnya dengan benar di kolom sebelahnya.

  Dua pintu diperbaiki — tahap "maju" (`produksi/routes.ts:989`) dan
  `POST /penerimaan/:fakturId/terima-sebagian` (`:725`, memprorata harga).
  `confirmedBy` **tetap** ditulis: "siapa menerima" dan "siapa menulis
  angkanya" dua fakta berbeda, dan menyatukannya menghapus satu.
  **9 → 5** pintu tak menyegarkan pelaku; yang menyentuh **ANGKA: 2 → 0**.

- **Instrumen**: `test/util/pelaku.ts` (AST). Graf panggilan
  **diparameterkan** — `panggilan.ts` dulu dipaku ke tenant (`TENANT_PROP`,
  `AUTH_RE`); mesinnya (titik-tetap, korespondensi argumen, penolakan nama
  bertabrakan) tak pernah tenant-spesifik. Kini `Dimensi` (`TENANT` | `PELAKU`)
  membawa keempat nilai yang berbeda, dan bukti tak-bergesernya perilaku:
  suite tenant tetap hijau dengan **angka yang sama** (101 situs, AUTH 48 /
  PARAMETER 25 / TURUNAN 1 / E 27, daftar tangan kosong). Perakit baris
  (`objekBaris`, `konteks`) **dipakai ulang** dari `tenant-tulis.ts`, tidak
  disalin.

- **Tiga kebutaan detektorku sendiri, semuanya ditemukan sebelum satu tuduhan
  ditulis**:
  1. **Sebar bersyarat.** `produksi/routes.ts:989` menulis seluruh
     perubahannya sebagai `...(lebih ? { qty } : {})`, jadi objeknya tak punya
     satu pun properti bernama — versi pertama melaporkannya `ubah{}` dan
     **pintu uangnya tak terlihat sama sekali**.
  2. **Kolom yang salah alamat.** Menuntut `deletedBy` pada pembaruan biasa
     menuduh `refund.ts` & `rekalkulasi.ts` yang menulis ulang total penjualan
     — padahal `sales` tak punya `updatedBy`, jadi tak ada tempat mencatatnya.
     Arahnya dipecah dua (`UBAH` / `HAPUS`); tuduhan itu dicabut, dan
     ketiadaan kolomnya **ditulis sebagai batas**, bukan ditambal migrasi.
  3. **Callback `.map` dan pewarisan kolom.** `uniqueIds.map((uid) => ({ userId:
     uid }))` terbaca `PARAMETER` padahal `uniqueIds` lahir dari badan
     permintaan; dan `b.userId → userId` saat memecah baris adalah **warisan**,
     bukan parameter. Dua kelas yang tadinya bersembunyi di `PARAMETER` kini
     punya nama sendiri — kelas yang salah menyembunyikan pertanyaan.

- **Negatif bersih yang layak dicatat**: **0** penghapusan lunak yang lupa
  menyebut penghapusnya (tiap `update` pengisi `deletedAt` pada tabel
  ber-`deletedBy` mengisi keduanya). Dan, diukur sambil jalan: daftar rute yang
  dipakai TIGA gerbang diadu dengan **tabel rute Hono sendiri** — 276 vs 275,
  satu-satunya beda `GET /health` (di luar lingkup tenant). Sapuan teks
  `rute.ts` **tidak buta**; utang "naikkan ke AST" untuk berkas itu **dicabut,
  berangka**.

- **Gerbang**: `typecheck` bersih (server+web) · `npm test` **2.456** (207
  berkas) · `verify-api` **3.219 lolos, 0 gagal** (§270 8 asersi + 1 asersi
  baru di §52b) · rekaman cakupan rute **identik, 274** · `audit:invarian`
  26/26 · build web ✔ · Playwright e2e **6/6**.

---

## Pengurungan CABANG: saudara kandung tenant yang tak pernah punya gerbang — server — 2026-08-27

- **Kenapa vena ini ada**: pengurungan TENANT sudah dijaga dua arah — baca (626
  kueri) dan tulis (101 insert), keduanya AST. Pertanyaan yang **sama persis
  satu tingkat ke bawah** tak pernah disapu sekali pun: *dalam SATU perusahaan,
  bisakah peran terikat cabang A menyentuh baris cabang B?*
  `cakupan-cabang.test.ts` yang ada bukan gerbang untuk itu, dan batasnya
  tertulis di berkasnya sendiri — *"ia menangkap KELALAIAN …, bukan
  PENYALAHGUNAAN"*. Ia berbasis TEKS, populasinya **8 berkas tulisan tangan**
  (padahal `resolveBranchId` dipanggil **85 kali di 18 berkas**), dan ia
  menyapu **satu arah**: "cabang datang dari PEMANGGIL". Ia tak pernah bertanya
  apakah kuerinya mengurung.

- **Populasi, dihitung**: 59 tabel → **24 ber-`branchId`** (22 juga
  ber-`companyId`). 626 kueri → **272** menyentuh tabel ber-cabang, 117
  menyebut `branchId`, **155 tidak**. 275 rute → **144** dimasuki peran terikat
  cabang → **78** menyentuh tabel ber-cabang.

- **Instrumen**: `test/util/cabang-terkurung.ts` (AST), memakai kembali
  `ast.ts`, `rute.ts`, `panggilan.ts`, dan matriks izin. Delapan kelas:
  `LUAR` · `E` · `KOSONG` · `KURUNG` · `HOP` · `MILIK` · `AKTOR` · `TELANJANG`.
  `peranEfektif`/`penjagaPrefiks`/`aliasPeran` **pindah** dari dalam
  `izin-per-rute.test.ts` ke `test/util/izin.ts` — sebabnya bukan estetika:
  berkas uji tak bisa diimpor berkas lain (`tsx`: *"Vitest cannot be imported
  in a CommonJS module"*), jadi gerbang kedua yang butuh matriks itu hanya
  punya pilihan menyalinnya. Suite izin tetap **11 lolos** dengan angka yang
  sama — itu buktinya pindahan ini tak mengubah perilaku.

- **Dua kebutaan detektorku sendiri, ditemukan oleh PENGUKURAN, bukan bacaan**:
  1. **Sentuhan tabel harus MENULAR lewat pembantu.** `GET /open-bill/:id`
     badan rutenya tak menyebut `openBills` sama sekali — kuerinya di
     `loadDetail`. Versi pertama menyebutnya `KOSONG` sementara HTTP
     membalas **200 berisi bill cabang lain**. Populasi yang menyusut
     diam-diam adalah kebutaan yang menyamar jadi kabar baik: `TELANJANG`
     10 → **18** setelah diperbaiki.
  2. **Gerbang peran INLINE** (`if (auth.role !== "owner" && …) 403`) tak
     terbaca `peranEfektif`. Tanpa itu `POST /penerimaan/anomali/tutup` jadi
     tuduhan palsu.

- **Tuduhan yang DICABUT sebelum satu baris diubah**: 5 rute `penerimaan` —
  kurungannya ADA, satu lompatan jauhnya di `kondisiFaktur`
  (`penerimaan/routes.ts:120`). Itulah kelas `HOP`, dan uji PREMIS menuntut
  kelas itu **tidak kosong**: kalau kosong, lompatannya tak terpakai dan angka
  `KURUNG` bohong.

- **TEMUAN — 14 pintu, tujuh ditembak lewat HTTP** (satu perusahaan, dua
  cabang; kasir & kitchen terikat "Pusat" atas baris "Cabang Uji 46"), tiap
  akibatnya dibuktikan di DB, bukan dari status code:

  | pintu | peran | sebelum | bukti di basis data |
  |---|---|---|---|
  | `GET /open-bill/:id` | cashier | **200** | nama pelanggan + itemnya terbaca |
  | `PUT /open-bill/:id` | cashier | **200** | `customer_nama` ditimpa, qty 2 → 9 |
  | `DELETE /open-bill/:id` | cashier | **200** | bill ditutup, **semua** barisnya `batal`, dan `pesanan_logs` mencatatnya **atas nama cabang korban** |
  | `GET /stok/opname/sesi/:id` | cashier | **200** | selisih −3, catatan, pelakunya |
  | `GET /penyimpanan/:id/bahan` | cashier+kitchen | **200** | isi rak cabang lain |
  | `PATCH /produksi/faktur/:key` | kitchen | **200** | `catatan` ditimpa di baris cabang lain |
  | `DELETE /produksi/faktur/:key` | kitchen | **200** | `deleted_at` terisi |

  Sesudah: **ketujuhnya 404**, dan barisnya terbukti **utuh** (`Milik Cabang
  A`, qty 2, masih hidup; faktur masih ada).

- **Perbaikan — satu pintu, bukan tujuh salinan**: `cabangTerikat(c)` +
  `syaratCabang(c, kolom)` di `middleware/auth.ts`, bersebelahan dengan
  `pastikanCabang`/`resolveBranchId`/`branchUntukTulis`. Dua bentuk dari SATU
  keputusan (nilai untuk pembanding JS, `SQL` untuk `.where`).

- **Regresi yang ditangkap uji PASANGAN, bukan oleh pembacaan ulang**: versi
  pertama memakai `syaratCabang` apa adanya di `/produksi`+`/pembelian` dan
  **menutup jalur Central Kitchen** — §93 berubah dari 200 jadi 404 (*"karyawan
  CK menyimpan laporan harga"*). Aturannya sudah tertulis di `app.ts`: kedua
  prefiks itu digerbang `izinkanManajemenAtauKaryawanCk`, jadi `tim` yang
  SAMPAI ke sana pasti `tim` Central Kitchen — merekalah yang belanja dan
  memegang notanya, untuk cabang mana pun. Lahirlah `syaratCabangDivisi`, yang
  hanya mengurung `kitchen`/`bar` (dua divisi produksi cabang store, dan
  komentar gerbangnya sendiri sudah menyebut *"kunci per-request tetap lewat
  `terikatCabang`"*). **`/pembelian` bukan lubang cabang** — itu diukur, bukan
  diasumsikan.

- **TEMUAN SAMPINGAN — penjaga yang JATUH TERBUKA**: `kondisiFaktur` menulis
  `terikatCabang(role) && auth.branch_id`, jadi peran terikat yang tak punya
  cabang lolos ke SELURUH perusahaan, sementara `resolveBranchId` pada keadaan
  yang sama menjawab 403. Dua pintu ke keadaan yang sama, dua jawaban. Jangkar
  ujinya menemukan **salinan kedua** di `penerimaan/routes.ts:465` (SQL mentah,
  di luar jangkauan drizzle). Keduanya kini lewat pembantu yang **melempar**.
  **Batasnya ditulis**: keadaan itu **tak terjangkau hari ini** — 0 dari 34
  keanggotaan peran terikat tanpa cabang, dijaga `WAJIB_CABANG` di
  `users/routes.ts:184` dan FK `memberships.branch_id` ber-`NO ACTION`. Jadi
  ini pertahanan berlapis, **bukan lubang terukur**, dan tak dibesarkan jadi
  temuan. Sembilan salinan bentuk yang sama di `produksi`/`transfer`/`meja`
  **tetap utang yang diukur**, tak disentuh putaran ini.

- **Sisa 4 `TELANJANG`, diadjudikasi beralasan** — dan yang menyatukannya satu
  kalimat: baris yang DIALAMATI `:id`-nya milik **perusahaan**, bukan cabang;
  tabel ber-cabang yang tersentuh cuma satelit. `GET /bahan/:id/detail` ·
  `GET /bahan/:id/pembelian` (kolam yang melahirkan `ingredients.harga_beli`,
  kolom perusahaan) · `GET /menu/:id` · `POST /profil/password`. Daftarnya
  ditagih dua arah: entri yang sudah berpenjaga wajib **dihapus**.

- **Angka akhir**: `TELANJANG` **18 → 4** · `KURUNG` 68 → **80** · `HOP` 5 → 7.
  Bukti merah mendarat di enam bentuk (rute telanjang, pasangannya berpenjaga,
  tabel tanpa cabang, gerbang `requireRole`, gerbang inline, penjaga di
  pembantu) **dan** pada penularan sentuhan tabel.

- **Gerbang**: `typecheck` bersih (server+web) · `npm test` **2.441** (206
  berkas) · `verify-api` **3.210 lolos, 0 gagal** (§269, 22 asersi) · rekaman
  cakupan rute **identik, 274** · `audit:invarian` 26/26 · build web ✔ ·
  Playwright e2e **6/6**. Satu jangkar irisan ikut bergeser
  (`open-bill-tutup.test.ts:104`) dan `jangkar-iris.test.ts` yang
  menemukannya — instrumen yang menjaga instrumen.

---

## "Diputuskan pemanggil" berhenti jadi janji — server (uji) — 2026-08-27

- **Kenapa vena ini ada**: dua putaran terakhir menutup dua arah gerbang tenant,
  dan **keduanya berhenti di tempat yang sama** — nilai yang datang lewat
  PARAMETER. Keduanya menuliskannya "tenant diputuskan pemanggil" lalu
  menyerahkannya ke daftar pilah-tangan: **31 klaim** (25 sisi TULIS di 14
  berkas, 6 sisi BACA). Semuanya benar hari itu, dan semuanya **SNAPSHOT**.

- **Yang tak dijaga apa pun: pemanggil BARU.** Satu pemanggil `createSale` atau
  `catatLogFaktur` yang mengisi `companyId` dari badan permintaan tak akan
  memerahkan apa pun — kedua gerbang hanya membaca situs `insert`/`select`-nya,
  tak pernah pemanggilnya. Alasan tulisan tangan ("ketiga pemanggilnya
  mengurung") **membusuk diam-diam pada pemanggil keempat**.

- **Tindak**: `test/util/panggilan.ts` — graf panggilan **lintas berkas** (112
  berkas, **435 pembantu bernama**, **10 nama bertabrakan** yang dilaporkan dan
  ditolak sebagai bukti) plus **titik-tetap**: sebuah pembantu TERBUKTI bila tiap
  situs panggilnya mengoper tenant yang (a) menelusur ke `auth.company_id`,
  (b) berada di berkas kelas E, atau (c) datang dari pembantu yang sendirinya
  sudah terbukti. Diulang sampai stabil.

- **Hasil, dua arah**:

  | arah | sebelum | sesudah |
  |---|---|---|
  | TULIS | 25 situs / 14 berkas beralasan TANGAN | **20 pembantu, 20 TERBUKTI**; daftar tangan **kosong** |
  | BACA | 6 situs kelas `F` beralasan TANGAN | kelas **`P` = 6**, `F` **56 → 50** |

  `selaraskanTutupBill` **sengaja tidak** diikutkan: parameternya `billId` —
  sebuah id baris yang diverifikasi di hulu, bukan kondisi yang membawa tenant.
  Ia tetap `F` dan tetap ditagih daftar tangan. Titik-tetap yang tak konvergen
  bukan alasan melonggarkan.

- **Empat penajaman, semuanya ditemukan sambil membuktikan** — dan tiap satunya
  bentuk NYATA di repo ini:

  | bentuk | tanpa penajaman |
  |---|---|
  | slot tenant hidup di **anotasi TIPE** (`row: { companyId: string; … }`) | `catatHargaMenu` & `denganKlaimIdempoten` tak punya slot → situs panggilnya tak pernah diperiksa |
  | himpunan kandidat harus **tertutup atas pemanggil** | 4 pembantu `perlengkapan/service.ts` menggantung: syarat (c) menanyakan pembantu yang tak pernah dinilai |
  | objek literal dibuka **satu tingkat**, dan **sebelum** penanda auth/klien diuji | `{ auth, fakturId, conds, body: c.req.valid(…) }` berhenti di penanda KLIEN milik `body` — properti yang sama sekali bukan tenantnya — sehingga `conds` tak pernah terbaca |
  | kedalaman telusur 4 → **6** | rantai terpanjang yang nyata: `konteks` → objek → properti ringkas `conds` → `const conds = [...]` |

  Titik-tetapnya konvergen dalam **4 putaran** (TULIS) dan **2** (BACA).

- **Bukti merah, dua arah, dan keduanya berpasangan**:
  · satu pemanggil `catatAbsen({ companyId: body.company_id })` disuntikkan →
  `catatAbsen` **berhenti terbukti**, dengan berkas & barisnya disebut,
  sementara `createSale` dan `catatLogFaktur` **tetap** terbukti — tuduhannya
  tepat sasaran, bukan longsor;
  · satu pemanggil `tahapSebagian({ conds })` dengan kondisi **tanpa** tenant →
  kelas `P`-nya jatuh, sementara `selectLaporan` tetap terbukti.

- **Batas, ditulis jujur**: grafnya berdasar NAMA dalam satu ruang nama seluruh
  `src`; 10 nama bertabrakan (`quoteIdent`, `jalankan`, `toDto`, `ambilSatu`, …)
  **tak boleh** jadi bukti dan memang ditolak. Pembantu **tanpa** situs panggil
  yang terbaca dihitung **belum terbukti**, bukan bersih.

- **Gerbang**: `typecheck` bersih · `npm test` **2.430** (205 berkas, +3 uji) ·
  tak satu baris pun `src` tersentuh, jadi `verify-api` & cakupan rute tak bisa
  terpengaruh dan tidak dijalankan.

---

## Baris BARU dan tenant-nya: arah TULIS yang tak pernah punya gerbang — server (uji) — 2026-08-27 — **BERSIH**

- **Kenapa vena ini ada**: sapuan pengurungan tenant hanya melihat
  `select`/`update`/`delete` — ketiganya punya `.where`, dan pengurungannya
  terbaca di sana. **`insert` tak punya `.where` sama sekali**, jadi ia tak
  pernah masuk populasi mana pun. Pertanyaannya juga berbeda: bukan "baris mana
  yang terbaca" melainkan **"nilai `companyId` yang DITULIS datang dari mana"**.
  Kalau ia dipungut dari permintaan, satu penyewa menanam baris di ruang
  penyewa lain.

- **Ledger sudah menulis celahnya sendiri**: vena "Isolasi tenant pada
  PENULISAN" (2026-08-22) menyapu 162 penulisan lalu menyatakannya bersih —
  *"tapi sapuannya hidup di scratchpad dan tak pernah jadi gerbang."* Sampai
  hari ini `insert` memang tak dijaga apa pun.

- **KENAPA BARU BISA DISAPU SEKARANG**: nilainya hampir tak pernah ada di situs
  `insert`-nya. `.values(items.map((b) => ({ companyId, … })))` ·
  `.values(rows)` yang dirakit belasan baris di atas · `.values(values)` yang
  diisi `.push` · `.values([...barisFaktur(a), ...barisFaktur(b)])`. Properti
  RINGKAS, callback, larik ber-`push`, pembantu bernama, elemen sebar — tak satu
  pun terbaca regex. Yang dibutuhkan resolusi per-LINGKUP, dan itu baru ada
  sejak dua putaran terakhir.

- **Populasi, terhitung**: **42 dari 59 tabel** punya kolom `companyId`;
  **101 insert** menulis ke tabel-tabel itu (dari 128 insert seluruhnya).

  | kelas | jumlah | arti |
  |---|---|---|
  | `AUTH` | **48** | `auth.company_id!` langsung dari token |
  | `PARAMETER` | **25** | tenant diputuskan PEMANGGIL — terdaftar per berkas beralasan |
  | `TURUNAN` | **1** | diwarisi baris induk yang dibaca terkurung (`b.companyId` saat faktur maju tahap) |
  | `E` | **27** | berkas yang memang lintas perusahaan (seed, admin, auth, onboarding) |
  | **`KLIEN`** | **0** | ← tenant dari permintaan; yang tak boleh ada |
  | **`TANPA`** | **0** | ← insert ke tabel ber-tenant yang lupa mengisinya |

  **BERSIH**: tak satu pun dari 101 insert memungut `companyId` dari badan atau
  kueri permintaan. Yang dibayar putaran ini bukan temuan melainkan **gerbang
  yang menjaga kedua angka nol itu tetap nol**.

- **Pemindainya salah EMPAT kali sebelum satu tuduhan pun ditulis**, dan tiap
  kali karena satu bentuk perakit baris yang NYATA ada di repo ini:

  | bentuk | akibat versi sebelumnya |
  |---|---|
  | `.map((b) => ({ … }))` | `ParenthesizedExpression` simpul tersendiri di pohon Oxc → **20 insert** terbaca "tak menyebut companyId", dua di antaranya ber-`auth.company_id!` terang-terangan |
  | `const values = []` lalu `values.push({ … })` | larik terbaca kosong |
  | `const baris = (r) => r.map(…)` | pembantu ber-badan EKSPRESI tak punya `return` untuk dicari |
  | `values([...baris(a), ...baris(b)])` | elemen SEBAR tak dibuka → seluruh larik kosong |

  Keempatnya kini uji PREMIS di gerbangnya: **TANPA 20 → 7 → 4 → 1 → 0**, dan
  tiap penurunan punya sebab yang bisa ditunjuk.

- **Bukti merah, empat arah**: `companyId: body.company_id` → `KLIEN` ·
  `c.req.valid('json')` lewat satu nama → tetap `KLIEN` · insert tanpa
  `companyId` → `TANPA` · **PASANGAN**: dari token → `AUTH`, dan tabel yang
  memang tak punya kolom tenant (`saleItems`) tak ikut disapu sama sekali.

- **Utang yang ditulis**: kelas `PARAMETER` (25 situs, 14 berkas) berarti
  "tenant diputuskan pemanggil", dan itu masih diverifikasi TANGAN — daftarnya
  di gerbang, tiap berkas beralasan. Membuktikannya mekanis menuntut
  penelusuran antar-fungsi yang sama dengan utang putaran lalu; keduanya kini
  satu utang: **parameter → destrukturisasi → tiap situs panggil**.

- **Gerbang**: `typecheck` bersih · `npm test` **2.427** (205 berkas, +13 uji) ·
  tak satu baris pun `src` tersentuh, jadi `verify-api` & cakupan rute tak bisa
  terpengaruh dan tidak dijalankan.

---

## Gerbang ISOLASI TENANT: vonis "aman" yang buktinya tak pernah terbaca — server (uji) — 2026-08-27

- **Kenapa vena ini ada**: putaran lalu mencatat penyapu yang masih berbasis
  teks sebagai **utang yang diukur**. Yang teratas bukan sekadar utang
  instrumen — ia gerbang **isolasi tenant**, kelas kerusakan tertinggi di produk
  ini: satu warung membaca data warung lain.

- **Populasi**: **626 kueri** `db|tx .select|update|delete` di **60 berkas**.
  **98 di antaranya divonis "aman" oleh dua aturan terlemah** — `A2` (lewat
  konstanta) dan `C` (lewat induk yang memverifikasi) — dan keduanya menebak:
  `nilaiKonstan()` mencari `const <nama> =` dengan regex atas SELURUH berkas dan
  memungut **kecocokan pertama**; `lingkup()` menelusuri kurawal mundur lalu
  menemukan-kembali kuerinya dengan `indexOf(isi.slice(0, 24))`; `rantai()`
  penelusur kurung tulisan tangan yang komentarnya sendiri mencatat versi
  keduanya membuat **103 kueri tak terkurung terbaca "aman"** — *"dan suntikan
  bukti merah pun dinyatakan bersih."*

- **ENAM vonis `A2` berdiri di atas deklarasi yang TAK ADA dalam lingkupnya**,
  dan bentuknya bermacam-macam — semuanya nyata:

  | situs | yang dikreditkan aturan lama |
  |---|---|
  | `produksi/routes.ts:630`, `:1258` | `conds` di sana **parameter** (`tahapSebagian(k: KonteksTahap)`); yang dikreditkan `const conds = [` **900+ baris DI BAWAHNYA**, milik rute lain |
  | `kebersihan/routes.ts:167` | `syarat` **parameter** `selectLaporan(syarat: SQL[])`; yang dikreditkan konstanta untuk **TABEL LAIN** (`cleaningAreas`, sementara kuerinya membaca `cleaningReports`) |
  | `perlengkapan/service.ts:545` · `bahan/routes.ts:662` | nama yang dideklarasikan 4×/2×, salah satunya **variabel perulangan** |

  **Keenamnya dibaca tangan sampai ke pemanggilnya, dan TAK SATU PUN BOCOR**:
  satu-satunya perakit `conds` (`produksi:1642`) memuat
  `eq(productions.companyId, …)`; ketiga pemanggil `selectLaporan` mengurung;
  `bahan:662` menyaring `existing.id` yang lahir dari baca ber-`companyId` di
  `:638`. **Yang rusak BUKTINYA, bukan pengurungannya** — dan vonis yang benar
  karena mujur tak bisa dibedakan dari vonis yang benar karena terbaca.

- **Diadu, dan penukarannya menagih TIGA pengetatan**, masing-masing terukur:

  | pengetatan | kenapa | akibatnya |
  |---|---|---|
  | `B` menuntut `branchId` **di dalam `.where`** | versi teks menguji seluruh rantai, jadi kolom `branchId` yang cuma DIPILIH ikut dihitung sebagai pengurungan | 22 → 21 |
  | `C` menuntut **panggilan BERNAMA** | `and(eq(t.id, id), eq(t.companyId, …))` adalah bagian dari KUERI LAIN, bukan langkah verifikasi; argumen berupa closure juga tak dihitung | enam kueri berhenti keluar dari F |
  | verifikator dicari di fungsi **TERLUAR** | verifikasi sah dilakukan SEBELUM transaksi dibuka: `pastikanKartu(...)` hidup di penangan rute, kuerinya di dalam `db.transaction(async (tx) => …)` | 16 kueri mendapat kembali penjaganya yang nyata |

- **Sebelum → sesudah**, dan tak satu angka pun bergerak karena aturannya
  dilonggarkan:

  | | A | A2 | B | C | E | **F** |
  |---|---|---|---|---|---|---|
  | teks | 390 | 53 | 22 | 45 | 68 | **48** |
  | pohon | 390 | 56 | 21 | 35 | 68 | **56** |

  **602 dari 626 sepakat sejak penukaran pertama.** Kelas F NAIK — itu arah
  yang benar: F berarti "tak teresolusi mekanis → ditagih keputusan tertulis".
  Tiap entri baru terdaftar beralasan; **tiga berkas justru KELUAR** dari daftar
  pilah-tangan (`penerimaan/routes.ts`, `perlengkapan/service.ts`,
  `sync/routes.ts`) karena buktinya kini benar-benar terbaca.

- **Gerbangnya**: tiga uji PREMIS baru di `ast-instrumen.test.ts`, semuanya
  mendarat di kode NYATA dengan angkanya dihitung di dalam ujinya — jarak
  900+ baris antara situs dan deklarasi yang dikreditkan; konstanta untuk tabel
  lain; dan pasangan "kueri tetangga → F" vs "panggilan bernama → C".

- **Batas & utang, ditulis jujur**:
  - **kelas PARAMETER belum ada.** Enam situs di atas aman karena pemanggilnya
    mengurung, dan itu diverifikasi TANGAN, bukan mesin. Membuktikannya mekanis
    menuntut penelusuran antar-fungsi (parameter → destrukturisasi → tiap situs
    panggil). Diusulkan sebagai putaran tersendiri, dengan populasinya:
    **6 situs, 3 fungsi pembantu**;
  - penyapu yang masih berbasis teks: `galat-ditelan.ts`, `templat-html.ts`,
    `kolom-numerik.ts`, `rute.ts` — tetap utang yang diukur;
  - putaran ini **tak menyentuh satu baris pun** `src`, jadi `verify-api` &
    cakupan rute tak bisa terpengaruh dan tidak dijalankan.

- **Gerbang**: `typecheck` bersih · `npm test` **2.414** (204 berkas, +6 uji) ·
  gerbang `kueri-terkurung-tenant` tetap hijau dengan kontrak yang sama.

---

## Instrumennya naik ke POHON SINTAKS — server (uji) — 2026-08-27

- **Kenapa vena ini ada**: enam kelas kusapu hari ini dan **semuanya bersih**
  (angkanya di bawah). Yang TIDAK bersih instrumennya sendiri. Ledger ini
  mencatat detektor regex meleset hampir tiap putaran, dan tiap kali dengan
  nama: **26** tuduhan palsu (sapuan tanggal) · satu "templat" menelan **141
  baris** `lib/backup.ts` (literal regex `/"/g`) · **14 dari 22** tuduhan cacat
  karena `rfind` −1 di kepala berkas · **99 dari 101** panggilan async tertuduh
  palsu (argumen `Promise.all`) · **empat generasi** pemindai telanan galat
  dalam satu putaran. Sebabnya satu: **pengurai yang dikira-kira**.
  `butaKomentar` ada persis karena itu — ia menambal gejala.

- **Yang berubah**: `rolldown/experimental` → `parseSync` mengurai TypeScript
  sungguhan dan sudah ada di lockfile (v1.1.5, transitif lewat `vite`).
  Dideklarasikan eksplisit sebagai `devDependencies` `@kakarut/server` dipatok
  di versi yang sama — **+1 baris di `package.json`, +1 di lockfile**, tanpa
  unduhan baru. Jalur pengecek TIPE tetap tertutup dan itu ditulis apa adanya:
  **TypeScript 7.0.2 yang terpasang adalah port Go**, dan API JS-nya hanya
  `version` + `versionMajorMinor`.

- **Yang dipindah**: `templateSql` (pencari templat `sql`) dan seluruh
  `situsBendera` (penyapu bendera "baris ini tidak berlaku lagi"). Sasarannya
  dipilih bukan karena termudah melainkan karena **paling mahal bila salah** —
  yang ikut terhitung kalau ia meleset adalah UANG, STOK, dan ATRIBUSI KERJA.

- **DIADU, bukan diganti diam-diam** — klasifikasi lama vs baru atas populasi
  yang sama:

  | | lama | baru |
  |---|---|---|
  | situs | 134 | **136** |
  | MENYARING | 71 | 71 |
  | LEWAT_VARIABEL | 31 | **33** |
  | MENULIS | 7 | **3** |
  | TELANJANG | 25 | **29** |

  **111 situs cocok persis**; 12 diadjudikasi tangan, dan ketiga kelompoknya
  ternyata KEBUTAAN YANG LAMA, bukan kelonggaran yang baru.

- **Buta #1 — prosa dibaca sebagai SQL.** `lib/porsi-ditagih.ts` menulis
  `` `sql<number>` `` sebagai prosa Markdown di komentarnya; regexnya
  (`\bsql(?:<…>)?\s*` + backtick`) melihat backtick penutup Markdown sebagai
  pembuka templat. Lama **6** templat, pohon **4**. Kelas yang sama di
  `modules/penjualan/routes.ts` (`` `sql<...>` ``): lama 7, pohon 6. Kedua
  pemanggilnya kebetulan membutakan komentar lebih dulu, jadi **tak ada gerbang
  yang tertipu** — dan itu justru intinya: kebenarannya bergantung pada tiap
  pemanggil ingat menambal. Di pohon, prosa memang tak pernah masuk.

- **Buta #2 — SELECT dimaafkan sebagai TULISAN.** `modules/pesanan/routes.ts`:
  **empat** kueri `tx.select(...).from(saleItems).where(eq(saleItems.saleId, id))`
  dilabeli **MENULIS** oleh aturan lama, karena jendela teksnya menelan
  `tx.insert(pesananLogs)` di pernyataan SEBELUMNYA. Situs berlabel MENULIS
  **tak pernah ditagih keputusan apa pun**. Di pohon keempatnya TELANJANG →
  masuk daftar pilah-tangan beralasan (25 → 29). Diperiksa satu per satu:
  keempatnya membaca SATU `saleId` yang sudah diresolusi pintunya di dalam
  transaksi yang sama, tanpa agregat lintas penjualan — **sah**, tapi sekarang
  sah *karena diputuskan*, bukan karena tak terlihat.

- **Buta #3 — dua kueri dihitung satu.** `Promise.all([db…, db…])`: kedua kueri
  berbagi "awal pernyataan" yang sama, jadi dedup berbasis offset menelan yang
  kedua. Terbukti di dua berkas nyata — `modules/bahan/routes.ts` 3 → **4**,
  `modules/customer/routes.ts` 2 → **3**. Kelas ini bahkan sudah tertulis di
  komentar `sql-mentah.ts` sendiri sebagai bahaya yang diketahui.

- **Kemampuan yang tak bisa ditiru teks: LINGKUP.** Aturan lama memakai
  "deklarasi TERDEKAT SEBELUM situsnya di berkas yang sama", dan berkas itu
  sendiri menulis kenapa itu rapuh: `conds` dideklarasikan sembilan kali di satu
  berkas. Diuji dan dibuktikan dua arah: dua kueri yang bentuk teksnya IDENTIK
  memakai `conds` berbeda → pohon menjawab `LEWAT_VARIABEL` dan `TELANJANG`,
  sementara aturan teks menjawab keduanya sama (posisi deklarasinya dihitung di
  dalam ujinya, bukan diklaim). Uji ini **ditandai sebagai uji KEMAMPUAN** —
  bentuknya disusun, bukan dipungut dari repo, dan itu ditulis di komentarnya.

- **Enam negatif bersih hari ini, semuanya berangka**:
  · promise mengambang di server **0** (15 pernyataan ber-Promise: 12 ber-`void`,
    2 ber-`.catch`; satu tuduhan **dicabut** — `tulis` ternyata `console.warn`,
    tertukar dengan `tulis` async di `backup.ts`)
  · rantai `db`/`tx` tanpa `await` **0**
  · `catch` yang hanya `console.*` **5** dari 93 blok — semuanya jalur
    boot/penjadwal yang memang tak punya pemanggil
  · `auth.company_id!` **589**, seluruhnya di balik SATU pintu `requireCompany`
    (`app.ts:151`); `auth.branch_id!` & `auth.role!` **0**
  · tes kebenaran atas nama ber-nuansa angka **69** di 30 berkas — yang
    benar-benar numerik semuanya sudah berpasangan `> 0`/epsilon
  · `as`-cast **277** & `!` **754**: dihitung, tak diusulkan — tanpa tipe,
    keduanya tak bisa dinilai, dan itu ditulis sebagai utang

- **Batas & utang, ditulis jujur**:
  - `parseSync` hidup di jalur `/experimental`. Satu uji PREMIS menjaga
    bentuknya, dan `uraikan` **melempar** untuk berkas yang ditolak parser —
    sapuan yang diam-diam memulangkan nol adalah kebutaan yang menyamar jadi
    kebersihan;
  - `akhirTemplate` kini hanya dipakai uji yang merekonstruksi pemindai lama.
    Dipertahankan dengan sengaja, dan alasannya ditulis di kodenya: menghapusnya
    menghapus buktinya;
  - **penyapu yang MASIH berbasis teks** dicatat sebagai utang yang diukur,
    bukan dinyatakan bersih: `galat-ditelan.ts`, `templat-html.ts`,
    `kueri-terkurung.ts`, dan sisa `daftar-tanpa-langit-langit.test.ts`
    (`awalPernyataan`/`ekorPernyataan`/`badanPembantu` masih hidup di sana);
  - putaran ini **tak menyentuh satu baris pun** `apps/server/src` atau
    `apps/web/src` — jadi `verify-api` & cakupan rute tak bisa terpengaruh, dan
    tidak dijalankan. Itu penerapan aturannya ("wajib bila menyentuh rute"),
    bukan jalan pintasnya.

- **Gerbang**: `typecheck` bersih · `npm test` **2.408** (204 berkas, +12 uji
  instrumen) · gerbang `bendera-hapus-disaring` tetap hijau dengan kontrak yang
  sama, dua pinnya ditulis ulang ke MAKSUDNYA (jumlah `pesanan/routes.ts` 3 → 7
  beralasan; bukti merah dipaku pada rantainya, bukan pada label `tabel`).

---

## Penghapusan yang GAGAL, dihitung sebagai berhasil — server+web+mobile — 2026-08-27

- **Kenapa vena ini ada**: antrean formal ledger habis di ANTREAN KESEBELAS,
  jadi putaran ini lahir dari sensus baru atas kelas yang **belum pernah disapu
  sekali pun** — dan yang gerbang repo ini sendiri sudah namai, di kepala
  `verify-api.sh`: *"galat yang ditelan lalu muncul sebagai kebingungan di
  tempat lain."*

- **Populasi, terhitung baca-saja**: **270 blok `catch`** (server 69 · web 45 ·
  mobile 156) → **24 berbadan KOSONG** → **12 tanpa satu kata pun alasan**
  (server 5 · mobile 7). Sepuluh di antaranya BENAR dan cuma perlu alasannya
  ditulis; dua sisanya satu bentuk, dan bentuk itulah temuannya.

- **Aturan yang dinamai**: *menghapus boleh diam HANYA untuk "sudah tidak ada";
  kegagalan lain tak boleh dihitung sebagai berhasil — dan tak boleh membuang
  catatan yang menamai objeknya.* Aturan sapuannya: **menelan galat itu jujur
  HANYA bila alasannya tertulis.**

- **Bentuknya**: kontrak `StorageDriver.hapus` menuliskan batasnya sendiri —
  *"berkas yang sudah tak ada bukan galat"* — sementara kedua driver LOKAL
  menulisnya `unlink(...).catch(() => {})`, menelan `EPERM`/`EISDIR`/`EACCES`/
  `EROFS` juga. Saudara kandungnya di R2 melempar (`DeleteObject` idempoten
  untuk kunci hilang). **Satu antarmuka, dua kejujuran yang berlawanan** — dan
  yang lokal itulah yang dipakai pemasangan tanpa R2. Tiga pintu memanggilnya,
  dan ketiganya membuang baris/hitungan yang MENAMAI objeknya tanpa tahu
  objeknya masih ada; satu di antaranya bahkan menuliskan alasannya **lebih
  sempit daripada yang dilakukannya** (`/* objek mungkin sudah hilang */`).

- **TERUKUR lewat HTTP** (DB dev segar + disk sungguhan; baris suntikan
  dibuktikan terbaca lewat `GET /admin/sistem/backup` lebih dulu; kegagalan
  hapus dipaksa dengan mengganti objeknya jadi DIREKTORI bernama sama —
  `unlink` atas direktori gagal bahkan untuk root):

  | pintu | sebelum | sesudah |
  |---|---|---|
  | `DELETE /admin/sistem/backup/:id` | **200 `{"ok":true}`** · baris 1 → 0 · objek **tetap ada** | **502** bernama · baris **dipertahankan** · objek tetap ada |
  | `POST /admin/sistem/backup/retensi` | **`{"dibuang":1}`** · baris 1 → 0 · objek **tetap ada** | `{"dibuang":0,"gagal":1}` · baris **dipertahankan** (retensi berikutnya mencoba lagi) |
  | `POST /admin/sistem/sapu-unggahan` | **`dihapus: 3`** padahal hanya **2** hilang (yang gagal masih dilayani **HTTP 200**) | `dihapus` hanya yang benar terhapus + medan `gagal_hapus` tersendiri |

  Retensi diukur dengan `BACKUP_KEEP=1` pada mesin ukur, dan sapuan dengan satu
  berkas ber-`chattr +i`. Keduanya cara ukur, bukan cara uji — §268 memakai
  trik direktori yang tak butuh hak istimewa sama sekali.

- **Tindak**: `hapusBerkasLokal(baseDir, key)` lahir di
  `modules/upload/jalur-aman.ts` (tetangga `jalurDalam`, yang sudah dipakai
  kedua driver lokal) — menelan **hanya `ENOENT`**, melempar sisanya; komentar
  `/* sudah tidak ada — idempoten */` **pindah ke sana**, tempat ia benar.
  `LocalDriver` & `LocalCadanganStorage` memanggilnya; **driver R2 tak
  disentuh** — ia sudah persis kontraknya. Lalu ketiga pintu memutuskan sendiri:
  DELETE melempar 502 bernama (galat aslinya **hanya ke log**, tidak ke
  penyewa); retensi **melewati** barisnya dan menghitung `gagal` terpisah;
  sapuan `try/catch` per berkas agar satu berkas bandel tak menghentikan
  pembersihan ribuan lainnya. Sepuluh telanan yang BENAR diberi alasan tertulis,
  dan `jadwalkanPangkasErrorLog` naik satu tingkat: dari menelan jadi
  **mencatat** (kalau ia gagal terus, tabel log tumbuh tanpa batas dan tak ada
  satu pun tanda kenapa).

- **Detektor DIBUKTIKAN bisa menuduh — sesudah EMPAT generasi**, dan tiap
  generasi diperbaiki karena satu kesalahan yang bisa ditunjuk:

  | generasi | cacatnya | akibat |
  |---|---|---|
  | 1 | komentar tak dibutakan | pemindainya menuduh **prosa di komentarnya sendiri** (`hapusBerkasLokal` mengutip bentuk lamanya) |
  | 2 | "komentar mana pun dalam 6 baris ke atas" | **JSDoc sebuah fungsi memaafkan telanan di baris pertama badannya** (`jadwalkanPangkasErrorLog`) |
  | 3 | ditelusuri dari token `.catch`, bukan awal pernyataannya | 2 tuduhan palsu (`app.ts`, `sync/idempoten.ts` — `.catch` mendarat di baris keempat rantai yang sama) |
  | 4 | "sebelum situs" dihitung sampai awal pernyataan **juga untuk bentuk blok** | komentar yang menjelaskan ISI `try` memaafkan telanannya (`api_client.dart:185` & `:704`) |

  Yang berlaku sekarang: situs dicari di sumber yang **komentarnya dibutakan**;
  alasan dicari di sumber **mentah** — di dalam badan `catch`, di tengah rantai
  tepat sebelum `.catch`, atau pada baris komentar tepat di atas pernyataannya
  (bentuk blok: di atas kata `try`-nya) — dan komentar di atas `{` sebuah blok
  **tidak** dihitung, sebab itu doc deklarasinya. Keempat kelolosan itu dipaku
  jadi uji PREMIS di kedua gerbang.

- **Bukti merah**: bentuk lama (`unlink(...).catch(() => {})`) direkonstruksi di
  dalam uji dan terbukti **memulangkan sukses** untuk direktori yang sama yang
  ditolak `hapusBerkasLokal`. Ketiga pin pintu diadu dengan kode yang
  dikembalikan ke bentuk lamanya: **5 dari 13 uji memerah**, dan hijau lagi
  begitu dipulihkan.

- **Pasangan yang menentukan**: idempotensi TIDAK ikut ditutup — cadangan yang
  objeknya **memang sudah hilang** tetap **200** dan barisnya tetap dibuang;
  cadangan wajar tetap **200** dan berkasnya ikut hilang; keempat pernyataan
  §253 (dirujuk selamat · yatim tua terhapus · yatim segar selamat · mode hitung
  tak menghapus) tetap hijau.

- **Dua ralat rencana, dicatat bukan disembunyikan**: (1) rencananya menuduh
  `BackupPage.tsx` tak menyampaikan penolakan 502 — dibaca sampai habis,
  `<ErrorText error={hapus.error} />` sudah merendernya merah apa adanya;
  cabang `onError` yang sempat kutulis **dicabut** sebagai mubazir. (2) yang
  ternyata memang salah di halaman itu hal lain: kotak kabarnya `string | null`
  yang **selalu dirender hijau**, jadi *"Gagal mengunduh cadangan."* tampil
  sebagai kabar baik. Diberi nada (`{teks, gagal}`) — kegagalan yang dicetak
  hijau adalah kegagalan yang dipercaya sebagai keberhasilan.

- **Satu pintu KELUAR dari daftar "tak terjangkau"**:
  `POST /admin/sistem/backup/retensi` selama ini terdaftar `DILUAR_JANGKAUAN`
  ("mengubah retensi cadangan mesin yang menjalankannya"). Alasannya terlalu
  takut: dengan `BACKUP_KEEP` bawaan 14 ia tak membuang apa pun pada suite.
  Cakupan rute **273 → 274**.

- **Batas detektor, ditulis jujur**:
  - hanya `catch` **berbadan kosong** yang terhitung. `catch` yang cuma
    `console.warn` lalu membuang kegagalannya **di luar populasi ini** — kelas
    tetangga yang dinyatakan **belum disapu**, bukan bersih;
  - komentar tepat di atas dihitung sebagai alasan tertulis, dan **mutunya tak
    diperiksa**: komentar yang membicarakan hal lain tetap lolos. Yang dijaga
    adanya KEPUTUSAN tertulis, bukan mutunya;
  - retensi & sapuan yatim **tak** diukur ulang CI dengan kegagalan yang
    dipaksa: keduanya butuh DB, dan memaksa `unlink` gagal atas berkas yang
    di-`list` menuntut `chattr +i` (butuh CAP_LINUX_IMMUTABLE — tak ada di CI).
    Yang dijaga gerbang adalah **bentuknya** (`continue` sebelum `db.delete`,
    penghitung `gagalHapus` terpisah) berikut bukti merahnya; angka
    ujung-ke-ujungnya adalah pengukuran tangan di atas;
  - **`await` yang hilang (promise mengambang) diperiksa dan TIDAK diusulkan**:
    repo ini tak punya ESLint sama sekali, jadi kelasnya memang terbuka — tapi
    detektor TEKS menuduh **99 dari 101** panggilan async di posisi pernyataan,
    hampir semuanya argumen `Promise.all([...])` atau `mutationFn: () => api(…)`.
    Kelas itu butuh **tipe**, bukan teks. Diusulkan untuk putaran lain, dengan
    angkanya.

- **Gerbang**: `typecheck` bersih · `npm test` **2.396** (203 berkas) ·
  `verify-api` **3.189 lolos, 0 gagal** vs Postgres **segar** (§268: 16
  pernyataan) · cakupan rute **273 → 274** (satu pintu yang dulu "tak
  terjangkau") · `audit:invarian` 26/26 · build web · Playwright e2e 6/6 ·
  `flutter analyze` bersih · `flutter test` **564** (+7).

---

## Pembagi nol dijawab NOL, dan nol itu dipercaya — server+web+mobile — 2026-08-26

- **Kenapa**: sembilan putaran menyapu *siapa yang boleh*, *punya siapa*, *apa
  yang dirakit*, dan *apa yang berhenti berlaku*. Yang belum pernah disapu:
  **apa yang dijawab ketika sebuah angka TAK BISA dihitung**
- **Aturannya sudah dinamai & dibayar sesi ini** — vena biaya menetapkan
  **`null`, bukan `0`** (*"nol tercetak 'Rp 0' dan dipercaya"*), ditegakkan di
  DTO dan di layar (`TAK_DIKETAHUI = "—"`). Ia **tidak** ditegakkan di rumus
  intinya: `foodCostPersen(hpp, hargaJual) = hargaJual > 0 ? … : 0`
- **Dan lencana penerimanya sudah menuliskan kerusakannya lebih dulu**,
  `MenuListPage.tsx:26-28`: *"'—' adalah jawaban yang benar, dan **0% akan
  terbaca sebagai food cost sempurna**."* Aturannya ada, penjaganya dipasang di
  layar, rumusnya dibiarkan tak bisa berkata "tak tahu"
- **TERUKUR lewat HTTP** — menu komplimen (`harga_jual = 0`, sah menurut
  skemanya: `z.number().nonnegative()`) ber-resep Rp2.083:

  | | sebelum | sesudah |
  |---|---|---|
  | `food_cost_persen` | **0** → layar **HIJAU "0,0%"** | **`null`** → "—" |
  | posisi di Analisis Harga (urut food cost tertinggi dulu) | **77 dari 93** — di antara menu tersehat | **94 dari 94** — ekor, dengan "—" |
  | `penyumbang[].persen_hpp` saat HPP menunya nol | **0** | **`null`** |
  | **PASANGAN** HPP 0 tapi dijual Rp15.000 | 0 | **0** (nol yang SAH tetap nol) |
  | **PASANGAN** porsi penyumbang menu komplimen | 100 | **100** (tak menular) |

  Kau mengeluarkan Rp2.083 per porsi dan tak menerima apa pun, dan layarnya
  memuji menu itu sebagai yang paling sehat di katalog
- **Populasi** (pembagian ber-fallback literal `0`, komentar dibutakan, di
  `packages/shared` + `apps/server`): **10 situs** →

  | kelas | jumlah | dasar |
  |---|---|---|
  | dijaga **CHECK basis data** | **6** | `ingredients_isi_ck` di migrasi `0000` — cabang nolnya tak pernah menyala |
  | **PENJAGA_AWAL** | **1** | `hariTerjadwal()` dibuka `if (perHari < 1) return []` |
  | **NOL yang BENAR** | **1** | `refund.ts` — nota tanpa PB1 memang mengembalikan nol rupiah |
  | **NOL yang dipercaya, TERJANGKAU** | **2** | `foodCostPersen` · `persen_hpp` — keduanya diperbaiki |

  Sisa **8** setelah perbaikan, semuanya terdaftar dengan kelas + alasan
- **Premisnya DIPERIKSA, bukan diyakini**: gerbangnya membaca
  `apps/server/drizzle/*.sql` dan menuntut `ingredients_isi_ck` benar-benar ada
  di sana. "Dijaga basis data" tak boleh jadi mantra — kalau migrasi kelak
  mencabutnya, keenam situs itu kehilangan dasarnya dan gerbang ini yang merah
- **Dua PRESEDEN yang sudah benar, dan itu yang membuat sisanya jadi cacat**:
  `produksi/routes.ts:540` sudah memulangkan `null` (`b.qty > 0 ? … : (… ?? null)`),
  dan `MenuFormPage.tsx` sudah menulis `"—"` lewat penjaga tulisan tangannya
  sendiri. **Ralat atas rencanaku**: rencana menyebut layar itu memajang
  "0.0%" — membacanya utuh, ia SUDAH benar. Yang salah rumusnya, dan penjaga
  di layar itu kini dilepas karena aturannya sudah tinggal di rumusnya
- **Satu rumah**: `bagiAtauNull(pembilang, penyebut)` di
  `packages/shared/src/angka.ts` — rumah yang sudah menampung
  `angkaDari`/`angkaAtauNull`. `null` = **tak bisa dihitung**; ia BUKAN
  pengganti nol yang sah
- **Typechecker yang mengenumerasi populasinya**, bukan tebakan:
  `MenuDtoPenuh.food_cost_persen` diubah `number` → `number | null` — dan
  justru *itulah* kebohongannya, sebab `hpp` selalu ada (ia jumlah) sementara
  food cost adalah PEMBAGIAN yang penyebutnya boleh nol. Typechecker lalu
  menunjuk **11 situs** di server (6) & web (5): pengurutan analisis, dampak
  harga, tiga situs ambang/warna, dan porsi penyumbang
- **Keputusan yang ditulis eksplisit, bukan lewat `?? 0`**:
  - pengurutan analisis: yang tak terhitung diurut **terpisah di ekor** —
    menyamakannya dengan 0% membuatnya mengendap di antara menu tersehat;
  - dampak harga: yang tak terhitung **tak bisa menyeberang ambang** (`continue`),
    sebab `?? 0` akan membuat tiap menu komplimen tampak baru jatuh ke bawah
    ambang setiap kali harga bahan naik;
  - ponsel: `_warnaFoodCost(null)` → **abu**, bukan hijau; `lewatAmbang` →
    `false` karena tak ada angka, dan itu ditulis di komentarnya supaya tak
    terbaca sebagai "aman"
- **Gerbang lama menagih dua penyesuaian, keduanya sah**:
  `diadili-lintas-fungsi` menuduh `bagiAtauNull(p.kontribusi * 100, dto.hpp)` —
  ekspresi aritmetika yang dioper ke fungsi yang memutuskan. Diperbaiki dengan
  **merestrukturisasi** (rasio dihitung dulu, dikali 100 sesudahnya), bukan
  dengan pengecualian; `lampiran-dto-utuh` menagih regenerasi Lampiran A
- **Bukti merah, dua sisi**: bentuk LAMA direkonstruksi apa adanya di dalam uji
  dan dibuktikan menjawab **0** untuk kasus yang sama — tanpa itu tak ada
  yang membuktikan temuannya nyata. Dan keduanya di-assert **SEPAKAT** di jalur
  wajar (tiga pasang angka), jadi perbaikannya tak menggeser satu angka pun
- **Batas, jujur**:
  - detektornya melihat bentuk **ternary → literal 0**. Pembagian yang **sama
    sekali tanpa penjaga** (menghasilkan `Infinity`/`NaN`) tak terlihat olehnya
    — populasi itu belum disapu, dan satu-satunya yang kutemui
    (`perlengkapan/service.ts`) ketahuan karena kebetulan berbentuk ternary;
  - sapuannya berhenti di `packages/shared` + `apps/server`; pembagian di
    `apps/web` dan di Dart **tidak** disapu putaran ini;
  - `foodCostPersen` kini `number | null`, tapi `hpp`/`harga_saran` tetap
    `number` — keduanya penjumlahan, bukan pembagian, dan menulari mereka
    dengan `null` akan menyebarkan ketidaktahuan ke angka yang diketahui;
  - `MenuDto.food_cost_persen` sudah `number | null` sejak vena biaya, jadi
    **kabelnya tak berubah bentuk** — yang berubah artinya: `null` kini berarti
    "ditahan **atau** tak terhitung". Klien lama membacanya sama
- **Tindak**: `packages/shared/src/angka.ts` (`bagiAtauNull`) · `hpp.ts` ·
  `types.ts` (`MenuDtoPenuh`, `PenyumbangHpp`) · `menu/routes.ts` ·
  `produksi/routes.ts` · `AnalisisHargaPage.tsx` · `MenuFormPage.tsx` ·
  `pembagi-nol-tak-jadi-nol.test.ts` (9 uji) · verify-api **§267** (10 asersi) ·
  ponsel: `format.dart` (`formatPersen`) · dua model · dua layar · `harga_test.dart` (+5 uji)
- Gerbang: typecheck bersih · `npm test` **2.377** (202 berkas) · `verify-api`
  **3.173 lolos, 0 gagal** vs Postgres SEGAR (§267 baru) · cakupan rute **273**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6** ·
  `flutter analyze` bersih · `flutter test` **557**

---

## Sajian yang DIBATALKAN dapur tetap bisa ditagih — server+web+mobile — 2026-08-26

- **Kenapa**: usulan antrean yang ditulis putaran lalu dengan angkanya
  (`pesanan_status='batal'`). Menyapunya menemukan bentuk yang sama persis
  dengan tanda tangan sesi ini — kali ini pada **UANG TAMU**
- **Aturannya sudah ditulis, bahkan dikomentari panjang** di
  `open-bill/routes.ts`, tepat di atas penyaring bon: *"Di slip, membawa baris
  batal berarti menyuruh dapur memasaknya lagi. Di sini artinya **MENAGIH TAMU
  untuk makanan yang tak pernah datang**. Pembatalan biasanya terjadi karena
  bahannya habis, jadi tamunya justru orang yang sudah dikecewakan sekali."*
  Ia ditegakkan di **empat** tempat — slip dapur, bon tagihan, keranjang kasir
  web (`cartTagih`), keranjang ponsel (`lineTagih`) — dan **tidak** di pintu
  yang benar-benar mengambil uangnya
- **TEREPRODUKSI lewat HTTP**, satu bill dua baris yang salah satunya
  dibatalkan dapur:

  | | sebelum | sesudah |
  |---|---|---|
  | bon sesudah pembatalan | Rp1.000 | Rp1.000 |
  | `POST /penjualan` dengan kedua baris | **201** | **409** `baris_dibatalkan` |
  | total penjualan yang terbit | **Rp6.000** | — |
  | stok bahan baris yang dibatalkan | **50 → 49** | **50 → 50** |

  Barisnya tersimpan sebagai `"Nasi Putih" Rp5.000 pesanan_status="batal"` —
  **sekaligus batal DAN ditagih** — dan stok terpotong untuk masakan yang tak
  pernah dibuat. Bon berkata Rp1.000; pintu bayar menerima Rp6.000
- **§229 sudah memaku bahwa BON-nya turun** saat baris dibatalkan. Yang tak
  pernah diuji: apakah **pembayarannya** menghormati bon itu
- **`createSale` mengiterasi `params.items` yang DIKIRIM KLIEN.** Ia
  mencocokkan `open_bill_item_id` → `menuId`, mewarisi `pesananStatus` dari
  baris bill-nya… lalu menagihnya. Tak ada satu pun pemeriksaan status
- **Populasi** (literal `"batal"`/`'batal'`, komentar dibutakan):

  | akar | literal | pembanding JS | pembanding domain PESANAN |
  |---|---|---|---|
  | `apps/server/src` | 19 → **15** | 5 → **1** | 4 → **0** |
  | `packages/shared/src` | 6 → **4** | 3 → **1** | 3 → **1** (rumahnya) |
  | `apps/web/src` | 10 → **6** | 8 → **4** | 4 → **0** |

  Aturan pesanan yang ditulis tangan: **11 → 1**. Sisa 4+1 pembanding milik
  **bendera LAIN** — status faktur beli perlengkapan yang kebetulan memakai
  kata yang sama; didaftarkan beralasan, tidak disatukan (menyatukannya justru
  menyesatkan)
- **Satu rumah**: `dibatalkanDapur(status)` + `barisDitagih(items, status)` di
  `packages/shared/src/pesanan.ts`. Bentuk barisnya berbeda antar pemanggil
  (`pesanan_status` di DTO server, `pesananStatus` di keranjang web), jadi
  statusnya diambil lewat **pengakses** — yang disatukan aturannya, bukan
  bentuknya
- **Penjaganya di `createSale`, satu titik untuk DUA pintu**: `POST /penjualan`
  dan `/sync` sama-sama memanggilnya. Keduanya diuji, bukan disimpulkan —
  §266 menembak keduanya dan keduanya membalas 409 dengan sebab yang sama
- **DITOLAK, bukan dilewatkan diam-diam.** Melewatkan barisnya akan membuat
  kasir menerima uang sebesar total lama dan memberi kembalian yang salah
  tanpa ada yang tahu — bug yang lebih sunyi daripada yang sedang ditutup
- **409, bukan 400, dan itu diangkat ke permukaan sebelum dikerjakan**: galat
  berkode di jalur ini kelas `PenjualanGagal` yang konstruktornya hanya
  menerima 409; hanya galat berkode yang membawa `sebab`, dan antrean offline
  ponsel membedakan sebab **hanya** lewat itu. Maknanya pun konflik keadaan,
  bukan permintaan cacat
- **Ponsel tak perlu berubah, dan alasannya sudah ditulis di sana**:
  `_sebabSudahTercatat` adalah daftar **PUTIH**, jadi sebab baru otomatis
  diperlakukan gagal & terlihat kasir. Yang ditambah cuma fikstur kontrak
  (regenerasi) dan **uji bernama** untuk `baris_dibatalkan` — perilaku yang
  benar karena konstruksi tetap layak dipaku
- **Detektor**: sapuan literal `"batal"` atas ketiga akar, memisahkan yang
  hidup **di dalam `` sql`…` ``** dari pembanding JS. **Dibuktikan bisa
  menuduh**: `dibatalkanDapur(l.pesananStatus)` di `KasirPage.tsx`
  dikembalikan ke `l.pesananStatus === "batal"` (suntikan di-assert
  **mengubah berkasnya**) → detektor menuduh berkas & barisnya, dan berkasnya
  tak terdaftar sebagai bendera lain. Berkas UTUH: nol tuduhan
- **PASANGAN**: bayar hanya baris yang SAH tetap **201** dengan total **persis
  sama dengan bon** sesudah pembatalan; penjualannya berisi **satu** baris;
  baris batal **tetap tercatat** di bill-nya (jejak, bukan dihapus); dan
  `dibatalkanDapur(null/undefined/""/"BATAL")` semuanya **false** — status
  yang belum terisi tak boleh hilang dari tagihan diam-diam, itu bug yang
  persis berlawanan arah
- **Tiga gerbang lama menagih penyesuaian, dan ketiganya dipaku ke NIATNYA**:
  `bill-dibuka-lagi-meja` memaku ejaan `kartu === "batal"` (dua situs) dan
  `pb1-satu-rumus` memaku **baris impor apa adanya** — menambah satu nama ke
  daftar impor yang sama memerahkannya tanpa satu pun rumus berpindah.
  Ditulis ulang jadi "bill tertutup TEPAT saat kartunya batal" dan "hitungPb1
  ada di dalam impor dari @kakarut/shared". `lampiran-dto-utuh` &
  `status-satu-kontrak` menagih regenerasi, dan itu dikerjakan
- **Batas, jujur**:
  - **`pesanan_status` pada penjualan yang SUDAH dibayar tidak disentuh.**
    Membatalkan baris di sana urusan **refund** (`qty_refund`); memotong omzet
    dari status papan akan menabrak jalur uang yang sudah punya pemiliknya.
    Diukur, dicatat, tidak diperbaiki;
  - penjaganya hanya menutup baris yang **berasal dari open bill**
    (`open_bill_item_id`). Penjualan langsung tak punya baris batal saat
    dibuat, jadi kelasnya tak terjangkau di sana — tapi itu keadaan hari ini,
    bukan jaminan;
  - detektor menilai `=== "batal"` secara **tekstual**. Perbandingan lewat
    variabel (`const B = "batal"; x === B`) akan terbaca aman — tak ada situs
    seperti itu hari ini;
  - empat literal di **SQL mentah** (`okupansi.ts` ×2, `penjualan/routes.ts`
    ×2) tetap literal: SQL tak bisa memanggil fungsi JS, dan memindahkannya ke
    JS berarti menarik seluruh baris ke memori untuk menjawab satu boolean
- **Ketegangan dengan tetangganya, ditulis di kodenya**: "tolak melebihi stok"
  sengaja **TIDAK** berlaku di `/sync` — menolaknya tak mencegah apa pun, ia
  hanya menghapus penjualan yang sungguh terjadi. Yang ini berbeda jenisnya:
  stok minus adalah **peringatan tentang masa depan**, baris yang dibatalkan
  adalah **fakta tentang yang disajikan**
- **Tindak**: `packages/shared/src/pesanan.ts` (rumah aturan) · `types.ts`
  (`SebabPenjualanGagal` +1) · `penjualan/service.ts` (penjaga) ·
  `open-bill/routes.ts` · `pesanan/routes.ts` · `KasirPage.tsx` ·
  `PesananPage.tsx` (empat penyaring dipindah) ·
  `test/batal-tak-ditagih.test.ts` (12 uji) · verify-api **§266** (11 asersi) ·
  ponsel: fikstur kontrak diregenerasi + `offline_queue_test.dart` (+1 uji)
- Gerbang: typecheck bersih · `npm test` **2.368** (201 berkas) · `verify-api`
  **3.163 lolos, 0 gagal** vs Postgres SEGAR (§266 baru) · cakupan rute **273**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6** ·
  `flutter analyze` bersih · `flutter test` **552**

---

## Baris yang sudah dinyatakan TIDAK BERLAKU, dan empat pintu yang lupa — server — 2026-08-26

- **Kenapa**: 77 vena menyapu *siapa yang boleh masuk*, *perusahaan siapa*,
  *angka siapa*, dan *apa yang dirakit dari masukan*. Yang tak pernah disapu
  sekali pun: apakah baris yang sudah dinyatakan **tidak berlaku** benar-benar
  berhenti dihitung. Ada empat benderanya, dan tak satu pun punya rumah —
  aturannya ditulis ulang di tiap situs
- **Populasi** (sapuan menyentuh rantai drizzle **dan** SQL mentah, dua cara
  hitung dilaporkan terpisah): **134 situs** menyentuh tabel berbendera atau
  anaknya —

  | induk | MENYARING | lewat variabel/pembantu | menulis | TELANJANG |
  |---|---|---|---|---|
  | `sales` (+ `sale_items`, `sale_consumptions`) | 23 | 12 | 5 | 9 |
  | `productions` (+ `production_consumptions`) | 26 | 19 | 2 | 6 |
  | `memberships` | 22 | 0 | 0 | 10 |

  Bentuknya: **107 drizzle · 27 SQL mentah**; sisa TELANJANG-nya 23 drizzle +
  2 SQL mentah, dipilah tangan dan didaftarkan beralasan
- **EMPAT TEMUAN, satu aturan, dan semuanya menugaskan PEKERJAAN.** Aturan
  "anggota = keanggotaan yang **belum diarsipkan**" ditulis eksplisit di
  `auth/session.ts` (*"keanggotaan AKTIF: perusahaan aktif + belum diarsip"*)
  dan ditegakkan di **sebelas** tempat. Empat pintu memakai aturan yang sama
  tanpa bagian terakhirnya. Terukur lewat HTTP terhadap DB dev, dengan
  karyawan yang benar-benar diarsipkan lebih dulu:

  | pintu | sebelum | sesudah |
  |---|---|---|
  | `POST /produksi/faktur` (`worker_id`) | **201** | **400** |
  | `PATCH /produksi/faktur/:key` (`worker_id`) | **200** | **400** |
  | `POST /rekomendasi/menu/faktur` (`worker_id`) | **201** | **400** |
  | `PUT /penyimpanan/:id/petugas` (`user_ids`) | **200** | **400** |
  | `PUT /karyawan/:id/tempat` (memberi) | 200 | **400** |

  Bukan teori: faktur **PR-0054** terbit pukul 13.46 dengan
  `dikerjakan_oleh: "Keluar Uji 143"` — karyawan yang diarsipkan pukul 11.42
  hari yang sama
- **Yang paling telanjang**: balasan `PUT /penyimpanan/:id/petugas` memuat
  `{"user_id":"…","nama":"Keluar Uji 143","role":"admin","aktif":false}` —
  **`"aktif": false` tepat di sebelah penugasan yang baru saja diterimanya.**
  Layarnya tahu; pintunya tidak
- **Beratnya ditulis apa adanya**: yang rusak **bukan aksesnya**. Orang itu
  sudah tak bisa login — `session.ts` menyaringnya, dan §54 memakukannya
  (401). Yang rusak **pembukuannya**: dokumen yang lahir sesudah ia berhenti
  menyebut namanya sebagai pelaksana, dan tak ada satu pun galat yang muncul
- **Satu rumah**: `pastikanAnggotaAktif(userId, companyId)` di
  `middleware/auth.ts`, tempat `pastikanCabang`/`resolveBranchId` sudah
  tinggal. **Dua sebab dijawab dua kalimat** — *"bukan anggota perusahaan"*
  dan *"sudah diarsipkan (keluar)"* menuntut tindakan berbeda dari orang yang
  membaca layarnya, dan menjawab keduanya dengan satu kalimat adalah temuan
  yang sudah pernah ditulis ledger ini
- **PASANGAN, dan yang satu ini menentukan**: mengarsipkan karyawan **tidak**
  menghapus penugasan tempat SO-nya, dan pintu itu satu-satunya cara
  membersihkannya dari sisi karyawan. Karena itu yang diperiksa hanya nama
  yang **DIMASUKKAN**: memberi → **400**, **mengosongkan → 200** (diuji pada
  tiga karyawan terarsip). Pengetatan yang mengunci daftarnya selamanya bukan
  pengetatan, ia bug kedua. Ditambah: karyawan aktif tetap 201/200 di ketiga
  pintu, arsipnya tetap terbaca di `?arsip=true`, dan faktur lama **tetap**
  menyebut pelaksananya — yang ditutup pintunya, bukan masa lalunya
- **Detektor**: rantai drizzle (`.from`/`join` + ekor pernyataan) **dan**
  pernyataan `` sql`…` `` yang benar-benar `.execute(`. **Dibuktikan bisa
  menuduh, dua kelas berbeda**: (1) empat `isNull(sales.deletedAt)` dicabut
  dari `laporan/routes.ts` (suntikan di-assert **mengubah berkasnya**) → **11
  situs** berubah jadi TELANJANG dengan berkas, baris, dan nama tabelnya —
  termasuk `saleItems` & `saleConsumptions`, tempat uangnya; (2) saringan
  dicabut dari **pembantu bernama** `kondisiFaktur()` di `penerimaan` →
  pemakainya ikut merah, jadi penelusuran pembantu bukan pemaaf buta. Berkas
  yang UTUH: nol tuduhan di kedua kasus
- **Detektornya sendiri salah tiga kali, dan ketiganya terukur** — semuanya
  ditemukan sebelum satu tuduhan pun ditulis:
  1. **pembantu bernama tak ditelusuri** → dua pintu `penerimaan` tertuduh
     keliru (saringannya hidup di `kondisiFaktur()`). Kelas yang sama memakan
     26 tuduhan pada sapuan tanggal putaran lalu;
  2. **literal larik terpotong** — `ekorPernyataan` hanya menghitung KURUNG,
     jadi `const conds = [a, b]` terputus di koma pertama dan `isNull(...)` di
     baris berikutnya tak terlihat: **10 pintu produksi** tertuduh keliru;
  3. **batas pernyataan berhenti di `{` mana pun** → daftar SELECT-nya sendiri
     terpotong, jadi `db.select({ archivedAt: … }).from(memberships)` terbaca
     telanjang. Kurungnya kini diseimbangkan MUNDUR
  Angka TELANJANG bergerak 41 → 35 → 29 → 25 karena ketiganya, bukan karena
  aturannya dilonggarkan
- **Satu rumah untuk instrumennya juga**: pemindai SQL mentah
  (`templateSql`/`tanpaSubkueri`/`badanPembantu`) hidup privat di
  `daftar-tanpa-langit-langit.test.ts`. **Dipindah** ke
  `test/util/sql-mentah.ts`; berkas lama mengimpornya dan tetap 10/10 hijau
- **Batas, jujur**:
  - **`users.deletedAt` sengaja DI LUAR populasi**, dan alasannya diukur: enam
    jalur auth sudah menyaringnya, sementara ~20 sentuhan sisanya adalah JOIN
    UNTUK NAMA (`deletedBy`, `dikerjakan_oleh`) — di situ menyaring justru
    SALAH. Menariknya masuk akan menenggelamkan gerbangnya dalam 20
    pengecualian dan membuatnya tak berarti;
  - daftar pengecualiannya berkunci **berkas + JUMLAH**, bukan nomor baris —
    stabil terhadap penyuntingan, tapi situs telanjang baru di berkas yang
    sama hanya menagih keputusan lewat kenaikan hitungannya, tak menyebut
    barisnya;
  - kelas `LEWAT_VARIABEL` menilai nama yang **terdekat sebelum** situsnya
    (fungsi di-hoist). Nama yang dibentuk ulang di tengah rantai — atau
    saringan yang datang lewat argumen dari berkas LAIN — masih terbaca aman;
  - **`sales.deleted_at` & `productions.deleted_at` tak menghasilkan satu pun
    temuan.** Jalur uang & stok memang sudah rapi, dan itu ditulis sebagai
    negatif bersih berangka: 23+26 situs menyaring, 31 lewat variabel bernama,
    15 sisanya satu-hop/penomoran/penulisan yang terdaftar beralasan
- **Usulan antrean berikutnya, dengan angkanya** (diukur di putaran ini,
  sengaja TIDAK dikerjakan): **`pesanan_status = 'batal'`** — baris pesanan
  yang DIBATALKAN dapur. **86 sebutan** di 6 berkas; hanya **4** menyaring di
  SQL dan **2** menyaring di JS (`.filter(it => it.pesanan_status !== "batal")`).
  Sebagian besar 86 itu memang cuma memajang status, jadi populasinya harus
  dipersempit ke kueri yang MENGHITUNG uang/stok sebelum ada tuduhan
- **Tindak**: `middleware/auth.ts` (`pastikanAnggotaAktif`) ·
  `produksi/routes.ts` · `rekomendasi/rencana.ts` · `penyimpanan/routes.ts` ·
  `users/routes.ts` · `test/util/sql-mentah.ts` (baru, dipindah) ·
  `test/util/bendera-hapus.ts` (baru) ·
  `test/bendera-hapus-disaring.test.ts` (8 uji) · verify-api **§265**
  (16 asersi)
- Gerbang: typecheck bersih · `npm test` **2.356** (200 berkas) · `verify-api`
  **3.152 lolos, 0 gagal** vs Postgres SEGAR (§265 baru) · cakupan rute **273**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6**

---

## HTML surat dirakit dari data pengguna, tanpa satu pun pelolos — server+web — 2026-08-26

- **Kenapa**: putaran lalu menutup *ke mana* tautan surat menunjuk. Menyapu
  sekitarnya menemukan saudara kandungnya di berkas yang sama — *apa* yang
  dirakit di sekelilingnya
- **Populasi** (literal templat ber-tag-HTML **dan** ber-interpolasi, dihitung
  pengurai templat, bukan grep):

  | akar | literal | melolos SEBELUM | melolos SESUDAH |
  |---|---|---|---|
  | `apps/server/src` | 12 → 13 | **0** | **7** |
  | `packages/shared/src` | 0 | 0 | 0 |
  | `apps/web/src` | 11 | 3 | 3 |

  (Angka sebelum diukur dengan pengurai yang SAMA terhadap `HEAD`, lewat
  `git show`, supaya keduanya sebanding. Server bertambah satu literal karena
  perakit suratnya dipecah jadi fungsi murni.)

  Delapan "tidak" di web adalah situs **penggabungan** (`${kepala}`, `${tabel}`,
  `${opts.bodyHtml}`) yang tiap sisipan **datanya** sudah lewat `esc()` di hulu
  — web memang sudah benar, dan angkanya karena itu tak berubah. Yang tak punya
  pelolos sama sekali: **server**. Sesudah: enam sisa di server semuanya
  terdaftar beralasan (satu `index.ts` + lima `backup-peringatan.ts`)
- **Yang paling tajam**: `modules/users/routes.ts:330` merakit surat undangan
  dari `co.nama`. Nama perusahaan divalidasi `z.string().trim().min(1)` — tanpa
  batasan aksara — dan di jalur ini penyerang memilih **keduanya**: isi yang
  disuntik (nama perusahaannya sendiri, bebas didaftarkan) dan penerimanya
  (`body.email`, alamat mana pun). Suratnya berangkat dari domain produk dan
  lolos SPF/DKIM
- **UKURAN, dari keluaran perakit yang sungguhan** (bukan dari membaca; badan
  surat tak terkirim di dev, jadi perakitnya diekstrak dulu **tanpa mengubah
  isinya**, baru diukur — "sebelum" dan "sesudah" datang dari fungsi yang sama):

  | kasus | `<a` sebelum | `<a` sesudah |
  |---|---|---|
  | undangan, nama = `</b></p><p><a href="https://penyerang.example">…` | **2** | **1** |
  | verifikasi, nama sama | **2** | **1** |
  | undangan, url = `https://kakarut.app" onmouseover="jahat()" x="` | 1 tag ber-**3 atribut** | 1 tag ber-**1 atribut** (`href`) |

  Satu `<a` itu milik Kakarut; yang kedua milik penyerang. Sesudah: suntikannya
  jadi teks yang terlihat (`&lt;/b&gt;…`), bukan tag
- **Vektor kedua menumpuk di atas putaran lalu**: `${url}` duduk **di dalam
  atribut** (`<a href="${url}">`), dan `url` lahir dari `appBaseUrl(c)` — yang
  tanpa `APP_BASE_URL`/`APP_HOST_DIPERCAYA` masih diturunkan dari
  `X-Forwarded-Host`. Putaran lalu menutup *tujuan*-nya; ini menutup
  *keluar-dari-atribut*-nya
- **Beratnya dinilai jujur, bukan dibesarkan** — dua klaim yang sengaja TIDAK
  dibuat, karena masing-masing diperiksa dan ternyata tak terjangkau:
  - **bukan injeksi header `Subject`**: nodemailer dan Resend sama-sama
    menyandikan header (`modules/mail/service.ts`);
  - **bukan XSS**: klien surat menyaring `<script>` dan atribut peristiwa.
  Yang NYATA dan tak disaring: **penyuntikan tautan & pemalsuan isi**
- **Detektor**: pengurai templat literal (backtick, `${}` bersarang, kutip,
  dan **literal regex**) atas ketiga akar. **Bisa menuduh, dibuktikan**:
  `lolosHtml` dicabut dari `surat.ts` (suntikan di-assert **mengubah berkasnya**,
  bukan sekadar dijalankan) → detektor menyebut berkas, baris, dan nama
  ekspresinya (`namaPerusahaan`); berkas yang UTUH tak dituduh sama sekali
- **Detektornya sendiri sempat salah, dan itu terukur**: versi pertama tak
  mengenal literal regex, jadi `${name.replace(/"/g, '""')}` di `lib/backup.ts`
  membuat `"` di dalam regex terbaca sebagai pembuka string — satu "templat"
  menelan **141 baris sisa berkasnya**. Sesudah `lewatiRegex`: 24 templat,
  tak ada yang kabur
- **PASANGAN**: nama wajar ber-`&` dan ber-apostrof tetap **TERBACA** —
  `Warung Bu Ani & Anak` → `&amp;` (bukan `&amp;amp;`, bukan dibuang),
  `D'Rasa "Enak"` utuh; tautan sah `<a href="…/daftar">…</a>` tetap satu tag
  utuh; undangan tetap **201** dan barisnya muncul di daftar pending
- **Yang TIDAK dilolos, dengan alasan yang bisa diperiksa** (daftar bernama,
  per-ekspresi, ber-anti-kuburan): `index.ts` `${buildId}` (heksa dari
  `computeBuildId`) · lima situs `backup-peringatan.ts` (surat ke super admin
  yang seluruh isinya dirakit server; zona waktunya dari `companies.timezone`
  yang **tak punya satu pun jalur tulis**) · `web/lib/pdf.ts` dan tiga belas
  ekspresi `DokumenBelanjaModal.tsx` (angka, dua ternary yang kedua cabangnya
  literal, konstanta, dan potongan yang dirakit di berkas yang sama)
- **Satu rumah, bukan salinan**: `esc` **dipindah** dari
  `DokumenBelanjaModal.tsx:225` ke `packages/shared/src/html.ts` sebagai
  `lolosHtml`/`lolosAtribut`, dan berkas web itu mengimpornya. Menyalinnya akan
  melahirkan aturan kedua — kelas yang baru saja dibayar putaran lalu (lima
  salinan validasi tanggal). Gerbangnya memaku itu: berkas mana pun di luar
  `shared/html.ts` yang memuat literal `"&lt;"` dituduh
- **Menyimpang dari rencana, disengaja**: rencana menyebut `subject` ikut
  dilolos. Tidak dilakukan — `subject` dirender sebagai **teks biasa**, bukan
  HTML, dan transportnya sudah menyandikan header. Melolosnya justru akan
  memajang `Undangan bergabung Warung Bu Ani &amp;amp; Anak` di judul surat:
  menukar satu bug dengan bug yang lebih sunyi
- **Tindak**: `packages/shared/src/html.ts` (baru) ·
  `modules/mail/surat.ts` (baru — perakit surat jadi fungsi murni yang bisa
  diuji) · `modules/auth/routes.ts` · `modules/users/routes.ts` ·
  `DokumenBelanjaModal.tsx` (esc dipindah) ·
  `test/util/templat-html.ts` (baru) · `test/html-surat-dilolos.test.ts`
  (12 uji) · verify-api **§264** (5 asersi)
- **Batas, jujur**:
  - **badan suratnya tak pernah diuji lewat HTTP.** Di dev tak ada SMTP/Resend,
    `kirimEmail` melempar dan ditangkap diam-diam — jadi HTML-nya tak terlihat
    dari luar. Yang diukur keluaran **perakitnya**; §264 hanya membuktikan
    alurnya hidup dan pelolosan tak merembes ke penyimpanan;
  - detektornya melihat **literal templat**, bukan HTML yang dirakit lewat
    `+` antar string biasa atau `Array.join` — populasi itu belum disapu;
  - "melolos" dinilai per-ekspresi secara tekstual (`lolosHtml(`/`esc(` muncul
    di dalamnya). Sisipan yang memanggil pelolos di CABANG saja
    (`x ? lolosHtml(a) : b`) akan terbaca aman — tak ada situs seperti itu
    hari ini, tapi detektornya tak akan menangkapnya bila lahir;
  - klien surat tak diuji satu per satu; klaim "skrip disaring" bersandar pada
    perilaku umum, dan justru karena itu **tak dijadikan alasan menurunkan**
    tingkat temuannya
- **Negatif bersih yang ikut terukur**: `packages/shared/src` **nol** literal
  HTML ber-interpolasi — perakit struk & ESC/POS di sana bekerja dengan bita,
  bukan markup, jadi tak ada permukaan yang perlu dijaga
- Gerbang: typecheck bersih · `npm test` **2.348** (199 berkas) · `verify-api`
  **3.136 lolos, 0 gagal** vs Postgres SEGAR (§264 baru) · cakupan rute **273**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6**

---

## Tautan email lahir dari header peminta — server — 2026-08-26

- **Kenapa**: permukaan "apa yang dipakai membangun tautan di surat" tak punya
  satu pun entri di 76 vena sebelumnya. Ditemukan saat menyapu sisa param
  query, bukan dicari — `lib/base-url.ts` menurunkan host dari header
  permintaan
- **TEREPRODUKSI lewat HTTP, dan ini pengambilalihan akun — bukan phishing**:

  ```
  POST /api/auth/forgot-password        Host: penyerang.example
  → {"dev_reset_url":"http://penyerang.example/reset-password?token=a9c078…"}

  POST /api/auth/forgot-password        X-Forwarded-Host: penyerang.example
                                        X-Forwarded-Proto: https
  → {"dev_reset_url":"https://penyerang.example/reset-password?token=e7fc51…"}
  ```

  Tokennya **hidup dan milik korban**. Surat mendarat di kotak masuk KORBAN,
  tampak sah (domainnya cuma beda di mata yang teliti), dan sekali diklik
  tokennya berpindah tangan. Protonya pun ikut ditempa
- **Empat tautan lewat pintu yang sama**: reset password (`auth:285`),
  verifikasi email (`auth:253`, `auth:436`), undangan karyawan (`users:326`)
- **Penawarnya KONFIGURASI, dan `APP_BASE_URL` tak di-set di mana pun** yang
  bisa kubaca — tak ada di `ci.yml`, `Dockerfile`, `docker-compose*`, atau
  `.env.example`. Env produksi hidup di panel Dokploy yang tak bisa kubaca,
  jadi **aku tak bisa menyatakan produksi rentan** — yang bisa kunyatakan:
  bawaannya rentan, dan tak ada apa pun di repo yang menutupnya
- **Yang diperbaiki**, dan urutannya sengaja:
  1. `APP_BASE_URL` di-set → dipakai apa adanya, **header diabaikan total**
     (terukur: `Host: penyerang.example` → `https://kanonik.kakarut.id`);
  2. `APP_HOST_DIPERCAYA` (env baru, dipisah koma) → host dari header **wajib
     ada di daftar**; kalau tidak, entri pertama dipakai sebagai domain
     kanonik. Terukur: host tempaan → `https://app.kakarut.id`, sementara
     host yang MEMANG sah (`kakarut.id`) tetap dihormati — pemasangan
     multi-domain tak ikut mati;
  3. keduanya kosong → perilaku lama **dipertahankan**, tapi dilaporkan
     `kritis` ke panel super admin lewat `pemeriksaan-setelan`, satu jalur
     dengan `jwt_bawaan` dan `superadmin_password_bawaan`
- **Kenapa nomor 3 TIDAK dibuat keras**, dan ini keputusan yang ditulis:
  bila produksi belum menyetel apa pun, menolak menurunkan dari header membuat
  SELURUH tautan reset & verifikasi menunjuk `localhost` — surat yang sama
  sekali tak bisa dipakai. Itu menukar lubang yang **butuh penyerang** dengan
  kerusakan yang **pasti**. Yang benar: membuatnya TERLIHAT sampai disetel
- **Terukur bahwa laporannya jujur**: temuan `kritis` muncul saat keduanya
  kosong, dan **hilang (0)** begitu `APP_BASE_URL` atau `APP_HOST_DIPERCAYA`
  disetel — bukan omelan permanen yang lalu diabaikan orang
- **Detektor: DIBUKTIKAN bisa menuduh** — daftar-izin dicabut dari
  `appBaseUrl` (suntikan di-assert mendarat) → uji merah menyebut nilainya:
  `expected 'http://penyerang.example' to be 'https://app.kakarut.id'`.
  Dipulihkan
- **PASANGAN**: alur reset yang SAH tetap hidup (`ok:true` + token terbit),
  host multi-domain yang sah tetap dipakai, dan tak ada tautan email lain
  yang merakit host sendiri (sapuan mekanis atas tiga modul pengirim surat)
- **Tindak**: `lib/base-url.ts` (daftar-izin + `tautanEmailDariHeader`) ·
  `config/env.ts` (`APP_HOST_DIPERCAYA`) · `pemeriksaan-setelan.ts` (temuan
  `kritis`) · `tautan-email-tak-dari-header.test.ts` (6 uji) · verify-api
  **§263** (4 asersi)
- **YANG HARUS DILAKUKAN PEMILIK, dan hanya dia yang bisa**: set
  `APP_BASE_URL` ke domain publik aplikasi di panel Dokploy, lalu restart.
  Sampai itu terjadi, lubangnya masih terbuka di produksi — kode ini membuat
  keadaan itu terlihat, bukan hilang
- **Batas, jujur**:
  - yang disapu **tautan di surat**; header permintaan yang dipakai untuk hal
    LAIN (mis. pembangunan URL di balasan API) belum diukur;
  - daftar-izin membandingkan host **persis**, tanpa wildcard subdomain —
    pemasangan ber-subdomain-per-tenant harus menyebut semuanya;
  - aku tak bisa membaca env produksi, jadi status produksi **tak diklaim**
- **Negatif bersih yang ikut terukur di putaran ini**, dicatat supaya tak
  terbaca terlupakan: (1) **ETag/cache** — keempat rute daftar ber-ETag sudah
  `Cache-Control: private, no-cache` + `Vary: Authorization`, jadi `/menu`
  yang kini berbeda isi per peran tak bisa tersaji silang; (2) **param angka
  query** — ketiga situsnya berbatas rapi (`Number.isFinite` + `Math.min/max`,
  atau 400 eksplisit untuk `biaya_tetap`); (3) **error_logs** sengaja tak
  menyimpan badan permintaan & query string, dan komentarnya menulis alasannya
- Gerbang: typecheck bersih · `npm test` **2.336** (198 berkas) · `verify-api`
  **3.131 lolos, 0 gagal** vs Postgres SEGAR (§263 baru) · cakupan rute **273**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6** ·
  `flutter test` **551** (fikstur kontrak status diregenerasi — `types.ts`
  berubah di vena biaya)

---

## Tanggal dari query & badan: cabang GAGALNYA tak bertuan — server — 2026-08-26

- **Kenapa**: permukaan yang tak punya satu pun entri di 75 vena sebelumnya.
  Badan permintaan sudah disapu (114 skema `.strict()`, `z.number().max()`,
  larik berbatas); **param query tak pernah**. Terukur: **82** pembacaan
  `c.req.query("...")`, **NOL** yang lewat skema
- **Populasi tanggal** (setelah tiga kali memperbaiki pengurainya): **36**
  pembacaan param tanggal —

  | | jumlah |
  |---|---|
  | memeriksa keabsahannya lalu **GAGAL DIAM** (dilewati / jatuh ke bawaan) | **29** |
  | tak memeriksa sama sekali | **5** |
  | menolak | **2** |

  Aturannya ada, dipanggil, bahkan dikomentari. Yang tak pernah ada: **apa
  yang terjadi saat ia bilang "tidak sah"**
- **Akarnya satu**: aturan "tanggal ini sah" punya **LIMA salinan yang tak
  sepakat** — `laporan:34`, `rekomendasi:86`, `penerimaan:243`,
  `perlengkapan:73` (regex-saja) vs `absensi:51`, `pengajuan:29` (regex +
  tanggalnya benar-benar ada). Yang kedua benar
- **TEMUAN 1 — 500 pada tanggal yang mungkin diketik orang.** Terukur lewat
  HTTP: `GET /laporan?dari=2026-02-30` → **500 `"Terjadi kesalahan pada
  server"`**. Bentuknya lolos regex, isinya ditolak Postgres. Berlaku di
  **seluruh** rute `/laporan/*`, dan sama untuk `2026-13-45`, `9999-99-99`,
  `2026-02-29` (2026 bukan kabisat). **SESUDAH: 400 yang MENYEBUT paramnya** —
  `Tanggal pada "sampai" tidak sah: "2026-02-31" — pakai format YYYY-MM-DD`
- **TEMUAN 2 — saringan dibuang diam-diam.** `pengajuan:168` memakai
  `if (dari && tanggalValid(dari))`; cabang gagalnya **melewati** saringannya.
  Terukur: rentang sah → **4** baris; `?dari=BUKAN&sampai=xxx` → **13**
  (seluruh tabel); dan **satu paruh ngawur membuang KEDUA saringannya**
  (`?dari=2026-08-01&sampai=BUKAN` → 13 juga). Balasannya larik telanjang,
  jadi layar tetap memajang pilihan tanggal yang tak pernah dipakai.
  **SESUDAH: 400 bernama**
- **TEMUAN 3 — permukaan BADAN kena penyakit yang sama.** Diukur sesudah dua
  temuan pertama, bukan diandaikan: `POST /stok/awal` dengan
  `tanggal: "2026-02-30"` → **500**, sebab `z.string().regex(...)` pun cuma
  memeriksa bentuk. **SESUDAH: 400.** Ditutup dengan `zTanggal` di rumah yang
  sama
- **Aturan yang akhirnya bisa DINAMAI**, dan repo ini sudah memakainya tanpa
  menamainya: **jatuh ke bawaan itu jujur HANYA bila balasannya menyebut apa
  yang dipakai.** `/laporan` mengembalikan `dari`/`sampai`; `/absensi/rekap`
  dan `/kebersihan/rekap` mengembalikan `bulan`/`dari`/`sampai` — layarnya
  merender dari nilai itu, bukan dari yang diketik orang. `/pengajuan` dan
  `/kebersihan` memulangkan larik telanjang — di sana bawaan berarti berbohong
- **Gerbang lama menahan pengetatan yang BERLEBIHAN, lagi.** Membuat `?bulan=`
  menolak mematahkan **empat asersi verify-api yang sudah ada** (*"rekap:
  bulan 00 → jatuh ke bulan berjalan (bukan 500)"*). Kontraknya sengaja
  dipaku, dan pengukuran membenarkannya: rekap MENYEBUT bulan yang dipakai,
  jadi bawaannya jujur. Dikembalikan lewat `bulanQueryAtau`, dengan alasannya
  tertulis. Preseden persis §191 (`kasir → POST /penyimpanan`)
- **Detektor: DIBUKTIKAN bisa menuduh — dan terbukti menuduh PALSU tiga kali
  lebih dulu.** Jendela tiga-baris pertama menandai 26 situs "telanjang";
  sebagian besar ternyata dijaga oleh **pembantu bernama** (`bacaHari(...)`,
  `tglValid(...)`) atau **daftar-izin** (`=== "pagi"`), yang jendelaku tak
  lihat. Sesudah pengurainya mengenali ketiganya: 33 pembantu · 13 daftar-izin
  · 10 branch · sisanya. Bukti merah akhir: `tanggalQuery` dicabut dari
  `/pengajuan` (suntikan di-assert mendarat) → gerbang menuduh **dua barisnya
  dengan nomor baris**
- **Hasil**: 36 pembacaan mentah → **0**. Lima salinan aturan → **satu rumah**
  (`lib/tanggal-query.ts`), dipakai query (`tanggalQuery`/`bulanQuery`/
  `bulanQueryAtau`) dan badan (`zTanggal`)
- **PASANGAN, terukur** — pengetatan tanpa pasangan adalah cara mengubah
  perbaikan jadi kerusakan:

  | pasangan | hasil |
  |---|---|
  | `?dari=&sampai=` (form kosong) | tetap **200**, 13 baris — persis sama dengan tanpa param |
  | 8 rute berentang, dengan & tanpa rentang | **200** semua |
  | rentang TERBALIK (`dari > sampai`) | **200** — nol baris adalah jawaban yang benar, bukan galat |
  | rekap `?bulan=NGAWUR` | jatuh ke bawaan **dan balasannya menyebutnya** |

- **Tindak**: `lib/tanggal-query.ts` (rumah) · 9 modul dialihkan ·
  `tanggal-query-satu-rumah.test.ts` (4 uji: premis kabisat/`2026-02-30`,
  sapuan mekanis pembacaan mentah, sapuan salinan regex di KEDUA permukaan,
  pasangan "kosong = tanpa rentang") · verify-api **§262** (39 asersi)
- **Dua gerbang berdiri lain ikut bereaksi, dan keduanya benar**:
  `batas-hari-zona` menuntut jembatan `T00:00:00Z` baru terdaftar beralasan
  (dua entri lama jadi satu, sebab salinannya menyusut), dan
  `rekap-absen-pindah-cabang` memaku regex bulan yang pindah rumah — pin-nya
  dipindahkan ke MAKSUDNYA, dua sisi
- **Batas, jujur**:
  - yang disapu **param tanggal**; 46 param query lain (`status`, `q`,
    `sesi`, `page`, `per_page`, `arsip`, …) dipilah tapi **tidak** diubah —
    semuanya daftar-izin `===` atau teks ber-`trim` yang tak bisa meledak,
    dan itu dicatat sebagai negatif bersih berangka, bukan kekosongan;
  - `zTanggal` menutup medan tanggal di badan, **bukan** medan waktu
    (`timestamptz`) — permukaan lain yang belum diukur;
  - aturan "bawaan sah bila balasannya menyebutnya" ditulis sebagai prosa dan
    dipaku per-situs, **belum** jadi sapuan mekanis — rute baru yang jatuh ke
    bawaan tanpa menyebutkannya takkan tertangkap
- Gerbang: typecheck bersih · `npm test` **2.330** (197 berkas) · `verify-api`
  **3.127 lolos, 0 gagal** vs Postgres SEGAR (§262 baru) · cakupan rute **273**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6**. Tak
  ada berkas Dart tersentuh → `flutter analyze`/`flutter test` tidak dijalankan

---

## Kebijakan BIAYA ditegakkan di pintunya — server+web+mobile — 2026-08-26

- **Kenapa**: bukan bug melainkan **kebijakan yang belum satu**. Aturannya sudah
  ditulis TIGA KALI di layar, tiap kali dengan nama sendiri — `isManajemen`
  (`App.tsx`, `Layout.tsx`), `bolehUbah` (`ResepPage`, yang bahkan tak
  MENGAMBIL datanya lewat `enabled: bolehUbah`), `lihatHarga`
  (`resep_page.dart`) — dan tak pernah di pintunya. Keputusan pemilik atas tiga
  pilihan yang disodorkan berangka: **"biaya = manajemen saja"**
- **Terukur SEBELUM** (token peran `bar` DAN `cashier` sungguhan, DB segar,
  fikstur dibuktikan terbaca lebih dulu) — ketiganya termasuk owner membaca
  angka yang **SAMA PERSIS**:

  | rute | yang terbaca `bar` & `cashier` |
  |---|---|
  | `GET /menu`, `/menu/:id` | `hpp` **5662,03** · `hpp_dine_in` 4732,03 · `harga_saran` 10820,01 · `harga_jual_bulat` 11000 · `food_cost_persen` 51,47 · `komponen[].harga_per_unit` **357,14** |
  | `GET /bahan` | `harga_beli` **35.000** · `harga_per_unit` 777,78 |
  | `GET /penjualan/:id` | `sale.totalHpp` **5662,0314** · `items[].hppSatuan` |
  | `GET /perlengkapan/:id/kartu` | `total_belanja` |

- **SESUDAH**: `null` untuk keduanya, angka penuh untuk owner/admin —
  seluruhnya dipaku §261 verify-api (**37 asersi**)
- **`null`, BUKAN 0**, dan itu keputusan yang ditulis: nol adalah angka; ia
  tercetak "Rp 0" dan dipercaya orang. Ledger ini sudah sekali menandai `?? 0`
  sebagai "bentuk diam yang sedang dijaga". Formatter web merendernya `—` lewat
  `TAK_DIKETAHUI` yang **sudah ada** di berkas itu untuk nilai tak-hingga —
  perluasan aturan yang berdiri, bukan aturan baru
- **Penyaringnya di BATAS RUTE, bukan di service** — pagar terpenting putaran
  ini. `toMenuDto` dipakai juga `laporan/routes.ts` dan DUA situs di berkasnya
  sendiri yang MEMBACA `harga_jual_bulat` untuk menghitung saran harga;
  `hitungSaldoCabang` dipakai opname, kartu stok, dan walk FIFO di dalam
  server. Menihilkan di dalamnya bukan menjaga data — ia merusak perhitungan
- **Tipe yang membedakan dua keadaan, bukan `!` yang membuangnya**: typechecker
  menemukan **25** situs yang mengandaikan biaya selalu ada. Menaburkan `!` di
  sana berarti membuang justru pemeriksaan yang menjaga penyaringnya benar.
  Yang dibuat: `MenuDtoPenuh`/`BahanDtoPenuh`/`KomponenDtoPenuh` — DI DALAM
  server angkanya selalu ada, DI KABEL ia boleh ditahan. `AnalisisHargaRow`
  ikut jadi `MenuDtoPenuh` sebab rutenya sudah `requireRole("owner","admin")`
- **Detektor: DIBUKTIKAN bisa menuduh — dan terbukti BUTA lebih dulu.** Sapuan
  versi pertama menuntut argumen `return c.json(...)` menyebut penyaringnya. Ia
  buta terhadap bentuk yang paling wajar dipakai orang saat mencabut
  penjaganya:

      const dto = toMenuDto(row, katalog);
      return c.json(dto);            // ← tak menyebut toMenuDto sama sekali

  Suntikan bukti merahnya persis begitu, **dan gerbangnya hijau**. Diganti
  jadi hitungan KESEIMBANGAN (tiap `toMenuDto` yang bukan situs perhitungan
  wajib berpasangan dengan satu `saringMenu`) → suntikan yang sama tertuduh
  dengan angkanya: *"4 situs keluaran tapi cuma 3 yang disaring"*
- **Gerbang lama menangkap dua situs yang kulewati sendiri**: `POST /menu` dan
  `PUT /menu/:id` semula tak kusaring ("balasan tulis, sudah owner/admin").
  Sapuan kelengkapan menolaknya — dan benar: satu jalan yang sama membuat
  gerbangnya bisa menuntut kelengkapan alih-alih menghafal pengecualian
- **Ratchet putaran KEMARIN langsung menagih keputusan atas rute baruku
  sendiri**: `GET /stok/nilai` lahir → `izin-per-rute.test.ts` merah menuntut
  ia diadjudikasi di `TERBUKA_SENGAJA_BACA`. Itu bukti gerbang itu hidup
- **PASANGAN, empat lapis** — pengetatan tanpa pasangan adalah cara mengubah
  perbaikan jadi kerusakan:

  | pasangan | terukur |
  |---|---|
  | `GET /stok/nilai` identik owner & bar | **7.395.611,15** keduanya |
  | kasir tetap MENJUAL | nota `PUSAT-20260826-0003`, total 11.000 |
  | papan dapur/bar tetap terima HPP | POST sajian → `total_hpp` **5662,0314** |
  | `bar` tetap baca menu & harga JUAL | `harga_jual` 11000, `komponen[].qty` 2 |

- **UTANG BERSYARAT — ditulis di kodenya DAN diuji, bukan cuma dikomentari**:
  `GET /stok` masih mengirim `harga_per_unit` per baris. Sebabnya tanggal
  rilis, bukan kelalaian: kartu "Nilai stok" ponsel menghitung totalnya sendiri
  dari baris, build terpasang masih `1.0.0+10`, dan rilis berikutnya tertahan
  keystore. **Syarat pencabutannya tertulis**; §261 memaku keadaannya hari ini
  (`utang bersyarat: /stok MASIH mengirim harga per bahan`) supaya pencabutannya
  jadi keputusan sadar. Kedua klien SUDAH siap — keduanya beralih ke agregat
  server begitu `harga_per_unit` datang `null`, dan menyebut di layar bahwa
  cakupannya berubah jadi seluruh cabang
- **Rumus nilai stok tak digandakan**: `GET /stok/nilai` memakai
  `ringkasNilaiStok` dari `@kakarut/shared` — rumah yang sudah ada, dipakai web
  dan dicerminkan Dart. `null` masuk ember `tanpa_harga_bahan` yang **sudah
  ada** untuk harga 0, jadi build lama pun berdegradasi dengan jujur alih-alih
  diam
- **Tindak**: `bolehLihatBiaya` (rumah aturan, `constants.ts`) ·
  `packages/shared/src/biaya.ts` (penyaring murni) · penyaring di 4 modul rute ·
  `GET /stok/nilai` · web+ponsel beralih ke agregat · gerbang
  `biaya-hanya-manajemen.test.ts` (**7 uji**) yang juga memaku ketiga definisi
  klien tetap sepakat · §261 verify-api · CHANGELOG-API + `BELUM_TAYANG`
- **Batas, jujur**:
  - `foodCostMaks`/`targetPenjualan` di `GET /company` **tidak** ditutup —
    keduanya TARGET, bukan biaya, dan `/company` dibutuhkan POS untuk `pb1Rate`
    & `receiptFooter`. Keputusan, bukan kelupaan;
  - pin ketiga definisi klien membaca repo ponsel yang **tak ada di CI** — ia
    dilewati di sana (pola `kunci-satu-kontrak`), jadi yang menjaganya mesin
    yang memuat kedua repo;
  - sapuan kelengkapan menghitung KESEIMBANGAN, bukan menelusuri aliran nilai:
    situs yang mengeluarkan `MenuDto` lewat variabel perantara berlapis masih
    bisa lolos bila jumlah `saringMenu`-nya kebetulan cocok;
  - `/stok` (di atas) belum ditutup, dan itu satu-satunya medan biaya yang
    tersisa terbuka
- **Kesalahan lingkungan yang dicatat**: `npm run build -w @kakarut/web` saat
  server berjalan membuat `index.html` yang di-cache boot menunjuk aset yang
  sudah tak ada → **404, layar kosong, e2e merah 6/6**. Bukan regresi; server
  di-restart, e2e hijau. Kelas yang sama ("server basi") sudah sekali menggigit
  sesi ini
- Gerbang: typecheck bersih · `npm test` **2.326** (196 berkas) · `verify-api`
  **3.096 lolos, 0 gagal** vs Postgres SEGAR (§261 baru) · cakupan rute
  **273** (+1: `/stok/nilai`, rekamannya diperbarui) · `audit:invarian` 26/26 ·
  build web · e2e Playwright **6/6** · `flutter analyze` bersih ·
  `flutter test` **551**

---

## Pengurungan tenant arah BACA — server — 2026-08-26 — **BERSIH**

- **Kenapa**: ledger punya entri "Isolasi tenant pada PENULISAN" (2026-08-22,
  162 penulisan, BERSIH) — tapi entri itu meninggalkan DUA lubang, dan
  keduanya dibayar di sini: (1) sapuannya hidup di scratchpad, **tak ada
  gerbang berdiri**, jadi penulisan baru tanpa pengurungan bisa lahir hari ini
  tanpa satu uji pun berubah warna; (2) **arah BACA tak pernah dihitung sekali
  pun**. Di SaaS multi-tenant itu kelas kerusakan tertinggi: satu warung
  membaca data warung lain
- **Populasi** (kode TANPA komentar — prosa yang menyebut `companyId` akan
  menyatakan aman untuk kueri yang tak pernah mengurungnya): **627** kueri
  `db|tx .select|update|delete` — **469 baca + 158 tulis**

  | kelas | jumlah | arti |
  |---|---|---|
  | A | **391** | mengurung `companyId`/`companies.id` di rantainya sendiri |
  | A2 | **53** | lewat variabel atau `and(...conds)` — satu tingkat |
  | B | **22** | lewat `branchId` (cabangnya lahir dari `resolveBranchId`) |
  | C | **45** | kunci saringnya ikut dioper ke pemanggilan ber-`company_id` |
  | E | **68** | memang LINTAS perusahaan: auth, panel super admin, cadangan, seed |
  | F | **48** | tak teresolusi mekanis → **dipilah tangan satu per satu** |

- **Detektor: DIBUKTIKAN bisa menuduh — dan tiga kali terbukti BUTA lebih
  dulu.** Ini bagian yang paling mahal dan paling berharga dari putaran ini:

  1. **Rantai terpotong di `;`** — rantai drizzle yang tersebar di banyak baris
     terbaca separuh. Diperbaiki dengan kurung berimbang.
  2. **Kurung buka dihitung GANDA** saat melompati `.metode(` — rantainya
     menelan rute BERIKUTNYA dan meminjam `companyId` milik tetangganya.
     Akibatnya angkanya **382 aman / 87 tidak**, dan **suntikan bukti merah pun
     dinyatakan bersih**. Sesudah diperbaiki: **280 / 189**. Seratus tiga kueri
     tak terkurung sempat terbaca "aman".
  3. **Kelas C terlalu longgar** — "lingkupnya menyebut tenant di suatu tempat"
     menyatakan aman untuk suntikan yang lingkupnya menyebut tenant untuk tabel
     **LAIN**. Diperketat jadi "kunci yang MENYARING kueri ini ikut dioper ke
     pemanggilan ber-`company_id`" (pola `pastikanKartu(jenis, id,
     auth.company_id!)`): kelas C **51 → 24**.
  4. **`lingkup()` memakai `indexOf`** — dua kueri berteks identik sama-sama
     menunjuk situs PERTAMA. Kelas kesalahan yang sudah menggigit repo ini
     (`re.search` memungut pembantu senama pertama). Diperbaiki: lokasi dari
     nomor baris.

  Sesudah keempatnya: suntikan telanjang **dan** suntikan tersamar sama-sama
  tertuduh, dan **pasangannya** — variabel yang MEMANG mengurung `companyId` —
  tidak tertuduh
- **Pilahan tangan atas ke-48**, dan tak satu pun bocor. Empat bentuk, semuanya
  bisa diperiksa:
  1. **induk diverifikasi lebih dulu di handler yang sama** —
     `pastikanKartu(jenis, id, auth.company_id!)`, `eq(ingredients.id, id) AND
     eq(ingredients.companyId, …)` sepuluh baris di atasnya;
  2. **kunci lahir dari kueri terkurung tepat di atasnya** — `billIds`,
     `saleIds`, `fakturIds`, `kirimMap`, `batchByProd`;
  3. **diperiksa di JS SESUDAH dibaca** — `bill.companyId !== companyId`
     (`loadDetail`), `row.companyId !== companyId` (`getCustomer`). Sah, tapi
     rapuh: WHERE-nya tak melindungi apa pun, yang melindungi baris `if`-nya;
  4. **tabel `users` yang memang global**, kuncinya dari baris terkurung
     (`users.id = sale.cashierUserId`) — venanya sendiri sudah pernah disapu
- **Diukur lewat HTTP dengan DUA tenant sungguhan** (Aturan 6 — tiap id milik
  tenant A dibuktikan terbaca oleh A lebih dulu; tanpa itu 404 milik tenant B
  tak menyatakan apa pun, sebab id ngawur juga 404): **sepuluh rute detail
  ber-`:id`** ditembak — `/bahan/:id/langkah` · `/resep` · `/detail` ·
  `/meja/:id/log` · `/stok/kartu/:id` · `/stok/fifo/:id` · `/penjualan/:id` ·
  `/slip` · `/pesanan/penjualan/:id/log` · `/perlengkapan/:id/kartu`.

  | | tenant A (pemilik) | tenant B |
  |---|---|---|
  | kesepuluh rute | **200** | **404** |

- **BUKTI MERAH atas pengukurannya sendiri** — sebab tembakan yang tak bisa
  merah tak membuktikan apa-apa: pengurungan dicabut dari
  `GET /bahan/:id/langkah` (suntikan di-assert mendarat), server dijalankan
  ulang, lalu **tenant B membaca resep tenant A dengan 200**. Sapuan statisnya
  ikut menuduh berkas & barisnya (`bahan/routes.ts:1660`). Dipulihkan
- **Hasil: BERSIH** — 627 kueri, nol kebocoran, dan untuk pertama kalinya
  angkanya ada
- **Tindak**: instrumennya **pindah ke repo sebagai gerbang** —
  `test/util/kueri-terkurung.ts` (dipakai bersama) +
  `test/kueri-terkurung-tenant.test.ts` (7 uji): `DIPILAH_TANGAN` per BERKAS +
  JUMLAH (bukan nomor baris — gerbang di repo ini sudah sekali patah karena
  memaku baris yang bergeser oleh komentar), uji anti-kuburan, uji PREMIS, uji
  yang menahan daftar GLOBAL agar tak dilonggarkan diam-diam, dan empat bukti
  detektor sintetis yang masing-masing memaku satu dari empat kebutaan di atas.
  **Ini juga menutup lubang (1) vena arah TULIS**: gerbangnya menilai
  `.update`/`.delete` sekaligus. verify-api **§260** (22 asersi)
- **Batas, jujur**:
  - resolusi variabelnya **satu tingkat** di berkas yang sama; `conds` yang
    dioper sebagai PARAMETER ke fungsi lain tak ditelusuri — itu sebagian dari
    48 yang dipilah tangan;
  - kelas B percaya `branchId` sudah lahir dari `resolveBranchId`; itu
    **tidak** diverifikasi ulang oleh gerbang ini (vena "cabang ikut di URL"
    yang menjaganya);
  - bentuk ke-3 (diperiksa di JS sesudah dibaca) **lolos gerbang ini** karena
    ia memang aman hari ini — tapi ia rapuh: mencabut satu baris `if` membuka
    kebocoran tanpa WHERE-nya berubah. Gerbang ini takkan melihatnya;
  - yang ditembak sepuluh rute detail; **rute daftar** (yang membalas larik)
    tak ditembak lintas-tenant — daftarnya memang tersaring `companyId` di
    kelas A, tapi itu pembacaan, bukan tembakan
- Gerbang: typecheck bersih · `npm test` **2.317** (195 berkas) · `verify-api`
  **3.072 lolos, 0 gagal** vs Postgres SEGAR (§260 baru) · cakupan rute **272**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6**. Tak
  ada berkas Dart tersentuh → `flutter analyze`/`flutter test` tidak dijalankan

---

## 60 rute BACA terbuka, dipilah satu per satu — server — 2026-08-26

- **Kenapa**: batas yang ditulis entri "Matriks IZIN per rute" sendiri —
  *"sisanya (60 rute BACA terbuka, termasuk beberapa yang menampilkan
  HPP/margin) belum diadjudikasi satu per satu."* Vena itu menutup dua pintu
  TULIS; arah BACA belum pernah disentuh
- **Populasi**: **274** rute · **105** GET · **60** GET terbuka untuk keenam
  peran (`owner` `admin` `cashier` `tim` `kitchen` `bar`). Ke-60 dipilah
  tangan, bukan disamaratakan
- **Detektor**: penyusun matriks yang sudah ada (`izin-per-rute.test.ts`)
  dijalankan pada arah GET. **DIBUKTIKAN bisa menuduh, dua lapis, suntikan
  di-assert mendarat lebih dulu**: (1) `requireRole` dicabut dari
  `GET /supplier/:id/kartu` → DUA uji merah, keduanya menyebut jalurnya;
  (2) rute baru `GET /satuan/laba-rahasia` tanpa penjaga disisipkan → tertuduh
  dengan namanya. Keduanya dipulihkan
- **Diukur lewat HTTP dengan token peran `bar` SUNGGUHAN** (premis tokennya
  diperiksa dulu: payload JWT-nya benar-benar `role: "bar"`), DB segar, tiap
  fikstur dibuktikan terbaca lebih dulu lewat 200 milik owner:

  | rute | yang terbaca peran `bar` SEBELUM |
  |---|---|
  | `GET /menu` | `hpp` **5662,03** · `hpp_dine_in` 4732,03 · `harga_saran` 10820,01 · `food_cost_persen` 51,47 · `komponen[].harga_per_unit` 357,14 / 754,55 |
  | `GET /bahan` | `harga_beli` **35.000** · `harga_per_unit` 777,78 |
  | `GET /bahan/:id/pembelian` | `harga_terkini` 777,78 + seluruh riwayat lot |
  | `GET /supplier/:id/kartu` | `total_belanja` + riwayat belanja supplier |
  | `GET /menu/panduan-markup` | seluruh tabel kebijakan markup perusahaan |
  | `GET /penjualan/:id` | `sale.totalHpp` **5662,0314** · `items[].hppSatuan` |
  | `GET /stok` · `GET /perlengkapan/:id/kartu` | `harga_per_unit` · `total_belanja` |

- **Temuan — 7 pintu BACA yang aturannya sudah tertulis di pintu SEBELAHNYA,
  di berkas yang SAMA.** Ini bukan disimpulkan dari klien; pasangannya bisa
  ditunjuk barisnya:

  | berkas | pintu TULIS (owner/admin sejak lama) | pintu BACA (terbuka keenam peran) |
  |---|---|---|
  | `bahan/routes.ts` | `PUT /:id/supplier` :1208 | `GET /:id/supplier` :1198 — **sepuluh baris di atasnya** |
  | `bahan/routes.ts` | `POST /:id/harga` | `GET /:id/pembelian` |
  | `perlengkapan/routes.ts` | `PUT /:id/supplier` | `GET /:id/supplier` |
  | `perlengkapan/routes.ts` | `POST /:id/harga` | `GET /:id/pembelian` |
  | `perlengkapan/routes.ts` | `GET /belanja` & `GET /master` (keduanya owner/admin) | `GET /beli` |
  | `supplier/routes.ts` | `PATCH /:id` | `GET /:id/kartu` |
  | `menu/routes.ts` | — | `GET /panduan-markup` (**NOL konsumen**: kedua klien mengimpor konstanta `PANDUAN_MARKUP` dari `@kakarut/shared`, tak satu pun lewat HTTP) |

  Dua di antaranya bahkan menulis aturannya utuh di doc-comment-nya sendiri —
  *"GET terbuka semua peran (info belanja); PUT owner/admin"* — lalu memasang
  penjaganya di separuh kalimat itu saja
- **SESUDAH** (terukur, tabel penuh di §259 verify-api): ketujuhnya `bar` →
  **403**; `owner` → **200**; dan **PASANGAN**: `tim` → **200** di kedua pintu
  bahan (layar yang membacanya memang dipasang untuk tim/tim-CK, jadi menutup
  `tim` akan mematikan layar yang hari ini bekerja). Terbuka **60 → 53**
- **Tindak**: 7 `requireRole` + `TERBUKA_SENGAJA_BACA` **per RUTE** (53 entri
  bernama & beralasan, bukan per prefiks — prefiks `/stok` sendiri memuat
  delapan pintu yang artinya berbeda) + uji anti-kuburan + uji PREMIS +
  uji "pintu yang WAJIB terbuka masih terbuka" (11 rute) + §259 verify-api
  (28 asersi). `izin-per-rute.test.ts` 6 → **11** uji
- **Batas — dan ini bagian yang paling penting, ditulis apa adanya**: angka
  biaya di `GET /menu`, `GET /bahan`, `GET /stok`, `GET /penjualan/:id`, dan
  `GET /perlengkapan/:id/kartu` **TIDAK ditutup**, dan alasannya hasil
  pengukuran, bukan kehabisan waktu:
  1. **Saling terjangkau.** Menutup `hpp` di `/menu` sementara `/stok` dan
     `/bahan` tetap memberi `harga_per_unit` per bahan (dan `/bahan/:id/resep`
     memberi takarannya) hanya memindahkan pintunya. Penjaga yang bisa
     dilewati lewat pintu sebelah persis penyakit yang ledger ini obati —
     memasangnya akan menambah satu lagi, bukan mengurangi.
  2. **Ada layar TERKIRIM yang sengaja menampilkannya ke peran non-manajemen**:
     papan pesanan ponsel memunculkan SnackBar *"HPP transaksi dihitung ulang
     → Rp …"* untuk dapur/bar, dan kartu "Nilai stok" di layar Stok ponsel
     dihitung dari `harga_per_unit` **tanpa penjaga peran sama sekali**;
     `KartuPerlengkapanModal` web (memajang `total_belanja`) dibuka dari tab
     Stok → Perlengkapan yang juga tak berpenjaga peran.

  Sementara itu KEDUA klien menulis aturan sebaliknya di layar, dengan nama:
  ponsel `resep_page.dart` memakai `final lihatHarga = user?.isManajemen`,
  web `ResepPage` bahkan tak mengambil datanya (`enabled: bolehUbah`), dan
  `MenuListPage`/`AnalisisHargaPage`/`MenuHppPage` semuanya di balik
  `isManajemen`. Jadi **kebijakannya sendiri belum satu** — menyeragamkannya
  keputusan PRODUK (siapa boleh melihat biaya), bukan tambalan yang boleh
  kupasang sendiri. Seluruh pengukurannya tersimpan di CATATAN BIAYA dalam
  `izin-per-rute.test.ts` supaya keputusan itu punya angkanya saat diambil
- **Batas kedua**: resolusi statisnya tetap buta pada penjaga yang bergantung
  **tipe cabang** (`izinkanManajemenAtauKaryawanCk`, `izinkanProduksi`) dan
  pada pemeriksaan kepemilikan **di dalam handler** — sama seperti putaran
  lalu. Yang memutuskan tetap tembakan HTTP
- **Kesalahan proses yang dicatat, bukan didiamkan**: putaran verify-api
  pertama dibunuh timeout perkakas di menit ke-2, dan putaran kedua kujalankan
  di atas DB yang sudah tercemar sisanya — **42 "kegagalan"** yang tak satu pun
  nyata. Ketahuan dari `jumlah menu = 79` (seharusnya 57), bukan dari hasil
  ujinya. Diulang dari DB yang benar-benar segar. Ditambah: `JEJAK_RUTE`
  menerima **jalur berkas**, bukan `1` — sekali kuisi `1` dan jejaknya masuk
  ke berkas bernama `1`
- Gerbang: typecheck bersih · `npm test` **2.310** (194 berkas) · `verify-api`
  **3.050 lolos, 0 gagal** vs Postgres SEGAR (§259 baru) · cakupan rute **272**
  identik · `audit:invarian` 26/26 · build web · e2e Playwright **6/6**.
  Tak ada berkas Dart tersentuh → `flutter analyze`/`flutter test` tidak
  dijalankan, dan itu disebutkan

---

## Jalur tulis KEDUA dibayar: rekalkulasi HPP — server — 2026-08-24

- **Kenapa**: batas gerbang luapan-turunan — *"jalur tulis KEDUA ke kolom
  yang sama takkan terlihat"* — dengan instansi yang ditunjuk usulannya:
  `rekalkulasi.ts` menulis ulang `hpp_satuan` + `total_hpp` saat dapur
  mengubah penyajian, dan arahnya bisa **naik** (kemasan takeaway)
- **Diukur di langit-langit**: bahan 999.999.999.999 + kemasan 5.000 → jual
  dine-in **201** (HPP tepat muat) → dapur menekan 🥡:

  | | balasan |
  |---|---|
  | SEBELUM | 400 **generik** — di TOMBOL SAJIAN, tanpa petunjuk baris mana |
  | SESUDAH | 400 **`HPP satuan "Menu Langit C2" terlalu besar…`** |
  | PASANGAN flip biasa | **200** |

- **Temuan sampingan tertangkap probe-ku sendiri**: segmen jalur `jenis`
  salah (`/pesanan/sale/…`) → **500 dari ZodError mentah** —
  `JenisParam.parse()` telanjang di **lima** situs. Kelima diganti
  `jenisDariJalur()` (safeParse → **400** "Jenis pesanan pada alamat tidak
  dikenal") — murni salah alamat klien, sekelas 22P02
- **Tindak**: `pastikanMuat` di rekalkulasi (bernama-menu + totalHpp) · entri
  PUTUSAN menyebut kedua jalur · pin + bukti merah mendarat · verify-api
  **§249** (6 asersi)
- **Batas**: dua jalur tulis kini dijaga (create + rekalkulasi); penelusuran
  ekspresi menyeluruh tetap bukan bentuk gerbangnya — yang dijaga tiap jalur
  yang DITEMUKAN dan diukur
- Gerbang: typecheck bersih · `npm test` 2.209 · `verify-api` **2.961** ·
  `audit:invarian` 26/26 · cakupan 271 identik — dan **keempat kalinya** cek
  cakupan pertamaku dari cwd salah; polanya konsisten (compound command yang
  berpindah direktori), dicatat supaya penerus tak mengulanginya

---

## Pintu FIFO pada 30 rb event: 0,056 dtk — server — 2026-08-24

- **Kenapa**: satu-satunya pintu detail tanpa angka — `GET /stok/fifo/:id`
  by design membaca sampai `BATAS_EVENT_FIFO + 1` = **20.001 baris** lalu
  menghitung FIFO **di JS** per permintaan
- **Diukur** (30.000 event tersuntik pada satu bahan satu cabang — 15 rb
  pembelian + 15 rb konsumsi; **dibuktikan terbaca**: `terpotong: true` di
  balasannya): **0,056 dtk · 4.682 byte**
- **Hasil: BERSIH berangka.** Beratnya di pembacaan 20 rb baris, bukan
  serialisasi — balasannya lot TERAGREGASI, dan pemotongan 20.001-nya bekerja
  persis seperti komentarnya (`terpotong: true` saat populasi melebihi)
- **Tindak**: baris `/stok/fifo/:ingredientId` masuk blok PINTU DETAIL
  `ukur-latensi.sh` dengan angka acuannya. Tak ada kode server tersentuh
- **Batas**: diukur satu bahan-cabang; FIFO lintas ribuan bahan sekaligus
  (laporan nilai stok) adalah jalur lain yang sudah punya gerbangnya sendiri

---

## Sebelas pintu "aman lewat baca" ditembak semua — server — 2026-08-24

- **Kenapa**: batas entri A′ — *"28 situs `.update()` lain dinyatakan aman
  lewat pilahan BACA, bukan lewat tembakan"* — dan tiga pilahan baca sesi ini
  sudah terbukti salah (dua arah)
- **Ditembak lewat HTTP**: **8** pintu PATCH ganti-nama ber-`tanpaBentrok`
  (kategori · satuan · supplier · meja · penyimpanan · kategori-bahan ·
  cabang · perlengkapan) — duplikat **berurutan** → 409 berkalimat, sah → 200,
  **empat serentak** → nol 5xx; **2** pintu BUAT yang §245 lewati — bahan
  (alokator `slugUnik`: empat serentak bernama sama → **tepat satu slug
  lahir**, sisanya 409) dan perlengkapan (`{201:1, 409:3}`). `POST /undang`
  tak diulang — §213 sudah menembaknya
- **Hasil: BERSIH — kesebelasnya memegang**, dan kini terpaku **perilaku**
  (§248, 37 asersi) alih-alih prosa
- **Detektor**: DIBUKTIKAN — `tanpaBentrok` di-shadow jadi passthrough pada
  `PATCH /satuan/:id` (suntikan di-assert) → duplikat terukur **HTTP 500**;
  dikembalikan → 409
- **Batas**: cabang memakai dua entitas yang sudah ada (buat cabang terbentur
  kuota plan) — seksi sengaja di ujung skrip; "empat serentak" curl paralel
  (bentuk yang terbukti cukup di §245: tanpa penjaga → `201 500 500 500`)
- Gerbang: typecheck bersih · `npm test` 2.208 · `verify-api` **2.955**
  terhadap Postgres segar · `audit:invarian` 26/26 · cakupan 271 identik

---

## Matriks IZIN per rute — server — 2026-08-25

- **Kenapa**: pertanyaan paling dasar tentang sebuah pintu — **peran mana yang
  efektif bisa masuk, dan apakah itu disengaja** — belum pernah dijawab ledger
  ini sekali pun. Tenant, cabang, langit-langit daftar, presisi angka: sudah;
  izin: belum
- **Metode**: jawabannya tak bisa dibaca dari satu baris. Disusun dari **tiga**
  sumber — penjaga prefiks `app.ts`, `requireRole` di rantai rutenya, dan
  **ALIAS tingkat modul** (`const bolehAturMeja = requireRole(…)`) — lalu
  **ditembak** dengan token peran sungguhan
- **Populasi**: **274** rute · **15** penjaga prefiks · **101** rute terbuka
  untuk keenam peran, **41** di antaranya TULIS · **14** yang mencurigakan
  ditembak satu per satu
- **Pengukuran membantah pembacaan statis DUA ARAH** (token peran `bar`):

  | | hasil |
  |---|---|
  | `POST`/`PATCH`/`PUT`/`DELETE /meja` | **403** — dijaga alias `bolehAturMeja`; pemindai versi pertamaku menuduhnya **palsu** |
  | `POST /penyimpanan` | **201**, dan barisnya **ADA** di `storage_locations` |
  | `POST /supplier` | **201**, dan barisnya **ADA** di `suppliers` |

- **Temuan**, dan bentuknya tanda tangan repo ini: di KEDUA modul, **mengubah**
  master data sudah `requireRole("owner","admin")` (`PATCH /:id`,
  `PUT /:id/petugas`), sementara **membuatnya** terbuka untuk keenam peran.
  Aturannya sudah ditulis di pintu sebelah
- **PENGETATAN PERTAMAKU TERLALU JAUH, dan gerbang lama yang menahannya**:
  §191 verify-api sudah memaku kontraknya **berpasangan** — *"kasir →
  `POST /penyimpanan` cabang SENDIRI tetap boleh"* & *"cabang lain = 403"*.
  Menutupnya ke owner/admin saja mematahkan asersi itu. Himpunan akhirnya
  mencerminkan `bolehAturMeja` (peran yang mengatur lantai) sambil tetap
  menutup `tim`/`kitchen`/`bar`; `/supplier` tetap owner/admin sebab tak ada
  kontrak yang menyatakan sebaliknya. **Inilah gunanya pasangan**: ia menahan
  perbaikan yang berlebihan, bukan cuma perbaikan yang kurang
- **SESUDAH**: `bar` → **403** di keduanya · `owner` tetap **201** · kasir
  tetap bisa membuat penyimpanan di cabangnya sendiri
- **Dua cacat pemindaiku sendiri, ketahuan lewat ANGKANYA**:
  · `[^)]*` berhenti di `)` pertama → **3 dari 15** penjaga terbaca, dan
    `/laporan/*` tercatat "terbuka untuk keenam peran";
  · alias tingkat modul tak terlihat → **4** pintu meja tertuduh palsu.
  Keduanya diperbaiki dan **dipaku uji PREMIS** supaya kebutaannya tak bisa
  kembali diam-diam
- **Satu rumah**: `semuaRute()` **dipindah** (bukan disalin) ke
  `test/util/rute.ts`, pola yang sama dengan `test/util/kolom-numerik.ts`,
  begitu gerbang kedua membutuhkannya
- **Ratchet**: `izin-per-rute.test.ts` — pintu TULIS baru yang terbuka untuk
  keenam peran menagih keputusan. Uji **anti-kuburan** langsung berguna: ia
  menolak entri `/meja` yang sudah tak berlaku
- **Bukti merah**: penjaga `POST /supplier` dicabut (suntikan di-assert
  mendarat) → **dua** uji merah menyebut rutenya; dipulihkan
- **Batas, jujur**: resolusi statis tak melihat penjaga **di dalam handler**
  (mis. `terikatCabang` + perbandingan `branch_id`) maupun penjaga yang
  bergantung **tipe cabang** (`izinkanManajemenAtauKaryawanCk` hanya
  meloloskan `tim` bila cabangnya central kitchen). Karena itu tiap tuduhan
  **ditembak** sebelum disebut temuan — dan justru tembakan itu yang
  membebaskan empat pintu meja
- **Cacat lingkungan yang sempat menyesatkan, dicatat supaya tak terulang**:
  proses server lama (jam 07:01) masih memegang port 3000 sementara
  `npm start` yang baru mati diam-diam, jadi satu putaran verify-api menguji
  **kode lama**. Ketahuan dari `ps` — bukan dari hasil ujinya
- Gerbang: typecheck bersih · `npm test` **2.305** (194 berkas) · `verify-api`
  **3.022 lolos, 0 gagal** vs Postgres SEGAR (§258 baru) · cakupan rute **272**
  identik · `audit:invarian` 26/26 · build web · e2e **6/6**
- Commit: `e95cbb4`

---

## Satu hop: perantara ber-ekspresi — server — 2026-08-25 — **BERSIH**

- **Kenapa**: batas yang ditulis vena di bawah ini — *"ia melihat pemanggilan
  LANGSUNG; nilai yang mampir ke variabel perantara lalu diteruskan ke pengadil
  masih di luar jangkauannya"*
- **Cacat pemindai pertamaku, dan ia ketahuan sebelum dikirim**: versi pertama
  menuduh **18** situs — **9 PALSU**, sebab ia mencocokkan nama identifier
  lintas SELURUH berkas (variabel bernama sama di fungsi lain ikut tertuduh).
  Dibatasi `JARAK_MAKS = 40` baris sebagai pendekatan atas "lingkup yang sama";
  batasnya **ditulis dan dipaku uji**, bukan disamarkan. Tersisa **9** situs
- **DUA tuduhan DICABUT OLEH PENGUKURAN, bukan oleh argumen**: `tarifPb1Struk`
  (`hpp.ts`) dan bon open-bill mengoper `subtotal − diskon` ke `hitungPb1`.
  Dugaannya: derau bisa mengubah `Math.round` di batas 0,5. Diukur atas
  **~1,8 juta** pasangan (subtotal, diskon, tarif) berskala-2 → **0 pasangan**
  berbeda hasil pembulatannya. Deraunya ≈**1e-13**, sementara jaraknya ke batas
  pembulatan **0,5**. Aman — dan kini bisa ditunjuk angkanya
- **Sisanya**: penjaga **langit-langit** (`pastikanMuat` — menilai muat/tidak,
  bukan kesetaraan) dan harga turunan yang dipakai sebagai **nilai**, bukan
  putusan. Semuanya masuk `DIKECUALIKAN_HOP` dengan alasannya
- **Yang ikut ketemu dan DIBAYAR**: `EPS_QTY = 1e-6` di
  `packages/shared/src/ketersediaan.ts` — konstanta **telanjang** tanpa satu
  kalimat tentang asalnya, kelas yang sudah **tiga kali** jadi bug di repo ini.
  Ia terlewat sapuan B⁷ karena tinggal di `shared` dan bernama lain. Asalnya
  kini tertulis, diukur:

  | | hasil |
  |---|---|
  | `\|1e-6\| < EPS_QTY` | **false** — selisih SATU unit kolom tak tertelan (`<` strik) |
  | `\|5e-7\| < EPS_QTY` | true — derau setengah unit tertelan |
  | ULP(`kemasan`) | 5,7e-14 (qty 10³) · 3,7e-9 (10⁸) · 1,2e-7 (10⁹) |
  | qty **10¹⁰** | ULP **1,91e-6 > EPS_QTY** ← di sini ia berhenti berarti |

  Batasnya ditulis apa adanya: di ≳10¹⁰ float8 tak sanggup membawa skala
  kolomnya, dan jawabannya berhenti memakai float8 — bukan mengecilkan
  toleransi ini
- **Bukti merah**: alasan `EPS_QTY` dihapus (suntikan di-assert mendarat) →
  merah; dipulihkan. Detektor satu-hop dibuktikan tiga arah: perantara
  ber-ekspresi **tertuduh**, identifier polos **tidak**, dan yang berjarak
  > `JARAK_MAKS` **tidak**
- **Batas, jujur**: `JARAK_MAKS` adalah pendekatan atas lingkup, bukan lingkup
  sungguhan; dan pemindainya berhenti di **satu** lompatan — dua lompatan
  (a → b → pengadil) masih di luar jangkauan
- Gerbang: typecheck bersih · `npm test` **2.298** (193 berkas). Perubahan di
  `ketersediaan.ts` **komentar saja** → `verify-api` tidak dijalankan ulang,
  dan itu disebut
- Commit: `2791db5`

---

## Yang diadili DI DALAM fungsi lain — server — 2026-08-25 — **BERSIH**

- **Kenapa**: batas yang ditulis vena di bawah ini tentang dirinya sendiri —
  *"sapuannya melihat perbandingan di SATU BARIS; nilai yang dioper ke fungsi
  lain lalu dibandingkan di dalam fungsi itu tak terlihat"*
- **Metode**: pemindai **dua tahap**, sebab pertanyaannya memang dua — (1)
  fungsi mana yang **mengadili** parameter numeriknya (`< > <= >= === !==`,
  `Math.max/min/round` atas parameter itu), lalu (2) siapa yang mengoper
  **EKSPRESI aritmetika** ke fungsi seperti itu, bukan identifier polos yang
  nilainya sudah berskala di tempat lahirnya
- **Populasi**: **104** fungsi pengadil di `apps/server/src` +
  `packages/shared/src`; **4** situs mengoper ekspresi
- **Hasil: BERSIH.** Keempatnya dipilah tangan dan aman, masing-masing dengan
  alasan yang bisa diperiksa:

  | situs | kenapa aman |
  |---|---|
  | `index.ts` ×2 — `jadwalkanSapuUnggahan`/`jadwalkanPangkasToken` | jam bulat, `(BACKUP_HOUR + n) % 24`; aritmetika integer tak berderau |
  | `scripts/acuan-uang-mobile.ts` — `hitungPb1(sub - dis, rate)` | pembangkit **fikstur**, dan seluruh `sub`/`dis`-nya bilangan bulat (1.000 · 12.345 · 99.999 · 333.333 × 0 · 1 · 500 · 1.234) → selisihnya eksak |
  | `receipt.ts` — `formatRupiahAscii(Math.max(0, uangDiterima - total))` | `uangDiterima` sudah `Math.round` (rupiah bulat) & `total` sudah berskala kolom sejak vena sebelumnya; hasilnya diformat — deraunya tak pernah sampai ke kertas |

- **Yang dikirim: ratchet-nya**, bukan laporannya —
  `apps/server/test/diadili-lintas-fungsi.test.ts` berdiri sebagai gerbang,
  jadi situs **kelima** yang lahir nanti menagih keputusan alih-alih lewat
  diam-diam. `keSkalaKolom`/`toleransiBanding` sengaja **tidak** dihitung
  sebagai pengadil: keduanya obatnya, bukan penyakitnya
- **Sekalian terukur & dipaku**: aturan **KEMBALIAN punya SATU rumah** di
  seluruh repo (`receipt.ts`). `hitungKembalian` yang pernah diusulkan **tak
  pernah ada** — dan tak perlu ada, sebab tak ada salinan kedua yang bisa
  menyimpang; ponsel mengoper `uangDiterima` ke pembangun struk bersama
  (`receipt_page.dart:128`), bukan menghitung sendiri
- **Detektor DIBUKTIKAN bisa menuduh, dua lapis**:
  · sintetis — ekspresi tertuduh; identifier polos **tidak**; argumen yang
    sudah dibungkus `keSkalaKolom` **tidak**; fungsi yang tak mengadili tak
    masuk populasi;
  · **pohon sungguhan** — `hitungPb1(subtotalNet, …)` dibuka jadi
    `hitungPb1(subtotal - diskon, …)` (suntikan di-assert mendarat) → merah
    menyebut `modules/penjualan/service.ts:523`; dipulihkan
- **Uji PREMIS** menahan hijau-palsu: berkas > 100, pengadil > 50, situs > 0 —
  nol berarti pemindainya rusak, bukan repo yang bersih (sudah pernah terjadi:
  sapuan larik dikirim dengan regex yang hanya melihat 18 dari 39)
- **Batas, jujur**: ia melihat pemanggilan **LANGSUNG**; nilai yang mampir ke
  variabel perantara lalu diteruskan ke pengadil masih di luar jangkauannya —
  itu bahan bakar putaran berikutnya, bukan janji yang dibuat di sini
- Gerbang: typecheck bersih · `npm test` **2.293** (193 berkas). **Tak ada kode
  produk yang berubah → `verify-api` tidak dijalankan ulang**, dan itu disebut
- Commit: `0841292`

---

## Angka yang disusun di JS lalu MENGADILI — server — 2026-08-25

- **Kenapa**: pelajaran vena di bawah ini dirumuskan jadi aturan sapuan —
  angka JS yang cuma **disimpan** atau **ditampilkan** aman (kolomnya
  membulatkan saat menulis, `formatRupiah` saat mencetak); yang berbahaya
  angka JS yang **MENGADILI**
- **Populasi**: **132** berkas (`apps/server/src` + `packages/shared/src`);
  identifier yang lahir dari komposisi/akumulasi lalu muncul di
  `< > <= >= === !==` → **36 tertuduh**, dipilah tangan
- **DIBAYAR (2)**:
  1. `penjualan/rekalkulasi.ts` — `if (totalHpp !== sale.totalHpp)` mengadu
     angka JS **mentah** dengan angka yang dibaca dari `numeric(16,4)`. Tanpa
     skala, jawabannya "berbeda" untuk derau digit ke-17, dan baris
     penjualannya ditulis ulang tanpa ada yang berubah
  2. `penjualan/refund.ts` — `if (it.qty > sisa + 1e-9)`: **situs terakhir**
     dari kelas angka firasat yang B⁷ bayar, dan ia terlewat DUA KALI karena
     ditulis inline, bukan sebagai konstanta bernama. `BATAS_QTY_BARIS` =
     99.999.999 menaruh besaran ≥ 10⁷ di dalam rentang yang skema izinkan, dan
     di sana `1e-9` lebih kecil daripada derau float itu sendiri — "kembalikan
     sisa yang PERSIS tersisa" bisa ditolak. Diganti
     `toleransiBanding(sisa, SKALA_QTY_BARIS_KOLOM)`
- **DICABUT (1), dengan pengukurannya**: `perlengkapan/routes.ts`
  `if (selisih === 0) continue` pada `POST /perlengkapan/stok-awal` **tidak
  bermasalah**. Terukur lewat HTTP: mengirim qty yang sama dua kali tak menulis
  mutasi apa pun (jumlah mutasi 1 → 1, lalu 2 → 2), sebab kedua operannya
  desimal yang sama pada skala yang sama (`rak` sudah `keSkalaKolom` sejak A⁷).
  Dicatat, bukan dipaksa jadi temuan
- **Bukti merah**: toleransi firasat dikembalikan ke `1e-9` (suntikan
  di-assert mendarat) → pin merah; dipulihkan
- **Pasangan anti-hijau-palsu**: refund **BERLEBIH** sebesar satu unit kolom
  (0,01) tetap ditolak pada empat besaran termasuk 10⁷ — toleransi yang
  kelonggaran berarti uang keluar untuk porsi yang tak pernah ada
- **Batas, jujur**: sapuannya melihat perbandingan di **satu baris** dan
  menilai **nama** identifiernya; nilai yang dioper ke fungsi lain lalu
  dibandingkan di sana tak terlihat. Sisa 33 tertuduh dipilah sebagai
  perbandingan terhadap **nol/konstanta** pada nilai yang sudah berskala, atau
  perbandingan tampilan
- Gerbang: typecheck bersih · `npm test` **2.287** (192 berkas) ·
  `verify-api` **3.016 lolos, 0 gagal** vs Postgres SEGAR · cakupan rute
  **272** identik · `audit:invarian` 26/26 · build web · e2e **6/6**
- Commit: `13ac267`

---

## Uang yang DIADILI ≠ uang yang dicetak — server — 2026-08-25

- **Kenapa**: kelas **UANG belum pernah disapu sekali pun**. Dua detektor
  terakhir memisahkannya dari kelas qty dan **sengaja melewatinya**; kalimat
  itu tertulis di dua entri di bawah ini
- **Populasi**: sapuan mekanis atas **265** berkas (`apps/server/src` +
  `packages/shared/src` + `apps/web/src`) — uang yang ditumpuk/disusun di JS →
  **38 tertuduh**, dipilah tangan
- **Keterjangkauan diukur di skema, bukan dikira**: `qty` baris penjualan
  `z.number().positive()` — **tanpa `.int()`**, jadi 0,5 porsi sah; dan
  `menus.harga_jual` `numeric(12,2)` boleh berdesimal
- **TUDUHAN YANG DICABUT, dengan angkanya**: "yang dicetak beda dengan yang
  tersimpan" **tak tereproduksi**. Menu Rp 1000,33 × qty 0,5 → balasan rute
  `subtotal 500.17`, DB `500.17` — sama persis. Sebabnya struktural dan layak
  ditulis: tiap angka uang mendarat di kolom `numeric(…,2|4)` yang **Postgres
  bulatkan saat menulis**, dan balasan `createSale` dibaca ulang lewat
  `.returning()`. Selama angka JS-nya cuma DISIMPAN, ia tak pernah bertengkar
- **Yang bertengkar: angka JS yang MENGADILI sesuatu sebelum ditulis.**
  Terukur lewat HTTP (menu Rp 0,01 × qty 0,4):

  | | SEBELUM | SESUDAH |
  |---|---|---|
  | nota tersimpan & dibalas rute | `subtotal 0`, `total 0` | sama |
  | bayar tunai **Rp 0** untuk nota **Rp 0** | **400** "Uang diterima kurang dari total belanja" | **201** |
  | PASANGAN: kurang bayar 11.999 atas 12.000 | 400 | **tetap 400** |

  Gerbang kasnya mengadili `total = 0.004` — angka yang **tak pernah bisa
  dilihat siapa pun**, sebab yang tercetak dan tersimpan Rp 0,00. Kelas yang
  sama dengan "stok yang PERSIS cukup ditolak", dipindahkan ke jalur uang
- **Fix**: `SKALA_UANG_KOLOM = 2` & `SKALA_HPP_KOLOM = 4` di `@kakarut/shared`
  (tetangga `SKALA_QTY_STOK_KOLOM` yang lahir putaran lalu), dan `lineTotal` ·
  `subtotal` · `subtotalNet` · `total` · `totalHpp` dikembalikan ke skala
  kolomnya **di tiap langkah**. `EPS_KAS` **tidak** disentuh — kelasnya sendiri
  dan sudah benar; dipaku uji pasangan
- **Bukti merah**: pembulatan `total` dicabut (suntikan di-assert mendarat) →
  pin merah menyebut barisnya; dipulihkan
- **Pasangan anti-hijau-palsu**: selisih **satu unit kolom (Rp 0,01)** tetap
  terlihat; bayar PAS diterima; kurang bayar tetap ditolak — ketiganya juga
  lewat HTTP di §257
- **Gerbang lama ikut menuduh, dan ia benar**: `verify-api-token` menolak
  cadangan `${REISS105:-$KASIR}` yang sempat kutulis di §257 — token `$KASIR`
  memang mati sesudah §105 dipakai me-reset passwordnya. Diperbaiki ke
  `$REISS105` tanpa cadangan, supaya kegagalan re-issue berbunyi alih-alih
  diam. (Kelima kalinya di sesi ini gerbang lama membetulkanku)
- **Batas, jujur**: yang dinilai jalur `createSale`. Situs uang lain yang
  tertuduh dan **dibiarkan beralasan**: agregat yang hanya TAMPIL
  (`rekomendasi` ×5, `perlengkapan.totalBelanja`, `bep.ts`) — tak mengadili apa
  pun dan diformat `formatRupiah`; `harga-stats` sudah ber-`bulat2`;
  `contoh-cetak.ts` fikstur pratinjau. Detektornya juga menilai **nama** untuk
  memisahkan kelas uang dari qty
- Gerbang: typecheck bersih · `npm test` **2.282** (192 berkas) · `verify-api`
  **3.016 lolos, 0 gagal** vs Postgres SEGAR (§257 baru) · cakupan rute **272**
  identik · `audit:invarian` 26/26 · build web · Playwright e2e **6/6**
- Commit: `3d96540`

---

## FIFO: angka firasat terakhir, dan bukti merah yang gagal mendarat — server — 2026-08-25

- **Kenapa**: utang terukur yang ditulis entri di bawah ini — *"`lib/fifo.ts`
  masih memakai `EPS = 1e-9`, angka firasat yang B⁷ ukur BERHENTI BERARTI pada
  besaran ≥ 10⁷; keterjangkauannya belum diukur"*. Situs `1e-9` **terakhir**,
  dan satu-satunya yang bahkan tak menulis asalnya
- **Populasi**: **14** pemakaian `EPS` di `fifo.ts` (223 baris). `jalankanFifo`
  **fungsi murni** dengan **satu** pemanggil (`stok/service.ts:821` →
  `GET /stok/fifo/:id`), jadi instrumennya deterministik penuh; harness ujinya
  sudah ada (`test/fifo.test.ts`, 18 uji) dan dipakai ulang
- **Diukur atas fungsinya** (dua lot pecahan sebesar N, lalu keluar seluruhnya):

  | N | sisa lot | saldo | defisit | hpp |
  |---|---|---|---|---|
  | 10³ · 10⁶ | 0 | 0 | 0 | terisi |
  | **10⁷** | **1,86e-9** | 1,86e-9 | 0 | terisi |
  | **10⁸** | 0 | **−1,49e-8** | **1,49e-8** | **NULL** |
  | **10⁹** | 0 | −1,19e-7 | 1,19e-7 | **NULL** |

- **Keterjangkauan DIUKUR lewat HTTP** (Aturan 6 — dua faktur beli qty
  100.000.000,1 & 100.000.000,2 **diterima pintu sungguhan**, dan kedua lot
  dibuktikan terbaca di kartu sebelum angkanya dipercaya), sesudah dihabiskan
  lewat opname ke 0:

  | `GET /stok/fifo/:id` | SEBELUM | SESUDAH |
  |---|---|---|
  | `saldo` | **−1.4901161193847656E-8** | `0` |
  | `defisit` | **1.4901161193847656E-8** | `0` |
  | `pemakaian[0].hpp` | **NULL** ("tidak diketahui") | terisi |
  | `rincian` | **3 baris** (satu hantu ber-`lot: null`) | 2 baris |

  Kartu FIFO melaporkan **stok minus** dan menolak menyebut HPP untuk pemakaian
  yang aritmetikanya eksak — kelas B⁷ ("stok yang PERSIS cukup ditolak"),
  dipindahkan ke jalur biaya
- **PENGUKURAN MERALAT LANGKAH PERTAMAKU, dan itu bagian dari hasilnya**: bukti
  merah versi pertama **TIDAK MENDARAT** — mengembalikan `EPS` ke `1e-9`
  membuat seluruh uji tetap hijau, sebab pembulatan ke skala kolom sudah
  menghapus gejalanya pada 10⁷–10⁹. Klaim "toleransinya yang memperbaiki"
  karena itu **belum terbukti dan tak ditulis**. Yang memisahkan keduanya
  besaran di PUNCAK rentang: pada ≈4,9e9 lantai derau float melewati satu unit
  kolom, jadi sisa hasil pembulatan mendarat tepat di `0,000001` — bukan nol —
  dan `1e-9` tak sanggup menyentuhnya:

  | | sisa lot | saldo |
  |---|---|---|
  | `1e-9` | **0.000001** (abadi) | 0.000001 |
  | `toleransiBanding` | 0 | 0 |

  Kedua paruh perbaikan membayar **band yang berbeda**: pembulatan per langkah
  untuk 10⁷–10⁹, toleransi sadar-besaran untuk puncaknya
- **Fix**: `toleransiBanding(besaranMaks, SKALA_QTY_STOK_KOLOM)` — lantai
  deraunya ditentukan angka **TERBESAR yang dilewati walk**, bukan sisa yang
  sedang diperiksa (sisa itu kecil; derau yang melahirkannya berasal dari
  besaran operannya) — plus `keSkalaKolom` di tiap langkah konsumsi, defisit,
  dan saldo. Asal angkanya **ditulis di tempat `EPS` dulu berdiri**, justru itu
  yang tak dimilikinya
- **Bukti merah (versi kedua, mendarat)**: `EPS` dikembalikan ke `1e-9` →
  uji puncak rentang merah: `expected [ +0, 0.000001 ] to deeply equal
  [ +0, +0 ]`; dipulihkan
- **Pasangan anti-hijau-palsu**: **18 uji FIFO lama tetap hijau** (perilaku
  besaran biasa tak bergeser sedikit pun — pasangan terkuat); sisa NYATA
  sebesar satu unit kolom (1e-6) tak ikut disnap; defisit NYATA tetap tercatat
  sebagai stok minus; besaran tinggi yang memang bersisa tetap punya sisanya
- **Tuduhan yang DICABUT**: "lot hantu tanpa harga membuat `rataBergerak`
  memulangkan null" — tak tereproduksi di skenario mana pun yang kucoba (lot
  hantunya tersnap lebih dulu). Dicatat, bukan dipaksa jadi temuan
- **Batas, jujur**: pada besaran ≳10¹⁰ lantai derau (2,3e-6) melewati satu unit
  kolom, jadi sisa sebesar satu unit di sana ikut dianggap nol — di besaran itu
  float8 memang tak sanggup membawa skala kolomnya, dan jawabannya berhenti
  memakai float8, bukan mengecilkan toleransi. Yang diperbaiki juga jalur
  **tampilan** kartu FIFO; HPP yang TERSIMPAN di penjualan dihitung jalur lain
  dan tak tersentuh putaran ini
- Gerbang: typecheck bersih · `npm test` **2.278** (192 berkas) · `verify-api`
  **3.012 lolos, 0 gagal** vs Postgres SEGAR · cakupan rute **272** identik ·
  `audit:invarian` 26/26 · build web · Playwright e2e **6/6**
- Commit: `e55d69e`

---

## Saldo stok disusun di JS: badge "habis" berhenti berbohong — server — 2026-08-25

- **Kenapa**: batas yang ditulis vena A⁷ tentang dirinya sendiri —
  *"`saldoStok()` menyusun saldo di JS juga, tapi gejalanya tak
  tereproduksi"*. Putaran ini mereproduksinya
- **Populasi**: sapuan mekanis atas **131** berkas (`apps/server/src` +
  `packages/shared/src`) — nilai ber-asal-`Number(row.*)` yang **dikombinasikan**
  (`±`, `±=`) dengan nilai ber-asal-SQL lain, plus pembantu bersama yang
  MEMULANGKAN komposisi parameternya. **29 tertuduh di 6 berkas**;
  dipilah tangan → **19 masuk kelas ini, 10 dikecualikan beralasan**
- **Yang DIKECUALIKAN, dan sebabnya** (menuduh kode benar = cara tercepat
  membuat gerbangnya diabaikan):
  · `lib/fifo.ts` (7) — tiap pembandingnya sudah ber-`EPS` dan lot yang habis
    **disnap ke 0 secara eksplisit**; rancangan lain, sudah berpenjaga
  · `harga-stats.ts` `sumQty` (1) — pembagi rata-rata harga, hasilnya rupiah
    ber-`bulat2`; kelas UANG
  · `produksi/konsumsi.ts` `cur.butuh` (1) — kelas KEBUTUHAN yang B⁷ sengaja
    beri `toleransiBanding`; menyeragamkannya akan merusak yang sudah benar
  · sisanya penghitung (`+= 1`) dan penyusun teks
- **Diukur lewat HTTP** (Aturan 6 — suntikannya dibuktikan terbaca lebih dulu:
  `stok_awal=0.1`, `produksi=0.2`, `rencana=0.1`, `dikerjakan=0.2` muncul di
  balasan rutenya):

  | | SEBELUM | SESUDAH |
  |---|---|---|
  | `GET /stok` → `saldo` | **0.30000000000000004** | 0.3 |
  | `GET /stok` → `pembelian_berjalan.qty` | **0.30000000000000004** | 0.3 |
  | `GET /stok/kartu/:id` → `saldo_akhir` | **0.30000000000000004** | 0.3 |

- **Kerusakan yang lebih dalam daripada angka jelek**, dan bukti merahnya yang
  menunjukkannya: `statusStok(0,1 · 0,2 · 0,3)` — bahan yang saldonya
  BENAR-BENAR nol — memulangkan **`"menipis"`**, bukan `"habis"`, karena
  `0.1 + 0.2 - 0.3 = 5,551e-17 > 0`. Badge "habis" karena itu tak pernah
  muncul untuk bahan yang habis lewat kombinasi baseline+masuk+keluar, dan
  `saldo === 0` yang menyembunyikan baris satuan setara ikut gagal
- **Fix**: pembulatan dipindahkan ke RUMAH ATURANNYA — `keSkalaKolom` +
  `SKALA_QTY_STOK_KOLOM` kini tinggal di `@kakarut/shared` (`skala.ts`), dan
  **`saldoStok` sendiri yang membulatkan**, jadi `statusStok` dan tiap
  pemanggil mewarisinya tanpa aturan kedua yang bisa menyimpang.
  `lib/batas-angka.ts` mengekspor ulang keduanya → pemanggil server tak
  berubah dan pin lama tetap hijau. Situs sekelas ikut dibayar: gabungan
  `terpakai + kirim_keluar`, dua `qtyBerjalan`, saldo awal kartu, **saldo
  berjalan kartu (dibulatkan TIAP LANGKAH — driftnya tumbuh dengan N)**,
  kartu perlengkapan, `sisa` pemakaian otomatis perlengkapan (tanpa ini ia
  mendarat di 1e-17 dan menyisipkan mutasi hantu keesokan harinya), dan
  balasan `POST /perlengkapan/:id/pakai` yang mengirim 0.19999999999999998 ke
  layar yang baru menekannya
- **Sisi klien diperiksa, bukan diandaikan**: `apps/web` tak memakai
  `saldoStok`/`statusStok` sama sekali, dan ponsel hanya mengurai `saldo`
  kiriman server (`stok_models.dart`) — tak ada salinan aturan, jadi tak ada
  kerja klien. Itu keputusan terukur, bukan kelalaian
- **Gerbang lama yang MEMATOK NOMOR BARIS ikut ketemu**: `pb1-satu-rumus`
  merah karena komentar pengukuran menggeser `hitungPb1` dari baris 103 ke
  122 — gerbang merah yang tak menyatakan apa pun tentang PB1. Diperbarui ke
  NIATNYA (satu situs, dan situs itu di dalam badan `hitungPb1`) lalu
  dibuktikan **masih bisa menuduh**: salinan rumus kedua disuntikkan ke
  `KasirPage` → merah menyebut berkasnya. Ini kelas keempat kalinya di sesi
  ini gerbang lama memaku ejaan alih-alih niat
- **Bukti merah**: pembulatan di `saldoStok` dicabut (suntikan di-assert
  mendarat) → 3 uji merah, termasuk `expected 'menipis' to be 'habis'` dan
  `expected 0.0000010000000000287557 to be 0.000001`; dipulihkan
- **Pasangan anti-hijau-palsu**: kekurangan/kelebihan **satu unit kolom
  (1e-6)** tetap terlihat (uji + §256 lewat HTTP: saldo 0,000001 tak ditelan
  jadi nol); stok yang memang aman tak berubah jadi habis; nilai yang memang
  muat di kolomnya tak tersentuh
- **Batas, jujur**: detektornya menilai **nama** (`qty|saldo|sisa|stok|
  terpakai|masuk|keluar`) untuk memisahkan kelas qty dari kelas uang — kolom
  qty yang dinamai lain takkan terlihat; ia juga hanya melihat komposisi di
  SATU baris, jadi komposisi yang dipecah ke beberapa pernyataan lolos.
  `lib/fifo.ts` masih memakai `EPS = 1e-9` — angka firasat yang B⁷ ukur
  BERHENTI BERARTI pada besaran ≥ 10⁷; ia dicatat sebagai utang terukur, bukan
  digarap di putaran ini (keterjangkauannya belum diukur)
- Gerbang: typecheck bersih · `npm test` **2.270** (192 berkas) ·
  `verify-api` **3.012 lolos, 0 gagal** vs Postgres SEGAR (§256 baru) ·
  cakupan rute **272** identik dengan rekaman · `audit:invarian` 26/26 ·
  build web · Playwright e2e **6/6**
- Commit: `1cdf132`

---

## Alamat printer tak sah sampai ke soket — mobile — 2026-08-25 (video lapangan)

- **Kenapa**: batas yang ditulis entri di bawah ini sendiri — *"validasi format
  alamat tetap tak ada — diketik salah tetap tersimpan dan baru ketahuan saat
  cetak gagal"* — lalu **video lapangan** menunjukkan bentuk persisnya: kotak
  "IP printer" TERISI di layar, sementara pesannya berbunyi
  `Gagal mencetak: Dapur (SocketException: Failed host lookup: '' (OS Error: No
  address associated with hostname, errno = 7))`. Host yang dipakai mencetak
  **string kosong** — yang dikirim bukan yang terlihat
- **Dua cacat dipisahkan, dan hanya satu ini kerja baru**:
  1. build terpasang `1.0.0+10` belum memuat `e072e4c` (IP hilang saat layar
     ditutup). Yang kurang **rilis**, bukan kode — disebut, tidak diklaim beres
  2. alamat kosong/salah ketik berjalan lurus ke `Socket.connect('')`, dan itu
     **tetap hidup walau (1) tayang**
- **Populasi**: aturannya SUDAH ada — `PrinterState._punyaAlamat`
  (`printer_controller.dart:63`) — dipasang di **2** gerbang tampilan
  (`siapCetakStruk`/`siapCetakTiket`, dibaca `receipt_page.dart:67,150` &
  `bayar_sheet.dart:185`) dan **0** dari **5** pintu tempat byte keluar
  (`_kirim` → `LanTransport`, dipakai `cetakTes` · `cetakTiket` ·
  `cetakTiketKe` · `cetakStruk` · `cetakBon`). Gerbangnya pun `.any(...)`:
  SATU printer beralamat sah membuat perintah cetak berjalan ke seluruh
  printer, termasuk yang alamatnya kosong
- **Diukur — dan pengukurannya mengubah bentuk perbaikannya**
  (`InternetAddress.lookup`, mesin uji Linux):

  | teks | hari ini |
  |---|---|
  | `''` | `Failed host lookup: ''` (13 ms) ← persis video |
  | `192.168.1` | **LOOKUP BERHASIL → 192.168.0.1** (2 ms) |
  | `192.168.1.500` | `Failed host lookup` |
  | `192.168.1.5:9100` · `http://192.168.1.5` | `Failed host lookup` |
  | `192.168.1.50` · `printer.local` | format sah |

  Baris kedua itu kerusakan yang paling sunyi: satu oktet yang kurang bukan
  membuat cetak gagal, melainkan mengirimnya ke perangkat LAIN di jaringan.
  Terukur lewat pintu cetak sungguhan (penjaga dicabut): bukan galat cepat,
  melainkan **`Connection timed out … errno = 110` sesudah 6 detik** ke host
  yang salah
- **Sebelum → sesudah** (`cetakTes` atas printer LAN bernama "Dapur"):
  `Gagal mencetak: Dapur (SocketException: Failed host lookup: '' …)` →
  `Gagal mencetak: Dapur (IP printer belum diisi)` — seketika, soket tak
  disentuh; `192.168.1` → ditolak bernama, tak pernah sampai ke 192.168.0.1
- **Fix**: `alasanHostLanTakSah()` + `PrinterSettings.alasanAlamatTakSah`
  (satu rumah, dipakai gerbang tampilan DAN `_kirim`); penjaga dipasang di
  `_kirim` — pintu tempat byte keluar — supaya pemanggil BARU ikut terjaga;
  `errorText` merah di kotak IP; "Cetak Tes" menyiram ketikan lebih dulu
  (dulu ia mencetak alamat LAMA — bentuk yang terlihat di video); daftar
  printer menandai alamat tak sah tanpa membuka editor
- **Keputusan yang ditulis, bukan didiamkan**: teks tak sah **tetap
  tersimpan**. Menolak menyimpannya akan menghidupkan lagi persis bug yang
  baru dibayar (ketikan hilang) — penandanya memberi tahu, bukan menahan.
  Dan penandanya **ditahan selama ketikan belum tersimpan**: merah yang
  berkedip di tiap ketukan cepat diabaikan orang
- **Cacat pada perbaikanku sendiri, ditangkap gerbang lama**: versi pertama
  memakai bendera yang dinolkan di `_siramLan` — dan `_siramLan` juga
  berjalan dari `deactivate`, jadi `setState` melempar saat pohon widget
  dibongkar (`printer_ip_tersimpan_test` merah). Diganti: penandanya
  diturunkan dari `_lanTersimpan` yang SUDAH ada
- **Kebocoran kecil yang ikut ketemu lewat instrumen**: `Timer` penyambungan
  awal di `build()` tak pernah dibatalkan saat provider dilepas — terukur
  sebagai galat plugin yang muncul di uji BERIKUTNYA, bukan di uji yang
  membuatnya. Timer koneksi per printer sudah dibatalkan sejak dulu; yang
  satu ini terlewat — tanda tangan yang sama, skala mikro
- **Bukti merah**: penjaga di `_kirim` dicabut (suntikan di-assert mendarat)
  → dua uji merah dengan **persis kalimat video** (`Failed host lookup: ''`)
  dan `Connection timed out, host: 192.168.1`; dipulihkan
- **Pasangan anti-hijau-palsu**: soket TCP sungguhan di `127.0.0.1` — cetak
  tetap sampai & byte diterima; printer Bluetooth berperangkat tak tertolak
  penjaga alamat; `printer.local`/`kasir`/`10.0.0.7` tetap sah
- **Batas, jujur**: pemeriksaan ini menangkap salah ketik yang **berbentuk**,
  bukan alamat yang bentuknya benar tapi tak ada di jaringan — `192.168.1.51`
  saat printernya di `.50` tetap lolos, dan yang menangkapnya cuma mencetak.
  Nama host sengaja diterima apa adanya (memaksa empat oktet akan mematikan
  pemasangan yang hari ini bekerja). Sisi web tak punya soket → tak disentuh
- Gerbang: `flutter analyze` bersih · `flutter test` **551** (3.44.7) ·
  server/web tak tersentuh → verify-api tak dijalankan (disebut)
- Commit: mobile `aec2962`

---

## IP printer hilang / gagal simpan diam — mobile — 2026-08-25 (laporan lapangan)

- **Kenapa**: laporan pemilik — *"IP printer suka tiba-tiba kosong atau tidak
  tersimpan padahal sudah diinputkan; simpan tidak berhasil terus."* Bukan
  vena hasil sapuan, melainkan gejala nyata yang direproduksi lebih dulu
- **Populasi/metode**: 3 tuduhan dari pembacaan `printer_editor_page.dart` +
  `printer_controller.dart`, masing-masing ditulis sebagai uji widget MERAH
  sebelum satu baris pun diperbaiki
- **Hasil — 2 terbukti, 1 DICABUT**:
  1. **Terbukti**: medan IP hanya tersimpan lewat `onTapOutside`. Ketik IP →
     tekan Kembali → penyimpanan berisi `""`. Medan **nama** di layar yang
     sama sudah punya `onSubmitted` sejak awal — tanda tangan yang sama lagi:
     penjaga di satu pintu, pintu sebelahnya terbuka
  2. **Terbukti**: Future `_simpan` dibuang SEMUA pemanggilnya → penyimpanan
     yang gagal berlalu tanpa satu tanda pun
  3. **DICABUT**: "tulis-balik basi antar-medan" **tak tereproduksi** —
     editor mem-build ulang lewat `ref.watch`, snapshot berikutnya segar.
     Ujinya dialihkan jadi PASANGAN anti-regresi, dan **langsung berguna**:
     penyiraman versi pertamaku memang menulis dari snapshot lama
- **Fix**: IP & Port tersimpan pada **tiga momen** (ketuk di luar · "selesai"
  di keyboard · `deactivate` saat layar ditutup); penyiraman lewat
  `PrinterController.ubahPrinter(id, ubah)` yang baru — `copyWith` berjalan
  di atas keadaan TERBARU; kegagalan memunculkan SnackBar
- **TIGA cacat pada perbaikanku sendiri ditangkap uji-uji itu sebelum
  terkirim**: `UnmountedRefException` (menyentuh provider yang sudah
  dilepas), galat tak tertangkap dari penyiraman lepas-tangan, dan
  `ScaffoldMessenger` dipanggil tanpa Scaffold
- **Instrumen diuji (Aturan 7), dua versi ditolak**: `setMockInitialValues({})`
  cuma mengganti isi penyimpanan (mengukur ketiadaan data, bukan kegagalan
  menulis); mock `MethodChannel` **tak pernah menggigit** karena
  `setMockInitialValues` memasang penyimpanan in-memory yang MELEWATI channel.
  Yang dipakai: override controller yang simpanannya melempar. Ditambah satu
  instrumen lagi — `pumpAndSettle` hanya menunggu FRAME, jadi pembacaan
  penyimpanan sebelum tulisan async rampung sempat gagal di premisnya sendiri
- **Bukti merah**: penyiraman-saat-tutup dicabut → uji 1 merah; umpan balik
  kegagalan dicabut → uji 3 merah; keduanya dipulihkan
- **Batas, jujur**: yang dijamin uji ini perilaku SIMPAN, bukan bahwa
  IP-nya benar (validasi format alamat tetap tak ada — diketik salah tetap
  tersimpan dan baru ketahuan saat cetak gagal); sisi **web diperiksa dan
  aman** (`PrinterContext.updateSettings` menyimpan di dalam updater pada
  setiap ketikan) jadi sengaja tak disentuh
- Gerbang: `flutter analyze` bersih · `flutter test` **535** (3.44.7) ·
  server/web tak tersentuh → verify-api tak dijalankan (disebut)
- Commit: mobile `e072e4c`

---

## Toleransi yang DIUKUR: `1e-9` berhenti berarti di 10⁷ — server — 2026-08-25

- **Kenapa**: tiga pintu memakai toleransi firasat (`1e-9` ×2, `1e-6` ×1)
  tanpa satu angka pengukuran di baliknya, sementara `EPS_KAS = 0.005` di
  jalur kas sudah **menulis asalnya** ("pembulatan numeric(…,2)" — setengah
  unit terkecil kolom). Preseden benar ada di satu pintu; tiga lainnya tidak
- **INSTRUMENNYA DIUJI LEBIH DULU (Aturan 7), dan DUA versi pertama BUTA**:
  membandingkan `SUM::float8` dengan `SUM(numeric)` membuat Postgres
  menaikkan numeric ke float8 → selisih **nol secara konstruksi**; lewat
  `::numeric(40,25)` juga nol karena Postgres memakai representasi terpendek.
  Uji-mandiri (`drift 0,1` harus terlihat) menolak keduanya; yang dipakai
  ekspansi desimal eksak Python — drift 0,1 = **5,551e-18 TERLIHAT**
- **Terukur — drift TIDAK tumbuh dengan N**: `SUM(qty)::float8` atas 30 rb
  baris pecahan (data dibuktikan terbaca API: saldo 5250) —
  **1 rb: 5,7e-15 · 10 rb: 4,5e-14 · 30 rb: 0**. Prediksi A⁷ (satu
  pembulatan di cast, drift fungsi BESARAN bukan N) **terbukti**
- **Yang tumbuh justru sisi KEBUTUHAN** (ditumpuk di JS lintas baris oleh
  `tambahKebutuhanBahan`): sapuan aritmetika menemukan **187 pasangan**
  (takaran, qty, baris) yang driftnya melampaui `1e-9` ke ATAS
- **Kurva ULP vs angka firasatnya**: pada 10⁷ ULP = **1,86e-9 > `1e-9`**;
  pada 10¹⁰ ULP = 1,91e-6 > `1e-6`. `BATAS_QTY_STOK` ≈ 10¹⁰ — besaran itu
  **di dalam** rentang yang skema izinkan, bukan angka khayalan
- **Tereproduksi lewat HTTP**: 500 baris × (0,01 × 49.157) → kebutuhan
  245.785,00000000253 atas saldo 245.785 → **400 "Stok tidak cukup: Bumbu B7
  (sisa 245.785 gr, butuh 245.785)"** — angka yang dicetak SAMA PERSIS,
  transaksinya tetap ditolak. **SESUDAH: 201**, dan kekurangan nyata tetap
  400 menyebut bahannya
- **Fix**: `toleransiBanding(nilai, skala)` = max(½ unit skala kolom, lantai
  derau float pada besaran itu). Suku pertama menjaga sifat anti-hijau-palsu
  — kekurangan sekecil **1 unit kolom (1e-6)** tetap tertangkap, dipaku pada
  lima besaran; suku kedua mengambil alih hanya di besaran tempat double
  sendiri tak sanggup membedakan sebesar itu. `EPS_KAS` **tidak disentuh**
  (kelas uang, sudah benar) — dipaku uji pasangan
- **Penjaga + bukti merah**: `saldo-skala-kolom.test.ts` +5 uji · **dua
  gerbang lama yang memaku ejaan angka diperbarui ke NIATNYA** (pembanding
  masih bertoleransi · saldo minus tetap dihitung kurang — kini diuji
  sebagai PERILAKU pada tiga besaran, bukan disimpulkan dari teks) dan
  **dibuktikan tetap menuduh**: toleransi dicabut habis → tiga uji merah ·
  verify-api **§255**
- **Batas, jujur**: `toleransiBanding` memakai faktor akumulasi tetap (1024,
  dari batas 500 baris per badan penjualan) — bila kelak ada jalur yang
  menumpuk jauh lebih banyak, faktornya perlu diukur ulang. Di besaran
  ≳10¹³ tak ada toleransi yang menolong: double tak lagi sanggup membawa
  skala kolomnya, dan jawabannya berhenti memakai float8 — di luar rentang
  masukan hari ini, dicatat bukan dikerjakan
- Gerbang: typecheck bersih · `npm test` **2.261** (192 berkas) · verify-api
  **3.005/0** vs Postgres segar · cakupan identik · `audit:invarian` 26/26
- Commit: `f38c66b`

---

## Saldo yang disusun di JS: sisa yang ADA tak bisa dihabiskan — server — 2026-08-25

- **RALAT ATAS PREMIS USULANKU SENDIRI, dan pengukuran yang membetulkannya**:
  usulan A⁷ menuduh "akumulasi banyak penjumlahan float". Pengukuran pertama
  **membantahnya** — Postgres menjumlahkan `numeric` EKSAK, jadi satu
  `SUM(...)::float8` dibulatkan sekali dan tetap sepadan dengan angka kiriman
  klien: `pakai 0,8` atas saldo 0,7 + 0,1 justru **200**. Tuduhan "pintu
  telanjang di `perlengkapan:1160`" karena itu **salah sebab**, dan kalau
  kupasang toleransi di situ aku akan menambal gejala yang tak ada
- **Yang sebenarnya**: saldo yang **disusun DI JS** dari dua nilai float8
  yang masing-masing sudah dibulatkan sendiri —
  `saldoDiRakPerlengkapan = SUM(mutasi)::float8 − SUM(dalam_jalan)::float8`
- **Terukur SEBELUM** (CK bermutasi 0,3 · kiriman menunggu 0,1 → rak
  `0.19999999999999998`), DUA gerbang, keduanya lewat HTTP:

  | pintu | balasan |
  |---|---|
  | `POST /perlengkapan/:id/pakai` qty 0,2 | **400** "Stok tidak cukup (saldo **0.19999999999999998** pak)" |
  | `POST /perlengkapan/:id/minta` qty 0,2 | **400** "Stok CK tidak cukup (siap kirim **0.19999999999999998** …)" |

  Dua kerusakan sekaligus: sisa yang ADA tak bisa dihabiskan, dan derau float
  ikut **tercetak di pesan** — angkanya sama dengan yang diminta petugas,
  jadi penolakannya tak masuk akal dari layar
- **Fix**: `keSkalaKolom(nilai, skala)` di rumah angka, dipasang di KEDUA
  penyusun JS. Bukan toleransi karangan: qty perlengkapan memang
  `numeric(16,3)` — tiga desimal adalah SELURUH presisi yang pernah ada di
  data itu, derau digit ke-17 bukan informasi
- **Terukur SESUDAH** (keadaan sama): `pakai 0,2` → ok · `minta 0,2` → ok ·
  pasangan `minta 0,25` & `pakai` saat rak habis → tetap 400, **angka bersih**
- **Distinksi yang TIDAK dihapus**: toleransi `1e-9`/`1e-6` di stok/produksi
  menjaga kelas LAIN — di sana yang dibandingkan **kebutuhan yang dihitung
  JS** (resep × batch, konversi satuan). Menyeragamkannya akan merusak yang
  sudah benar; uji pasangan memaku keduanya tetap ada
- **Penjaga + bukti merah**: `saldo-skala-kolom.test.ts` (5 uji; detektor
  dibuktikan lewat masukan sintetis; pembulatan dicabut → menuduh dengan
  angka pengukurannya) · verify-api **§254** (8 asersi) · gerbang lama
  `perlengkapan-ck-dijanjikan-sekali` dilonggarkan TEPAT untuk pembungkusnya
  dan **dibuktikan tetap menuduh** saat pengurangan `dalamJalan` dicabut
- **Batas, jujur**: `saldoStok()` (`shared/hpp.ts`) menyusun saldo di JS juga
  (`awal + produksi − terpakai`), TAPI ketiga konsumennya bertoleransi dan
  penolakan serupa **tak tereproduksi** di sana (jalur waste lewat sesi ACC,
  saldo tak langsung bergerak) — dicatat sebagai kelas yang sama yang belum
  bergejala, bukan diperbaiki buta. Perbandingan `=== 0`/`!== 0` atas selisih
  rak (stok-awal & koreksi) kini aman karena sumbernya dibulatkan, tapi
  bentuknya tetap rapuh bila kelak nilainya datang dari jalur lain
- Gerbang: typecheck bersih · `npm test` **2.256** (192 berkas) · verify-api
  **3.002/0** vs Postgres segar · cakupan identik · `audit:invarian` 26/26
- Commit: `4dce441`

---

## ANTREAN KESEBELAS — usulan dari celah yang tercatat di ledger — 2026-08-25

Antrean kesepuluh (A⁶–B⁶) tuntas. Dua usulan; yang teratas adalah tanda
tangan sesi ini dalam bentuknya yang paling telanjang — **empat pintu ke
keadaan yang sama, tiga berpenjaga dengan TIGA nilai berbeda, satu kosong**.

### Usulan A⁷ — saldo lahir dari `SUM(...)::float8`, lalu dibandingkan tanpa toleransi

**Sumbernya**: bukan batas yang tertulis, melainkan pola yang sapuan hari ini
temukan utuh. Kolom qty adalah `numeric`, tapi **25 situs** membacanya lewat
`::float8` — dan nilai float hasil penjumlahan tidak sama dengan nilai
desimalnya. Terukur di Node hari ini: `0,7 + 0,1 = 0,7999999999999999`,
`0,3 + 0,6 = 0,8999999999999999`, `4,35 + 0,1 = 4,449999999999999` — ketiganya
**di BAWAH** nilai sebenarnya.

**Populasi (dihitung hari ini)**: 4 gerbang "cukup tidak stoknya" yang membaca
saldo float —

| pintu | penjaga |
|---|---|
| `stok/routes.ts:335` | `body.qty > saldo + 1e-9` ✔ (komentar di `service.ts:289` menuliskan aturannya) |
| `stok/service.ts:291` | `r.saldo < perlu - 1e-9` ✔ |
| `produksi/konsumsi.ts:187` | `req.butuh - tersedia > 1e-6` ✔ (nilai BEDA) |
| **`perlengkapan/routes.ts:1160`** | **`body.qty > saldo` — tanpa apa pun** |

Plus `EPS_KAS = 0.005` di `shift/routes.ts` (4 pemakaian) — jadi satu kelas,
**empat nilai**, tanpa rumah bersama.

**Kerusakannya**: petugas TIDAK BISA menghabiskan sisa perlengkapannya
sendiri. Saldo yang benar 0,8 terbaca 0,7999999999999999; "pakai 0,8" dibalas
**400 "Stok tidak cukup (saldo 0,8)"** — angka yang ditampilkan sama dengan
yang diminta, jadi dari layar penolakannya tak masuk akal. Diukur lewat HTTP
sebelum dituduh (mutasi 0,7 + 0,1 lalu pakai 0,8).

**Bentuk kerjanya**: ukur lewat HTTP; satu pembantu bersama (`cukup(minta,
saldo)` di rumah yang sudah ada) menggantikan empat toleransi tulisan tangan
— tanpa mengubah arti `EPS_KAS` (0,005 rupiah adalah toleransi UANG, kelas
lain, dan itu ditulis, bukan disamakan diam-diam); gerbang mekanis:
perbandingan atas nilai yang lahir dari `::float8` wajib lewat pembantu itu,
`DIKECUALIKAN` bernama + beralasan; bukti merah; verify-api §254 (habiskan
sisa pecahan → 200; minta melebihi → tetap 400).

### Usulan B⁷ — seberapa besar drift itu tumbuh? Toleransi yang DIUKUR, bukan dirasa

Ketiga toleransi yang ada (1e-9, 1e-9, 1e-6) dipilih dengan perasaan; tak ada
satu pun angka pengukuran di baliknya. Vena pintu FIFO mengukur KECEPATANNYA
(0,056 dtk pada 20.001 baris) tapi tak pernah ketepatan numeriknya. Bentuk
kerja: suntik N mutasi pecahan (0,1 · 0,125 · 0,3) sampai 30 rb pada satu
bahan — mesin yang sudah ada — lalu bandingkan saldo float8 dengan jumlah
desimal eksak (`numeric` di SQL) pada beberapa titik; laporkan drift
maksimum terukur; **patok toleransi A⁷ pada angka itu** (dengan marginnya
ditulis), bukan pada firasat. Bila drift ternyata tumbuh melampaui toleransi
mana pun pada volume nyata, itu temuan sendiri: pembacaan `::float8` untuk
saldo harus diganti `numeric`-as-string di jalur gerbangnya.

### Diperiksa dan TIDAK diusulkan

- **Injeksi perintah printer ESC/POS** — `sanitizeAscii` menyaring ke
  0x20–0x7E (0x1b terbuang) dan dipasang di `text()` maupun `line()`;
  `pushAscii` hanya dipanggil dari dalam kelasnya, `divider(ch)` selalu
  literal. **Bersih secara konstruksi.**
- **Injeksi HTML pada dokumen cetak** — `DokumenBelanjaModal` (satu-satunya
  pembangun `bodyHtml`) meloloskan SEMUA interpolasinya lewat `esc()`.
  Bersih; kalau kelak ada pembangun kedua, kelas ini pantas jadi gerbang.
- **Buntu-mati (deadlock) urutan kunci** — sapuan badan transaksi: hanya
  **satu** badan yang memegang lebih dari satu kunci (`createSale`, dua
  `FOR UPDATE` berurutan tetap). Tanpa dua urutan berlawanan, kelasnya tak
  terjangkau hari ini — dicatat berangka.
- **Agregat UANG `::float8`** — rupiah di aplikasi ini bilangan bulat, dan
  double eksak sampai 2⁵³ ≈ 9×10¹⁵; jauh di atas langit-langit kolomnya
  sendiri (999.999.999.999). Bukan vena, dan alasannya diukur.

**Rekomendasi: A⁷ → B⁷.**

---

## Tiga tabel token dipangkas — server — 2026-08-25

- **Kenapa**: entri retensi ledger sinkron menyebut tiga saudara yang sudah
  dipangkas lalu berhenti; sapuan ulang atas **62 tabel** menemukan tiga lagi
  tanpa satu pun penghapus (hanya `.update()` penanda pakai/cabut) —
  `password_reset_tokens`, `email_verification_tokens` (keduanya menyimpan
  **hash token**: debu bermuatan kredensial mati), dan `invitations`
- **Terukur SEBELUM** (DB verify sesudah satu run penuh): **28 baris** —
  2 reset (2 mati) · 13 verifikasi (10 mati) · 13 undangan (5 `pending`)
- **Terukur SESUDAH** (+ backdate): **20 baris mati terpangkas** (2 · 10 · 8);
  **kelima undangan `pending` SELAMAT** meski di-backdate 100 hari, dan
  3 token verifikasi yang belum kedaluwarsa tak tersentuh
- **Jendela menghormati arti tiap tabel**: token hidup ≤ 24 jam (verifikasi) /
  1 jam (reset) → baris ber-`expires_at` lewat sudah pasti mati; retensi
  **30 hari = 30× umur terpanjang**. Undangan `pending` **tak punya
  kedaluwarsa** dan tak pernah disentuh (`ne(status,'pending')` adalah
  PAGARNYA, bukan filter); yang dibuang hanya `accepted`/`revoked` > 90 hari
- **Penjaga + bukti merah**: `pangkas-token.test.ts` — rasio retensi vs umur
  token, pagar `pending`, kolom penyaring benar (`expires_at` token vs
  `created_at` undangan), penjadwal benar-benar terpasang; pagar `pending`
  dicabut → merah dengan kalimat kerusakannya
- **Batas**: pemangkas berjalan per-hari tanpa indeks pada `expires_at` —
  tabel ini kini selalu kecil, jadi seq-scan-nya murah; bila kelak terukur
  berat, indeks adalah tuning satu baris. Empat tabel log berjalan
  (`pesanan_logs`, `faktur_logs`, `meja_kosong_logs`, `menu_price_logs`) juga
  tanpa penghapus — sengaja tak disentuh: jejak audit yang dibaca layar
  riwayat, membuangnya keputusan produk (dicatat sebagai populasi terukur)
- Gerbang: typecheck bersih · `npm test` **2.251** (191 berkas) · verify-api
  **2.995/0** vs Postgres segar · cakupan identik · `audit:invarian` 26/26
- Commit: `b30187e`

---

## Sel CSV yang dibuka Excel dinetralkan — web — 2026-08-25

- **Kenapa**: permukaan **ekspor** tak pernah dinilai 53 vena sebelumnya.
  `selCsv` mengutip untuk PARSING dan benar untuk itu; yang tak dijaganya —
  berkas ini dibangun untuk dibuka program LAIN, dan sel berawalan `=`, `+`,
  `-`, `@` dieksekusi Excel/Sheets/LibreOffice. Alurnya tertulis di berkas itu
  sendiri: *"unduh template → buka di Excel → Simpan"* → impor balik, jadi
  yang kembali adalah HASIL rumusnya, bukan nama yang diketik orang
- **Populasi**: 1 pembangun (`web/src/lib/bahanCsv.ts`), 2 pintu unduh
  (`ImporBahanModal:139`, `BahanPage:152`), **6 kolom teks ketikan pengguna**
  dari 17 (sisanya `selAngka`/`ya`/enum)
- **Terukur SEBELUM** (lewat pembangun sungguhan): nama `=1+1`, kategori
  `@SUM(1+1)`, satuan `+kg`, catatan `-2+3`, dan muatan DDE
  `=cmd|"/C calc"!A0` semuanya keluar APA ADANYA
- **Terukur SESUDAH**: keempatnya berawalan `'` (inert), dan ronde
  ekspor→impor memulangkan teks aslinya PERSIS — termasuk nama yang memang
  diawali `'` (dilolos ganda `''=merek` → kembali `'=merek`); pecahan
  `0,125` tetap `0.125` (kelas lama tak tersentuh)
- **Bentuknya pelolosan, bukan pemangkasan** — dan itu keputusan yang dibayar
  ledger ini: berkas yang sama sudah pernah merusak data justru pada ronde
  ekspor→impor (`0,125 → 125`), jadi penjaga barunya wajib berpasangan
  (`selTeks` ↔ `lepasLolos`)
- **Penjaga + bukti merah**: `csv-formula-netral.test.ts` — INTI bersifat
  PERILAKU dan otomatis mencakup kolom baru (isi tiap medan teks dengan
  muatan rumus → tuntut tak ada sel berawalan pemicu); ronde-utuh; pasangan
  sel biasa; detektor dibuktikan menuduh lewat masukan sintetis. Penetral
  dicabut dari kolom `nama` → merah menyebut kolomnya
- **Catatan gerbang**: `jangkar-iris` menuduh berkas uji baru ini karena
  memakai `indexOf` berargumen literal — aturan yang BENAR untuk kelasnya
  (jangkar irisan sumber). Punyaku lookup data, jadi BENTUKNYA yang diganti
  ke `findIndex`; gerbangnya tidak diberi pengecualian yang bisa basi
- **Batas**: yang dinilai baru ekspor bahan baku — satu-satunya pembangun CSV
  di repo hari ini (disapu, bukan diingat). `lib/pdf.ts` dinilai dan bersih
  (HTML→PDF, tak ada mesin formula). Kesalahan pengukuranku sendiri tercatat:
  ronde pertama "gagal" ternyata kutipan shell-ku, bukan kode
- Gerbang: typecheck bersih · `npm test` **2.247** (190 berkas) · `build`
  web sukses · verify-api TIDAK dijalankan (murni web, tak menyentuh rute)
- Commit: `d1760c5`

---

## ANTREAN KESEPULUH — usulan dari celah yang tercatat di ledger — 2026-08-25

Antrean kesembilan (A⁵–B⁵) tuntas. Dua usulan; keduanya arah yang belum
pernah disapu ledger ini sekali pun.

### Usulan A⁶ — sel CSV yang dibuka Excel

Permukaan **ekspor** tak pernah dinilai 53 vena sebelumnya (yang disapu:
badan MASUK 112 `.strict()`, teks galat KELUAR, daftar tanpa langit-langit).
Terukur: `web/src/lib/bahanCsv.ts:30` `selCsv()` mengutip untuk PARSING
(`,`/`"`/newline) tapi tak menetralkan **formula** — sel berawalan `=`, `+`,
`-`, `@` dieksekusi Excel/Sheets/LibreOffice saat dibuka. Sel berisi teks
ketikan pengguna: `nama`, `kategori`, `satuan`, `satuan_beli`, `kode`,
`catatan` (6 dari ~15 kolom). Dua pintu unduh memakai pembangun yang sama
(`ImporBahanModal:139` template "berisi data lama", `BahanPage:152` Export).
Alurnya tertulis di berkas itu sendiri: *"unduh template → buka di Excel →
Simpan"* → impor balik. Bentuk kerja: sapuan pembangun sel (detektor
dibuktikan menuduh), ukur lewat berkas sungguhan (bahan bernama `=1+1`),
perbaiki di SATU tempat dengan syarat **round-trip ekspor→impor tetap
identik** (kelas "0,125 → 125" yang berkas itu sudah pernah alami), gerbang
+ bukti merah; verify-api tak tersentuh (murni web) — disebut.

### Usulan B⁶ — tiga tabel token tak pernah dipangkas (melengkapi B⁗)

B⁗ membayar `sync_commands` dan menyebut tiga saudara yang sudah dipangkas;
sapuannya berhenti di situ. Dihitung hari ini atas 62 tabel:
`password_reset_tokens`, `email_verification_tokens` (ber-`expires_at` +
`used_at`) dan `invitations` (ber-`status`/`accepted_at`) **tak punya satu
pun penghapus** — hanya `.update()` penanda pakai/cabut; barisnya tinggal
selamanya, ikut tiap cadangan, memuat hash token (debu bermuatan kredensial
mati). Bentuk kerja: ukur lewat HTTP, pangkas berpola `pangkasLedgerSync`
dengan jendela yang menghormati arti tiap tabel (undangan `pending` TAK
BOLEH disentuh), margin dipaku uji, bukti merah, ukur sesudah.

### Diperiksa dan TIDAK diusulkan

Ekspor ponsel (`SharePlus` berbagi teks/gambar — tak ada permukaan formula) ·
log berjalan (`pesanan_logs`, `faktur_logs`, `meja_kosong_logs`,
`menu_price_logs`) tak berpenghapus juga, tapi jejak audit yang dibaca layar
riwayat — membuangnya keputusan produk, dicatat sebagai populasi · `lib/pdf.ts`
(HTML→PDF, tanpa mesin formula) dinilai saat A⁶ menyapu.

**Rekomendasi: A⁶ → B⁶.**

---

## Granularitas badan diadjudikasi untuk keenam aturan — server — 2026-08-25

- **Kenapa**: batas tertulis PALING LAMA `penjaga-semua-pintu` (*"satu
  penjaga di mana pun dalam satu badan membuat SELURUH tulisan lolos"*),
  ditunda tiga antrean; `bentrok-unik` sudah dibayar D′ per-pernyataan
- **Metode**: kelima aturan sisa dijalankan ulang per-TULISAN — penjaga
  wajib hadir SEBELUM tiap tulisan di badannya; gaya-PINTU (unggah/email:
  penjaga = middleware pendaftaran rute) diperiksa per NAMA yang terpungut
  pola longgarnya
- **Hasil — BERSIH berangka, nol temuan hidup**: 5 tuduhan = `dasar` yang
  sudah tertimbang · **1 tuduhan palsu jendela pengukurku sendiri**
  (`konsumsi.ts:100` — penjaga DIRANTAI pada pernyataan yang sama:
  `.insert(…).values(…).onConflictDoNothing()`; riwayat kelas ini 14 → 15) ·
  email: semua yang terpungut `\bbatas[A-Z]` adalah pembatas laju sungguhan
  (`batasUndang*`, `batasLupa`) · upload: 1 badan, kedua middleware hadir
- **Tindak**: prosa batas gerbang diperbarui — utang granularitas kini
  tercatat DIADJUDIKASI keenam aturannya, dengan batas jujur: adjudikasi ini
  sekali jalan (badan baru yang menaruh tulisan sebelum penjaganya menunggu
  adjudikasi berikutnya, bukan sapuan badan)
- Gerbang: typecheck bersih · `npm test` **2.243** (189 berkas) · hanya
  prosa berkas uji tersentuh — verify-api tak dijalankan ulang (disebut)
- Commit: `f40209b`

---

## Berkas unggahan yatim disapu — server — 2026-08-25

- **Kenapa**: `POST /upload` tak menulis baris DB apa pun, dan komentar
  pintunya sendiri menulis celahnya sejak vena batas-laju: *"tak ada kuota
  per perusahaan, tak ada pembersihan yatim"* — LAJU dijaga, STOK tumbuh
  selamanya. Sumber yatim aktif: foto bukti sinkron yang perintahnya ditolak
  per-item (kelas A‴/A⁗) + form web yang batal sesudah unggah
- **Terukur SEBELUM** (mesin dev, akumulasi lintas reset DB — analog
  produksi "baris dihapus, berkas tinggal"): **2.384 berkas / 12 MB** di
  direktori unggahan vs **40 rujukan** (20 nama unik) di DB aktif = 98,3 %
  yatim; ±130 berkas baru per run verify
- **Terukur SESUDAH** (semua mtime dimundurkan 10 hari + satu berkas
  ditautkan `menus.image_url`): sapuan menghapus **2.383**, penyintas
  tunggal = berkas yang DIRUJUK — perlindungannya rujukan, bukan umur
- **Bentuk**: `StorageDriver` += `list`/`hapus` (lokal rekursif + R2
  `ListObjectsV2`, cermin backup-storage) · `lib/sapu-unggahan.ts` — 9 kolom
  perujuk, `namaBasis` kebal bentuk rujukan, `TENGGANG_HARI = 7`, advisory
  lock, **pagar**: rujukan dikumpulkan LENGKAP dulu (satu kueri gagal = tak
  menghapus apa pun) dan umur tak terbaca tak dihapus · penjadwal harian
  sejam sesudah jam cadangan · `POST /admin/sistem/sapu-unggahan`
  (`?hitung=1` = mode ukur)
- **Penjaga + bukti merah**: `sapu-unggahan.test.ts` — kelengkapan daftar
  perujuk ditagih sapuan mekanis `schema.ts` **dihitung per nama** (tabel
  baru memakai ulang `foto_url` tak lolos); entri `ingredient_steps` dicabut
  → merah "3 di schema tapi 2 di daftar". verify-api **§253** (8 asersi)
- **Batas, jujur**: rujukan di DB verify ternyata mayoritas string fikstur
  (`/u/b250.jpg`) — angka "40 rujukan" adalah lingkungan uji; fraksi yatim
  produksi akan jauh lebih rendah, tapi arah tumbuhnya sama dan kini
  terpangkas. Sapuan menilai NAMA BASIS (uuid unik global) — rujukan yang
  disimpan tanpa nama berkasnya (tak ada hari ini) tak terlihat. Kuota per
  perusahaan tetap kebijakan produk (fondasi `list` per prefiks kini ada)
- Gerbang: typecheck bersih · `npm test` **2.243** (189 berkas) · verify-api
  **2.995/0** vs Postgres segar · cakupan **272/275** (+1 rute baru,
  rekaman diperbarui dari jejak run) · `audit:invarian` 26/26 · ponsel tak
  tersentuh (disebut)
- Commit: `568f91e`

---

## ANTREAN KESEMBILAN — usulan dari celah yang tercatat di ledger — 2026-08-25

Antrean kedelapan (A⁗–B⁗) tuntas. Dua usulan.

### Usulan A⁵ — berkas unggahan YATIM: celah yang ditulis kodenya sendiri tiga kali

`upload/routes.ts`: *"Tak ada yang menghapus berkas ini kelak: tak ada kuota
per perusahaan, tak ada pembersihan yatim"* — diulang teks aturan
`unggah-berbatas`. Vena batas-laju menjaga LAJU; STOK tumbuh selamanya.
Terukur baca-saja: `POST /upload` tak menulis baris DB apa pun (tanpa
akuntansi); sumber yatim aktif = foto bukti sinkron yang perintahnya ditolak
per-item (kelas yang baru digarap A‴/A⁗) + form web yang batal; `StorageDriver`
hanya `put` — `list`/`hapus` dicermin dari `backup-storage.ts` (kedua driver).
Bentuk kerja: sapuan kolom perujuk (PREMIS memaku vs skema — kolom URL baru →
merah menuntut keputusan), ukur fraksi yatim pasca-run verify + satu yatim
lahir hidup, `sapuUnggahanYatim()` bermasa-tenggang ≥ 7 hari menumpang
penjadwal cadangan, pagar "gagal baca rujukan = tak menghapus apa pun",
guard + bukti merah + verify-api §253.

### Usulan B⁵ — granularitas badan 5 aturan sisa `penjaga-semua-pintu`

Batas tertulis paling lama yang belum dibayar (ditunda tiga antrean); D′
membayarnya untuk `bentrok-unik`. Jalankan ulang `owner-terakhir`,
`ganti-daftar`, `cuti-bertindih`, `unggah-berbatas`, `email-berbatas` pada
jendela per-PERNYATAAN (mesin D′ dipakai ulang); tiap tuduhan diadjudikasi
baca + ukur (riwayat 14 tuduhan palsu); hasil = prosa/dasar gerbang atau
temuan berangka.

### Diperiksa dan TIDAK diusulkan

Idempotensi sisi WEB — pintu inti + tahap sudah ber-`client_ref`
(`lib/idempoten.ts`); pakai/opname perlengkapan tak ada di web; `kirim` web
body kosong tapi berpenjaga status (micro-gap dicatat) · `terbitkanNomor`
bukan kelas #38 (counter atomik, prefiks tetap, idempoten per-ref) · kuota
simpanan per perusahaan = kebijakan produk, bukan bug (A⁵ memberi fondasinya).

**Rekomendasi: A⁵ → B⁵.**

---

## Ledger sinkron dipangkas: retensi yang menghormati kontrak antrean — server — 2026-08-25

- **Kenapa**: tiga tabel debu operasional dipangkas (`error_logs`,
  `backup_runs`, `rate_limits`); `sync_commands` tidak — ≈ satu baris per
  transaksi ponsel ber-`hasil_json` utuh, satu-satunya `delete` hanya
  melepas klaim gagal
- **Terukur**: **108 baris / 136 kB** per run verify-api (118 penjualan) —
  ≈ 73 rb baris (~90 MB) per tahun per penyewa aktif, ikut tiap cadangan
- **Fix**: `pangkasLedgerSync()` (`RETENSI_LEDGER_HARI = 60`), lepas-tangan
  di ekor `/sync` (pola `pangkasErrorLog` menumpang penulisnya). **Aman
  karena satu kalimat**: retensi ≥ 2× usia perintah maksimum /sync (30 hari
  penjualan) — replay atas ref terpangkas tertahan gerbang usia 400 SEBELUM
  eksekutor; pemangkasan tak pernah membuka jendela eksekusi ganda
- **Terukur pemangkasnya**: 8 baris, 4 di-backdate 100 hari → terpangkas
  tepat 4, penyintas baris hari ini
- **Penjaga + bukti merah**: `sync-ledger-retensi.test.ts` — rasio retensi
  vs usia dipaku (retensi diciutkan 20 → merah berkalimat jendela-ganda),
  filter `created_at` (bukan `waktu` kejadian yang bisa 30 hari lebih tua),
  kaitan `/sync`
- **Batas**: pemangkasan berjalan per permintaan sinkron tanpa indeks
  `created_at` — pada tabel yang KINI selalu ≤ ~60 hari isi, seq-scan-nya
  kecil; bila kelak terukur berat, indeks adalah tuning satu baris
- Gerbang: typecheck bersih · `npm test` **2.238** (188 berkas) · verify-api
  **2.988/0** · cakupan identik · `audit:invarian` 26/26 · ponsel tak
  tersentuh (disebut)
- Commit: `a8874cb`

---

## Satu kunci idempotensi untuk dua percobaan — server+mobile — 2026-08-25

- **Kenapa**: `sync_queue.tambah()` menulis kegunaan `clientRef` (*"diisi bila
  sudah dibuat sebelum percobaan ONLINE … server dedupe, tak dobel"*) dan
  komentar `OpnameBody` stok menulis aturannya — lalu 6 dari 10 situs enqueue
  tak pernah mengisinya, dan modul perlengkapan tak punya medan kuncinya
  (0 dari 22 pintu tulis; skema strict → mengirimnya = 400). `TahapBody`
  punya kunci + klaim server, dan ponsel tak pernah mengirimnya
- **Terukur SEBELUM** (online COMMIT + replay `/sync` ber-ref BARU — persis
  skenario balasan hilang di jaringan): `pakai 7` → saldo **100→93→86**
  (potongan GANDA, balasan "ok") · satu niat opname → **2 sesi kembar**
  menunggu dua ACC · `faktur_tahap` → 400 "Tahap tidak berurutan" = item
  antrean **gagal PALSU** untuk aksi yang sukses · kirim/kirim-hasil sekelas
  (penjaga status dibaca: `siap.length === 0` → 400, tak bisa ganda) ·
  `shift_buka` TOLERAN terukur (replay → ok + `sudah_terbuka`, shift tetap 1)
- **Fix server**: `PakaiBody`/`OpnameBody` perlengkapan ber-`client_ref` +
  `denganKlaimIdempoten` (pola stok/routes.ts — pintu pemindah stok butuh
  klaim SEBELUM eksekusi); `KirimBody` (+turunannya) ber-`client_ref` +
  `catatHasilIdempoten` (pintu berstatus cukup MENCATAT sukses ke ledger
  bersama). **Fix mobile**: 6 situs mencetak `refPerintah` SEBELUM percobaan
  online, dibagi ke badan online (`client_ref`) + envelope antrean
- **Terukur SESUDAH** (keadaan sama): pakai replay → `sudah_ada`, saldo
  TETAP; pasangan ref baru tetap dieksekusi (−1) · opname **+1 sesi saja** ·
  tahap replay → `sudah_ada` · kegagalan TIDAK di-cache (klaim dilepas saat
  gagal): pakai-melebihi-saldo ber-ref → 400, retry ref sama → tetap 400
- **Penjaga + bukti merah** (suntikan di-assert mendarat):
  `idempoten-dua-percobaan.test.ts` (tipe klaim dicabut → menuduh dengan
  angka pengukurannya) · mobile `sync_ref_dibagi_test.dart` (9 tipe +
  pasangan badan online; `clientRef` dicabut → merah berkalimat) ·
  verify-api **§252** (12 asersi perilaku)
- **Batas, jujur**: pintu kirim/kirim-hasil tidak diukur GANDA lewat HTTP
  (fikstur CK→cabang mahal) — ketidak-gandaannya dari penjaga status yang
  DIBACA, dan mekanisme putar-ulangnya persis jalur yang diukur tiga kali
  (pakai/opname/tahap semua lewat fast-path ledger yang sama); yang dipaku
  bentuk TULIS ledger-nya. Build lama tetap tanpa ref → perilaku hari ini
  (terukur di SEBELUM) tak berubah untuk mereka. Satu alarm palsu tercatat:
  ref pelacak `origin/claude` ponsel basi menunjuk leluhur lama — kukira
  cabang remote di-reset; GitHub (head PR = commit-ku) membantahnya
- Gerbang: typecheck bersih · `npm test` **2.235** (187 berkas) · verify-api
  **2.988/0** vs Postgres segar · cakupan identik · `audit:invarian` 26/26 ·
  `flutter analyze` bersih · `flutter test` **532**
- Commit: server `43590f5` · mobile `772f4c7`

---

## ANTREAN KEDELAPAN — usulan dari celah yang tercatat di ledger — 2026-08-25

Antrean ketujuh (A‴–B‴) tuntas. Dua usulan; yang teratas lahir dari
pengintaian A‴ sendiri: sapuan kunci payload menemukan pintu yang kuncinya
benar tapi tak pernah DIBAGI antara dua percobaan yang menjaga hal yang sama.

### Usulan A⁗ — SATU kunci idempotensi untuk DUA percobaan (online → offline)

Komentar `OpnameBody` stok menulis aturannya (*"jaringan putus SESUDAH server
menyimpan … sesi kedua lahir"*) dan `sync_queue.tambah()` menulis kegunaannya
(*"[clientRef] diisi bila sudah dibuat sebelum percobaan ONLINE … server
dedupe, tak dobel"*). **Populasi (dihitung 25-08)**: 10 situs enqueue —
**4 membagi ref** (penjualan, stok_opname, absen ×2), **6 tidak** (shift_buka,
perlengkapan_pakai/opname, faktur_tahap/kirim, produksi_kirim_hasil); dedup
server ada di **6 modul**, **perlengkapan NOL dari 22 pintu tulis** (skema
strict-nya bahkan tak punya medan `client_ref`); `TahapBody` punya kuncinya
dan ponsel tak pernah mengirimnya. Model kerusakan: timeout-setelah-commit →
antre ber-ref BARU → sinkron mengeksekusi ULANG — pemakaian terpotong dua
kali tanpa galat. Bentuk kerja: ukur dulu (online + replay via `/sync`),
fix server (client_ref + `denganKlaimIdempoten` pola `stok/routes.ts:388`) +
mobile (ref dicetak sebelum online, dibagi — pola `bayar_sheet._clientRef`),
adjudikasi shift_buka (`sudah_terbuka`), guard dua repo + verify-api §251 +
bukti merah + CHANGELOG (aditif).

### Usulan B⁗ — `sync_commands` tanpa pemangkasan

Retensi ada di TIGA saudara (`error_logs`, `backup_runs`, `rate_limits`);
`sync_commands` — ≈ satu baris per transaksi ponsel, ber-`hasil_json` utuh —
tak pernah dipangkas (satu-satunya `delete` hanya melepas klaim gagal) dan
ikut membengkakkan tiap cadangan. Ukur dulu (baris & byte per N transaksi —
Postgres mati saat pengintaian, angka diukur di putaran), pangkas berpola
`pangkasErrorLog` dengan jendela menghormati kontrak antrean offline
(30 hari penjualan + 14 hari gagal → retensi ≥ 60–90 hari, alasan di
konstanta), guard + bukti merah, ukur sesudah.

### Diperiksa dan TIDAK diusulkan

Nomor struk kembar lintas cabang berprefiks sama (`kodeCabang` 10 aksara) —
`nomor` tak pernah jadi kunci pencarian server, indeks unik per-(cabang,
nomor); ambiguitas tampilan/ekspor dicatat · granularitas badan 5 aturan
`penjaga-semua-pintu` sisa (populasi kecil, paling rawan tuduhan palsu,
aturan berisiko tertinggi sudah dibayar D′) · kelas DB ON DELETE/CHECK
(tergarap 2026-08-22) · `restore-backup.ts` seluruh arsip di memori (CLI
admin, bukan rute; terukur jalan utuh di 600 rb baris) · fase-2 mengabaikan
niat cabang peran terikat (arah aman — tetap cabangnya sendiri).

**Rekomendasi: A⁗ → B⁗.**

---

## Pencadangan pada volume: seluruh DB di memori + gzip sinkron — server — 2026-08-25

- **Kenapa vena ini ada**: `POST /admin/sistem/backup` tak pernah diukur pada
  volume; `lib/backup.ts` memuat seluruh baris semua tabel ke satu larik
  string, `join`, lalu `gzipSync` — kompresi SINKRON atas seluruh DB yang
  menghentikan event loop (kelas #12, sebab berbeda: CPU, bukan kunci)
- **Populasi/mesin**: 200.015 penjualan + 400.028 baris item = **600.790
  baris, DB 193 MB**, disuntik SQL dari baris templat API; **dibuktikan
  terbaca** (aturan 6): `GET /laporan` memulangkan `jumlah_transaksi:
  200.000`, omzet 3 M — persis suntikan
- **Terukur SEBELUM** (server dingin, sampler health 50 ms + RSS 100 ms):
  backup **12,9 dtk** · arsip 21,3 MB · `/api/health` (biasa 2 ms) macet
  sampai **5.299 ms** — semua permintaan lain ikut berhenti, layar bayar
  termasuk · RSS **207 MB → 1.786 MB**, lalu **bertahan 1,66 GB** sesudah
  selesai (heap V8 tak menyusut; run kedua di atasnya memuncak 1.772 MB)
- **Fix**: ekspor streaming — satu transaksi `REPEATABLE READ` (bonus yang
  dulu tak ada: semua tabel dipotret SATU snapshot, bukan dibaca pada waktu
  berbeda), kursor per tabel di koneksi advisory-lock yang sudah dipegang,
  `FETCH 5000` per batch, tulisan sadar-backpressure ke `createGzip`
- **Terukur SESUDAH** (keadaan sama, dingin): backup **8,6 dtk** · health
  MAKS **28 ms** (p50 2 ms) · RSS puncak **392 MB**, idle sesudah **164 MB**
- **Kompatibilitas format DIBUKTIKAN DIJALANKAN, bukan dibaca**:
  `restore-backup.ts` atas arsip streaming 600.788 baris ke DB kosong →
  58 tabel pulih, `sales=200.015`, `items=400.028`, agregat suntikan cocok
- **Penjaga + bukti merah**: `backup-streaming.test.ts` (4 uji — createGzip +
  `drain` + kursor + snapshot + ROLLBACK); suntikan `gzipSync` kembali →
  merah dengan kalimat pengukurannya; dipulihkan
- **Batas**: volume 200 rb terlalu mahal untuk CI — angka di atas hidup di
  ledger, CI menjaga BENTUKNYA (uji sumber) dan perilakunya pada volume
  kecil (verify-api § pemeriksaan sistem: sukses/unduh/retensi). Selisih
  600.790 → 600.788 antara run = baris retensi/log yang terpangkas di
  antara pengukuran, bukan kehilangan ekspor (restore menghitung ulang
  angka arsipnya sendiri, cocok)
- Gerbang: typecheck bersih · `npm test` **2.225** (186 berkas) · verify-api
  **2.979/0** · cakupan identik · `audit:invarian` 26/26 · ponsel tak
  tersentuh (disebut, bukan didiamkan)
- Commit: `faaa30d`

---

## Cabang niat di /sync: empat pintu membuangnya, satu temuan sampingan mem-500-kan kasir — server+mobile — 2026-08-24

- **Populasi**: 13 tipe perintah `EKSEKUTOR` · **10 situs enqueue** ponsel ×
  **7 build tayang** (+3…+10, dari 6 commit kenaikan versi) — kunci payload
  per (situs, build) diekstrak `git show` + pemindai kurung berimbang
  sadar-spread (`...{`) dan sadar-kedalaman
- **Detektor DIBUKTIKAN menuduh** — masukan sintetis: kunci asing tertuduh,
  kunci dalam spread dinilai milik induk, kunci item bersarang terbaca,
  payload lewat variabel teresolusi. **Satu tuduhan palsu tertangkap**:
  `'nominal'` — lengan TERNER (`hasil.dibatasi ? 'nominal' : x`) terbaca
  sebagai kunci; kelas yang sudah dua kali tercatat. Aturan "kunci tak pernah
  didahului `?`" dipasang dan jadi kasus sintetis detektornya
- **Arah kunci-LEBIH: BERSIH** — 10 situs × 7 build, semua ⊆ skema strict
  tujuannya (SaleBody/SelfBody/ClockBody/OpnameBody×2/PakaiBody/TahapBody/
  KirimBody/KirimHasilBody; kunci params dicabut `pisahParam`)
- **Arah kunci-KURANG: TEMUAN** — 4 pintu tak pernah membawa `branch_id` di
  build mana pun (`perlengkapan_pakai`, `perlengkapan_opname`, `absen_saya`,
  `absen_stasiun`) padahal jalur online-nya mengirim `branchId:` (query).
  Terukur lewat POST /sync sungguhan (dua cabang, saldo 100/100):
  - SEBELUM: pakai niat "Cabang Dua" → **PUSAT 100→93, balasan "ok"** ·
    opname niat Dua → sesi + koreksi −38 lahir di PUSAT · absen admin →
    masuk tercatat di PUSAT. Fallback "cabang pertama" peran tak terikat —
    dua cabang salah sekaligus tanpa satu galat pun (kelas §208, di pintu
    yang komentarnya sendiri menulis "satu eksekutor yang lupa akan
    mengulang bug yang sama tanpa suara")
  - Fix: `angkatCabangNiat()` di 4 eksekutor + ponsel mengirim
    `'branch_id': ?branchIdQueryProvider` (null untuk peran terikat)
  - SESUDAH (keadaan sama): pakai → Dua 100→95 · koreksi −5 di Dua (selisih
    dihitung atas saldo Dua) · absen masuk di Dua · payload TANPA branch_id
    tetap ok dengan fallback tak berubah · kasir terikat + niat cabang lain
    → item 403
- **TEMUAN SAMPINGAN** (dari fikstur §249 baru): **ganti nama cabang
  mem-500-kan SEMUA penjualan sisa hari itu**. Nomor struk lama = `ORDER BY
  nomor DESC` (teks) + `slice(-4)+1`; prefiks campuran pasca-rename → max
  tekstual memilih prefiks lama (`PUSAT-…-0106` > `CABANGG248-…-0107`) → seq
  0107 → 23505 → 500 **deterministik sampai ganti tanggal bisnis**. Terukur:
  101 nota `PUSAT-` + 1 nota `CABANGG248-` di satu cabang → tiap penjualan
  500; SESUDAH `MAX(RIGHT(nomor,4)::int)` → 0108, 0109 sukses berurutan.
  (Ini juga sebab sesungguhnya pasangan §249 merah "404" — bukan urutan
  menu; pemungut "menu pertama" diganti fikstur buatan sendiri)
- **Penjaga + bukti merah** (semua suntikan di-assert mendarat):
  `sync-cabang-niat.test.ts` (suntik `resolveCabangSync(auth, null)` →
  menuduh nama eksekutornya) · `nomor-struk-lintas-prefiks.test.ts` (suntik
  bentuk tekstual → merah) · mobile `sync_payload_cabang_test.dart` (cabut
  `branch_id` → menuduh dengan kalimat kerusakannya) · verify-api **§250**
  (18 asersi perilaku; §249 pasangan kini deterministik)
- **Batas, jujur**: build lama tak bisa diperbaiki dari sini — owner/admin
  offline di build ≤+10 tetap jatuh ke cabang pertama (fallback DIPAKU §250
  supaya tak berubah diam-diam); pintu fase-2 memakai `resolveBranchId` yang
  MENGABAIKAN (bukan menolak) niat cabang lain milik peran terikat — 403
  hanya di jalur fase-1; detektor membaca NAMA kunci, nilai tak ditelusuri
  melampaui pin `branchIdQueryProvider`. Dan dua kesalahan proses tercatat:
  `git checkout --` menghapus fix yang belum di-commit (pagar lama dilanggar
  lagi — dipasang ulang dari konteks), dan dua kali server lama yang masih
  memegang port melayani pengukuran (EADDRINUSE di log server baru; sejak
  itu pid pemegang port diverifikasi sebelum suite jalan)
- Gerbang: typecheck bersih · `npm test` **2.220** (185 berkas) · verify-api
  **2.979/0** vs Postgres segar · cakupan rute identik · `audit:invarian`
  26/26 · `flutter analyze` bersih · `flutter test` **522**
- Commit: server `6c74010` · mobile `20a28c6`

---

## ANTREAN KETUJUH — usulan dari celah yang tercatat di ledger — 2026-08-24

Antrean keenam (A″–C″) tuntas. Dua usulan; populasinya diukur baca-saja hari
ini, dan keduanya menunjuk kelas yang sudah pernah menggigit di repo ini.

### Usulan A‴ — antrean offline build lama vs skema strict di `/sync`

Vena #36 membuat 112 badan `.strict()`, dan pengecualian yang ditulisnya saat
itu (`TataLetakBody`) lahir dari satu fakta: **build ponsel yang sudah tayang
tak bisa diperbaiki**. Jalur yang belum pernah disapu dengan fakta itu:
`POST /sync` — payload antrean offline di-parse MENTAH terhadap skema yang
kini strict (`sync/routes.ts:324` `SaleBody.parse`, `:443` `SelfBody.parse`,
`:479` `ClockBody.parse`; 9 tipe lain dispatch ke endpoint asli ber-skema
strict). Kelas ini **sudah menggigit sekali di jalur ini sendiri**:
`execPerlengkapanPakai` membuang `branch_id` dengan tangan, dan komentarnya
menuliskan persis sebab-akibatnya.

**Model kerusakannya diukur hari ini di `sync_queue.dart`**: hasil per-item
400 → `status: 'gagal'` **permanen** — tak pernah diulang, terpangkas 14 hari
setelah ditolak; item pending penjualan tak boleh dihapus manual. Artinya:
transaksi/kehadiran NYATA (uang sudah diterima kasir) ditolak selamanya saat
sinkron, lama setelah layar ditutup.

**Populasi**: **13** tipe perintah di `EKSEKUTOR`; **10** situs enqueue di
ponsel hari ini; **7** build tayang (1.0.0+3 … +10). Sudah diukur hari ini:
`penjualan` — ketujuh build kuncinya ⊆ `SaleBody` (bersih); `absen_saya` /
`absen_stasiun` — build tertua & sekarang ⊆ skema (`foto_url` disuntik
`sync_queue` dan memang ada di `KoordinatBody`); `shift_buka` — skema inline
TIDAK strict (longgar = aman untuk build lama). **Belum disapu: 6 situs
fase-2** (stok_opname, perlengkapan_opname/pakai, faktur_tahap/kirim,
produksi_kirim_hasil) × 7 build vs skema strict endpoint tujuannya — kunci
`params` (`jalur`, `faktur_id`, `supply_id`) dicabut `pisahParam`, sisanya
harus muat di skema tujuan. Bentuk kerja: ekstraksi mekanis kunci payload per
(situs, build) lewat `git show`; banding vs himpunan kunci skema tujuan; yang
tak cocok DIUKUR lewat `/sync` sungguhan dengan payload build lama diputar
ulang; perbaikan menurut sifatnya (terima-dan-abaikan berdokumen bersyarat
cabut, atau dicabut di dispatcher seperti `perlengkapan_pakai`); gerbang
lintas-repo memakai mesin kunci-kontrak yang sudah ada.

### Usulan B‴ — pencadangan pada volume: seluruh DB di memori + `gzipSync`

`lib/backup.ts` memuat **seluruh baris semua tabel** ke memori JS sekaligus
(loop `SELECT to_jsonb(x) FROM <t>` tanpa batas, ditumpuk ke satu larik
string), lalu `potongan.join("\n")` menggandakan memorinya, lalu
**`gzipSync`** — kompresi SINKRON atas seluruh DB yang **memblokir event
loop**: selama itu berjalan, SEMUA permintaan lain berhenti. Kelas yang sama
dengan `GET /menu` 0,009→20,07 dtk (#12), di pintu yang belum pernah diukur
pada volume. Mesin ukurnya sudah ada (suntikan 200 rb transaksi, data
dibuktikan terbaca): jalankan `POST /admin/sistem/backup` pada volume itu,
ukur durasi + puncak memori + **latensi GET serentak selama backup berjalan**
(itulah angka yang menentukan). Berat → perbaikan terukur (baca per-batch +
gzip async/stream, hasil tetap byte-identik dipulihkan `restore-backup.ts`);
ringan → angka acuan tercatat. Backup memang ekspor penuh — `LIMIT` bukan
perbaikannya; yang diukur *bagaimana* ia memuat & memampat.

### Diperiksa dan TIDAK diusulkan

Sapuan `.parse(` telanjang atas `apps/server/src`: **5** situs — pesanan
sudah dibayar (jenisDariJalur, C″); tiga di `sync/routes.ts` ditangkap
dispatcher per-perintah (`z.ZodError` → item 400, bukan 500 — dan justru
populasi A‴); `config/env.ts` memang harus mati saat boot bila env cacat ·
kunci pemotongan (`lots_terpotong`/`terpotong`/`transaksi_terpotong`) dibaca
web DAN ponsel pada tingkat nama — bersih · FIFO lintas-bahan (laporan nilai
stok) sudah punya gerbang sendiri (batas entri B″ menyebutnya).

**Rekomendasi: A‴ → B‴.** A‴ teratas karena kelasnya sudah menggigit di jalur
yang sama (`perlengkapan_pakai`), model kerusakannya terukur paling mahal
(uang nyata tertolak permanen), dan separuh populasinya sudah terukur hari
ini — tinggal 6 situs × 7 build yang belum.

---

## ANTREAN KEENAM — usulan dari celah yang tercatat di ledger — 2026-08-24

Antrean kelima (A′–D′) tuntas. Tiga usulan; populasinya diukur baca-saja
hari ini, dan yang teratas menunjuk pola yang antrean kelima sendiri buktikan
tiga kali.

### Usulan A″ — tembak yang dinyatakan aman LEWAT BACA

Entri A′ menulis batasnya: *"28 situs `.update()` lain dinyatakan aman lewat
pilahan BACA, bukan lewat tembakan."* Sesi ini baru membuktikan tiga kali
berturut bahwa pilahan baca bisa salah dua arah: klaim "`sales.nomor` tanpa
kunci" gugur oleh 50 tembakan satu-tick; klaim PUTUSAN "terkurung aritmetika"
terbantah oleh 1e11; angka "20 pintu terbuka" ternyata 8. **Populasi**: **11**
pintu PATCH/PUT ber-`tanpaBentrok` di luar menu/customer yang belum pernah
ditembak duplikat — berurutan maupun serentak — plus 28 situs pilahan-baca A′.
Bentuk kerja: **§248** per pintu — duplikat berurutan → 409 berkalimat, sah →
200, empat serentak → nol 5xx + tepat satu pemegang; yang 500 = temuan; yang
bersih = terpaku perilaku, bukan prosa. Bukti merah pola §245.

### Usulan B″ — pintu FIFO: 20.001 baris per permintaan, belum pernah diukur

Putaran pintu-detail mengukur `/stok/kartu` (berbatas 500+1) tapi bukan
`GET /stok/fifo/:ingredientId` — yang by design membaca sampai
`BATAS_EVENT_FIFO + 1` = **20.001 baris** lalu menghitung FIFO **di JS** per
permintaan. Pintu detail terberat di repo ini, satu-satunya tanpa angka.
Suntik 30 rb mutasi satu bahan (data dibuktikan terbaca), ukur byte + ms;
berat → temuan; ringan → angka acuan masuk blok PINTU DETAIL.

### Usulan C″ — jalur tulis KEDUA ke kolom yang dijaga

Batas gerbang luapan-turunan: *"jalur tulis KEDUA ke kolom yang sama takkan
terlihat."* Instansinya nyata: `penjualan/rekalkulasi.ts` menghitung ULANG
`hppSatuan` (basis biaya berubah saat dapur membungkus) dan menulis
`sale_items.hpp_satuan` + `sales.total_hpp` — dijaga `pastikanMuat` di
`createSale`, **di jalur ini tidak**, dan arahnya bisa NAIK (kemasan takeaway
menambah HPP). Ukur keterjangkauan lampauannya lewat HTTP; pasang penjaganya
apa pun hasilnya (pintu saudara); pin di gerbang.

### Diperiksa dan TIDAK diusulkan

Refund menulis `sales.subtotal/total/pb1` — jalur kedua juga, tapi arahnya
MENURUN dari nilai yang sudah lolos penjaga · tiga pintu host super admin
(permanen beralasan) · kesegaran fikstur lintas-repo di CI ponsel (CI ponsel
tak bisa membaca repo server; dijaga di mesin bermuat-keduanya) · web (tak
ada batas terukur tersisa di entri-entrinya).

**Rekomendasi: A″ → B″ → C″.**

---

## Utang "20 pintu terbuka" bentrok-unik dibayar — server — 2026-08-24

- **Kenapa**: aturan `bentrok-unik` menulis utangnya sendiri — daftar tabelnya
  berhenti di 14 dari 32 karena sisanya "20 pintu terbuka" yang belum pernah
  diperiksa satu per satu
- **Adjudikasi**: angka "20" **kedaluwarsa** — sapuan hari ini (jendela
  per-pernyataan + kosakata penjaga aturan itu + `pg_advisory`) menyisakan
  **8**, dan kedelapannya terjaga oleh bentuk yang kosakata aturan tak bisa
  lihat: indeks **parsial** (`auto_uq` — kelima insert `supply_mutations`
  bertipe lain), `FOR UPDATE` jauh di atas jendela (`createSale` — terukur 50
  satu-tick → 50×201 di vena A), dedup `Map` (`replaceKomponen`), dan keunikan
  atas `sha256(randomBytes(32))` (dua tabel token — bentrok mustahil praktis)
- **Tindak**: daftar tabel aturan **14 → 32**; 4 berkas / 8 pintu masuk
  `dasar` **beralasan**; dua baris uji-diri berpindah false → true dengan
  komentarnya; prosa "kenapa berhenti di 14" diganti kisah adjudikasinya.
  **Granularitas badan gerbang terbukti lebih pintar dari jendela ±2500-ku**:
  `createSale` tak tertuduh karena badannya memuat kuncinya
- **Detektor**: DIBUKTIKAN — `insert(syncCommands)` telanjang disuntik ke
  berkas netral (di-assert) → tertuduh berkas & barisnya; dicabut → hijau
- **Batas, tetap tertulis di prosa aturan**: granularitas badan — penjaga sah
  di pemanggil tetap terbaca telanjang, dan satu penjaga di badan panjang
  tetap menutupi tulisan lain di bawahnya
- Gerbang: typecheck bersih · `npm test` **2.208** · hanya berkas uji
  tersentuh (verify-api tak diulang, disebutkan)

---

## `pastikanMuat` bernama untuk jalur non-penjualan — server — 2026-08-24

- **Kenapa**: batas #39, dua kali ditulis — jalur non-penjualan hanya
  dilindungi lapis pertama: 400 terbaca, **tanpa sebutan medan**
- **Kandidatnya baris `PUTUSAN` gerbangku sendiri**, dan pengukurannya
  **membantah klaimnya**: `production_consumptions.qty` tercatat *"terkurung
  secara aritmetika — belum diukur"*. Terukur: takaran resep **99.999.999**
  (sah) × qty produksi **1.000** (sah) = **1e11** — sepuluh kali kolomnya
  `numeric(16,6)`:

  | | balasan |
  |---|---|
  | SEBELUM | 400 **generik** "Angkanya terlalu besar untuk disimpan" (diselamatkan pintu bersama §243) |
  | SESUDAH | 400 **`Pemakaian bahan "Air Mineral 330 ml" terlalu besar untuk disimpan (maksimal 9.999.999.999)`** |
  | PASANGAN qty 50 | **201** |

- **Tindak**: `pastikanMuat` di tempat angkanya lahir
  (`produksi/konsumsi.ts`, + `inputNama` di select) · entri `PUTUSAN`
  diperbarui **dengan ralatnya ditulis di tempat** · pin baru di
  `luapan-turunan.test.ts` (bukti merah mendarat) · verify-api **§247**
  (5 asersi, fikstur dibuat lewat API di seksinya sendiri)
- **Sapuan sisa**: perkalian → kolom numeric di luar penjualan tinggal
  **satu** situs lain (`open-bill:403 lineTotal`) — DTO bon **cetak**, tidak
  disimpan (`open_bill_items` tak punya kolom `line_total`); bukan kandidat
  luapan simpan
- **Batas**: penjaga bernama kini di penjualan + konsumsi produksi; jalur
  masukan-langsung lain tetap dilindungi lapis pertama saja — dan itu memadai
  selama masukannya `.max()` presisi-kolom (vena #38)
- Gerbang: typecheck bersih · `npm test` **2.208** · `verify-api` **2.918**
  terhadap Postgres segar · `audit:invarian` 26/26 · cakupan 271 identik

---

## 73 kunci "belum dibaca" dipilah: lima hilang, 68 beralasan — mobile — 2026-08-24

- **Kenapa**: daftar ratchet gerbang kunci-kontrak (**73** kunci) belum pernah
  **dipilah** — sengaja vs hilang; kelas `durasi_detik` yang dulu ketemu tak
  sengaja
- **Hasil**: **LIMA "hilang"** (layar ponselnya sudah ada, kuncinya dibuang),
  diimplementasi + ditampilkan:

  | kunci | layar |
  |---|---|
  | `pesanan_durasi_detik` + `pesanan_selesai_pada` | chip ⏱ di Riwayat Transaksi (formatDurasi yang ada; null tetap null) |
  | `penjualan_tunai_shift` | stat "Tunai shift" di kartu pantau — payload sungguhan membuktikan dua jendelanya beda & `kas_sistem = modal + tunai SHIFT` |
  | `lots_terpotong` | baris "menampilkan 300 dari 30.018" di Riwayat Harga |
  | `faktur_ids` | tanda "barang tidak sampai" di kartu faktur Pengadaan — himpunan populasi penuh, BUKAN diturunkan dari rows (pelajaran vena #36) |

  **68 sisanya beralasan per kelompok** (panel super admin — ponsel tak punya
  perannya; manajemen menu tetap web per keputusan #34; impor CSV; penugasan
  tempat SO) — pembaca snapshot kini melewati `#` supaya alasannya hidup di
  berkas
- **Detektor**: `kunci_baru_terbaca_test.dart` — tiap kunci diasersi payload
  utuh **vs** payload dicabut, wajib berbeda; payload dari server sungguhan
  (durasi 480 menggantikan 0 asli SUPAYA bisa dibedakan dari bentuk diam, dan
  itu ditulis). Bukti merah mendarat: parse dicabut → dua uji merah
- **Kesalahanku tercatat**: anchor `required this.rows` cocok di kelas LAIN
  lebih dulu — `fakturIds` sempat terpasang di kelas yang salah; `flutter
  analyze` menangkapnya sebelum satu uji pun jalan
- **Batas**: "ditampilkan" = satu titik render per kunci; kualitas UX-nya
  bukan urusan gerbang ini. 68 yang beralasan tetap ratchet — kunci baru tanpa
  keputusan tetap merah
- Gerbang: `flutter analyze` bersih · `flutter test` **517** (3.44.7) ·
  commit `e677737` di PR #12

---

## Arah GANTI-NAMA: 500 di alur harian, telanjang di sebelah saudaranya — server — 2026-08-24

- **Kenapa**: entri klik-ganda menulis *"balapan ganti-nama … berpenjaga
  `tanpaBentrok` per situs"* — keyakinan yang **belum pernah disapu**: vena
  sebelumnya hanya menghitung `.insert()`; arah `.update()` tak pernah dihitung
- **Populasi**: **37** situs `.update()` ke tabel unik · **9** tertuduh jendela
  · dipilah tangan: **7 tuduhan palsu** (medan struk, deaktivasi, backfill
  ber-uniquifier, memberships menulis role/arsip) · **1 telanjang** — persis
  tanda tangan sesi ini, **di berkas yang sama**: `POST /menu` dijaga
  `onConflictDoNothing`+409; `PUT /menu/:id` **80 baris di bawahnya** menulis
  `nama` tanpa apa pun
- **Terukur lewat HTTP — TAK BUTUH BALAPAN**:

  | | sebelum | sesudah |
  |---|---|---|
  | ganti nama menu B → nama menu A (**berurutan**) | **HTTP 500** | **409** `Menu "…" sudah ada` |
  | ganti-nama sah | 200 | 200 |
  | 4 ganti-nama serentak ke SATU nama | — | `200 200 409 409`, nol 5xx, **tepat satu** pemegang nama |

  Alur manajemen menu harian, bukan kasus tepi
- **Kembaran** `PUT /customer/:id` (WA): berurutan dijaga pra-cek (409 menyebut
  pemiliknya), jeda pra-cek→tulis kini juga dibungkus `tanpaBentrok`
- **Detektor**: DIBUKTIKAN — pembungkus dicabut (di-assert) → 500 terukur
  kembali; dikembalikan → 409
- **Tindak**: `tanpaBentrok` di kedua pintu · verify-api **§246** (8 asersi)
- **Batas**: yang dipaku dua pintu yang terukur; 28 situs `.update()` lain
  dinyatakan aman lewat pilahan baca (kolom non-unik / uniquifier / penjaga
  per situs), bukan lewat tembakan. Dan **dua kali** kubaca "cakupan BEDA
  271→0" yang ternyata **cwd-ku sendiri salah** (stderr tertelan `/dev/null`)
  — regenerasi dari cwd benar: identik
- Gerbang: typecheck bersih · `npm test` **2.207** · `verify-api` **2.913**
  terhadap Postgres segar · `audit:invarian` 26/26 · cakupan 271 identik

---

## ANTREAN KELIMA — usulan dari celah yang tercatat di ledger — 2026-08-24

Antrean keempat tuntas. Yang di bawah **diukur baca-saja hari ini**; tiap
usulan menunjuk baris "Batas" yang melahirkannya.

### Usulan A′ — arah GANTI-NAMA tak pernah disapu

**Sumbernya**: entri klik-ganda menulis — *"balapan ganti-nama tak ikut dipaku
— berpenjaga `tanpaBentrok` per situs."* Kalimat "berpenjaga per situs" itu
**keyakinan yang belum pernah disapu**: vena A hanya menghitung `.insert()`;
arah `.update()` belum pernah dihitung sekali pun.

**Diukur**: **37** situs `.update()` ke tabel berindeks unik, **9** menulis
kolom uniknya tanpa penjaga di jendela. Dipilah sebagian: dua tuduhan palsu
jendela, satu **terkonfirmasi telanjang — dan bentuknya persis tanda tangan
sesi ini, di berkas yang sama**: `POST /menu` (`menu/routes.ts:553`) dijaga
`onConflictDoNothing` + 409 "Menu sudah ada"; `PUT /menu/:id` (`:651`),
delapan puluh baris di bawahnya, menulis `nama` **tanpa apa pun** dengan
`menus_company_nama_uq` menunggu. Dan ini **tak butuh balapan**: ganti nama
menu B menjadi nama menu A — dua permintaan berurutan, alur manajemen harian —
diperkirakan 23505 mentah → 500 → overlay "server sedang diperbarui".
Kandidat lain untuk dipilah: `menu:424`, `menu/service.ts:335`,
`bahan/kode.ts:92`, `users:684` & `onboarding:252` (memberships.kode).
Bentuk kerja: pilah 9, ukur HTTP (berurutan dulu, baru serentak), perbaiki
dengan `tanpaBentrok`, §246 + bukti merah seperti §245.

### Usulan B′ — 73 kunci kontrak yang tercatat belum dibaca Dart: dipilah

Gerbang kunci-kontrak mengukur 463 kunci, 390 disentuh, **73 tercatat belum**.
Yang belum pernah terjadi: ke-73 itu dipilah jadi "sengaja tidak" (beralasan)
vs "hilang" (kelas `durasi_detik` yang dulu ketemu tak sengaja). Kerja mobile;
tiap yang "hilang" diurai + bukti merah mekanis, fikstur server sungguhan.

### Usulan C′ — `pastikanMuat` bernama untuk jalur non-penjualan

Batas #39, dua kali ditulis: jalur non-penjualan hanya dilindungi lapis
pertama — 400 terbaca, tanpa sebutan medan. Ukur dulu lewat HTTP pintu mana
yang bisa meluap dari masukan sah (`harga_per_unit × qty`, RAB per tahap),
baru pasang penjaga bernama di yang terukur.

### Usulan D′ — granularitas `penjaga-semua-pintu`: badan → pernyataan

Batas yang tetap tertulis, plus **20 pintu tekstual** bentrok-unik yang belum
pernah di-adjudikasi. Peringkat terakhir dengan sengaja: sapuan berjendela
sudah menuduh salah 14 kali di vena A — kelas ini paling rawan tuduhan palsu,
dan separuh nilainya sudah dibayar A′.

### Diperiksa dan TIDAK diusulkan

Tiga pintu host super admin (batas permanen beralasan) · antrean kolam
(terukur pulih sendiri, tuning tanpa bug) · tumpukan `BELUM_TAYANG` (menunggu
rilis ponsel, bukan kerja kode).

**Rekomendasi: A′ → B′ → C′ → D′.**

---

## Pintu detail ber-`:param` pada volume per-entitas — server — 2026-08-24

- **Kenapa**: batas tertulis dua entri — rute ber-`:param` tak ikut
  `ukur-latensi.sh`, dan jejaknya hanya pada volume seed; kelas inilah tempat
  balasan 2,97 MB `/customer/:id` dulu ditemukan
- **Metode**: volume ditempelkan pada SATU entitas per pintu (30.000 transaksi
  satu member · 30.000 lot satu bahan · 30.000 mutasi satu perlengkapan), dan
  tiap suntikan **dibuktikan terbaca lewat rutenya sendiri** (aturan 6):
  `jumlah_transaksi` 30.000 · `jumlah_pembelian` 30.018 · `terpotong: true`
- **Hasil — BERSIH dengan angka**:

  | pintu | terukur |
  |---|---|
  | `/customer/:id` | **0,024 dtk · 39 KB** |
  | `/bahan/:id/pembelian` | 0,077 dtk · 56 KB — `jumlah_pembelian` tetap **30.018** (hitungan populasi SQL, bukan larik terpotong) |
  | `/stok/kartu/:ingredientId` | 0,039 dtk · 54 KB — `terpotong: true` |
  | `/perlengkapan/:id/kartu` | 0,018 dtk · 111 KB |
  | `/perlengkapan/:id/pembelian` | 0,056 dtk · 56 KB |

  Langit-langit vena #15/#16 **memegang di dimensi per-id**
- **Aturan 6 menangkap pengukuranku sendiri**: tembakan pertama ke
  `/bahan/:id/kartu` memulangkan 0,004 dtk / **27 byte** — itu **404** (rute
  yang benar `/stok/kartu/:ingredientId`). Angka tercepat yang pernah kuukur
  adalah angka pintu yang salah alamat
- **Tindak**: blok "PINTU DETAIL" permanen di `ukur-latensi.sh` — id dipungut
  lewat API, melewati diri dengan pesan bila entitas tak ada, angka acuan
  tertanam. Gerbang: `npm test` 2.202

---

## Balapan dua boot `provisionGuest` — server — 2026-08-24

- **Kenapa**: utang yang ditulis `penjaga-semua-pintu` sendiri — satu
  `onConflictDoUpdate` di awal badan menutupi insert `companies` yang tak
  berpenjaga; *"badan yang panjang adalah titik butanya"*
- **Diukur** (dua `provisionGuest` dilepas `Promise.all` pada DB tanpa demo;
  demo mustahil di-`DELETE` — FK NO ACTION `sale_consumptions`, konsisten
  audit ON DELETE, jadi jalannya `TRUNCATE` pada DB buangan):

  | | boot 1 | boot 2 |
  |---|---|---|
  | SEBELUM | selesai (true) | **melempar `Failed query: insert into "companies" …` mentah** |
  | SESUDAH | true | **false** — jalur kalah idempoten |

  Ronde kedua false/false; 1 perusahaan; keanggotaan utuh. Yang kalah dulu
  selamat **hanya karena catch pembungkus** di `index.ts` — aman-karena-catch
  adalah aman yang bisa hilang tanpa ada yang sadar
- **Tindak**: `onConflictDoNothing` pada insert perusahaan (gerbang balapan) +
  jalur kalah yang memastikan keanggotaannya sendiri → `false`. Gerbang
  `provisi-tamu-balapan.test.ts` (2 uji source-pin; bukti merah mendarat).
  Prosa `penjaga-semua-pintu` diperbarui: utang tercatat DIBAYAR, granularitas
  badan tetap batas
- **Batas**: pin-nya struktur, bukan balapan hidup (butuh Postgres+TRUNCATE —
  terlalu mahal untuk suite unit; pengukurannya yang jadi buktinya). `branches`
  & `storageLocations` terkurung transaksi yang gerbangnya insert perusahaan
- Gerbang: typecheck bersih · `npm test` **2.207** · `verify-api` **2.905**
  terhadap Postgres segar · `audit:invarian` 26/26 · cakupan **271 identik**

---

## Rekaman cakupan diukur ulang tiap CI — server — 2026-08-24

- **Kenapa vena ini ada**: gerbang cakupan menulis batasnya sendiri —
  *"`rute-diketuk.txt` adalah REKAMAN, bukan pengukuran ulang."* Terukur:
  `ci.yml` **sudah** menjalankan verify-api tiap push, **tanpa** `JEJAK_RUTE` —
  98,9 % itu diukur sekali di satu mesin lalu dipercaya
- **Tindak**: dua perubahan kecil di `ci.yml` — `JEJAK_RUTE` dinyalakan pada
  langkah verify-api, dan langkah baru men-diff jejak run itu terhadap
  rekamannya: rute yang **berhenti** diketuk maupun rute **baru** membuat CI
  merah menyebut barisnya + perintah pembaruan sadar
- **Diverifikasi pada kenyataan, bukan niat**: jejak verify-api penuh (run
  §245, 2.905 asersi) → **271 rute, IDENTIK** dengan rekaman; simulasi merah
  (satu baris dicabut) → diff menyebut barisnya
- **Aturan 7**: `cakupan-rute.test.ts` dapat jangkar untuk langkah CI-nya
  sendiri (`JEJAK_RUTE=`, `cakupan-rute.ts`, `diff -u …`). **Suntikan bukti
  merah PERTAMAKU GAGAL MENDARAT** — frasa "Cakupan rute" juga hidup di
  komentar langkah server, jadi cek keberadaannya harus pada baris `- name:` —
  dan yang menangkapnya assert pendaratan itu sendiri, persis alasan aturannya
  ada
- **Batas**: pembandingnya menuntut kesamaan PERSIS, jadi verify-api yang
  nondeterministik (seksi yang kadang melewati diri) akan membuat CI merah
  palsu — hari ini nol seksi begitu pada dua run berturut (271 = 271), dan
  bila kelak ada, pesan gagalnya menunjuk barisnya
- Gerbang: typecheck bersih · `npm test` **2.202** · YAML tervalidasi

---

## Bentrok unik di bawah klik ganda SERENTAK — server — 2026-08-24

- **Kenapa vena ini ada**: `penjaga-semua-pintu` menulis utangnya sendiri —
  *"32 tabel berindeks unik… menyapu semuanya memunculkan 20 pintu terbuka…
  sisanya utang yang diukur."* Kelasnya sudah menggigit: 23505 mentah = 500,
  overlay "server sedang diperbarui", pemicunya satu klik ganda
- **Populasi**: **71** situs `.insert()` ke **32** tabel unik; **8** pintu
  buat-dengan-nama diukur perilakunya; **50** penjualan dilepas satu tick
- **Hasil: BERSIH secara perilaku — dan tiga lapis kesalahanku tercatat**:
  1. sapuanku menuduh **22**, EMPAT BELAS cacat jendelaku sendiri (`rfind` −1
     di kepala berkas → konteks kosong → `onConflict` tiga baris di bawah tak
     terlihat) → **8**, dan kedelapannya dipilah tangan **semuanya terjaga**:
     `auto_uq` indeks **parsial** (`WHERE tipe='auto'`; kelima insert bertipe
     lain), `supplySuppliers` dikunci `FOR UPDATE` induk (jendelaku tak kenal
     bentuk drizzle `.for("update")`), `menuComponents` dedup `Map`;
  2. **kandidat teratas usulanku GUGUR OLEH PENGUKURAN**: kutulis
     "`sales.nomor` baca-maks+1 TANPA kunci" — salah; baris PERTAMA transaksi
     `createSale` adalah `FOR UPDATE` baris cabang, seratus baris di atas
     komentar `FOR SHARE` yang kubaca. Terukur: 5 ronde × 10 penjualan dilepas
     **satu tick** (Promise.all) → **50× 201**;
  3. sasaran bukti merah pertamaku salah: mencabut `tanpaBentrok` dari
     `POST /supplier` tetap `{201, 409×3}` — penjaga pintu BUAT-nya
     `onConflictDoNothing` di insert; wrapper itu milik PATCH rename
- **Terukur, pelepasan serentak sungguhan, 8 pintu**: supplier · kategori ·
  satuan · customer(WA) · meja · cabang · penyimpanan · kategori-bahan →
  semuanya `{201:1, 409:3}`, **nol 5xx**
- **Detektor**: DIBUKTIKAN — `onConflictDoNothing` dicabut (suntikan
  di-assert) → **201 500 500 500**; dikembalikan → `409 409 409 409`
- **Yang belum pernah ada sampai putaran ini**: satu pun uji yang menembakkan
  duplikat **serentak** — semua asersi 409 menembak berurutan, jadi jalur
  balapan (23505 dari indeks, bukan pra-cek) tak pernah dilewati. **§245**
  (15 asersi) memakukannya: 4 curl paralel per pintu, nol 5xx, tepat satu 201,
  yang kalah dibalas kalimat
- **Batas**: 8 pintu yang dipaku adalah kelas buat-dengan-nama; balapan
  ganti-nama (PATCH bertabrakan) dan tabel token/idempotensi tak ikut dipaku —
  yang pertama berpenjaga `tanpaBentrok` per situs, yang kedua justru
  MENGANDALKAN 23505 sebagai mekanisme (menerjemahkannya akan merusak makna).
  `POST /cabang` membalas 400×4 di probe (validasi tipe/kuota) — pintunya tak
  sampai ke insert, dicatat bukan diabaikan
- **Tindak**: verify-api §245. Angka "20 pintu terbuka" di kepala
  `penjaga-semua-pintu` adalah sapuan TEKSTUAL aturan itu; kebenaran
  perilakunya hari ini nol pintu. Gerbang: typecheck bersih · `npm test`
  **2.201** · `verify-api` **2.905** terhadap Postgres segar

---

## ANTREAN KEEMPAT — usulan dari celah yang ditulis ledger sendiri — 2026-08-24

Antrean 1→3→2→4 tuntas. Yang di bawah **diukur baca-saja hari ini**, bukan
didaftar dari ingatan; tiap usulan menunjuk baris "Batas" ledger yang
melahirkannya.

### Usulan A — bentrok unik yang tak diterjemahkan: utang yang gerbangnya sendiri tulis

**Sumbernya**: `penjaga-semua-pintu.test.ts` menulis di kepalanya sendiri —
*"ada **32 tabel berindeks unik** di skema ini, dan menyapu semuanya
memunculkan **20 pintu terbuka**. Yang didaftarkan hanya kelas yang sudah
terbukti menyakiti… Sisanya **utang yang diukur**, bukan wilayah yang
dinyatakan bersih."* Kelasnya sudah menggigit: yang kalah balapan menerima
23505 mentah alias **500**, dan di web itu memicu overlay "server sedang
diperbarui". Pemicunya *"cukup SATU KLIK GANDA"*.

**Populasi diukur ulang hari ini**: **71** situs `.insert()` ke tabel-tabel
unik itu. Sapuanku sendiri salah dua generasi — versi pertama menuduh **22**,
dan **14 di antaranya cacat jendelaku sendiri** (`rfind` yang memulangkan −1
untuk situs di kepala berkas memotong konteksnya jadi kosong, jadi
`onConflictDoNothing` tiga baris di bawahnya tak terlihat). Sesudah diperbaiki:
**8** situs tanpa penjaga di jendelanya, dan dua yang kupilah tangan **sudah
bersih** (`menuComponents` — dedup `Map` sebelum insert; itu bukan kata kunci
penjaga, tapi ia penjaga).

**Kandidat hidup yang paling mahal**: `penjualan/service.ts` menyusun
`sales.nomor` lewat **baca-maks+1 tanpa kunci** (`orderBy desc limit 1` → +1),
dengan `sales_branch_nomor_uq` menunggu di ujungnya. `FOR SHARE` di baris
shift adalah kunci BERBAGI — dua penjualan serentak sama-sama memegangnya
tanpa saling menunggu. 50 penjualan serentak di putaran konkurensi lolos
semua, tapi curl yang di-spawn berurutan praktis terserialisasi; balapan
sesungguhnya butuh pelepasan serentak. **Kalau terukur: 500 di layar
pembayaran saat dua kasir menagih pada detik yang sama** — pintu paling mahal
di produk ini. Kandidat lain: `supplyMutations` ×5 (indeks `auto_uq`),
`supplySuppliers:945`.

**Bentuk kerjanya**: pilah tangan ke-8 (+ sapu bentuk `update` juga), ukur
balapan lewat HTTP dengan pelepasan serentak sungguhan, lalu putuskan per
kelas: `onConflict`/`tanpaBentrok` di situsnya, atau — sekarang pintu ini ada —
`23505` masuk `galatDataKlien`. Yang terakhir TIDAK otomatis benar:
`sync_commands_company_ref_uq` adalah **idempotensi**, dan menerjemahkannya
jadi 409 "sudah ada" akan mengubah makna balasan /sync. Tiap indeks diputuskan,
bukan disamaratakan.

### Usulan B — rekaman cakupan yang bisa membusuk diam-diam

**Sumbernya**: gerbang cakupan menulis batasnya — *"`rute-diketuk.txt` adalah
REKAMAN, bukan pengukuran ulang. Bila suatu saat sebuah rute berhenti diketuk
tanpa berkasnya diperbarui, gerbangnya tetap hijau."*

**Terukur hari ini**: `ci.yml` **sudah** menjalankan verify-api terhadap
Postgres segar tiap push — tapi **tanpa `JEJAK_RUTE`**, jadi 98,9% itu diukur
sekali di mesinku dan sesudahnya cuma dipercaya. Bentuk kerjanya kecil dan
struktural: nyalakan `JEJAK_RUTE` di langkah verify-api CI, tambah langkah
pembanding (`cakupan-rute.ts` sudah ada) yang gagal bila rekaman ≠ kenyataan.
Rekaman jadi pengukuran ulang **setiap CI jalan**, dan §244 tak bisa dicabut
diam-diam.

### Usulan C — 1.261 permintaan ber-`:param` di jejak, tak satu pun diukur pada volume

**Sumbernya**: dua entri — *"rute ber-`:param` tak ikut diukur `ukur-latensi.sh`
(butuh id yang sah); latensinya hanya terlihat lewat jejak saat verify-api
berjalan, **pada volume seed**"*. Detail per-id (`/customer/:id` dengan ribuan
transaksi, `/bahan/:id/kartu` dengan puluhan ribu mutasi) adalah kelas
`GET /customer/:id` 2,97 MB dulu. Bentuk kerjanya: pungut id sungguhan lewat
API, ukur N rute detail terpanas pada 200 rb transaksi dengan mesin yang sudah
ada.

### Usulan D — badan panjang `penjaga-semua-pintu`: penjaga satu insert memaafkan tiga insert di bawahnya

**Sumbernya**: gerbang itu menulis — *"satu penjaga di mana pun dalam satu
badan membuat SELURUH tulisan di badan itu lolos. `provisionGuest` adalah
contoh nyatanya: `onConflictDoUpdate` di insert `users` paling atas menutupi
insert `companies`, `branches`, `storageLocations` di bawahnya yang tak
berpenjaga sama sekali."* Keterjangkauannya rendah (boot + cek "sudah ada"),
jadi peringkatnya terakhir — tapi granularitas badan itu juga yang membuat
sapuan A perlu jendela per-PERNYATAAN, dan keduanya bisa dibayar sekali.

### Diperiksa dan TIDAK diusulkan

- **Cabang `revoked` undangan** — jalur sidestep kuota lewat XFF hanya hidup
  bila `TRUST_PROXY_HOPS > 0`; CI tak menyetelnya. Menembaknya berarti
  menaikkan kuota register untuk uji — biaya kontrak demi satu cabang kecil.
- **`sales.nomor` di 50-serentak putaran lalu** — TIDAK dihitung bukti aman:
  spawn berurutan ≈ serialisasi. Justru masuk usulan A sebagai kandidat utama.
- **Fikstur uang "tiga fungsi, bukan seluruh aritmetika"** — sisa rumusnya
  sudah tersapu vena #26 (34 render dihitung, 0 selisih); tak ada populasi
  baru.

**Rekomendasi: A dulu** — satu-satunya yang kelasnya sudah terbukti menggigit
(empat 500 sebelumnya), utangnya ditulis gerbangnya sendiri, dan kandidat
teratasnya duduk di jalur pembayaran. Lalu **B** (kecil, menutup batas tertulis
gerbang cakupan), **C**, **D**.

---

## Kunci kontrak ↔ Dart: sapuan sekali-jalan jadi gerbang berdiri — server+mobile — 2026-08-24

- **Kenapa vena ini ada**: `durasi_detik` dikirim server berbulan-bulan dan
  dibaca ponsel NOL kali — dan yang menemukannya **sapuan sekali jalan**, bukan
  gerbang. Sesudah sapuan itu selesai, tak ada apa pun yang menagih kunci
  kontrak berikutnya
- **Populasi** (diukur, pembangkitnya `acuan-kunci-mobile.ts`):

  | ukuran | angka |
  |---|---|
  | baris `Interface\|kunci` dari `types.ts` | **1.127** |
  | kunci unik | **463** |
  | disentuh Dart (baca `['k']` maupun tulis `{'k': v}`) | **390** |
  | tercatat BELUM, dengan nama | **73** |

- **Bentuknya pola cermin yang sudah terbukti dua kali** (`acuan-status-mobile`,
  `acuan-uang-mobile`): pembangkit di server → fikstur di repo mobile → uji
  cermin Dart menagih tiap kunci **diputuskan** — dibaca, atau tercatat di
  `kunci-belum-dibaca.txt`. Ratchet-nya MENYUSUT dua arah: kunci yang mulai
  dibaca wajib dihapus dari catatan (uji merah menyebutnya), kunci yang hilang
  dari kontrak juga
- **Sentinel historis**: kelima kunci vena #30/#34 (`durasi_detik`,
  `masuk_pada`, `lewat_target`, `target_detik`, `bertarget`) diasersi tetap
  disentuh — lenyapnya salah satu adalah persis regresi bug aslinya
- **Detektor**: bukti merah DUA lapis di mobile (kunci karangan → merah
  bernama; kunci terbaca yang dicatat "belum" → ratchet merah) + pasangan
  sintetis di server. **Dua kali detektorku sendiri salah saat membangunnya**:
  (1) regex pembangkit buta terhadap `export type X = {` — di `types.ts` hari
  ini kebetulan nol (139 kontrak semuanya interface), tapi kontrak pertama
  berbentuk type-alias akan lenyap tanpa suara; ketahuan oleh uji pasangan
  sintetis; (2) masukan sintetisku sendiri dirakit `replace` satu-baris
  sehingga medan keduanya tak pernah berpindah baris — ujinya menuduh
  pembangkit yang benar
- **Batas, ditulis di kedua berkasnya**: "disentuh" ≠ "diurai benar" — literal
  yang kebetulan sama ikut memuaskan sapuan; yang menjaga arah "diurai benar"
  uji parser per fitur. Fikstur diperbarui manual; kesegarannya dijaga
  `kunci-satu-kontrak.test.ts` hanya di mesin yang memuat kedua repo (CI
  masing-masing repo tak saling checkout), dan itu disebut apa adanya
- **Tindak**: `acuan-kunci-mobile.ts` + npm script · `kunci-satu-kontrak.test.ts`
  (4 uji, server) · `kunci_kontrak_server_test.dart` (5 uji, mobile) + dua
  fikstur. Gerbang: typecheck bersih · `npm test` **2.199** · `flutter analyze`
  bersih · `flutter test` **512** (3.44.7)

---

## `22001` dan jalur non-penjualan luapan turunan — server — 2026-08-24

- **Kenapa vena ini ada**: dua celah yang kutulis sendiri sebagai batas vena
  luapan-turunan — `22001` ditahan karena *"keterjangkauannya belum kuukur"*,
  dan jalur non-penjualan hanya dilindungi lapis pertama
- **Hasil 1 — `22001` terukur MUSTAHIL**: `schema.ts` punya **NOL** kolom
  `varchar(n)`/`char(n)` — seluruh **127** kolom teks bertipe `text` yang tak
  berbatas panjang dan tak pernah melempar 22001 — dan **NOL** cast
  `::varchar` di SQL mentah. Menerjemahkannya berarti mengubah 500 jadi 400
  untuk jalur yang TIDAK ADA. Keputusannya **dipaku**: `galatDataKlien` tetap
  `null` untuk 22001, dan kolom varchar PERTAMA yang lahir membuat paku merah
  dan menagih pengukuran ulang. Bukti merah mendarat (varchar suntikan →
  tertuduh → dicabut)
- **Hasil 2 — jalur non-penjualan diukur lewat HTTP**: bahan produksi
  bertakaran resep 99.999.999 diproduksi qty 1.000 → konsumsi **1e11** atas
  `production_consumptions.qty` `numeric(16,6)` (maks 9,99e9):

  | permintaan | balasan |
  |---|---|
  | `POST /produksi` qty=1.000 | **400** "Angkanya terlalu besar untuk disimpan" |
  | `POST /produksi` qty=1.000.000 | **400**, bukan 500 |

  Kelas 5xx-nya tertutup pintu keluar bersama. Yang tersisa **hanya ketiadaan
  nama medan**, dan itu batas yang dipilih sadar: `pastikanMuat` bernama milik
  jalur penjualan, tempat kasir berdiri di depan tamu
- **Tindak**: `luapan-turunan.test.ts` 5 → **7** uji (paku 22001 + pin
  pengukuran non-penjualan). Tak ada kode server tersentuh. Gerbang: typecheck
  bersih · `npm test` **2.201**

---

## Latensi di bawah KONKURENSI — server — 2026-08-24

- **Kenapa vena ini ada**: pengukuran cakupan menilai VOLUME (200.101
  transaksi, satu permintaan pada satu waktu) dan menulis batasnya sendiri —
  *"jalur tulis diukur … tapi tidak di bawah konkurensi — kelas yang justru
  melahirkan vena #12"* (`GET /menu` 0,009 → **20,07 dtk** saat
  `PUT /menu/urutan` berjalan)
- **Populasi**: enam keadaan konkurensi atas kolam **10 koneksi** (pg.Pool
  bawaan), pada **200.101 transaksi** yang **dibuktikan terbaca API** lewat
  `jumlah_transaksi` balasan rutenya (aturan 6)
- **Hasil — BERSIH, dengan bacaan yang ditulis**:

  | keadaan | terukur |
  |---|---|
  | dasar | `GET /menu` 0,013 · `POST /penjualan` 0,018 dtk |
  | 10 laporan serentak | `GET /menu` **0,160** · `POST /penjualan` 0,165 (201) |
  | 10 penjualan serentak | `GET /menu` 0,015 · penjualan ke-11 **0,085** (201) |
  | **5 `PUT /menu/urutan` serentak** | `GET /menu` **0,018 dtk** — kelas #12, dulu **20,07** |
  | 30 laporan (3× kolam) | p50 **1,631** · maks 1,930 · `GET /menu` **0,675** dtk |
  | 50 penjualan serentak | p50 0,395 · p95 **0,656** · maks 0,677 · **50× 201** |

  Penurunan di bawah beban adalah **antrean kolam** — linier terhadap kedalaman
  antrean, pulih sendiri, **tanpa 5xx**, tanpa kelaparan tak berbatas. Baris
  keempat yang terpenting: perbaikan vena #12 **memegang di bawah beban yang
  sama yang dulu membunuhnya**, dan sekarang ada angkanya
- **Bacaan atas 30-serentak, supaya tak dibaca lebih buruk dari faktanya**:
  `/laporan` **sengaja** tak berbatas laju — vena "batas laju di luar email"
  mengukurnya murah (0,225 dtk @ 200 rb) dan memutuskan begitu. Yang
  membatasinya kolam itu sendiri: 30 permintaan serentak menaikkan bacaan lain
  ke 0,675 dtk lalu pulih. p50 1,63 dtk ≈ 2,4× hitungan antrean murni
  (0,225 × 3 gelombang) — sisanya kontensi CPU serialisasi JSON, bukan kueri
- **Tindak**: blok KONTENSI KOLAM di `scripts/ukur-latensi.sh` dipermanenkan
  mengukur jalur TULIS juga (10 penjualan serentak + baca & tulis di
  tengahnya), angka acuan tertanam sebagai komentar, dan blok tulisnya
  **melewatkan diri dengan pesan jujur** bila token kasir/menu tak tersedia —
  bukan diam. Tak ada kode server tersentuh; `verify-api` tak dijalankan ulang
  untuk commit ini dan itu disebutkan. Gerbang: `npm test` **2.195**
- **Batas**: mesin CI satu kotak — klien dan server berbagi CPU, jadi angka
  serentaknya konservatif (kontensi klien ikut terhitung); konkurensinya
  sebatas 50 (kasir sungguhan per tenant jauh di bawah itu); dan `FOR UPDATE`
  meja/advisory lock tak diukur terpisah — jalurnya sudah dijaga uji perilaku
  (`§161`, `bill-dikunci-saat-dibayar`), yang belum ada angka latensinya

---

## Lima belas pintu yang tak pernah diketuk — server — 2026-08-24

- **Kenapa vena ini ada**: gerbang cakupan putaran lalu mengukur 274 rute
  konkret, 256 diketuk, dan menuliskan **15 pintu sebagai UTANG YANG DIUKUR** —
  empat `DELETE` dan sembilan jalur tulis lain yang bisa 500 sejak berbulan-bulan
  tanpa satu uji berubah warna
- **Populasi**: **15** pintu utang + 3 di luar jangkauan, dari **274**
- **Metode**: §244 di `verify-api.sh` (**41 asersi**) mengetuk kelima belasnya
  lewat HTTP sungguhan memakai fikstur yang sudah hidup di aliran skrip — tiap
  ketukan memeriksa status + satu fakta dari badannya + pasangan
  anti-hijau-palsu (404 untuk id asing, penolakan peran, idempotensi)
- **Hasil**:

  | | sebelum | sesudah |
  |---|---|---|
  | rute diketuk | **256** (93,4 %) | **271** (**98,9 %**) |
  | jalur TULIS diketuk | 155/168 | **165/168** |
  | UTANG | **15** | **0** |

  **Tak satu pun pintu membalas 5xx** — venanya bersih secara perilaku, diukur
  bukan diduga. Tiga yang tersisa memang di luar jangkauan: migrasi sungguhan,
  email sungguhan, retensi cadangan mesin
- **Dua dari lima belas ternyata PINTU HANTU — ralat atas penyebut cakupanku
  sendiri**: `buatRuteTambahStok` dipasang di dua prefiks dan dua handler-nya
  menolak separuh dirinya di baris pertama (`kirim-hasil`: `tipe !==
  "produksi"` → mount `/pembelian` **selalu 404**; `dampak`: `tipe !== "beli"`
  → mount `/produksi` **selalu 400**). Bukan utang melainkan **artefak
  pabrik**. Kini terdaftar `HANTU_PABRIK` dengan sebab strukturalnya, diuji
  **tetap mustahil** lewat HTTP, dan source-pin menahan penjaga `tipe`-nya —
  hantu yang tiba-tiba berhasil berarti mengirim hasil produksi lewat pintu
  belanja
- **Kandidat perilaku diukur lalu DITOLAK, dengan alasannya**:
  `setujui-massal` tak punya syarat `selisih ≠ 0` yang pintu tunggalnya punya —
  tapi baris nol-selisih lahir berstatus `disetujui`, jadi predikat `menunggu`
  tak pernah memungutnya. **Aman karena konjungsi lain**; yang diasersi
  perilakunya (idempoten — panggilan kedua menyetujui **NOL**)
- **Dua kesalahanku saat menulis §244, keduanya tertangkap alat yang ada**:
  1. pintu hantu kutembak `{"items":[]}` dan dapat 400 — `zValidator` berjalan
     **sebelum** handler, jadi cabang `tipe` tak pernah tercapai. Badannya
     harus sah dulu supaya hantunya benar-benar teruji;
  2. pasangan kasir kupakai `$KASIR` yang mati sejak §105 → 401 alih-alih 403.
     Yang menemukannya `verify-api-token.test.ts` — penjaga yang dipasang untuk
     kesalahan persis ini, bekerja persis seperti niatnya
- **Detektor**: bukti merah mendarat — satu baris dicabut dari
  `rute-diketuk.txt` (suntikan di-assert) → dua uji merah menyebut
  `PATCH /api/satuan/:id`. Ratchet diperketat: `UTANG` maks **0**, jalur tulis
  diketuk ≥ **165**
- **Batas**: "diketuk" tetap bukan "diuji" — tiap pintu dilewati sekali dengan
  badan sah; cabang-cabang dalamnya tidak disapu. Cabang `revoked` di
  `undangan/:id/tolak` tak tertembak (butuh akun terdaftar baru; kuota register
  20/jam sudah terpakai ~18 oleh skrip) — yang ditembak cabang penjaganya
  (404 untuk undangan orang lain + pending tetap utuh)
- **Tindak**: §244 (41 asersi) · `rute-diketuk.txt` 256 → 271 · gerbang
  `cakupan-rute.test.ts` 5 → 6 uji (+`HANTU_PABRIK` + source-pin). Gerbang:
  typecheck bersih · `npm test` **2.195** · `verify-api` **2.890** terhadap
  Postgres segar · `audit:invarian` 26/26

---

## Kunci JSON ponsel yang dibaca lewat VARIABEL — mobile — 2026-08-24

- **Kenapa vena ini ada**: ledger vena "medan yang tak diurai" menulis batasnya
  — *"regex `x['kunci']` tak melihat kunci yang lewat variabel (`j[k]`) maupun
  kunci pada badan PERMINTAAN."* Separuhnya sudah tertutup: usulan #5 membuat
  **112 dari 114** badan permintaan menolak kunci tak dikenal, jadi kunci yang
  salah nama berbunyi 400 alih-alih hilang. Yang tersisa arah BACA
- **Populasi** (disapu **tanpa komentar** — lihat di bawah):

  | ukuran | angka |
  |---|---|
  | akses kunci LITERAL `x['kunci']` di `kakarut-mobile/lib` | **1.213** |
  | akses lewat **variabel** `x[k]` (di luar indeks gelung) | **32** |
  | di antaranya membaca **payload JSON server** | **1** |

- **Sapuan pertamaku salah, dan salahnya dua macam sekaligus**: ia melaporkan
  **187** situs. Sesudah komentar dikupas dan indeks gelung (`list[i]`,
  `rows[i]`) dikeluarkan, angkanya **32**. Yang 155 itu prosa (`// lihat
  [sajianTakeaway]`, `// pakai [perbarui]` — tanda kurung siku di kalimat
  Indonesia) dan pengindeksan larik biasa. Menuduh keduanya adalah cara
  tercepat membuat gerbangnya diabaikan
- **Hasil**: **BERSIH.** Ketiga puluh satu sisanya peta LOKAL, bukan payload:
  cache `api_client` (`_cacheEtag[key]`, `_cacheWaktu[key]`, `_cacheGet[key]`),
  keadaan per-id (`_foto[areaId]`, `status[id]`, `_porsi[menuId]`), tabel
  karakter pencetak (`_charMap[ch]`), dan label peran. Satu-satunya yang
  membaca payload server `features/manajemen/manajemen_models.dart:307`:

  ```dart
  HargaEkstrem? ekstrem(String key) {
    final v = j[key];
    return v is Map<String, dynamic> ? HargaEkstrem.fromJson(v) : null;
  }
  ```

  …dan **kedua pemanggilnya memakai literal** — `ekstrem('harga_terendah')`,
  `ekstrem('harga_tertinggi')`. Sapuan kunci-per-nama mana pun tetap
  menemukannya; hanya sapuan yang bersikeras pada bentuk kurung
  `j['harga_terendah']` yang akan luput
- **Tindak: tidak ada, dan itu keputusan.** Populasi satu yang sudah tercakup
  tak menjustifikasi gerbang baru — bentuk keputusan yang sama dipakai vena
  #33 untuk tiga panggilan URL-variabel di ponsel. Menambah gerbang untuk
  populasi satu adalah menambah biaya perawatan tanpa menambah penjagaan
- **Batas & celah yang tersisa** (bahan antrean berikutnya): sapuan
  "kunci kontrak server vs kunci yang dibaca Dart" (425 vs 804 pada vena
  sebelumnya) **tak pernah jadi gerbang berdiri** — ia skrip sekali jalan.
  Kunci kontrak baru karena itu masih bisa lahir tanpa ada yang menagih sisi
  ponselnya, persis seperti `durasi_detik` dulu

---

## Teks galat DI DALAM balasan sukses — server — 2026-08-24

- **Kenapa vena ini ada**: ledger menulis *"penjaganya hanya melihat
  `new HTTPException`. Medan galat yang dibalas lewat `c.json` biasa — mis.
  `alasan` per baris pada impor bahan — tak terlihat sama sekali."*
- **Populasi** (disapu **tanpa komentar**):

  | ukuran | angka |
  |---|---|
  | medan bernama-galat (`alasan`/`sebab`/`pesan`/`keterangan`) | **48** |
  | blok `catch` di `apps/server/src` | **45** |
  | · yang MENGIKAT galatnya | **28** |
  | · galat MENTAH sampai ke nilai yang DIKIRIM | **1** |

- **Hasil perilakunya: BERSIH.** Satu-satunya situs `lib/backup.ts:157`
  (`e instanceof Error ? e.message : String(e)` → `error: pesan`), dan ia
  **sah**: seluruh rute cadangan ada di balik `/admin/*` + `requireSuperAdmin`,
  dan pesan asli itulah isi diagnosis operatornya. Dua situs `alasan:` pada
  impor bahan keduanya lewat `alasanGagalBaris`; `sebab` di `/sync` kode
  terstruktur, bukan pesan
- **Yang TIDAK bersih penjaganya, dan itu dua hal terukur**:
  1. **polanya satu bentuk, kelasnya lebih luas.** Ia menuntut tulisan harfiah
     `(e as Error).message`. Tiga bentuk yang lebih sering dipakai repo ini
     **dibuktikan lolos** pola lama dan tertuduh sapuan baru:
     `e instanceof Error ? e.message : String(e)`, `String(e)`, `` `${e}` ``;
  2. **pengecualiannya lebih luas dari alasannya.** `BOLEH` mengecualikan
     **seluruh `lib/`** dengan alasan *"penulisan log & peringatan, bukan badan
     respons"* — dan alasan itu tidak benar untuk seluruh `lib/`, karena
     `lib/backup.ts` justru memulangkan `error: pesan` di dalam objek yang
     dikirim. Kini tiga berkas `lib/` dikecualikan **dengan nama**, masing-masing
     dengan sebabnya
- **Detektor**: DIBUKTIKAN bisa menuduh, dua lapis. Sintetis: ketiga bentuk di
  atas tertuduh sementara pola lama diam (uji berpasangan di berkas yang sama).
  Pohon sungguhan: menyisipkan `e instanceof Error ? e.message : String(e)` ke
  `modules/kebersihan/routes.ts` — **suntikan di-assert mendarat** — tertuduh di
  berkas & baris yang tepat, lalu dicabut
- **Versi pertama sapuannya menuduh KOMENTAR**: `modules/bahan/routes.ts:976`,
  yaitu prosa yang MENJELASKAN cacat ini dan mengutip bentuk yang salah.
  Dibaca tanpa komentar sesudahnya. Penjaga yang menuduh tulisannya sendiri
  sudah terjadi sekali di repo ini (`sql-number-bukan-janji`)
- **Batas**: sapuan ini menilai badan `catch` sepanjang satu blok. Galat yang
  disimpan ke variabel di luar `catch` lalu dikirim jauh di bawahnya tak
  terlihat; begitu pula pesan yang dirakit di modul lain dan diteruskan. Yang
  dijamin: bentuk yang paling sering ditulis tak bisa lagi masuk diam-diam
- **Tindak**: `alasan-gagal-tanpa-bocor.test.ts` bertambah sapuan kedua + uji
  berpasangan (7 → **13** uji); `BOLEH` dipersempit dari awalan direktori jadi
  berkas bernama. Tak ada kode server yang tersentuh — hanya berkas uji — jadi
  `verify-api` tidak dijalankan ulang, dan itu **disebutkan** bukan didiamkan.
  Gerbang: typecheck bersih · `npm test` **2.194**

---

## Cakupan rute: pintu yang tak pernah diketuk — server — 2026-08-24

- **Kenapa vena ini ada**: ledger menulis batas alat ukur latensi — *"yang
  diukur RUTE BACA tanpa parameter jalur (68 dari 469). Jalur tulis dan rute
  ber-`:id` tak diukur."*
- **RALAT atas angka ledger itu**: `scripts/ukur-latensi.sh` mengukur
  **SEBELAS** jalur yang ditulis tangan di satu baris `for`, semuanya `GET`.
  Bukan 68. Dan penyebutnya **274** rute konkret, bukan 469
- **Temuan pengintaian yang menentukan bentuk putaran ini**: angka cakupan
  **tak bisa didapat secara statis**. Kucocokkan jalur yang disebut
  `verify-api.sh` dengan deklarasi rute di `src` — hasilnya **2 dari 163**,
  karena hampir setiap jalur di skrip itu dirakit dari variabel shell
  (`/bahan/$BP242/resep`). Yang dibutuhkan **pola** rutenya
  (`/api/bahan/:id/resep`), dan hanya server yang mengetahuinya
- **Populasi**:

  | ukuran | angka |
  |---|---|
  | rute konkret terdaftar di tabel rute Hono | **274** |
  | · jalur **TULIS** | **168** |
  | jalur yang `ukur-latensi.sh` ukur sebelumnya | **11**, semuanya `GET` |
  | jalur TULIS yang pernah punya angka | **0** |
  | permintaan tercatat saat `verify-api.sh` berjalan | **4.324** |

- **Metode**: middleware ber-env `JEJAK_RUTE` di `app.ts` mencatat
  `metode · c.req.routePath · status · ms`. **Diukur, bukan diandaikan**:
  `routePath` memulangkan pola LENGKAP dengan prefiks mount
  (`/api/customer/:id`, `/api/menu/:id`). Daftar rutenya dari `app.routes`
  Hono sendiri — pemeta teks di repo ini sudah salah berkali-kali, dan di sini
  aplikasinya bisa ditanya langsung
- **Detektor**: DIBUKTIKAN bisa menuduh — satu rute baru disisipkan ke `app.ts`
  (suntikan **di-assert mendarat**), gerbang menuduhnya dengan nama
  (`GET /api/pintu-yang-tak-pernah-diketuk`), lalu dicabut
- **Hasil — peta cakupan pertama yang pernah ada di repo ini**:

  | | angka |
  |---|---|
  | rute konkret terdaftar | **274** |
  | **diketuk** verify-api | **256** (**93,4 %**) |
  | **TAK PERNAH diketuk** | **18** — **13** di antaranya jalur TULIS |
  | jalur tulis | **168** terdaftar, **155** diketuk |

  Tiga memang di luar jangkauan suite dan alasannya bisa diperiksa: menjalankan
  migrasi sungguhan, mengirim email sungguhan, mengubah retensi cadangan mesin
  yang menjalankannya. **Lima belas sisanya UTANG YANG DIUKUR** — ditulis apa
  adanya, bukan disamarkan jadi "di luar jangkauan": empat `DELETE` dan sembilan
  jalur tulis lain yang bisa 500 sejak berbulan-bulan tanpa satu uji berubah
  warna
- **Venanya sendiri BERSIH secara perilaku, dan itu diukur**: pada **200.101
  transaksi** yang **dibuktikan terbaca API** (lewat `jumlah_transaksi` balasan
  rutenya, bukan `SELECT count(*)` — kesalahan yang pernah kubuat dan yang
  melahirkan gerbang premis skrip itu), **71** rute baca terukur otomatis:

  | | terukur |
  |---|---|
  | terlambat: `GET /laporan` | **0,119 dtk** |
  | `POST /penjualan` | **0,020 dtk** |
  | `POST /stok/opname` | **0,036 dtk** |
  | `PUT /menu/:id` | **0,018 dtk** |
  | kontensi kolam `GET /menu` senggang → sibuk → pulih | **0,015 → 0,012 → 0,016 dtk** |

  Kontensi yang dulu **0,009 → 2,11 dtk** kini rata. Perbaikan vena #12/#14/#15/
  #16/#36 memang memegang — dan sekarang ada angkanya, bukan keyakinan
- **Batas gerbangnya, ditulis jujur**
  - `docs/audit/rute-diketuk.txt` adalah **rekaman**, bukan pengukuran ulang.
    Bila suatu saat sebuah rute berhenti diketuk tanpa berkasnya diperbarui,
    gerbangnya tetap hijau. Yang dijaganya: rute **baru** tak bisa lahir tanpa
    keputusan
  - **"diketuk" bukan "diuji"**: rute yang ditembak sekali dengan badan paling
    sederhana tetap terhitung tercakup
  - rute ber-`:param` tak ikut diukur `ukur-latensi.sh` (butuh id yang sah);
    latensinya hanya terlihat lewat jejak saat verify-api berjalan, pada volume
    seed
  - jalur tulis diukur pada volume seed dan pada 200 ribu transaksi, tapi tidak
    di bawah **konkurensi** — kelas yang justru melahirkan vena #12
- **Tindak**: middleware jejak ber-env di `app.ts` (mati secara bawaan; isinya
  hanya metode, pola, status, ms — tak ada UUID, badan, atau token) ·
  `src/scripts/cakupan-rute.ts` · gerbang `cakupan-rute.test.ts` (5 uji) ·
  `ukur-latensi.sh` memakai tabel rute Hono (11 → **71** rute baca), gerbang
  premisnya utuh · `docs/audit/rute-diketuk.txt`. Gerbang: typecheck bersih ·
  `npm test` **2.191** · `verify-api` **2.849** terhadap Postgres segar ·
  `audit:invarian` 26/26
- **Catatan alat**: `buta-komentar.test.ts` turun **4.167 → 3.348** aksara, dan
  sebabnya ditulis di tempatnya — kerusakan pengupas naif berbentuk **RANTAI**:
  satu komentar blok baru di mana pun memasangkan ulang seluruh `/*`…`*/`
  sesudahnya dan menggeser angkanya **ke dua arah**. Ambangnya karena itu
  dipasang pada besaran, dan yang tak boleh mundur asersi
  `.route("/admin/tenants"` di atasnya — itu propertinya; angka itu ukurannya

---

## Luapan TURUNAN: angka yang lahir di server, tempat `.max()` tak menolong — server — 2026-08-24

- **Kenapa vena ini ada**: entri di bawah menutup celah "batas ada tapi angkanya
  milik kolom lain", lalu menulis batasnya sendiri — *"kelas luapan turunan tak
  disentuh sama sekali … dan tak satu pun punya penjaga"*. Ia dikerjakan
  mendahului #8–#10 karena kerusakannya **500 di layar pembayaran** dan
  keterjangkauannya **aritmetika, bukan dugaan**
- **Populasi**:

  | ukuran | angka |
  |---|---|
  | kolom `numeric(p,s)` di `schema.ts` | **62** |
  | · diisi LANGSUNG medan permintaan tervalidasi | **30** |
  | · **lahir dari hitungan server** | **32** |
  | SQLSTATE yang `alasanGagalBaris` sudah bisa terjemahkan | **7** |
  | modul yang memakainya | **1** (`bahan/routes.ts`) |
  | SQLSTATE yang diterjemahkan `app.onError` | **1** (`22P02`) → **2** |

  **Ralat atas angkaku sendiri**: entri di bawah menulis *"13 dari 62 kolom
  diisi hitungan server"*. Tiga belas adalah besar daftar `TAK_DIKLAIM` di
  berkas ujinya — himpunan yang berbeda. Yang benar **32**, dihitung sebagai
  komplemen `PETA` terhadap seluruh kolom numeric
- **Metode**: komplemen `PETA` (peta medan→kolom dari vena sebelumnya) terhadap
  kapasitas kolom yang dibaca `schema.ts`; tiap kolom turunan dipilah tangan
  jadi DIJAGA atau BERALASAN, lalu tiap kandidat **diukur lewat HTTP**
- **Detektor**: DIBUKTIKAN bisa menuduh, **tiga lapis**, tiap suntikan
  **di-assert mendarat**: (1) mencabut satu `pastikanMuat` → source-pin merah
  menyebut penjaganya; (2) mencabut terjemahan `22003` → uji pintu keluar
  merah; (3) menambahkan kolom `numeric` baru ke `schema.ts` → KELENGKAPAN
  merah menyebut `sales.uji_luap_baru`
- **Hasil**: **TEMUAN.** Terukur lewat HTTP terhadap Postgres sungguhan:

  | permintaan | sebelum | sesudah |
  |---|---|---|
  | menu Rp 10.000 × qty 99.999.999 (= 999.999.990.000) | **201** | 201 |
  | menu Rp 20.000 × qty 99.999.999 | **HTTP 500** | **400** `Total baris "…" terlalu besar untuk disimpan (maksimal 999.999.999.999)` |
  | menu Rp 1 jt × qty 1.000.000 | **HTTP 500** | **400** bernama |
  | **TIGA baris yang masing-masing MUAT** | **HTTP 500** | **400** `Subtotal terlalu besar…` |
  | menu ber-resep takaran 1000 × qty 9.999.999 | **HTTP 500** | **400** `Total HPP terlalu besar…` |

  Baris keempat itu inti venanya: **tiap medan sah, tiap baris muat di
  kolomnya, dan penjualannya tetap 500 karena jumlahnya tidak.** Tak ada
  `z.number().max()` di mana pun yang bisa mencegahnya. Pasangan
  anti-hijau-palsu ikut diukur lewat verify-api: nota Rp 20 juta dan nota tiga
  baris wajar tetap **201**
- **Bentuknya persis tanda tangan sesi ini, sampai ke kalimat pembelaannya.**
  `lib/pg-galat.ts` sudah tahu arti luapan numerik dan sudah punya kalimatnya
  (`case "22003": "Angkanya terlalu besar untuk disimpan"`), dan berkas yang
  **sama** sudah menuliskan argumen untuk memasangnya di pintu keluar bersama —
  untuk saudaranya `22P02`: *"menyalin saringan ke 137 tempat sisanya bukan
  perbaikan, itu daftar tugas yang tak akan selesai — jadi terjemahannya
  dipasang di SATU pintu keluar galat."* Argumen itu ditulis, disepakati, dan
  dijalankan — **untuk satu kode SQLSTATE saja**
- **Perbaikannya DUA LAPIS, dan keduanya perlu — dibuktikan sendiri-sendiri**:
  1. **pintu keluar bersama** (`app.onError` → `galatDataKlien`): dengan
     **seluruh** penjaga lokal dicabut (suntikan di-assert: 6 panggilan → sisa
     0), permintaan yang sama dibalas **400 "Angkanya terlalu besar untuk
     disimpan"**, bukan 500. Ini menutup kelasnya di **setiap** rute sekaligus.
     Tetap dicatat sebagai 400, sama seperti perlakuan `22P02`;
  2. **`pastikanMuat()` di tempat angkanya lahir**: menyebut **medannya** dan
     nama menunya. Pintu keluar bersama tak pernah tahu angka yang MANA, dan
     kasir yang berdiri di depan tamu perlu tahu baris mana yang diperbaiki
- **Sengaja hanya `22003`**: saudaranya `22001` ("teks terlalu panjang")
  sekelas dan sudah punya kalimatnya, tapi **keterjangkauannya belum diukur** —
  menerjemahkan yang belum diukur berarti mengubah 500 jadi 400 untuk jalur
  yang mungkin tak pernah ada, dan itu menyembunyikan cacat server sungguhan
- **Asersi verify-api-ku sendiri sempat melaporkan 5xx yang tak pernah ada**:
  `status_code_body` sengaja tak menutup barisnya, jadi `"400"` dan `"400"`
  menyatu jadi `"400400"` dan `awk '$1 >= 500'` menghitungnya satu. Diperbaiki
  dengan newline eksplisit, dan sebabnya ditulis di tempatnya
- **Batas detektornya, ditulis jujur**
  - ia menilai **kolom**, bukan menelusuri tiap ekspresi. Sebuah kolom yang
    "DIJAGA" dijaga di jalur yang kuperiksa — kalau kelak ada jalur tulis KEDUA
    ke kolom yang sama, gerbang ini tak melihatnya. Yang dijaganya: tak ada
    kolom turunan **baru** yang lahir tanpa keputusan
  - **`production_consumptions.qty` belum diukur lewat HTTP.** Jalur produksi
    memakai qty yang sudah ber-`BATAS_QTY_STOK` dan kolomnya `numeric(16,6)`
    yang sama, jadi secara aritmetika ia terkurung — tapi itu penalaran, bukan
    pengukuran, dan ditulis begitu di `PUTUSAN`
  - **jalur non-penjualan hanya dilindungi lapis pertama**: balasannya 400 yang
    bisa dibaca, tapi tanpa sebutan medan. Menambahkan `pastikanMuat` ke tiap
    jalur adalah daftar tugas yang sama dengan yang ditolak `pg-galat.ts`;
    yang dikerjakan lebih dulu jalur yang **terukur** menggigit
  - `22001` tak diukur sama sekali putaran ini
- **Tindak**: `galatDataKlien` + wiring `app.onError` · `pastikanMuat()` &
  `BATAS_HPP` di `lib/batas-angka.ts` · **enam** titik penjaga di `createSale` ·
  gerbang `luapan-turunan.test.ts` (5 uji) · `verify-api` §243 (9 asersi) ·
  pemetaan kolom dipindah ke `test/util/kolom-numerik.ts` (mengimpor berkas
  `.test.ts` membuat describe-nya berjalan dua kali) · entri `CHANGELOG-API`
  🟡 PERLU DILIHAT — ponsel tak berubah, tapi **satu kelas galat berpindah dari
  5xx ke 4xx**, dan klien yang mencoba-ulang otomatis pada 5xx sebelumnya
  mengulang permintaan yang takkan pernah berhasil. Gerbang: typecheck bersih ·
  `npm test` **2.186** · `verify-api` **2.849** terhadap Postgres segar ·
  `audit:invarian` 26/26

---

## Peta medan → kolom: batasnya ADA tapi angkanya milik kolom lain — server — 2026-08-24

- **Kenapa vena ini ada**: gerbang `angka-berbatas-atas` menulis batasnya
  sendiri — *"ia menuntut ADANYA `.max()`, bukan bahwa angkanya cocok dengan
  kolom tujuannya. Pemetaan medan → kolom tak ada di kode."* Ledger putaran lalu
  mencatatnya sebagai negatif bersih ("ketiga belas konstanta cocok hari ini"),
  dan **negatif bersih itu meleset**: yang diperiksa waktu itu konstantanya,
  bukan pemakaiannya
- **Populasi**:

  | ukuran | angka |
  |---|---|
  | kolom `numeric(p,s)` di `schema.ts` | **62** (11 presisi berbeda) |
  | `z.number()` di server + shared | **109** |
  | · ber-`.max()` | **105** — 77 lewat konstanta `BATAS_*`, 28 literal |
  | pasangan (berkas, medan) yang namanya kolom numeric | **32** |
  | nama medan yang BUKAN nama kolom mana pun | **20** (35 situs) |
  | konstanta di `lib/batas-angka.ts` | **7** → 8 |

  Angka ledger lama **"13 konstanta" diralat jadi 7**; 13 adalah jumlah kolom
  yang disebut komentarnya, bukan jumlah konstantanya
- **Metode**: kapasitas tiap kolom dihitung dari `schema.ts` sebagai
  `10^(p−s) − 1` (BigInt — `10 ** 16` sudah tak tepat di float64), lalu
  diadu dengan `.max()` tiap medan lewat peta (berkas, medan) → `tabel.kolom`
- **Detektor pertamaku SALAH, dan itu bagian hasilnya**: penjodohan otomatis
  berdasar NAMA medan menuduh **17, lima belas di antaranya keliru**. `qty` ada
  di **tiga belas** tabel dengan tiga presisi berbeda (10,2 · 12,4 · 16,3 ·
  16,6), jadi penjodoh nama selalu memilih yang tersempit (`sale_items` 10,2)
  dan menuduh setiap `qty` perlengkapan/produksi yang sah. Detektor yang dipakai
  karena itu **peta eksplisit + uji KELENGKAPAN**, bukan penjodoh nama —
  petanya tulisan tangan, tapi medan baru tak bisa lolos diam-diam
- **Detektor**: DIBUKTIKAN bisa menuduh, dua lapis, keduanya dengan suntikan
  yang **di-assert mendarat**: mengembalikan pintu resep ke `BATAS_QTY_STOK` →
  tertuduh `modules/menu/routes.ts:41` **dengan kolom & presisinya disebut**;
  mempersempit `menus.mult` jadi `numeric(6,3)` di `schema.ts` → `BATAS_FAKTOR`
  langsung merah ("harus sama dengan kapasitas menus.mult numeric(6,3)")
- **Hasil**: **DUA TEMUAN**, keduanya kolom `numeric(12,4)` yang dijaga batas
  `numeric(16,6)` — **seratus kali kolomnya**. Terukur lewat HTTP terhadap
  Postgres sungguhan:

  | pintu | sebelum | sesudah |
  |---|---|---|
  | `POST /menu` `komponen[].qty` = 99.999.999 | **201** | 201 |
  | `POST /menu` `komponen[].qty` = 100.000.000 | **HTTP 500** | **400** "komponen[0].qty: maksimal 99999999" |
  | `PUT /bahan/:id/resep` `komponen[].qty` = 99.999.999 | **200** | 200 |
  | `PUT /bahan/:id/resep` `komponen[].qty` = 100.000.000 | **HTTP 500** | **400** bernama |

  Sembilan setengah miliar nilai lolos gerbang yang KELIHATANNYA menjaga.
  Pasangan anti-hijau-palsu ikut diukur: `stok_minimum = 9.999.999.999` tetap
  **201** di jalur stok (`numeric(16,6)`) — pengetatannya tidak bocor ke pintu
  tetangga
- **`BATAS_QTY_RESEP` sengaja tidak digabung dengan `BATAS_ISI`** walau angkanya
  sama: keduanya kebetulan `numeric(12,4)` hari ini, satu isi per kemasan dan
  satu takaran resep. Menyatukannya berarti presisi salah satu kolom yang
  berubah menyeret kolom yang tak ada hubungannya — persis bentuk yang membuat
  `batas-angka.ts` ada
- **Alatnya ikut dibereskan, dan ia TUMBUH KEMBALI**: pengupas komentar naif
  ternyata punya **empat** salinan baru di berkas uji, sesudah vena sebelumnya
  menyatukan tujuh. Terukur atas berkas yang mereka baca sendiri
  (`AnalisisHargaPage`, `RiwayatPage`, `BahanEditorGrid`), ketiganya membuang
  **2–3 aksara lebih banyak** dari yang seharusnya; atas `apps/web` +
  `apps/server` (239 berkas), **74** dan **82** berkas berbeda (2.119 dan 2.576
  aksara). Atas populasi `angka-berbatas-atas` sendiri (server + shared, 127
  berkas) bedanya **satu berkas — `buta-komentar.ts` itu sendiri**, jadi tak ada
  angka gerbang terkirim yang berubah. Keempatnya kini memakai `butaKomentar`
- **Batas detektornya, ditulis jujur**
  - petanya berkunci **(berkas, medan)**, bukan nomor baris: peta yang basi tiap
    minggu akan dihapus orang. Konsekuensinya satu nama medan yang bermuara ke
    dua kolom berbeda **di berkas yang sama** akan dinilai dengan kolom yang
    terdaftar saja — hari ini tak ada yang begitu, dan uji KELENGKAPAN tak bisa
    melihatnya
  - **20 nama medan tak bernama-kolom** (`jumlah` → productions.qty, `harga` →
    total_harga, `porsi` → qty hasil kali, `harga_per_unit`, `dana_cair`, …)
    dinilai dari daftar putusan, bukan dari penelusuran nilai. Yang dijamin cuma
    daftarnya tak bertambah tanpa keputusan
  - **kelas LUAPAN TURUNAN tak disentuh sama sekali**: `porsi × takaran`,
    `jumlah batch × isi`, `harga_per_unit × qty` semuanya bisa melampaui kolom
    hasilnya walau tiap masukannya sah. 13 dari 62 kolom numeric memang diisi
    hasil hitungan server (`sales.total_hpp`, `sale_items.line_total`,
    `stock_opnames.selisih`, …) dan tak satu pun punya penjaga. Itu vena
    tersendiri, bukan bagian yang ini
  - kapasitas yang dipakai bilangan bulat (`10^(p−s) − 1`), bukan kapasitas
    sebenarnya (`… − 10^(−s)`): seluruh konstanta memang bulat, dan batas
    pecahan membuat pesan galatnya tak terbaca orang
- **Tindak**: `BATAS_QTY_RESEP` di `lib/batas-angka.ts` + dua pintu resep
  diperbaiki · gerbang `batas-ikut-presisi-kolom.test.ts` (7 uji) · `verify-api`
  §242 (11 asersi) · empat salinan pengupas komentar disatukan · entri
  `CHANGELOG-API` ⚪️ INFO (ponsel **tidak** menulis resep — tambah/ubah menu &
  resep tetap di web, jadi tak ada perubahan sisi ponsel; dicatat, bukan
  didiamkan). Gerbang: typecheck bersih · `npm test` **2.181** · `verify-api`
  **2.840** terhadap Postgres segar · `audit:invarian` 26/26

---

## SQL mentah: populasi yang tak pernah disapu aturan mana pun — server — 2026-08-24

- **Kenapa vena ini ada**: tiga aturan yang sudah terkirim menulis batas yang
  SAMA tentang dirinya sendiri — *"hanya melihat bentuk TypeScript, bukan SQL
  mentah"*. Celah itu **sudah sekali memakan temuan**: `GET /customer` yang
  1,61 MB tak pernah tertuduh sapuannya sendiri dan ditemukan dengan tangan
- **Populasi** (pemindai template berimbang, menghormati `${}` bersarang;
  definisinya ikut ditulis karena angka tanpa definisi tak bisa ditinjau):

  | ukuran | angka |
  |---|---|
  | template `` sql`…` `` polos di `apps/server/src` | **140** (134 terluar, 6 bersarang) |
  | template `` sql<T>`…` `` — potongan ekspresi ber-cast | **110** |
  | · total | **250** |
  | polos yang memuat pernyataan lengkap | **50** |
  | situs `.execute(` berargumen `` sql`…` `` | **42** dari 43 |
  | kueri lengkap tanpa sebutan `company_id` | **20** |
  | kueri ber-SELECT tanpa `LIMIT` | **29** (22 non-agregat) |

  Angka pengintaian awal (247 / 62 / 19 / 29 / 21) **diralat di sini**: regex
  versi itu tak memuat bentuk `sql<T>` dan menghitung situs `.execute` dua kali
- **Metode**: ketiga aturan yang sudah terkirim dijalankan ulang atas populasi
  itu — langit-langit daftar, pengurungan tenant, dan cast `sql<number>`
- **Detektor**: DIBUKTIKAN bisa menuduh, dua lapis. Sintetis: sebelas masukan
  lewat `situsSql([{nama, isi}])` (telanjang tertuduh · ber-`LIMIT` tidak ·
  agregat skalar berbungkus `COALESCE` tidak · ber-`GROUP BY` ya · `SELECT 1 …
  FOR UPDATE` tidak · `SELECT (subkueri), (subkueri)` tidak · tabel di dalam
  CTE pembantu TETAP terlihat · `LIMIT` milik subkueri pembantu tak memaafkan
  induknya). Pohon sungguhan: mencabut `LIMIT` dari `/sampah` — **suntikan
  di-assert mendarat** (2 → 1) — menuduh `sampah/routes.ts:67` dan menaikkan
  hitungan 9 → 10; mengembalikan `daftar.reduce()` membuat penjaga agregat
  merah. Keduanya hijau lagi sesudah dikembalikan
- **Hasil**: **DUA TEMUAN.** Keduanya membaca tabel yang **sudah ada** di
  daftar `TUMBUH` milik gerbang drizzle — aturan yang sama, tabel yang sama,
  bentuk handler yang sama; satu dijaga dan satu tidak, semata karena cara
  menulisnya berbeda. Diukur lewat HTTP terhadap Postgres nyata, 10.000 baris
  disuntikkan; **suntikannya dibuktikan terbaca lebih dulu** (10.000/10.000
  baris ber-prefiks `UJI-VOL-` muncul di balasan):

  | pintu | sebelum | sesudah |
  |---|---|---|
  | `GET /sampah` | 10.000 baris · **2.438.895 byte** · 78 ms | 300 · 72.793 byte · 23 ms |
  | `GET /penerimaan/anomali` | 10.000 baris · **2.760.043 byte** · **4.170 ms** | 100 · 27.676 byte · 1.522 ms |

  Pasangan anti-hijau-palsu: `jumlah` **tetap 10.000** dan `qty_total` **tetap
  30.000** sesudah dipotong — keduanya pindah ke `COUNT(*) OVER ()` /
  `SUM(qty) OVER ()`, yang Postgres hitung SEBELUM `LIMIT`. Memotong daftar
  tanpa memindahkan agregatnya ke SQL adalah menukar satu bug dengan bug yang
  lebih sunyi
- **Perbaikannya sendiri hampir melahirkan kerusakan baru, dan itu terukur**:
  tanda "barang tidak sampai" di kartu Beli & Produksi diturunkan dari `rows`.
  Dengan baris menggantung tersebar ke **500 faktur**, `rows` yang dipotong
  hanya memperlihatkan **100** di antaranya — 400 faktur kehilangan tandanya
  diam-diam, tepat saat masalahnya paling besar. `faktur_ids` karena itu jadi
  medan tersendiri, dihitung atas populasi penuh (2.000 UUID, ±76 KB terburuk)
- **Bentuk balasan `/sampah` SENGAJA tidak diubah**: ketujuh build ponsel yang
  pernah rilis membacanya `as List`, dan `{items, terpotong}` seperti
  `/customer` akan MELEMPAR di aplikasi yang hari ini terpasang. Batasnya tetap
  berlaku untuk semua; penandanya di header `X-Kakarut-Terpotong`, yang build
  lama abaikan tanpa akibat. Preseden headernya sudah ada di kedua sisi
  (`X-Kakarut-Build` di web, `etag`/`retry-after` di ponsel) dan tak ada
  middleware CORS yang perlu diurus
- **Dua arah lain: negatif bersih BERANGKA, bukan kekosongan**
  1. **Pengurungan tenant.** Ke-20 kueri tanpa `company_id` dipilah tangan dan
     semuanya sah — `SELECT 1`, advisory lock, subkueri berkorelasi, tabel
     global, dan yang terkurung transitif lewat `branch_id` (yang sudah dipilih
     `resolveBranchId`). Satu-satunya penulisan global sungguhan,
     `open-bill/backfill.ts:23`, memang lintas-tenant seperti migrasi
  2. **Cast `sql<number>` atas SQL mentah.** Padanannya bukan `sql<T>`
     melainkan `.rows as { … number }[]` — janji tulisan tangan yang sama
     persis, dan gerbang `sql-number-bukan-janji` buta total terhadapnya.
     Populasi **9**, satu menjanjikan `number` (`sampah/routes.ts:154`, atas
     `COUNT(*)` yang pg pulangkan sebagai **string**), dan itu sudah dibungkus
     `Number()`. Populasi 1 tak memberi gerbang baru
- **Batas detektornya, ditulis jujur**
  - hanya template yang jadi argumen LANGSUNG `.execute(`; potongan yang
    dirakit di tempat lain dinilai di situs pemakainya. Tanpa batas itu,
    `const fakturTerhapus = sql`(SELECT …)`` tertuduh padahal ia bagian DELETE
  - `${pembantu(...)}` ditelusuri **satu tingkat** saja. Tanpa penelusuran itu
    `GET /penerimaan/anomali` — yang `FROM`-nya `g`, CTE di dalam
    `cteMenggantung()` — luput dari sapuan yang justru dibuat untuknya
  - `LIMIT` dinilai pada kueri LUAR: `cteMenggantung` memuat dua subkueri
    berkorelasi ber-`LIMIT 1`, dan menilai teks mentah membuat kueri terbesarnya
    dimaafkan oleh langit-langit milik subkuerinya
  - agregat dinilai pada daftar SELECT tingkat teratas. Versi pertama menilai
    teks yang sudah dikosongkan, jadi `COALESCE(SUM(qty) FILTER (…), 0)`
    menaruh `SUM(` di kedalaman 1 dan tak terlihat — ia **menuduh
    `stok/service.ts:431`**, kueri yang selalu memulangkan tepat satu baris
  - langit-langitnya membatasi BALASAN, bukan pemindaian: `/penerimaan/anomali`
    turun 4,17 → 1,52 dtk, tidak ke nol, karena `COUNT(*) OVER ()` memang
    menuntut satu lintasan penuh. Angka benarnya yang dibayar, dan itu disengaja
  - daftar tabelnya tetap turunan `TUMBUH` yang ditulis tangan — kini
    diturunkan MEKANIS ke snake_case, bukan diketik kedua kalinya, karena
    daftar tangan yang tak memuat `customers` adalah sebab balasan 1,61 MB itu
    tak pernah tertuduh
  - keadaan TERPOTONG tak diuji verify-api: membuatnya butuh 301 penjualan yang
    dihapus satu per satu lewat HTTP (±600 permintaan untuk satu asersi). Yang
    dijaga §241 justru sisi yang paling mudah rusak tanpa disadari — bahwa
    pembatasannya TIDAK mengubah apa pun pada pemakaian normal
- **Tindak**: `situsSql()` di `daftar-tanpa-langit-langit.test.ts` (ratchet
  `DASAR_SQL = 9`, +5 uji), `verify-api.sh` §241 (12 asersi),
  `sampah_terpotong_test.dart` di ponsel (4 uji, bukti merah sendiri).
  Kesembilan situs yang tersisa dipilah tangan dan tak satu pun tumbuh seumur
  pemakaian: backfill boot ×3 (`dokumen/nomor.ts`), satu baris per meja
  (`okupansi.ts:81`), per bahan (`stok/routes.ts:590`, `service.ts:48`,
  `:830`, `:857`), per cabang (`service.ts:547`). Gerbang: typecheck bersih ·
  `npm test` **2.174** · `verify-api` **2.829** terhadap Postgres segar ·
  `audit:invarian` 26/26 · `flutter analyze` bersih · `flutter test` **507**
  pada 3.44.7

---

## N round-trip per baris di dalam transaksi — server — 2026-08-22

- **Populasi**: 33 situs perulangan ber-`await tx.<kueri>` di dalam 72 badan
  `db.transaction`
- **Cakupan (aturan ke-5, diterapkan sejak awal kali ini)**: sapuan sempit
  `for (const x of y)` hanya melihat **16 dari 33 — 48%**. Sapuan lebar (for /
  for await / while / forEach / map(async)) yang dipakai
- **Detektor**: DIBUKTIKAN bisa menuduh — satu loop ber-`await tx.select()`
  disuntikkan ke badan transaksi sungguhan di `company/routes.ts` → ratchet
  merah; dicabut → hijau. Dan DIBUKTIKAN tak salah menuduh: `(?<![.\w])`
  wajib di depan `for`/`while`, sebab tanpa itu `.for("update")` — kunci baris
  drizzle, bukan perulangan — ikut tertangkap dan "menemukan" tiga loop di
  dalam `createSale` yang sama sekali tak ada
- **Hasil**: **TEMUAN** pada 2 situs yang N-nya ditentukan pengirim
- **Ukuran**, `PUT /menu/urutan`, sepuluh permintaan serentak:

  | keadaan | `GET /menu` |
  |---|---|
  | senggang | 0,012 dtk |
  | N=28.000, sebelum dibatasi | **20,07 dtk** |
  | N=2.000, sesudah dibatasi | 1,47 dtk |
  | N=2.000, sesudah SATU pernyataan | **0,012 dtk** — tak terbedakan dari senggang |

  Pada tingkat kuerinya, 2.000 baris terhadap Postgres yang sama: **289 ms
  berurutan vs 11 ms** satu pernyataan `unnest` (26×), dengan hanya 3 parameter
  ikat berapa pun N-nya
- **Tindak**: `PUT /menu/urutan` dan `PUT /meja/tata-letak` ditulis ulang jadi
  satu `UPDATE … FROM (SELECT unnest(…))`; transaksinya dibuang (satu
  pernyataan sudah atomik sendiri); ratchet `test/round-trip-per-baris.test.ts`
  dengan DASAR 31; §231 memeriksa HASILNYA — 81 menu diurutkan terbalik lalu
  dibaca lagi, dan id asing tak menyentuh baris mana pun
- **Yang hampir merusak**: versi pertama membalas **500 "cannot cast type
  record to uuid[]"** — drizzle memecah larik JS jadi TUPLE `($1, $2, …)`,
  bentuk yang berguna untuk `IN (…)` tapi mustahil dicast ke `uuid[]`.
  `sql.param(...)` wajib membungkusnya. Probe `pg` mentah LOLOS, sebab di sana
  lariknya memang satu parameter — hanya tembakan lewat HTTP yang
  menemukannya
- **Kenapa ratchet dan bukan nol**: dari 33 situs, hanya 2 yang N-nya
  ditentukan pengirim; sisanya berputar atas data internal yang sudah terbatas
  sendiri (jumlah cabang, hari tertunggak, baris satu faktur). Menuntut nol
  berarti menulis ulang tiga puluh tempat demi bahaya yang tak ada di
  kebanyakan darinya — dan uji yang menuntut pekerjaan tanpa alasan akan
  dilonggarkan orang, bukan dipatuhi

## Larik permintaan (LANJUTAN) — gerbangnya sendiri buta 54% — server — 2026-08-22

- **KOREKSI entri di bawahnya.** Entri "Larik badan permintaan tanpa batas
  atas" menyatakan populasinya **18** dan semuanya beres. Populasinya
  sebenarnya **39**. Regex gerbangnya menuntut `z` dan `.array(` bersebelahan,
  sementara prettier memformat skema panjang sebagai `items: z\n  .array(` —
  dan bentuk itu tak terlihat sama sekali. Yang luput 21 larik, termasuk
  SELURUH larik di `penjualan`, `produksi`, `sync`, dan `transfer`
- **Metode**: regex diperlebar jadi `z\s*\.\s*array\s*\(`, lalu populasinya
  dihitung ulang dari nol
- **Detektor**: DIBUKTIKAN bisa menuduh, DUA arah —
  (a) pola sempit dikembalikan → uji "melihat SELURUH populasi" merah dengan
  angkanya sendiri ("expected 18 to be greater than 18");
  (b) `.max(500)` dicabut dari `penjualan/routes.ts` → tertuduh di baris 49
- **Hasil**: **TEMUAN**, 13 larik masih telanjang sesudah putaran sebelumnya
- **Ukuran** (`POST /penjualan`, yang terburuk): `insert into sale_items`
  memakai **14 parameter ikat per baris**, dan Postgres membatasi 65.535 →
  ambang **4.681 baris**. Terukur:

  | N | sebelum | sesudah |
  |---|---|---|
  | 4.500 | 201 | 201 |
  | 5.000 | **500** "Terjadi kesalahan pada server" | **400** "items: maksimal 500" |
  | 30.000 | 500 | 400 |

  Galatnya mendarat di `error_logs` sebagai `DrizzleQueryError` berisi SQL
  penuh. Yang diperbaiki batas ini karena itu bukan cuma bebannya melainkan
  BENTUK jawabannya
- **Tindak**: 13 larik diberi `.max()` (500 baris transaksi, 1000 baris opname,
  200 komponen); regex gerbang diperlebar; uji baru "PASANGAN: pemindainya
  melihat SELURUH populasi" memaku perbandingan dengan pola sempitnya supaya
  kebutaan itu tak bisa kembali diam-diam; §231 diperluas
- **Pelajaran yang dicatat, bukan disembunyikan**: detektor yang dibuktikan
  bisa menuduh SATU kasus belum tentu MELIHAT seluruh populasinya. Bukti merah
  menjawab "bisakah ia menuduh?"; ia tak menjawab "berapa yang dilihatnya?".
  Sejak sekarang tiap sapuan wajib menyebut CAKUPAN, bukan cuma kemampuan
  menuduh

## Larik badan permintaan tanpa batas atas — server — 2026-08-22

- **Populasi**: 18 `z.array(...)` di skema badan permintaan `apps/server/src`
- **Metode**: `larik-tanpa-batas.py` — tiap `z.array(...)`, baca rantai method
  sesudahnya, pilah yang memuat `.max(` dari yang tidak
- **Detektor**: DIBUKTIKAN bisa menuduh — `.max(2000)` dicabut dari
  `penyimpanan/routes.ts` → hitungan berbatas turun 10→9 dan lariknya muncul
  di daftar telanjang; dipulihkan → 10 lagi
- **Hasil**: **TEMUAN**. 10 dari 18 sudah berbatas — termasuk DUA yang tinggal
  di berkas yang SAMA dengan larik telanjangnya. Delapan sisanya tidak
- **Ukuran** (`PUT /menu/urutan`, satu UPDATE per baris di dalam transaksi;
  rutanya "boleh diakses SEMUA PERAN termasuk kasir"):

  | N | lama satu permintaan |
  |---|---|
  | 1 | 13 ms |
  | 1.000 | 242 ms |
  | 20.000 | 2,94 dtk |
  | 28.000 (langit batas badan 2 MB) | ~4,4 dtk |

  Dan yang benar-benar merusak bukan permintaan itu sendiri melainkan SEMUA
  yang lain — `db` adalah pg.Pool max 10:

  | keadaan | `GET /menu` |
  |---|---|
  | senggang | 0,009 dtk |
  | 10 × `PUT /menu/urutan` N=28.000 | **20,07 dtk** (2.200×) |
  | sesudah semuanya usai | 0,009 dtk |
  | 10 × N=2.000 (batas baru) | **1,47 dtk** |

- **Tindak**: kedelapan larik diberi `.max()` dengan angka yang SUDAH mapan di
  repo (2000 daftar uuid panjang, 500 daftar id, 200 baris komponen, 100
  daftar cabang); gerbang `test/larik-permintaan-berbatas.test.ts`; §231
  verify-api. Pengurutan sah 81 menu sungguhan tetap 200 dalam 35 ms
- **Utang yang DIUKUR, bukan dinyatakan beres**: batasnya mengecilkan
  kerusakan 14× tapi TIDAK menghapus mekanismenya — `PUT /menu/urutan` masih
  melakukan N round-trip di dalam satu transaksi. Menggantinya dengan satu
  `UPDATE … FROM (VALUES …)` akan membuatnya satu round-trip berapa pun N-nya.
  Itu vena tersendiri, sudah masuk antrean di bawah

## I/O jaringan di dalam `db.transaction` — server — 2026-08-22

- **Populasi**: 72 badan `db.transaction(...)` di `apps/server/src`
- **Metode**: dua sapuan bertingkat.
  (a) `io-dalam-tx.py` — panggilan berat yang HARFIAH di dalam badan transaksi:
  `kirimEmail`, `PutObjectCommand`/S3, `fetch`, `bcrypt.hash/compare` async,
  `fs.*`;
  (b) `io-dalam-tx2.py` — SATU lapis indireksi: 354 fungsi tingkat berkas
  diindeks, 33 nama yang benar-benar dipanggil dari dalam badan transaksi
  ditelusuri ke definisinya, lalu badannya diperiksa dengan pola yang sama
- **Detektor**: DIBUKTIKAN bisa menuduh, KEDUANYA.
  (a) `await kirimEmail(...)` palsu disisipkan ke badan transaksi sungguhan di
  `users/routes.ts` → tertuduh di baris 204; dicabut → nol lagi.
  (b) `await fetch(...)` palsu disisipkan ke `resolveKodeKaryawan` — fungsi
  yang MEMANG dipanggil dari dalam transaksi → 2 tersangka muncul
  (`users/routes.ts`, `admin-tenants/routes.ts`); dicabut → nol lagi
- **Hasil**: **BERSIH**. Nol I/O jaringan di dalam transaksi, langsung maupun
  satu lapis di bawah
- **Konteks**: repo ini memang sudah sadar kelasnya — `autoFileRakCabang`
  SENGAJA ditinggal di luar transaksi penerimaan, dengan komentar yang
  menyebut alasannya
- **Batas**: (1) hanya SATU lapis indireksi — fungsi yang memanggil fungsi
  yang ber-I/O tak terlihat; (2) hanya `await <ident>(`, jadi panggilan metode
  `await obj.method(` tak ditelusuri; (3) daftar "berat"-nya pilihan, bukan
  kelengkapan
- **Tindak**: —

## Isolasi tenant pada PENULISAN — server — 2026-08-22

- **Populasi**: 162 `UPDATE`/`DELETE` di `apps/server/src`
- **Metode**: sapuan AST-kasar — tiap `.update(t)`/`.delete(t)`, ekstrak
  `.where(...)`-nya, lalu pilah: mengurung `companyId` sendiri / menulis ke
  baris yang id-nya berasal dari SELECT terkurung / handler-nya tak menyebut
  perusahaan sama sekali
- **Detektor**: DIBUKTIKAN bisa menuduh — 3 penulisan tanpa `.where()` sama
  sekali tertangkap (`auth`, `rateLimit`, `lib/build`), dan ketiganya
  diperiksa sah
- **Hasil**: **BERSIH**. 72 mengurung `companyId` langsung di WHERE-nya; 37
  menulis ke baris yang id-nya `x.id` dari SELECT terkurung; 53 sisanya
  diperiksa dengan tangan — kebersihan ×6, bahan ×2, menu ×2, papan pesanan
  ×9, open-bill ×2, users ×1, onboarding ×2, dan semuanya memverifikasi
  induknya lebih dulu lalu 404
- **Batas**: hanya melihat bentuk yang ditulis TypeScript, bukan SQL mentah.
  Pengurungan yang tinggal di variabel (`filter`, `conds`, `kunci`) tak
  ditelusuri — semuanya diperiksa tangan sebagai gantinya
- **Tindak**: —

## Penulisan ke tabel `users` GLOBAL — server — 2026-08-22

- **Populasi**: 9 `insert`/`update`/`delete` ke `users` di luar seed
- **Metode**: telusuri tiap situs sampai gerbangnya
- **Detektor**: pembandingnya bukan sapuan melainkan pembacaan penuh 9 situs;
  kekuatannya berasal dari populasinya yang habis, bukan dari sampel
- **Hasil**: **BERSIH**, dan gerbangnya justru teliti. `PATCH
  /karyawan/:id` memblokir 403 untuk password, email, dan penonaktifan global
  bila akun itu masih aktif di perusahaan LAIN — `memberships_user_company_uq`
  memang mengizinkan satu akun jadi anggota beberapa perusahaan. Sisanya
  terkunci ke `auth.sub` (profil sendiri, hapus akun sendiri) atau menolak
  email yang sudah terdaftar
- **Tindak**: —

## Kunci JSON: dibaca mobile tapi tak pernah dikirim server — mobile — 2026-08-21

- **Populasi**: 425 kunci yang dibaca `lib/**.dart` vs 804 kunci yang dikenal
  `apps/server/src` + `packages/shared`
- **Metode**: `scratchpad/kunci.py` — himpunan selisih dua arah
- **Detektor**: DIBUKTIKAN bisa menuduh — kunci palsu
  `omzet_yang_tak_pernah_ada` disuntikkan ke `operasional_models.dart`,
  tertuduh; dicabut, hijau lagi
- **Hasil**: **BERSIH** untuk arah "mobile membaca yang tak ada" (7 kandidat,
  semuanya penyimpanan lokal mobile sendiri). Arah sebaliknya menyisakan satu
  celah koheren: seluruh fitur **lama pengerjaan pesanan** (`durasi_detik`,
  `masuk_pada`, `target_durasi_detik`, `LaporanDurasiPesanan`, `DurasiMenuRow`,
  `DurasiRiwayatRow`) sudah tayang di production tapi belum diurai mobile
- **Batas**: regex `x['kunci']` tak melihat kunci yang lewat variabel
  (`j[k]`) maupun kunci pada badan PERMINTAAN (map literal) — keduanya
  menghasilkan positif palsu yang sudah dipilah tangan
- **Tindak**: celah fitur durasi dicatat di PR #207, belum dikerjakan

## `sql<number>` yang tak dicast — server — 2026-08-21

- **Populasi**: 76 ekspresi `sql<number...>` di `apps/server/src`
- **Metode**: sapuan + probe langsung ke Postgres 16 untuk mengukur tipe
  balikan tiap agregat
- **Detektor**: DIBUKTIKAN — mencabut satu cast → menuduh berkas & barisnya;
  mengubah ekspresi yang dikecualikan → menuduh daftarnya basi
- **Hasil**: **TEMUAN**. 12 ekspresi tanpa cast, semuanya di jalur uang/cacah.
  Driver memulangkan `SUM(numeric)`, `SUM(integer)`, `AVG`, dan `COUNT(*)`
  sebagai STRING sementara `sql<number>` membuat TypeScript yakin ia `number`.
  Keduabelas pemanggilnya ternyata sudah membungkus `Number(...)`, jadi tak
  ada angka yang salah hari ini — yang dipindahkan letak kebenarannya, dari
  disiplin ke struktur
- **Tindak**: `::float8`/`::int` di ekspresinya; gerbang
  `test/sql-number-bukan-janji.test.ts`

## Tanggal bisnis di `verify-api.sh` — server — 2026-08-21

- **Populasi**: 20 perhitungan tanggal-saja (`+%F`) di skripnya
- **Detektor**: DIBUKTIKAN dua arah — mengembalikan `date -u` di §218 →
  tertuduh; menghapus `TZ=` pada satu dari dua perintah SEBARIS → mula-mula
  LOLOS, dan itu lubang di penjaganya sendiri yang lalu ditutup dengan memecah
  per perintah
- **Hasil**: **TEMUAN**. 18 dari 20 sudah memakai `TZ=Asia/Jakarta`, dua di
  antaranya bahkan menuliskan alasannya di komentar. Dua pintu terlewat, dan
  §218 GAGAL NYATA pada pukul 23.18 UTC — gerbangnya merah tujuh jam setiap
  hari
- **Tindak**: kedua pintu diperbaiki; gerbang menumpang
  `zona-waktu-satu-suara.test.ts`

## Batas laju pada pintu pengirim email — server — 2026-08-22

- **Populasi**: 4 pemanggil `await kirimEmail(` di `apps/server/src`
- **Detektor**: DIBUKTIKAN — mencabut kedua ember → sapuan menuduh
  `modules/users/routes.ts (baris 253)`
- **Hasil**: **TEMUAN**. `POST /karyawan/undang` tak berbatas sementara dua
  pintu sekelasnya di `auth/routes.ts` sudah berbatas 6/15mnt dengan alasan
  tertulis "cegah bom email ke korban". Terukur: 20 dari 20 surat terkirim ke
  korban yang sama, nol 429 → sesudah diperbaiki 6 terkirim, 14 ditolak
- **Batas**: granularitasnya BADAN, jadi penjaga yang sah tapi tinggal di
  PEMANGGIL terbaca "tanpa penjaga" — `kirimTautanVerifikasi` persis begitu
- **Tindak**: dua ember di `users/routes.ts`; aturan `email-berbatas` di
  `penjaga-semua-pintu`; §230 verify-api

## Balasan daftar tanpa langit-langit — server — 2026-08-22

- **Populasi**: 147 `.select().from(tabel-yang-tumbuh)` di `apps/server/src`.
  41 sudah ber-`.limit()`, 29 by-id, sisanya 75 bacaan daftar penuh. Dipilah
  tangan: 24 terikat induk tunggal (baris satu faktur, item satu struk), 3
  terikat rentang tanggal, **48 tak terikat apa pun** — tumbuh seumur warung
- **Metode**: `scratchpad/tanpa-limit{,2,3,4}.py`
- **Detektor**: DIBUKTIKAN — `.limit(BATAS_TRANSAKSI_SHIFT + 1)` dicabut dari
  `shift/routes.ts` (suntikannya di-assert mendarat lebih dulu) → sapuan
  menuduh `modules/shift/routes.ts:200`; dikembalikan → hilang lagi.
  Diperiksa pula ke arah sebaliknya: hasil jendela 1.500 aksara dibandingkan
  dengan 20.000 → **0 tuduhan palsu**
- **Hasil**: **TEMUAN**, dua pintu ke ruangan yang sama di
  `modules/customer/routes.ts`. Terukur pada Postgres berisi 10.002 member dan
  satu member dengan 20.001 transaksi:

  | | sebelum | sesudah |
  |---|---|---|
  | `GET /customer` | 1,53 MB · 0,072 dtk | **0,046 MB · 0,031 dtk** |
  | `GET /customer/:id` | 2,83 MB · 0,109 dtk | **0,042 MB · 0,017 dtk** |

  Yang membuat vena ini tak selesai dengan menempelkan `.limit()`:

  1. **Agregatnya dihitung dari larik yang dikirim.** `total_belanja` dan
     `jumlah_transaksi` dijumlahkan di JavaScript atas seluruh baris, jadi
     `.limit(300)` polos akan menjawab "Total belanja Rp 3 juta" untuk member
     yang sudah belanja Rp 600 juta. Dipindah ke agregat SQL tanpa batas LEBIH
     DULU; pasangannya terukur: 20.001 dan 600.030.000 **identik** sebelum dan
     sesudah pemotongan
  2. **Halaman Member menyaring di browser** (`useMemo` atas seluruh larik).
     Memotong 300 tanpa pencarian sisi server tidak sekadar menyembunyikan
     member ke-301 — ia membuatnya **mustahil ditemukan**. Terbukti terukur:
     `Member Uji 2137` tak ada di 300 yang terkirim, ketemu lewat `?q=`
- **Pola**: pintu saudaranya ada di berkas yang SAMA. `memberCariRoutes`
  sepuluh baris di atasnya sudah mencari di server dan sudah ber-`.limit(8)`
  sejak awal
- **Batas**: sapuan hanya melihat bentuk drizzle `.select().from()` — SQL
  mentah lewat `db.execute` tak terlihat. Daftar tabelnya DITULIS TANGAN, dan
  `customers` tak ada di dalamnya: balasan 1,61 MB itu **tak pernah tertuduh**,
  ia ditemukan dengan tangan. Versi pertama juga hanya melihat rantai SESUDAH
  `.from()` — padahal daftar SELECT ada sebelumnya, jadi hampir semua agregat
  luput dan hitungannya 78, bukan 63
- **Sisa yang tercatat, bukan dikerjakan**: enam riwayat harga per-item
  sepanjang masa (`perlengkapan/routes.ts:118`, `perlengkapan/service.ts:515`
  & `:544`, `bahan/routes.ts:464`, `produksi/routes.ts:536`,
  `rekomendasi/routes.ts:183`). Bentuknya sama — daftar tanpa batas yang
  agregatnya dihitung di JS — tapi tumbuhnya jauh lebih lambat (satu baris per
  pembelian item itu). Masuk antrean sebagai vena tersendiri
- **Tindak**: kedua pintu dibatasi 300 + penanda `terpotong` /
  `transaksi_terpotong`; `?q=` sisi server memakai penyaring yang sama dengan
  `memberCariRoutes`; ratchet `daftar-tanpa-langit-langit.test.ts` (DASAR 63);
  §232 verify-api (14 asersi); `MemberPage.tsx` menampilkan kedua penanda

## Agregat dihitung di JavaScript atas daftar tak berbatas — server — 2026-08-22

- **Populasi**: 63 bacaan daftar tanpa batas atas tabel yang tumbuh (dari
  vena sebelumnya). Ditelusuri variabel penerimanya, lalu diperiksa apakah
  larik itu DIAGREGAT di JS (`.reduce(`, `.length`, `for..of`,
  `.filter().length`, `.forEach(`): **24 ya**, 32 tidak, 7 variabelnya tak
  terlacak
- **Metode**: `scratchpad/agregat-js.py`
- **Detektor**: DIBUKTIKAN — `rows.reduce((n, r) => n + r.qty, 0)` disuntikkan
  tepat sesudah kueri `rekomendasi/routes.ts:183` (suntikannya di-assert
  mendarat DUA kali: sebelum & sesudah tulis) → bentuknya berubah dari
  `for..of` jadi `.reduce(, for..of`; dicabut → pulih.
  Versi pertamanya melewatkan suntikan itu: jendela pelacak variabelnya
  dipatok ke `.from(`, padahal blok `.select({…})` bisa dua puluh baris,
  sehingga jendelanya mulai SESUDAH deklarasi variabelnya. Dipatok ulang ke
  `.select(` → yang tak terlacak turun **15 → 7**, yang tertangkap naik
  **19 → 24**
- **Hasil**: **TEMUAN**. Dari 24, dua puluh terikat sesuatu yang tak ikut
  tumbuh (baris satu faktur, item satu struk, jendela satu shift, sesi opname,
  `inArray` dari daftar induk). Yang tersisa: **kartu Riwayat Harga**, dua
  pintu ke ruangan yang sama (`bahan/routes.ts`, `perlengkapan/routes.ts`).
  Terukur pada satu bahan dengan 12.018 lot:

  | | sebelum | sesudah |
  |---|---|---|
  | `GET /bahan/:id/pembelian` | 2,098 MB · 0,092 dtk | **0,053 MB · 0,061 dtk** |

  Yang membuatnya lebih berbahaya daripada ukurannya: `harga_median` di kartu
  ini **JADI harga acuan RAB belanja** (disinkron tiap Laporan Harga), dan
  harga acuan itu dasar HPP setiap menu yang memakai bahannya. Median dari
  "300 lot terbaru" menggeser HPP seluruh menu tanpa satu pun galat muncul.
  Pasangannya diukur: ketujuh angka (`jumlah_pembelian`, `jumlah_harga_nyata`,
  `harga_rata`, `harga_median`, `harga_terkini`, `harga_terendah`,
  `harga_tertinggi`) **identik** sebelum dan sesudah pemotongan
- **Ikut ketemu**: rumus harga per satuan
  (`Math.round((total / qty) * 100) / 100`) hidup dalam **empat** salinan —
  `harga-stats.ts` ×2, `bahan/routes.ts`, `perlengkapan/routes.ts`, dan
  `stok/service.ts` (kartu FIFO). Pembulatannya bagian dari jawabannya:
  median/terendah/tertinggi dihitung DARI angka yang sudah dibulatkan itu.
  Komentar di `harga-stats.ts` sendiri sudah menulis bahwa rata-rata tertimbang
  pernah "disalin utuh di dua berkas rute — dan kedua salinan sama-sama lupa"
- **Kesalahanku, tertangkap penjagaku sendiri**: pemindai vena sebelumnya
  memotong ekor pernyataan di `;` saja. Dua kueri di dalam `Promise.all([a, b])`
  tak pernah turun ke kedalaman nol sampai `]);`, jadi ekor kueri PERTAMA
  menelan kueri kedua dan `.limit()` milik yang kedua **memaafkan** yang
  pertama — bentuk yang baru saja kutambahkan sendiri. Gerbangnya menghitung
  61, bukan 63. Diperbaiki (berhenti juga di `,` kedalaman nol) dan diperiksa
  ke belakang: pada `HEAD` sebelumnya kedua versi sama-sama 63, jadi kebutaan
  itu tak pernah menyembunyikan apa pun di masa lalu
- **Batas**: pelacakan variabel hanya mengenali `const X = await db|dbx|exec|tx`
  dalam 400 aksara sebelum `.select(` — 7 situs masih tak terlacak dan
  diperiksa mata. Bentuk agregat yang dicari lima macam; `.map()` yang
  menjumlahkan di dalam pemanggilnya tak terlihat
- **Tindak**: kedua kartu dipecah jadi dua kueri — statistik dari kueri SEMPIT
  tanpa batas (empat kolom, tanpa join), daftar `lots` berbatas 300 +
  `lots_terpotong`; `hargaPerSatuanLot` jadi satu-satunya rumus (empat salinan
  → satu); pemindai gerbang diperbaiki + asersi `Promise.all`; 4 asersi baru di
  `daftar-tanpa-langit-langit.test.ts`; §233 verify-api (13 asersi, premisnya
  memilih bahan yang BENAR-BENAR punya lot); `RiwayatHargaModal.tsx`
  menampilkan pemotongan dan menyimpulkan "ada lot tebakan" dari angka
  populasi, bukan dari larik yang dipotong

## `z.number()` tanpa batas atas — server — 2026-08-22

- **Populasi**: **109** `z.number()` di `apps/server/src` + `packages/shared/src`.
  32 sudah ber-`.max()`, **77 telanjang**
- **Metode**: `scratchpad/znumber.py`; polanya `z\s*\.\s*number\s*\(` supaya
  bentuk prettier (`harga: z\n  .number()`) ikut terlihat — pelajaran dari
  gerbang larik yang dulu buta 54%
- **Detektor**: DIBUKTIKAN — `.max(1_000_000_000_000)` dicabut dari
  `produksi/routes.ts:153` (suntikan di-assert mendarat) → tertuduh;
  dikembalikan → hilang. Pasangannya: ketiga bentuk penulisan
  (`z.number()`, multi-baris, berspasi) diperiksa cocok
- **Hasil**: **TEMUAN**. `numeric(p, s)` cuma memuat `p − s` digit di depan
  koma; `z.number()` menerima sampai 1,8e308. Terukur lewat HTTP:

  | kirim | sebelum | sesudah |
  |---|---|---|
  | `PUT /menu/:id` `mult = 9.999` | 200 | 200 |
  | `PUT /menu/:id` `mult = 10.000` | **HTTP 500** | `400 "mult: maksimal 9999"` |
  | `POST /penjualan` `qty = 99.999.999` | 201 | 201 |
  | `POST /penjualan` `qty = 1e8` | **HTTP 500** | `400 "items[0].qty: maksimal 99999999"` |
  | `POST /bahan` `harga_beli = 999.999.999.999` | 201 | 201 |
  | `POST /bahan` `harga_beli = 1e12` | **HTTP 500** | `400 "harga_beli: maksimal 999999999999"` |

  Dan yang lebih sunyi daripada 500: **apa yang lolos**. `qty = 10.000.000`
  dibalas **201**, tersimpan, lalu ikut tiap SUM — omzet hari itu terbaca
  **Rp 11.003.936.250** dari satu ketikan. Tak ada galat, tak ada peringatan
- **Pola**: aturannya SUDAH ditegakkan di empat pintu (`harga_per_unit`,
  `harga`, `dana_cair`, `realisasi`) dan tujuh puluh tujuh saudaranya
  dibiarkan. Lebih dari itu — **batas yang sudah ada pun salah**: keempatnya
  memakai `1_000_000_000_000`, satu lebih BESAR dari yang muat di
  `numeric(14,2)`. Terukur: 1e12 lolos Zod lalu jatuh 500; 1e12+1 ditolak 400.
  Pintu yang "sudah dijaga" meloloskan tepat satu nilai yang meledak
- **Batas**: gerbangnya menuntut ADANYA `.max()`, bukan bahwa angkanya cocok
  dengan kolom tujuannya — pemetaan medan → kolom tak ada di kode, jadi
  `.max()` yang kebesaran tetap lolos. Yang menjaganya `batas-angka.ts`, tempat
  tiap konstanta menyebut kolomnya. Batasnya juga TIDAK menghalangi nilai yang
  absurd-tapi-muat: `qty = 99.999.999` tetap diterima. Batas bisnis sengaja tak
  dikarang — penjaga yang menolak data sah lebih merusak daripada bug yang
  dijaganya
- **Satu pengecualian, disebut namanya**: `BahanImportRowBody`. Rute impor
  melaporkan kegagalan PER BARIS lalu meneruskan sisanya; `.max()` di situ
  memindahkan penolakan ke Zod yang membatalkan SELURUH badan — satu sel salah
  ketik di baris ke-500 membuang 999 baris yang benar. Ditemukan karena §225
  verify-api berubah merah, bukan karena kupikirkan lebih dulu. Angkanya tetap
  tak lolos ke basis data (dijaga §225). Pengecualiannya dibatasi ke DALAM
  skema itu saja, dengan uji yang membuktikan medan bernama sama di skema lain
  pada berkas yang sama tetap tertuduh
- **Kesalahanku**: uji "batas `}` menghentikan rantai" kutulis seolah terbukti;
  suntikan yang mencabutnya ternyata tetap hijau — yang menahan di situ `)`
  penutup, bukan `}`. Klaimnya diralat di komentarnya alih-alih dibiarkan
  terbaca sebagai bukti
- **Tindak**: `lib/batas-angka.ts` (7 konstanta, tiap satu menyebut kolomnya);
  77 medan diberi batas; 4 batas 1e12 yang kelebihan satu diperbaiki; gerbang
  `angka-berbatas-atas.test.ts` (5 uji, penyaring komentar supaya tak menuduh
  prosanya sendiri); §234 verify-api (10 asersi, tiap penolakan dipasangkan
  nilai sah tepat di batasnya); 4 source-pin lama disesuaikan

## Pesan galat sistem sampai ke penyewa — server — 2026-08-22

- **Populasi**: mula-mula kusapu 28 blok `catch` (17 membaca pesan galatnya).
  Itu populasi yang SALAH. `onError` global sudah rapi — galat tak tertangani
  jadi "Terjadi kesalahan pada server" — jadi satu-satunya teks yang lolos apa
  adanya `message` milik `HTTPException`. Populasi sebenarnya: **453
  `new HTTPException`** di `apps/server/src`; **88** pesannya menyisipkan nilai;
  **5** membawa teks galat sistem
- **Metode**: `scratchpad/pesan-galat{,2,3,4}.py`
- **Detektor**: DIBUKTIKAN — kebocoran baru disuntikkan ke `menu/routes.ts`
  (di-assert mendarat) → tertuduh di baris yang tepat; dicabut → hilang
- **Hasil**: **TEMUAN**, satu pintu. Empat dari lima ada di
  `admin-system/routes.ts` yang digerbang super admin — TERUKUR lewat HTTP, tak
  disimpulkan dari membaca: kelima rutenya membalas **403 untuk owner MAUPUN
  kasir**. Yang kelima `print/routes.ts`, dan itu satu-satunya yang bisa dicapai
  kasir. Terukur sebagai kasir:

  ```
  POST /print/lan {host:"192.0.2.2", port:9100}
  → "Gagal mencetak ke 192.0.2.2:9100 — connect ECONNREFUSED 192.0.2.2:9100."
  → sesudah: "… — koneksi ditolak (port tertutup atau printer mati)."
  ```

  Yang berubah **bukan** seberapa banyak yang diketahui pemanggil: ketiga
  keadaan (menjawab / menolak / diam) memang harus bisa dibedakan, dan tetap
  bisa — juga lewat waktu tunggu. Yang berubah, teksnya kini milik kita. Pesan
  pustaka bisa berganti isi kapan saja dan apa pun isinya dulu ikut keluar
- **Kebutaan detektor, ditemukan tangan bukan oleh sapuannya**: sapuan ketiga
  hanya melihat ekspresi yang disisipkan (`${e.message}`) dan karena itu buta
  terhadap `const pesan = e.message; … ${pesan}` — bentuk yang dipakai
  `print/routes.ts`, yaitu satu-satunya temuan vena ini. Sapuan keempat
  melacak variabelnya; penjaganya memakai bentuk keempat
- **Ikut diperiksa & BERSIH**: `resolveHostPrinter` menolak alamat internal
  SEBELUM menyentuh soket dan mem-pin IP hasil resolve (anti DNS-rebinding).
  Terukur sebagai kasir: `127.0.0.1`, `localhost`, `169.254.169.254`, `::1`
  → 400 "tidak diizinkan (internal)". LAN privat (`10/8`, `192.168/16`,
  `172.16/12`) memang SENGAJA diizinkan — printer LAN tinggal di sana, dan
  komentarnya menyebutnya
- **Batas**: penjaganya hanya melihat `new HTTPException`. Medan galat yang
  dibalas lewat `c.json` biasa — mis. `alasan` per baris pada impor bahan —
  tak terlihat sama sekali; yang menjaganya §225. Ia juga tak mengukur
  seberapa banyak yang bocor, cuma apakah teksnya milik kita
- **Tindak**: `sebabGagalCetak()` menerjemahkan `code` soket ke kalimat kita;
  gerbang `pesan-galat-milik-kita.test.ts` (5 uji) dengan pengecualian
  `admin-system` yang TIDAK dipercaya begitu saja — ada uji yang menuntut
  `requireSuperAdmin` masih terpasang di `/admin/*`, jadi melepas gerbangnya
  membuat pengecualiannya ikut merah; §235 verify-api (7 asersi). Mobile tak
  terpengaruh: ia mencetak lewat Bluetooth, `/print/lan` hanya dipakai web

## Uang ditulis di luar pembantu bersama — server + web + mobile — 2026-08-22

- **Populasi**: dua lapis.
  (a) **Penulisan kolom uang `sales`**: 5 `insert/update(sales)` di
  `apps/server/src`, **3** menyentuh kolom uang — semuanya di jalur kanonik
  (`createSale`, `hitungUangSetelahRefund`, rekalkulasi HPP).
  (b) **Rumusnya sendiri**, disapu lintas TIGA permukaan (server, web, mobile):
  `PB1 = round(net × tarif/100)` → 3 kemunculan; `TOTAL = subtotal − diskon`
  → 9 kemunculan
- **Metode**: `scratchpad/uang-liar.py`, `scratchpad/rumus-uang.py`
- **Detektor**: DIBUKTIKAN dua kali — penulisan uang disuntikkan ke
  `sampah/routes.ts` (di-assert mendarat) → tertuduh, dicabut → hilang; dan
  penjaga rumusnya diuji dengan bentuk yang sah maupun yang salah
- **Kebutaan detektor, ditemukan lewat silang-periksa dengan `grep`**: sapuan
  pertama menghitung **1** penulisan, padahal ada **5**. Dua sebab: pola
  `medan:` tak melihat shorthand `{ totalHpp }`, dan `.values(x)` non-literal
  dilewati diam-diam. Diperbaiki → 3 yang menyentuh uang, 0 tak terbaca
- **Hasil**: **TEMUAN — dan seluruhnya di mobile.** Sisi server & web bersih:
  web mengimpor `hitungPb1` dan komentarnya menuliskan alasannya
  ("`hitungPb1`, bukan rumusnya ditulis ulang"), penulisan `sales` semuanya
  lewat jalur kanonik. Dart tak bisa mengimpor `@kakarut/shared`, jadi mobile
  punya tiga salinan. Diadu dengan aslinya lewat **697 baris fikstur yang
  DIHASILKAN implementasi TypeScript-nya sendiri** (bukan diketik ulang):
  `tarifPb1Struk` dan `hitungUangSetelahRefund` **cocok sempurna**;
  `bayar_sheet.dart` menyimpang.

  Terukur, sapuan tarif 1,00%–15,00% × net 1…2.000.000 (**26.185.000
  pasangan**) dijalankan di JavaScript DAN di Dart — keduanya memberi pasangan
  yang sama persis:

  | net Rp 25.000, tarif 1,13% | hasil |
  |---|---|
  | `net × (tarif ÷ 100)` — server, struk | **Rp 283** |
  | `net × tarif ÷ 100` — lembar pembayaran | **Rp 282** |

  Selisihnya satu rupiah; tempatnya yang penting — layar tempat kasir membaca
  total sebelum menekan Bayar dan menghitung kembalian, dan lembar itu berbeda
  dari struk yang dicetak untuk transaksi yang sama
- **Pola**: aturannya tertulis **dua kali** — di komentar `receipt_builder.dart`
  ("urutan operasinya SENGAJA sama persis… dua urutan itu bisa berbeda di bit
  terakhir") dan di komentar `KasirPage.tsx`. Pintu pembayarannya yang tak
  mengikuti
- **Kesalahanku**: penjaga "rumusnya cuma satu salinan" versi pertama
  mencocokkan bentuk ekspresi dengan `\w*`, dan `company!.pb1Rate` memuat `!`
  dan `.` — bukan `\w`. **Bukti merah yang menyuntikkan kembali bug aslinya
  tetap HIJAU.** Diganti jadi `* … / 100` apa pun isinya + barisnya harus
  menyebut pb1/tarif, dengan pasangan uji yang membuktikan `maksPersen / 100`
  milik batas diskon tetap bebas
- **Batas**: fikstur cerminnya menguji tiga fungsi, bukan seluruh aritmetika
  uang. `TOTAL = subtotal − diskon + pb1` sendiri tak ikut diadu baris demi
  baris — ia terlalu sederhana untuk menyimpang, tapi itu penilaian, bukan
  pengukuran. Penjaga rumusnya juga hanya melihat PB1
- **Tindak**: mobile — `lib/core/uang.dart` jadi satu rumah, dua pemakainya
  memanggilnya, uji cermin 697 baris + penjaga salinan (7 uji, 3 bukti merah);
  server — `npm run acuan:uang-mobile` yang MELAHIRKAN fikstur itu, dan
  `uang-satu-rumah.test.ts` (6 uji, 3 bukti merah) yang menjaga sisi
  server/web plus asal-usul fiksturnya. Mobile: `mohteja/kakarut-mobile`
  commit `5fc0251`, PR #12

## Batas laju di luar email — server — 2026-08-22

- **Populasi**: **469 rute HTTP** dienumerasi mekanis dari `app.ts` + tiap
  modul; **12** berbatas laju (8 auth, 1 undangan, 1 sinkron, 2 tuduhan palsu
  dari nama variabel `batas…`). Sisanya 457
- **Metode**: `scratchpad/rute-mahal.py`, lalu tiap GET tanpa parameter jalur
  (100 jalur) DITEMBAK dan diukur
- **"Mahal" DIUKUR, bukan diduga**: 100 GET ditembak dua kali — terhadap seed
  (111 penjualan) dan terhadap 50.111 penjualan sepanjang setahun. Yang
  terlambat tetap 0,035 dtk.

  > ⚠️ **ANGKA ITU SALAH, dan diralat oleh vena "Indeks vs WHERE" di bawah.**
  > 50.111 baris suntikannya mendarat di PERUSAHAAN LAIN; token yang dipakai
  > mengukur milik perusahaan yang cuma punya 98 penjualan, jadi kuerinya tak
  > pernah melihat satu pun baris itu. Diukur ulang dengan tenant yang benar:
  > `GET /laporan` **0,212 dtk** pada 50 ribu dan **0,526 dtk** pada 500 ribu.
  > Temuan `POST /upload` di entri ini tetap berdiri — ia diukur lewat
  > penyimpanan, bukan lewat kueri tenant. Aturan ke-6 lahir dari sini.
- **Detektor**: DIBUKTIKAN — aturan sapuan `unggah-berbatas` di
  `penjaga-semua-pintu`, tiga suntikan (cabut dua ember, cabut satu ember,
  cabut batas ukuran) masing-masing di-assert mendarat; ketiganya tertuduh
- **Hasil**: **TEMUAN**, satu pintu: `POST /upload`. Terukur sebagai **kasir** —
  peran paling rendah yang punya token:

  | | sebelum | sesudah |
  |---|---|---|
  | 20 unggahan 5 MB berturut-turut | 100 MB dalam **0,81 dtk** | — |
  | laju | **123 MB/dtk ≈ 432 GB/jam** | berhenti di 300 MB / 15 mnt |
  | 80 percobaan | 20/20 diterima, **nol 429** | 60 diterima, **20 × 429** |

  Bentuknya sama dengan vena `z.number()`: batas per SATUAN sudah ada
  (`MAX_SIZE` 5 MB, dan `BATAS_UNGGAH` 8 MB di `app.ts`), batas LAJUNYA tidak.
  Tak ada kuota per perusahaan dan tak ada pembersihan berkas yatim, jadi
  lajunya satu-satunya pengendali yang tersedia
- **Ikut ketemu, TIDAK dikerjakan**: isi berkas tak pernah diperiksa — hanya
  `file.type` yang DIDEKLARASIKAN pengirim. 5 MB byte acak tersimpan sebagai
  `.png`, terbukti dengan `file(1)`. Bukan lubang eksekusi (berkasnya disajikan
  statis, bukan dijalankan), tapi berarti "hanya gambar" bukan pernyataan yang
  ditegakkan. Masuk antrean sebagai vena tersendiri
- **Kesalahanku**: aturan sapuannya mula-mula memakai pola yang sama dengan
  `email-berbatas` (`rateLimit\(|\bbatas[A-Z]\w*`). **Bukti merahnya gagal**:
  mencabut kedua ember dari `.post()` membiarkan definisinya utuh di berkas yang
  sama, dan sapuannya tetap hijau. Diganti ke bentuk PEMAKAIAN
  (`^\s{2,}batasUnggah\w*,$`). Itu pun masih hijau bila SATU ember tersisa,
  jadi ada uji terpisah yang menuntut keduanya
- **Batas**: sapuan latensi hanya menembak **GET tanpa parameter jalur** (100
  dari 469 rute). Rute ber-`:id` dan seluruh POST/PUT tak diukur — yang mahal di
  sana bisa saja ada, dan tak ada yang menyatakan sebaliknya. Enumerasi rutenya
  juga menghasilkan beberapa jalur artefak (`/xxxauth`) dari modul yang
  dipasang di dua prefix
- **Tindak**: dua ember di `upload/routes.ts` (60/15mnt per pengguna,
  300/15mnt per perusahaan) mengikuti bentuk `POST /karyawan/undang`; aturan
  `unggah-berbatas` di `penjaga-semua-pintu`; 4 uji di `rate-limit.test.ts`
  termasuk yang menuntut KEDUA ember terpasang; §236 verify-api (8 asersi,
  tiap penolakan berpasangan dengan yang sah)

## Isi berkas unggahan tak pernah diperiksa — server — 2026-08-22

- **Populasi**: **2** keputusan di seluruh `apps/server/src` yang bersandar pada
  tipe yang DIDEKLARASIKAN pengirim — keduanya di `upload/routes.ts`: memilih
  ekstensi berkas, dan menetapkan `ContentType` yang disimpan ke R2
- **Metode**: `scratchpad/tipe-diklaim.py` (`file.type`, header `content-type`,
  ekstensi dari nama berkas)
- **Detektor**: DIBUKTIKAN — empat suntikan, masing-masing di-assert mendarat:
  mencabut pemeriksaan tanda tangan, menambahkan `image/svg+xml` ke daftar
  terima, memindahkan `secureHeaders` ke sub-app `/api` saja, dan melonggarkan
  tanda tangan PNG. Keempatnya tertuduh
- **Hasil**: **TEMUAN — tapi bukan yang kukira, dan itu bagian pentingnya.**
  Terukur lewat HTTP: `<svg><script>alert(1)</script></svg>` dideklarasikan
  `image/png` → **201**, tersimpan `.png`, dilayani `Content-Type: image/png`.
  Lalu kuperiksa apakah ia benar-benar berbahaya, dan **tidak**:

  | penjagaan | terukur |
  |---|---|
  | `image/svg+xml` tak ada di daftar terima | SVG satu-satunya format gambar yang bisa memuat `<script>` |
  | `secureHeaders` dipasang `app.use("*")` | respons `/uploads/*` memulangkan `X-Content-Type-Options: nosniff` |

  Jadi tak ada skrip yang berjalan. Yang menahannya **dua penjagaan di HILIR**,
  dan **tak satu pun dijaga uji** sebelum vena ini. Yang pertama bahkan berupa
  KETIADAAN satu baris — dan ketiadaan tak meninggalkan jejak yang bisa dibaca
  orang berikutnya. Menambahkan satu entri SVG (perubahan yang kelihatan
  sepele dan mudah diminta) langsung menjadikannya XSS tersimpan
- **Yang benar-benar terbuka**: penyimpanannya menerima byte apa pun. Terukur:
  200 byte acak dan 5 MB byte acak sama-sama tersimpan sebagai `.png`, terbukti
  dengan `file(1)`. Bukan lubang eksekusi, tapi "hanya gambar" bukan pernyataan
  yang ditegakkan — dan bersama vena sebelumnya (unggahan tanpa batas laju) itu
  kanal menaruh data sembarang
- **Diperiksa & bersih**: tak ada satu pun tempat di server yang MEMBACA KEMBALI
  berkas unggahan (tak ada pengolah gambar, tak ada penyematan ke PDF sisi
  server), jadi tak ada pengurai yang bisa disodori berkas cacat
- **Batas**: yang diperiksa cuma beberapa byte pertama. Itu bukan pengurai
  gambar dan tak berpura-pura: berkas yang kepalanya benar tapi badannya rusak
  tetap lolos. Yang ditegakkan lebih sederhana — tipe yang DIKLAIM harus cocok
  dengan yang TERTULIS di byte-nya. Uji penjaganya juga menjalankan SALINAN
  aturannya, bukan kode rutenya; ada asersi terpisah yang menuntut salinan itu
  tak menyimpang
- **Tindak**: `cocokTandaTangan()` di `upload/routes.ts` (PNG/JPEG/WebP);
  gerbang `unggahan-hanya-gambar.test.ts` (6 uji) yang **juga menahan kedua
  penjagaan hilir** tetap di tempatnya; §237 verify-api (8 asersi, pasangan
  "gambar sah tetap diterima" ditembakkan LEBIH DULU)

## Kebijakan `ON DELETE` tiap FK — basis data — 2026-08-22

- **Populasi**: **166 foreign key**, dibaca dari **katalog Postgres sungguhan**
  (`pg_constraint`), bukan dari migrasi: **80 cascade · 18 set null · 68 NO
  ACTION**. `schema.ts` sepakat — 99 `onDelete` eksplisit (81 cascade + 18 set
  null), sisanya bawaan `NO ACTION`
- **Metode**: `scratchpad/on-delete.py` — katalog FK disilangkan dengan tabel
  yang benar-benar DIHAPUS kode
- **Detektor**: DIBUKTIKAN — tiga suntikan, masing-masing di-assert mendarat:
  menambahkan `DELETE branches`, mencabut pra-cek 409 kategori, dan mengubah
  `menus.category_id` jadi cascade. Ketiganya tertuduh
- **Hasil**: **BERSIH.** 68 FK NO ACTION bersandar pada **9** induk berbeda;
  `users` (28 anak) dan `branches` (26) yang terbanyak — dan **keduanya tak
  pernah dihapus kode sama sekali**. Satu-satunya induk NO ACTION yang dihapus
  `menu_categories`, dan penghapusannya dijaga pra-cek. Terukur lewat HTTP:

  | | terukur |
  |---|---|
  | `DELETE /kategori/:id` yang masih dipakai | **409 "Kategori masih dipakai 33 menu"** |
  | Kosongkan Tempat Sampah, penjualan sungguhan | **200**, induk hilang, `sale_items` & `sale_consumptions` ikut tersapu cascade |

  Kelas yang dulu membuat Tempat Sampah gagal dikosongkan tak lagi punya jalan
  masuk: `sales` dan `productions` — dua tabel yang dihapus permanen di sana —
  **nol** anak NO ACTION
- **Tiga kali detektorku salah, dan ketiganya kuukur bukan kuduga**:
  1. Sapuan pertama hanya melihat `.delete(tabel)` drizzle → **buta terhadap
     SQL mentah**, yaitu justru `sampah/routes.ts` — jalur yang dulu RUSAK
     karena kelas ini. Cakupan 27 → 35 tabel.
  2. Ia menuduh `DELETE /kategori/:id` yang JUSTRU BENAR, sebab pra-cek yang
     menolak dianggap bukan penjagaan. Ditambahkan sebagai cabang sah.
  3. Jendelanya ±4.000 aksara, dan itu **menyeberang ke handler tetangga**:
     mencabut pra-cek kategori tetap hijau karena 409 "nama sudah dipakai"
     milik `POST /kategori` ikut terhitung. Dipersempit ke handler-nya sendiri.
     Bukti merah baru mendarat sesudah perbaikan ketiga ini
- **Batas**: yang dijaga uji barunya STRUKTUR (`schema.ts` + situs `DELETE` di
  kode), bukan katalog basis data. Migrasi yang mengubah kebijakan FK tanpa
  menyentuh `schema.ts` tak terlihat — yang menjaga celah itu gerbang
  `drift schema vs migrasi` yang sudah ada. Kebijakan `SET NULL` (18) tak
  diperiksa sama sekali di sini: akibatnya bukan kebuntuan melainkan medan yang
  diam-diam jadi null, dan itu vena yang berbeda
- **Tindak**: tak ada perubahan kode — vena bersih. Gerbang
  `hapus-induk-tak-buntu.test.ts` (5 uji) menahan keadaannya: `users`/`branches`
  tetap tak pernah dihapus, tiap induk NO ACTION yang dihapus wajib punya jalan
  keluar tertulis, dan pra-cek kategori tetap menghitung menunya. Sisi
  perilakunya sudah dijaga verify-api yang ada — §65 (409) dan §91
  (kosongkan sampah; 500 akibat FK akan menjatuhkan `ok:true`-nya)

## Kebijakan `SET NULL`: fakta yang disimpan sebagai penunjuk — basis data — 2026-08-22

- **Populasi**: **18 FK `ON DELETE SET NULL`** dari katalog Postgres, bersandar
  pada **9 induk**. Disilangkan dengan induk yang BENAR-BENAR dihapus kode:
  hanya **4** yang hidup — `meja`, `sales`, `customers`, `cleaning_areas`.
  `users` (7 anak SET NULL), `storage_locations`, `branches`, `shifts`,
  `companies` tak pernah dihapus
- **Detektor**: DIBUKTIKAN — empat suntikan, masing-masing di-assert mendarat:
  alasan 409 dikembalikan bersandar `saleId` saja, filter pesanan
  dikembalikan, penandaan di `createSale` dicabut, dan isi-ulang migrasi
  dihapus. Keempatnya tertuduh
- **Hasil**: **TEMUAN.** `open_bills.sale_id` dipakai bukan sebagai PENUNJUK
  melainkan sebagai **BUKTI PERISTIWA** — "bill ini sudah jadi penjualan".
  FK-nya `SET NULL`, jadi begitu penjualannya dihapus permanen, Postgres
  menghapus penunjuknya dan **faktanya ikut hilang**. Pemicunya tindakan
  pemilik yang biasa saja: mengosongkan Tempat Sampah.

  Terukur ujung ke ujung lewat HTTP:

  | | sebelum | sesudah |
  |---|---|---|
  | `sale_id` sesudah sampah dikosongkan | **NULL** (`closed_at` tetap terisi) | NULL, tapi `pernah_jadi_penjualan` = true |
  | bill di `GET /pesanan` | **muncul lagi sebagai pesanan aktif** | tidak muncul |
  | bayar ulang | **`bill_dibatalkan`** | `bill_sudah_dibayar` |

  Yang kedua bukan salah kata, dan kodenya sendiri yang menuliskan bedanya:
  `bill_sudah_dibayar` = kiriman kembar, aman dibuang dari antrean;
  `bill_dibatalkan` = "membuang perintahnya berarti kehilangan satu transaksi
  sungguhan". Jadi klien offline **menahan perintah yang tak akan pernah
  berhasil**
- **Bentuknya, dan kenapa ia layak jadi kelas tersendiri**: sebuah medan boleh
  jadi null **tanpa satu baris kode pun memintanya**. Semua penjaga yang
  dipasang di jalur tulis — validasi, transaksi, kunci baris — tak menyentuh
  jalur ini sama sekali; yang menulis basis datanya sendiri
- **Batas**: gerbangnya menjaga dua pemakai yang SUDAH diketahui, bukan menyapu
  seluruh kode mencari FK-nullable yang dibaca sebagai bukti — sapuan begitu
  butuh tahu FK mana yang `SET NULL`, dan itu ada di katalog, bukan di kode.
  Yang bisa dijaga statis: **jumlah 18** tak bertambah tanpa ditinjau. Tiga
  induk hidup lainnya (`meja`, `customers`, `cleaning_areas`) diperiksa tangan
  dan medannya memang dipakai sebagai tautan, bukan bukti — `sales.customer_id`
  bahkan sudah punya kalimat konfirmasinya sendiri di web ("Transaksi lamanya
  tetap tersimpan (tanpa link member)")
- **Tindak**: kolom `open_bills.pernah_jadi_penjualan` (migrasi `0101`
  **beserta isi ulang baris lama** — tanpa itu deploy-nya sendiri yang memicu
  cacatnya); `createSale` menandainya saat menutup bill; alasan 409 dan filter
  `GET /pesanan` diturunkan dari faktanya (dengan `saleId` dipertahankan
  sebagai jaring pengaman); gerbang `fakta-bukan-penunjuk.test.ts` (8 uji);
  §238 verify-api (7 asersi, termasuk pasangan "bill yang DIBATALKAN tetap
  terbaca dibatalkan"); entri CHANGELOG untuk mobile

## CHECK yang hilang — basis data — 2026-08-22

- **Populasi**: **8 `CHECK`** untuk **59 tabel** (katalog Postgres). 32 kolom
  numeric pada tabel yang tumbuh, **tak satu pun** ber-CHECK. Sisi kode: 34
  `z.enum`, dan **27 enum Postgres asli** — jadi status memang sudah ditegakkan
  basis data; hanya 2 kolom `status` bertipe `text`, keduanya ditulis server
  sendiri
- **Detektor**: DIBUKTIKAN — empat suntikan ke DATA sungguhan (identitas uang
  digeser Rp 500, `qty_refund` dinaikkan melebihi `qty`, mutasi `pakai`
  dibalik tandanya, bill ber-`sale_id` dicabut tandanya); keempatnya tertuduh
  dan skripnya keluar dengan status 1. Ditambah tiga suntikan ke gerbang
  pemasangannya
- **Hasil**: **BERSIH pada datanya, dengan satu artefak baru.** Tiap invarian
  yang diandaikan kode kuprobe lewat rute sungguhan:

  | probe | hasil |
  |---|---|
  | refund 5 porsi dari 2 yang terjual | **400** "hanya bisa dikembalikan 2 porsi lagi" |
  | **dua refund penuh SERENTAK** | **200 + 400**, `qty_refund = 2 = qty` — kunci `FOR UPDATE` pada baris `sales` menahan yang kedua |
  | `diskon_nilai` 99.999.999 atas subtotal 1.000 | tersimpan `diskon = 0`, `total = 1.000` |
  | penulis `qty_refund`/`refund_total` | **satu pintu saja** (`refund.ts`), dan terkunci |

- **KESALAHANKU, dan ia yang paling perlu ditulis**: invarian pertamaku
  `supply_mutations.qty >= 0` menuduh **58 baris**. Kuperiksa dulu sebelum
  melaporkannya, dan ternyata **TANDA-nya yang membawa arah** — `masuk`/`terima`
  positif, `pakai`/`auto`/`kirim` negatif. Datanya benar; invariannya yang
  salah. Kalau kupercaya angka 58 itu, vena ini akan melahirkan "temuan" yang
  justru merusak semantik yang benar. Yang masuk audit akhirnya kecocokan tanda
  dengan `tipe` — dan ia lolos 0 pelanggaran
- **Artefak**: `npm run audit:invarian` — **26 invarian** dijalankan sebagai
  kueri terhadap datanya, dan CI menjalankannya **SESUDAH `verify-api.sh`**.
  Urutan itu seluruh nilainya: pada basis data yang baru di-seed audit ini
  hijau tanpa menyatakan apa pun. Terukur sesudah 2.785 asersi melewatinya
  (112 penjualan, 138 baris, 122 mutasi, 236 produksi): **26 sehat, 0
  dilanggar**
- **Kenapa bukan `CHECK` saja**: sebagian memang bisa (`qty > 0`), dan yang
  begitu sebaiknya begitu. Tapi yang paling berharga justru yang tak bisa —
  identitas `total = subtotal − diskon + pb1` menyilang empat kolom, dan
  kecocokan tanda bergantung pada enum di kolom lain. `CHECK` menolak baris
  saat DITULIS; audit ini menjawab pertanyaan yang berbeda: "sesudah semua rute
  dijalankan, adakah yang tersisa salah?"
- **Ikut diperbaiki**: penjaga `jangkar-iris` tak bisa menelusuri jangkar yang
  menunjuk `ci.yml` — `replace(/^[./]+/, "")` ikut memakan titik milik
  `.github`. Padahal `.yml` dimasukkan ke daftar ekstensinya JUSTRU supaya bisa.
  Ketahuan karena uji baru ini yang pertama memakai `indexOf` atasnya
- **Batas**: audit ini memeriksa apa yang tersisa di data, **bukan** apakah
  suatu jalur bisa menulis pelanggaran lalu memperbaikinya sendiri. Ia juga
  hanya melihat 26 invarian yang ditulis tangan — bukan seluruh invarian yang
  diandaikan kode
- **Tindak**: `scripts/audit-invarian.ts` + npm script + langkah CI sesudah
  verify-api; gerbang `audit-invarian-terpasang.test.ts` (6 uji) yang menahan
  urutan langkah CI dan jumlah invariannya; perbaikan resolver `jangkar-iris`

## Fitur lama pengerjaan pesanan (belum diurai mobile) — mobile — 2026-08-22

- **Populasi**: **8 medan kontrak** yang menyangkut fitur ini di
  `packages/shared/src/types.ts` (`durasi_detik` di tiga tipe, `masuk_pada`,
  `status_oleh`, `status_pada`, `pesanan_durasi_detik`, `target_durasi_detik`,
  `target_detik`, `lewat_target`, `bertarget`), plus satu rute laporan
  (`/laporan/durasi-pesanan`) dan satu pembantu (`durasiPesananDetik`)
- **Sapuan**: tiap kunci JSON dicari di `lib/` — hasilnya berangka:

  | kunci | dibaca Dart |
  |---|---|
  | `status_oleh`, `status_pada` | **2** masing-masing |
  | `durasi_detik` | **0** |
  | `masuk_pada` | **0** |
  | `pesanan_durasi_detik` | **0** |
  | `target_durasi_detik`, `target_detik`, `lewat_target`, `bertarget` | **0** |
  | rute `/laporan/durasi-pesanan` | tak pernah dipanggil |

- **Terukur, bukan dibaca**: satu bill dibuat lewat HTTP sungguhan, satu sajian
  ditandai selesai dua detik kemudian. `GET /pesanan` membalas
  `{"durasi_detik": 2, "status_oleh": "Kasir Cabang 2", "status_pada":
  "2026-08-22T14:54:46.065Z", "items":[{"durasi_detik": 2, …}]}` — ponsel
  membaca dua yang terakhir dan **membuang `durasi_detik`** pada kartu maupun
  barisnya
- **Bentuk diamnya**: `fromJson` yang melewatkan satu kunci tak melempar apa
  pun, dan `flutter analyze` tetap hijau karena parameternya opsional
- **KESALAHANKU, DI VENA YANG SEDANG MEMBURU KESALAHAN ITU**: saat menulis
  perbaikannya, `PesananKartu.fromJson` **sempat tidak ikut diperbaiki** —
  `analyze` hijau, dan yang menangkapnya asersi kartu di uji baru. Bukti
  merahnya menyuntikkan kembali persis keadaan itu
- **Yang TIDAK disalin, dan alasannya**: durasi tidak dihitung ulang di ponsel
  walau `masuk_pada` dan `status_pada` dua-duanya sudah ada. Aturannya (jepit di
  nol, abaikan baris batal, abaikan yang tak berwaktu) tinggal di
  `durasiPesananDetik` milik `@kakarut/shared`; salinan Dart-nya akan jadi rumus
  kedua yang bisa menyimpang diam-diam — kelas yang sudah sekali menggigit repo
  ini pada PB1. `formatDurasi` memang disalin: ia murni tampilan, jadi
  menyimpangnya berarti kata yang beda di layar, bukan angka yang beda di
  pembukuan. Kedelapan batasnya dipatok uji
- **PINTU SAUDARA yang ikut ketemu, dan diperbaiki di commit terpisah**:
  `ringkasPesanan` memilih "terakhir disentuh" dengan `String.compareTo` atas
  `status_pada` — kelas yang sama dengan vena sebelumnya, tapi di sini kedua
  sumbernya **bercampur**: stempel server selalu berpecahan 3 digit
  (`toISOString()` JavaScript), stempel optimistis ponsel 3 **atau** 6.
  Dua sentuhan dalam milidetik yang sama diurutkan terbalik, dan kartu
  menampilkan nama orang **sebelumnya**. `bandingStempel` dipindah ke
  `lib/core/waktu_stempel.dart` supaya kedua pintu memakai satu rumah
- **Batas / tersisa, dicatat bukan didiamkan**: `target_durasi_detik` per menu
  (badge "lewat target") dan laporan `/laporan/durasi-pesanan` belum ada di
  ponsel. Keduanya **layar baru**, bukan medan yang tak terurai — beda kelas
  dari vena ini, dan lebih jujur diusulkan sebagai pekerjaan tersendiri
- **Tindak**: `durasi_detik` + `masuk_pada` diurai di baris & kartu, ditampilkan
  cermin papan web (baris selesai "⏱ 2 dtk", baris jalan "masuk 21.54", kartu
  "⏱ Rampung dalam …"), `formatDurasi` di `core/format.dart`, uji
  `test/lama_pengerjaan_test.dart` (7 uji) + `test/urutan_antrean_test.dart`
  bertambah uji pintu saudara. Mobile: commit `ccd433e` & `42820f4`, PR #12

---

## Urutan pemutaran ulang antrean offline — mobile — 2026-08-22

- **Populasi**: **14 tipe perintah** yang boleh diantre (`SyncBody.tipe`
  `z.enum`), **satu** jalur penyetempelan (`SyncQueue.tambah` → `waktuServer()
  .toUtc().toIso8601String()`), **dua** tempat pengurutan di
  `pangkasAntrean` (urutan kirim + pemangkasan item gagal)
- **Kenapa urutan itu penting, DIUKUR bukan diasumsikan**: server memproses satu
  batch `/sync` berurutan (`for (const cmd of commands)`). Satu batch dua
  perintah, kasir baru yang belum absen:

  | urutan batch | `shift_buka` | `absen_saya` |
  |---|---|---|
  | `[shift_buka, absen_saya]` | **400** "Absen masuk dulu sebelum buka kasir" | 201 |
  | `[absen_saya, shift_buka]` | **201** | 201 |

- **Hasil**: **TEMUAN.** Urutannya dibandingkan sebagai **TEKS**
  (`a.waktu.compareTo(b.waktu)`), padahal `DateTime.toIso8601String()` menulis
  **tiga** digit pecahan bila mikrodetiknya nol dan **enam** bila tidak:

      2026-08-22T05:26:23.239Z        ← mikrodetik 0
      2026-08-22T05:26:23.239001Z     ← satu mikrodetik SESUDAHNYA

  `'0'` (48) < `'Z'` (90), jadi yang **belakangan dinyatakan lebih dulu**.
  Diukur langsung: dari 12 pasangan stempel yang diuji, **4** urutannya berbeda
  antara `compareTo` teks dan `compareTo` waktu
- **Yang membuatnya lebih dari sekadar sepele**: pemutus seri `prioritas()` —
  yang mendahulukan `absen_saya` di atas `shift_buka` — hanya berjalan saat
  kedua teksnya **sama persis**. Dengan panjang pecahan yang berbeda, teksnya
  tak pernah sama, jadi **pemutus seri yang ditulis khusus untuk kasus "waktunya
  seri" tidak pernah jalan di kasus itu**. Komentarnya sendiri sudah menyebut
  bahayanya (*"urutan dalam satu batch menentukan hasilnya"*) — yang meleset
  alat ukurnya, bukan pemikirannya
- **Akibatnya di lapangan**: kasir yang absen masuk lalu membuka laci saat
  offline bisa mendapati lacinya **tetap tertutup** sesudah jaringan pulih —
  tanpa satu pun galat yang menunjuk sebabnya, karena absennya sendiri berhasil
- **Detektor**: DIBUKTIKAN bisa menuduh dua kali, tiap suntikan di-assert
  mendarat — sort utama dikembalikan ke `compareTo` teks → uji INTI merah dengan
  urutan **terbalik persis**; sort pemangkasan dikembalikan → uji pasangannya
  merah
- **Sisi TypeScript diperiksa, bukan diduga**: JS `toISOString()` **selalu**
  menulis 3 digit pecahan (dijalankan, bukan diingat), dan keempat situs
  `localeCompare` atas `waktu` di server/web mengurutkan string yang **server
  sendiri** serialisasi dari kolom `timestamp`. Pembalikan itu mustahil di sana
- **Batas detektor**: yang diperiksa urutan yang DIHASILKAN `pangkasAntrean`.
  Urutan di dalam satu tipe perintah yang bergantung satu sama lain (mis. dua
  penjualan atas bill yang sama) tak diuji — server memakai `client_ref` untuk
  idempotensi, bukan urutan, jadi kelas itu tak punya bentuk kegagalan yang sama
- **Tindak**: `bandingStempel()` mengurai kedua stempel jadi `DateTime` lebih
  dulu, dengan jatuh-balik ke perbandingan teks untuk stempel yang tak bisa
  diurai (antrean versi lama) — mempertahankan urutan yang ada lebih baik
  daripada melemparkannya ke ujung daftar. Dipakai di KEDUA tempat pengurutan.
  Gerbang `test/urutan_antrean_test.dart` (7 uji), termasuk uji PREMIS yang
  memastikan kedua stempel contohnya memang berbeda panjang pecahan — kalau
  Dart suatu hari menyeragamkannya, diamnya ketahuan di situ, bukan di produksi.
  Mobile: `mohteja/kakarut-mobile` commit `061c473`, PR #12

---

## Enum status dibandingkan sebagai teks — mobile — 2026-08-22

- **Populasi**: **122** berkas Dart, **156** perbandingan teks ke medan yang
  namanya menyebut enum (`status|tipe|role|jenis|metode|kategori|sesi|sebab|
  divisi|pengadaan|peran`), **41** nilai berbeda — diadu dengan **297 baris
  kontrak server** dari TIGA sumber: 27 `pgEnum` (92 baris), `z.enum` +
  `kode`/`sebab` di rute (64 + 17), dan union literal bernama di
  `packages/shared` (124)
- **Detektor**: DIBUKTIKAN bisa menuduh tiga kali, tiap suntikan di-assert
  mendarat — (1) `r.status == 'dikonfirmasi'` → `'dikonfirmasii'` di
  `pengadaan_page.dart` → tertuduh di baris yang tepat; (2) fikstur dikosongkan
  → uji PREMIS merah, bukan INTI hijau dengan populasi nol; (3) pengupas
  komentar pembangkitnya dilumpuhkan → merah
- **EMPAT KALI DETEKTORKU SALAH**, dan tiap kali ia menuduh kode yang benar:
  1. semestanya cuma `pgEnum` (78 nilai) → **12 tuduhan palsu**. `"persen"`/
     `"nominal"` (tipe diskon), `"open_bill"` (jenis pesanan), `"gagal"`
     (status antrean) memang tak pernah jadi enum Postgres. Diperlebar ke
     seluruh kontrak: 173 nilai
  2. `sebab:` tak ikut dipungut → menuduh `'sedang_diproses'`, yang justru
     dipakai benar di dua tempat dengan komentar yang menjelaskannya
  3. komentar di dalam badan `pgEnum` ikut terbaca: `paritas tahap "diproses"`
     masuk sebagai nilai enum KELIMA yang tak pernah ada di Postgres mana pun
  4. arah B versi pertama mencocokkan nilai LINTAS KONTEKS → `'beli'`,
     `'opname'`, `'produksi'` di peta label kartu stok dikira `dokumen_jenis`
- **ASERSI HAMPA YANG KURALAT SENDIRI**: uji "komentar tak ikut jadi nilai enum"
  versi pertama menghitung nilai `supply_beli_status` — dan tetap **HIJAU** saat
  pengupasnya dicabut, karena nilai yang dikutip komentarnya (`"diproses"`)
  kebetulan juga nilai yang sah, jadi `Set` melipatnya. Diukur: keluaran
  dengan dan tanpa pengupas **identik, 0 beda**. Asersinya tak bisa gagal.
  Diganti uji sifat langsung atas masukan yang memang memancingnya (komentar
  yang mengutip nilai yang TIDAK ada di lariknya), lalu bukti merahnya diulang
  dan kali ini mendarat
- **Hasil**: **BERSIH, dua arah.**
  - **Arah A** (literal Dart di luar kontrak): **2** dari 41 — `'bt'` dan
    `'lepas'`, keduanya jenis transport printer yang tak pernah menyeberang ke
    server
  - **Arah B** (nilai kontrak yang tak ditangani Dart): dari **34** union
    literal bernama di `packages/shared`, **3** tak lengkap — dan ketiganya
    benar secara struktural:
    · `MetodeHpp` — dipakai sebagai boolean biner (`== 'average'`), jadi
      `fifo` tertangani oleh konstruksi;
    · `InvitationStatus` — hanya `pending` yang dikirim ke layar onboarding;
    · `SebabPenjualanGagal` — **DAFTAR PUTIH yang disengaja**. `sync_queue.dart`
      hanya menyebut `bill_sudah_dibayar` sebagai "sudah tercatat"; komentarnya
      menuliskan alasannya: *"sebab baru dari server otomatis diperlakukan
      sebagai gagal dan terlihat kasir, bukan diam-diam dibuang"*. Menuntut
      keempat nilainya disebut justru akan mengubah daftar putih jadi daftar
      hitam — dan itu kebalikan dari yang aman
- **Yang sudah dijaga sebelum vena ini**: `offline_queue_test.dart` sudah
  memuat perilaku daftar putih itu (`bill_dibatalkan` → tidak selesai; sebab
  tak dikenal → tidak selesai). Tak ada uji baru yang ditambahkan di situ —
  menambah salinan uji yang sudah ada bukan penjagaan, cuma angka
- **Batas detektor**: hanya melihat perbandingan `==`/`!=`/`case` ke medan yang
  NAMANYA menyebut enum. Status yang mengalir lewat variabel bernama netral
  (`v`, `x`) tak terlihat. Nilai yang dipakai sebagai kunci peta atau argumen
  fungsi juga di luar sapuan
- **Tindak**: tak ada perubahan kode — tak ada yang salah. Artefaknya TAUTAN
  MEKANIS yang selama ini tak ada: `npm run acuan:status-mobile` melahirkan
  `test/fikstur/status-kontrak-server.txt` (297 baris) di repo mobile,
  `status_cermin_server_test.dart` (5 uji) mengadu tiap literal status dengan
  fikstur itu, dan `status-satu-kontrak.test.ts` (5 uji) menjaga pembangkitnya
  supaya fikstur tak menyusut diam-diam. Mesin yang sama dengan vena uang —
  fikstur DIHASILKAN, bukan diketik ulang

---

## Invalidasi sesudah mutasi — web — 2026-08-22

- **Sudah ada penjaganya, dan batasnya ditulis sendiri.** `invalidate-kunci.test.ts`
  menjaga arah SEBALIKNYA — tiap kunci yang di-invalidate benar-benar dipakai
  suatu query (tak ada baris mati). Komentarnya: *"Ini TIDAK menjamin cakupannya
  lengkap"*. Vena ini menggarap batas itu
- **Populasi**: **124** `useMutation` di `apps/web` (64 berkas), **110** yang
  penulisannya terurai; **185** panggilan `invalidateQueries`; **89** kunci
  query berbeda
- **EMPAT KALI DETEKTORKU SALAH, dan tiap kali ia menuduh kode yang benar.**
  Dicatat satu per satu karena polanya sendiri yang berharga — setiap kesalahan
  berbentuk "menebak dari BENTUK alih-alih menelusuri":
  1. tak mengikuti pembantu lokal → menuduh `ShiftPage` (`invalidate()`) dan
     `PesananPage` (`onSettled: segarkan`). 20 → 11
  2. hanya mengenali badan panah BERKURUNG → melewatkan
     `const segarkan = () => queryClient.invalidateQueries(…)`, menuduh tiga
     mutasi `AreaKebersihanModal`. 11 → 8
  3. `re.search` memungut definisi PERTAMA di berkas → `OpnameRiwayatPage`
     punya DUA komponen yang sama-sama punya pembantu bernama `invalidate`,
     satu untuk bahan satu untuk perlengkapan; keduanya tertuduh, keduanya
     benar. Diganti "definisi terdekat SEBELUM mutasinya"
  4. tak mengikuti panggilan balik lewat PROP (`onSukses()` di anak,
     `onSukses={segarkan}` di induk) → menuduh `StokPerlengkapanTab`, yang
     penyegarannya justru paling lengkap di repo ini. Sesudahnya: **nol** mutasi
     tanpa penyegaran sama sekali
- **Aturan pertama juga salah, dan itu keputusan bukan bug**: "segarkan SEMUA
  pembaca sumber daya ini" menuduh **70** mutasi, hampir semuanya benar —
  mengganti nama meja memang tak perlu menyegarkan riwayat pengosongan meja.
  Dipersempit ke yang tak ambigu: **berkas yang SAMA membaca apa yang baru saja
  ditulisnya**. 70 → 19
- **Detektor**: DIBUKTIKAN bisa menuduh — invalidasi `["meja"]` dicabut dari
  `MejaPage.toggle` (di-assert mendarat) → tertuduh di baris yang tepat, 11 → 12;
  dikembalikan → hilang. Untuk gerbangnya: bug aslinya disuntikkan kembali →
  INTI merah menyebut `AnalisisHargaPage`; pengecualian karangan ditambahkan →
  uji "pengecualian basi" merah
- **Hasil**: **TEMUAN — satu, lewat arah ketiga yang tak terpikir di awal.**
  Sapuan "cakupan" hanya melahirkan kandidat yang semuanya sah. Yang menemukan
  bugnya justru sapuan **ILUSI AWALAN**: pencocokan TanStack membandingkan
  elemen secara UTUH, jadi `["A"]` TIDAK pernah mengenai `["A-…"]`. Ada **31
  pasangan** kunci yang tampak induk-anak padahal bukan (`stok`/`stok-fifo`,
  `perlengkapan`/`perlengkapan-master`, `menu`/`menu-riwayat-harga`, …), dan
  **5 berkas** meng-invalidate `A` sambil membaca `A-…`
- **Yang bugnya**: `AnalisisHargaPage` — tombol **"Terapkan saran"**
  MENERBITKAN baris riwayat harga (`catatHargaMenu(…, sebab:
  "terapkan_saran")`), panel yang menampilkannya ada di halaman yang sama dan
  sedang terbuka tepat di bawah baris yang ditekan, dan invalidasinya menyebut
  `["menu"]` + `["menu-analisis-harga"]` — tak satu pun mengenai
  `["menu-riwayat-harga", id]`.

  | | sebelum | sesudah |
  |---|---|---|
  | riwayat harga di server | 3 baris | **4 baris** (`harga_lama 34.000 → harga_baru 300.000`, `sebab: terapkan_saran`) |
  | yang tampil di panelnya | 3 baris | **3 baris** — tak berubah |

  Berkas itu bahkan sudah punya labelnya: `SEBAB_LABEL.terapkan_saran =
  "terapkan harga saran"`. **Ia tahu tombol ini menerbitkan baris riwayat, dan
  tetap tak menyegarkan daftar yang menampilkannya**
- **Bentuknya, lagi**: aturan ini sudah ditulis repo ini **DUA KALI**,
  panjang-panjang — di `StokPerlengkapanTab` dan `OpnameRiwayatPage`, untuk
  `perlengkapan` vs `perlengkapan-master`, lengkap dengan alasan mengapa
  `staleTime` 5 menit membuatnya lebih parah. Pintu ketiganya tetap terbuka.
  Catatan bukan penjaga
- **Empat sisa yang TIDAK diperbaiki, berikut alasannya** (masuk `DIKECUALIKAN`
  di gerbangnya): `DetailBahanPage` ×2 — `onSuccess` memanggil `navigate()`,
  halamannya lepas sebelum kuerinya dibaca lagi; `KaryawanPage` —
  `karyawan-aktivitas` itu JEJAK AUDIT, bukan turunan datanya; `ErrorLogPage` —
  modal dimuat saat dibuka. Gerbangnya menolak pengecualian yang basi
- **Batas detektor**: hanya melihat `queryKey`/`invalidateQueries` yang elemen
  pertamanya LITERAL; kunci yang dirakit dari variabel tak terbaca (penjaga
  tetangganya sudah mencatat enam di antaranya). Penelusuran pembantu berhenti
  di dua lapis dan di dalam satu berkas — invalidasi yang dilakukan komponen
  induk di BERKAS LAIN tak terlihat
- **Mobile: kelas bug ini MUSTAHIL di sana, dan itu diperiksa bukan diduga.**
  241 `ref.invalidate(...)` di `lib/`, **nol** yang berbasis string — Riverpod
  membatalkan lewat OBJEK provider, jadi tak ada awalan untuk salah dikira
  induk. Tak ada perubahan mobile untuk vena ini
- **Tindak**: satu baris di `AnalisisHargaPage` + gerbang
  `apps/server/test/invalidasi-ilusi-awalan.test.ts` (5 uji) yang mengkodekan
  aturan yang sudah dua kali ditulis itu — termasuk uji PREMIS yang menjalankan
  aturan pencocokan TanStack-nya sendiri, supaya klaimnya diuji bukan dipercaya

---

## Uang dihitung ulang di klien — web + mobile — 2026-08-22

- **Bukan pengulangan** vena "Uang ditulis di luar pembantu bersama": entri itu
  menyapu DUA rumus (`PB1`, `TOTAL = subtotal − diskon`) dan batasnya sendiri
  menuliskan sisanya. Yang disapu di sini SELURUH rupiah yang lahir di layar
- **Populasi, TIGA cara hitung** (satu cara saja pasti buta):

  | arah | apa yang dihitung | web | mobile |
  |---|---|---|---|
  | A | `formatRupiah(<ekspresi>)` — dihitung di dalam kurung render | **13** | **5** |
  | B | `formatRupiah(x)` yang `x`-nya `const` ber-aritmetika di berkas yang sama | **20** | — |
  | C | `Rp {…}` tanpa `formatRupiah` | **1** (dari 4) | — |
  | | **jumlah rupiah yang lahir di layar** | **34** | **5** |
  | | `formatRupiah` seluruhnya (pembagi) | **203** | **165** |

  Jadi **169 dari 203** render web adalah medan server apa adanya. Arah B wajib
  ada: `kembalian` (`KasirPage:597`) tak terlihat oleh arah A sama sekali
- **Detektor**: DIBUKTIKAN bisa menuduh, tiga kali, tiap suntikan di-assert
  mendarat lebih dulu — (1) `formatRupiah(totalAlpa * 25000 - 500)` → tertuduh
  di baris yang TEPAT; (2) bentuk arah B (`const dendaPalsu = …` lalu
  `formatRupiah(dendaPalsu)`) → tertuduh; (3) nama fungsi yang disapu dibuat
  tak ada → uji PREMIS-nya merah, bukan INTI-nya hijau dengan hitungan nol.
  Di mobile: satu `formatRupiah` berhitung disisipkan → 5 → 6, tertuduh
- **KESALAHAN DETEKTORKU, ditemukan oleh bukti merahnya sendiri**: arah B versi
  pertama memakai DAFTAR NAMA (`total|diskon|harga|pb1|…`) dan **melewatkan
  `upahPalsu`** — suntikan yang dibuat justru untuk mengujinya. Daftar nama
  adalah detektor yang selalu tertinggal satu kata, dan ia sudah menuduh empat
  pemanggilan yang benar pada vena sebelumnya. Diganti jadi bebas nama: apa pun
  yang dirender `formatRupiah` ADALAH rupiah menurut kodenya sendiri; tinggal
  ditanya apakah `x` datang dari server atau lahir di sini
- **Kesalahan kedua**: penghapus komentar versi pertama MEMENDEKKAN teksnya,
  jadi nomor barisnya meleset — dilaporkan `ResepPage:1012` untuk baris yang
  sebenarnya **1110**. Penghapusnya diganti yang mempertahankan posisi (komentar
  jadi spasi, `\n` dijaga), dan ada uji yang menjaga sifat itu
- **Hasil**: **BERSIH — dan diukur, bukan dibaca.** Rantai uang layar kasir
  (subtotal → diskon → batas diskon kasir → PB1 → total) disalin apa adanya dari
  `KasirPage.tsx:566–593` lalu DIADU dengan yang benar-benar dicatat server
  lewat `POST /penjualan` sungguhan, pada perusahaan ber-PB1 **11,13%** dan
  batas diskon kasir **10%**:

  | kasus | total klien | total server |
  |---|---|---|
  | polos 1 baris | 12.224 | 12.224 |
  | polos 3 baris ganjil | 128.911 | 128.911 |
  | diskon 7% (di bawah batas) | 35.139 | 35.139 |
  | diskon 10% (PAS di batas) | 34.006 | 34.006 |
  | diskon 25% (DI ATAS batas) | 34.006 | 34.006 |
  | diskon 7,5% | 114.103 | 114.103 |
  | nominal Rp 1.000 | 74.457 | 74.457 |
  | nominal Rp 50.000 (di atas batas) | 68.012 | 68.012 |
  | diskon 100% | 11.002 | 11.002 |
  | qty 7 | 113.186 | 113.186 |

  **10 kasus, 0 selisih** — subtotal, diskon, PB1, dan total keempatnya sama
  persis. Yang membuatnya begitu: layar kasir memanggil `hitungPb1` dari
  `@kakarut/shared` alih-alih menulis ulang rumusnya, dan komentarnya sendiri
  menuliskan alasannya
- **Yang HAMPIR kutuduh, dan kenapa tidak** (pagar ke-3):
  - `ResepPage:1110` `hargaBatch / isiBatch` menulis ulang `hargaPerUnit`, dan
    penjaganya justru **terbalik** — `isiBatch = isi > 0 ? isi : 0`, yaitu nol,
    persis nilai yang meledakkan pembagiannya. Tapi rendernya dikurung
    `{isiBatch > 0 && …}`. **Tak terjangkau.**
  - `RiwayatHargaModal:295` `angkaDari(hargaBaru) / isi` — `isi` sudah dinormalkan
    ke **1** di baris 41. Aman.
  - `FakturFormPage:396` `(qtyPcs / b.isi) * b.harga_beli` — `isi` bertipe
    `z.number().positive()` di SETIAP jalur tulis; nol tak bisa masuk basis data
  - `BeliPerlengkapanPage:454` `r.qty * r.harga_beli` — perlengkapan **tak punya
    `isi`**; `harga_beli` memang per satuan. Bukan `hargaPerUnit` yang disalin
  - `LaporanPage:194` `lap.omzet + lap.total_refund` — rumusnya tertulis di
    komentar DTO servernya sendiri: *"omzet kotornya = `omzet + total_refund`"*
- **`kembalian` punya EMPAT salinan** (`receipt.ts:150`, `ReceiptModal:356`,
  `KasirPage:597`, `bayar_sheet.dart:481`) dan tak punya rumah. Ketiganya
  `Math.max(0, diterima − total)`, yang keempat `diterima − total` tanpa jepitan
  tapi dikurung di titik render. **Diperiksa satu per satu: keempatnya sepakat
  untuk semua masukan.** Dicatat sebagai duplikasi TANPA penyimpangan — bukan
  temuan, karena tak ada angka yang salah. "Sepertinya berisiko" bukan temuan
- **Batas detektor**: hanya melihat yang dirender lewat `formatRupiah` (atau
  literal `Rp {…}`). Rupiah yang dihitung lalu DIKIRIM ke server tanpa pernah
  tampil di layar tak terlihat — satu-satunya yang begitu, `total_harga` di
  `StokPerlengkapanTab:452`, diperiksa tangan (`qty × harga_beli`, dan
  perlengkapan tak punya `isi`). Arah B hanya menelusuri SATU lapis `const` di
  berkas yang sama; rantai dua lapis lintas berkas tak terlihat
- **Tindak**: tak ada perubahan kode — tak ada yang salah. Artefaknya dua ratchet
  kembar: `apps/server/test/uang-dihitung-klien.test.ts` (DASAR **34**, 5 uji) dan
  `kakarut-mobile/test/uang_dihitung_layar_test.dart` (dasar **5**, 5 uji).
  **Dipasang di KEDUA repo dengan sengaja**: memasangnya hanya di web akan jadi
  contoh berikutnya dari pola yang diburu peta ini — penjaga di satu pintu,
  pintu saudaranya dibiarkan terbuka — dan permukaan ponsel itulah yang sudah
  sekali menggigit (Rp 282 vs Rp 283)
- **Ikut diperbaiki**: `jangkar-iris` merah oleh berkas uji baru ini — ia memakai
  `.indexOf("…")` tapi literal direktorinya tak berakhir "/" sehingga tak bisa
  ditelusuri. Diberi garis miring, bukan dikecualikan: gerbang yang menyapu
  dirinya sendiri ke bawah karpet berhenti menyatakan apa pun

---

## Kunci React Query & cabang di URL — web + mobile — 2026-08-22

- **Populasi**: **166** `useQuery`/`useQueries`/`useInfiniteQuery` di
  `apps/web/src`, dan **56 rute** yang badan handler-nya memanggil
  `resolveBranchId(c)` (32 di antaranya GET) di `apps/server/src`
- **Metode**: dua arah, karena keadaan yang dijaga ("cabang mana yang sedang
  dibicarakan layar ini") punya dua pintu:

  **Arah A — kunci vs URL.** Untuk tiap `useQuery`, kumpulkan pengenal yang ikut
  membentuk URL-nya, telusuri turunan `const` lokal secara transitif, lalu
  tuntut semuanya muncul di `queryKey`. **BUKAN daftar nama variabel** —
  versi pertama sapuan ini memakai daftar nama dan menuduh empat pemanggilan
  yang benar (`cabangFilter`, `asalId`, `storageBranch`, `branchSel` tak ada di
  daftarku). Hasil arah A: **13 selisih, KETIGA BELASNYA turunan lokal yang sah**
  (`branchParam` dari `cabangFilter`, `qs` dari `branchQuery`, `qsPengadaan`
  dari `scopePengadaan`, …). **Arah A BERSIH — semua 166 kunci membawa apa pun
  yang dibawa URL-nya.**

  **Arah B — URL vs server.** `resolveBranchId` untuk owner/admin berbunyi:
  `?branch_id=` bila ada, **kalau tidak cabang aktif PERTAMA**. Jadi rute
  begitu yang dipanggil tanpa `branch_id` diam-diam berbicara tentang cabang
  pertama. **Di sinilah temuannya.**
- **Detektor**: DIBUKTIKAN bisa menuduh — tiga kali, tiap suntikan diperiksa
  benar-benar mendarat lebih dulu. (1) `branchQuery` dicabut dari
  `/kosongkan` → gerbang menuduh `MejaStatusPanel.tsx:122`; (2) dicabut dari
  `PUT /meja/tata-letak` → menuduh `MejaPage.tsx:162`; (3) `branchQuery`
  dicabut dari `queryKey` (URL tetap benar) → pasangan kunci-cache merah.
  Di mobile: cabang dikembalikan ke BADAN pada `simpanTataLetak` → merah;
  satu aksi papan berhenti mengoper cabang → merah (5 → 4)
- **KESALAHAN GERBANGKU SENDIRI, ditemukan oleh bukti merahnya**: asersi
  source-pin `expect(meja).toContain("/kosongkan${branchQuery}")` tetap **HIJAU**
  saat bug aslinya kusuntikkan kembali — yang dibacanya **prosaku sendiri**,
  komentar yang mengutip bentuk benar untuk menjelaskan kenapa ia benar. Uji
  yang dijaga komentarnya sendiri adalah uji yang tak bisa gagal. Diperbaiki
  dengan `tanpaKomentar()`, lalu bukti merahnya diulang
- **Hasil**: **TEMUAN — 7 pintu di web, 6 di mobile.** Terukur terhadap Postgres
  sungguhan; meja & bill milik cabang KEDUA, token pemilik:

  | pintu | tanpa `branch_id` | dengan |
  |---|---|---|
  | `GET /meja/:id/log` | **404** | 200 |
  | `POST /meja/:id/kosongkan` | **404** | 200 |
  | `GET /pesanan/:jenis/:id/log` | **404** | 200 |
  | `POST /pesanan/:jenis/:id/status` | **404** | 200 |
  | `POST /pesanan/…/item/:it/status` | **404** | 200 |
  | `POST /pesanan/…/item/:it/sajian` | **404** | 200 |
  | `PUT /meja/tata-letak` | **200 — dan tak ada yang pindah** | 200, pindah |

  Yang terakhir jauh lebih sunyi dari 404: memindahkan meja cabang kedua ke
  (7,9) tanpa `branch_id` membalas **HTTP 200** berisi **7 meja cabang LAIN**,
  dan mejanya tetap di (0,0). Halaman menggambar denah cabang yang salah
  sebagai denah yang barusan "tersimpan"
- **Bentuknya, lagi**: setiap pintu di atas punya **kembaran di layar yang sama
  yang mengirimkannya dengan benar**. `KasirPage` menulis
  `/meja/${id}/kosongkan${branchQuery}` sejak awal; modal yang dipakai bersama
  di `MejaStatusPanel` tidak — padahal ia MENERIMA `branchQuery` sebagai prop
  dan memakainya dua baris di bawah untuk `invalidateQueries`. Papan pesanan
  memuat kartunya dengan `branch_id`, lalu menolak setiap ketukan di atasnya
- **Mobile — bentuk paling sunyi dari semuanya**: `simpanTataLetak` MENGIRIM
  cabangnya, di **badan**. `TataLetakBody` di server hanya berisi `items`, jadi
  Zod membuangnya tanpa sepatah kata dan handler-nya jatuh ke cabang pertama.
  Terukur: `branch_id` di badan → **HTTP 200**, 7 meja cabang lain, mejanya tak
  bergerak. Komentar di repositori itu **sudah menuliskan aturannya** ("[branchId]
  wajib bagi owner/admin agar server tahu denah cabang mana yang ditulis") —
  yang salah cuma tempat menaruhnya
- **Cakupan (aturan ke-5)**: dari 20 pemanggilan web yang tercocokkan ke rute
  `resolveBranchId`, **9 membawa cabang, 11 tidak**; dari 11 itu **7 temuan, 4
  sah** (2 layar peran terikat cabang, 1 `branch_id` bersyarat dari URL halaman,
  1 mengirimnya di badan sebagai `tujuan_branch_id` yang memang dibaca server).
  Keempatnya masuk `DIKECUALIKAN` berikut alasannya, dan gerbangnya menolak
  pengecualian basi
- **Batas detektor**: hanya melihat `api(...)` yang argumen pertamanya literal —
  **22 panggilan** URL-nya dirakit di variabel dan tak terbaca. Rute yang
  memilih cabang lewat `auth.branch_id` langsung (tanpa `resolveBranchId`) juga
  di luar sapuan; ia bagian populasi yang lebih luas dan belum disapu
- **Tindak**: 7 pintu web + 6 pintu mobile menempelkan cabangnya; kunci cache
  `meja-log` & `pesanan-log` ikut membawanya; `ApiClient.put` di mobile menerima
  `query`. Gerbang `apps/server/test/cabang-ikut-di-url.test.ts` (6 uji) dan
  `test/cabang_ikut_di_query_test.dart` (9 uji). Pasangan anti-hijau-palsu:
  kasir cabang 2 tanpa `branch_id` tetap **200** di keempat pintu yang diukur —
  perbaikannya tak menyentuh peran yang terikat cabang
- **Belum dikerjakan, tercatat**: server MENERIMA `branch_id` di badan
  `/meja/tata-letak` lalu membuangnya diam-diam. Menolaknya (`.strict()`) atau
  membacanya akan mengubah kegagalan sunyi itu jadi berbunyi — di luar lingkup
  vena ini

---

## Indeks vs WHERE yang benar-benar dipakai — basis data — 2026-08-22

- **Populasi**: **157 indeks** di katalog. Diukur empiris, bukan dibaca:
  statistik direset, **68 rute GET** ditembak, lalu `pg_stat_user_tables`
  ditanya tabel mana yang di-seq-scan dan berapa baris terbaca
- **Volume**: disuntikkan bertahap sampai **500.098 penjualan + 500.138 baris
  jual** (≈7 tahun warung ramai), `ANALYZE` sesudah tiap tahap
- **Hasil**: **BERSIH — tak ada indeks yang hilang.** Dari 68 rute, tepat SATU
  tabel besar di-seq-scan penuh (`sales`, lewat `/laporan/durasi-pesanan`), dan
  `EXPLAIN (ANALYZE)` menunjukkan planner-nya BENAR: filternya memilih ~100%
  baris dalam rentang yang diminta, jadi indeks tak bisa menolong. Postgres
  sudah memparalelkannya sendiri (`Parallel Seq Scan` + `Parallel Hash Join`)

  | rute | 50 ribu | 500 ribu |
  |---|---|---|
  | `GET /laporan` | 0,212 dtk | 0,526 dtk |
  | `GET /laporan/menu-laris` | 0,099 dtk | 0,604 dtk |
  | `GET /laporan/durasi-pesanan` | 0,130 dtk | 0,273 dtk |
  | rute baca lainnya (8) | — | ≤ 0,087 dtk |

- **KESALAHAN YANG DITEMUKAN, dan ia ada di ledger ini sendiri**: vena "Batas
  laju di luar email" mencatat "laporan agregat ternyata murah (0,035 dtk atas
  50.111 penjualan)". **Angka itu hasil pengukuran yang datanya tak pernah
  dilihat kuerinya**: 50.111 baris suntikannya mendarat di perusahaan LAIN,
  sementara token pengukurnya milik perusahaan dengan 98 penjualan. Kesimpulan
  itu diralat di entrinya, dan **aturan ke-6** lahir dari sini. Temuan
  `POST /upload` di entri itu tetap berdiri — ia diukur lewat penyimpanan,
  bukan lewat kueri tenant
- **Ikut terukur**: 10 laporan rentang-penuh SERENTAK membuat `GET /menu`
  melompat **0,010 → 2,073 dtk**, lalu pulih. Bentuknya sama dengan vena
  N-round-trip, tapi **tak kuperlakukan sebagai temuan**: seluruh rute laporan
  digerbang owner/admin — terukur **403 untuk kasir pada kelimanya** — jadi ini
  ciri kapasitas pada tenant yang sepuluh pemiliknya menarik laporan tujuh
  tahun bersamaan, bukan permukaan serangan. Memasang batas laju di situ tak
  menyentuh mekanismenya dan cuma akan terlihat seperti penjagaan
- **Batas**: yang diukur RUTE BACA tanpa parameter jalur (68 dari 469). Jalur
  tulis dan rute ber-`:id` tak diukur. Volume disuntikkan pada satu tenant
  besar; distribusi banyak-tenant (yang membuat `company_id` selektif) tak
  diuji, dan justru di sanalah indeks ber-prefix `company_id` paling berguna
- **Tindak**: tak ada perubahan kode — tak ada indeks yang hilang.
  `scripts/ukur-latensi.sh` dibuat sebagai penawar kesalahan di atas: ia
  **menolak berjalan** (exit 2) sampai membuktikan API benar-benar melihat data
  yang diukur, dan buktinya diambil dari balasan rutenya sendiri, bukan dari
  `SELECT count(*)`

---

## Stempel waktu dibandingkan sebagai teks — mobile + server — 2026-08-22

Vena pertama dari **usulan lanjutan** (antrean awal habis). Dipilih karena satu
alasan yang bisa ditunjuk: kelas ini sudah menggigit **dua kali**, dan
**keduanya ketemu tak sengaja**. Alatnya sudah ada; penjaganya belum.

- **Populasi**:

  | permukaan | angka |
  |---|---|
  | Dart · `.compareTo(` di `lib/` | **12** |
  | Dart · `.sort(` | **14** |
  | TS · kandidat mentah | **19** |
  | TS · di dalam `` sql`…` `` — **Postgres, bukan JS** | **8** |
  | TS · JS sungguhan | **11** |
  | TS · medan stempel **dari klien** (`z.string().datetime(`) | **2** |

- **Hasil**: **TEMUAN — yang ketiga, dan ia ketemu saat menulis penjaganya.**
  Terukur pada `urutkanPesanan`: dua kartu, B berstempel server
  `10:00:01.000Z`, A baru ditandai di ponsel sehingga berstempel optimistis
  `10:00:01.000123Z` (**lebih baru**). Urutan papannya `[B, A]` — persis
  kebalikan dari yang ditulis dokumen fungsinya sendiri (*"tanpa mengurut ulang
  dengan kunci yang sama, kartu yang baru ditandai diam di tempatnya"*)
- **DUA KALI PENJAGANYA GAGAL PADA BUKTI MERAHNYA SENDIRI**, dan keduanya
  ditulis apa adanya:
  1. Versi pertama hanya melihat **penerima** `compareTo`. Bug yang jadi alasan
     berkas itu ada — `t.compareTo(p.waktu)` — penerimanya bernama `t`, jadi
     sapuannya **melewatkannya**. Diperbaiki jadi memeriksa KEDUA sisi; sesudah
     diperlebar ia langsung menemukan dua situs lagi yang belum pernah dilihat
  2. `urutkanPesanan` menyortir `kunciUrutPesanan(b).compareTo(kunciUrutPesanan(a))`
     — seluruhnya tentang stempel, tanpa satu kata pun yang menyebut waktu.
     Sapuan berbasis nama **tak bisa** melihatnya. Batas itu **ditulis dan
     dijaga source-pin**, bukan disamarkan dengan menambah kata ke daftar nama
- **Dua tuduhan yang ternyata BENAR**: `rekap_kebersihan_page` dan
  `rekap_absen_page` membandingkan bulan `'YYYY-MM'` — **berlebar tetap**, jadi
  urutan teks = urutan waktu. Masuk `dikecualikan` berikut alasannya. Justru
  kelas ini yang membuat aturannya tak bisa "semua perbandingan waktu wajib
  lewat pembantu"
- **Sisi TypeScript: BERSIH, dan alasannya diukur bukan diandaikan.**
  `Date.prototype.toISOString()` **selalu** menulis tiga digit pecahan
  (dijalankan di uji, bukan diingat), dan kesebelas situs JS membandingkan
  stempel yang server/web sendiri hasilkan. Kedua medan stempel dari klien
  (`sync.waktu`, `admin-tenants.plan_expires_at`) sudah diurai `new Date(...)`
  di batasnya
- **Gerbangnya TIPIS di sisi TS, dan itu keputusan**: ia hanya melarang
  perbandingan teks atas stempel **yang datang dari klien**. Gerbang yang
  menuntut seluruh perbandingan stempel lewat pembantu akan menuntut pekerjaan
  pada kode yang hari ini benar — dan penjaga semacam itu dilonggarkan orang,
  bukan dipatuhi
- **Batas detektor**: sapuan Dart berbasis NAMA medan, jadi buta terhadap
  pembantu yang namanya tak menyebut waktu (dibuktikan, lalu ditutup
  source-pin). Sapuan TS hanya melihat medan ber-`z.string().datetime(`;
  stempel klien yang masuk lewat `z.string()` polos tak terlihat
- **Tindak**: 4 situs Dart → `bandingStempel`; catatan **asimetri** ditulis di
  `packages/shared/src/pesanan.ts` (kenapa versi TS-nya aman sementara
  cerminan Dart-nya wajib memakai pembantu) supaya tak ada yang
  "menyederhanakan" sisi Dart kembali. Gerbang:
  `kakarut-mobile/test/stempel_satu_banding_test.dart` (6 uji) dan
  `apps/server/test/stempel-klien-diurai.test.ts` (5 uji, termasuk uji pasangan
  yang **menjalankan** premis `toISOString()`-nya dan yang membuktikan
  pemindainya melewati `` sql`…` ``). Mobile: commit `426ae6a`, PR #12

---

## Cabang dari query dipilih di luar `resolveBranchId` — server — 2026-08-23

Vena kedua dari usulan lanjutan (usulan #2). Yang ditemukan lebih dulu bukan
venanya, melainkan **cacat di alat yang kupakai untuk mengukurnya** — jadi
entri ini punya dua bagian, dan urutannya penting.

### Bagian A — pengupas komentar buta, dan sapuannya tetap melapor

- **Gejala**: sapuan pertama vena ini mengurai **19 rute dari 40 berkas rute**,
  lalu melaporkan angkanya seperti biasa. Instrumentasi menunjukkan tabel
  `.route(...)` di `app.ts` tak pernah terbaca.
- **Sebabnya satu baris**, `apps/server/src/app.ts:144`:

  ```ts
  .use("/admin/*", requireAuth, requireSuperAdmin)
  ```

  `/*` **di dalam string literal**. Pengupas komentar naif menilai `/` tanpa
  tahu ia ada di mana, membacanya sebagai pembuka komentar blok, dan menelan
  **12.363 aksara** sisa berkas.
- **Salinannya ada TUJUH** — empat TS, tiga Dart — semuanya versi naif yang
  sama. Kelas "aturan ditulis sekali, disalin, lalu menyimpang" ternyata berlaku
  pada perkakas auditnya sendiri.
- **Kebutaan terukur** (pengupas naif vs pengupas leksikal, aksara yang
  hasilnya BERBEDA):

  | akar | berkas | terdampak | aksara |
  |---|---|---|---|
  | `apps/server/src` | 106 | 9 | **6.307** (4.167 di `app.ts` saja) |
  | `apps/web/src` | 133 | 2 | **104** |
  | `packages/shared/src` | 21 | 0 | 0 |
  | `kakarut-mobile/lib` | 123 | 3 | **157** (semuanya `//` di dalam `https://…`) |

- **Dampak pada gerbang yang SUDAH terkirim: nol, dan itu diukur bukan
  diandaikan.** `formatRupiah` 203/203 · `queryKey:` 346/346 ·
  `z.string().datetime(` 2/2 · `terikatCabang(` 35/35 · `resolveBranchId(`
  61/61. Yang berubah hanya tabel rute `app.ts` (261 → 263), dan
  `cabang-ikut-di-url.test.ts` membaca berkas itu **mentah**, jadi ia tak pernah
  terkena. Tak ada temuan lama yang perlu ditarik.
- **Versi antara pun masih salah, dengan cara lain.** Pengupas yang cuma
  melewati string literal terpeleset di `/[",\n]/` — sebuah **regex** yang
  memuat kutip ganda; kutip itu membuka string palsu yang menelan komentar
  dokumentasi di bawahnya (`apps/web/src/lib/bahanCsv.ts:36`). Kebutaan berubah
  jadi tuduhan palsu, dan itu pertukaran yang lebih buruk (pagar #3).
- **Tindak**: satu rumah per repo —
  `apps/server/src/scripts/buta-komentar.ts` dan
  `kakarut-mobile/test/util/buta_komentar.dart`; tujuh salinan dihapus, enam
  pemakai mengimpor. Pemindainya melewati string, template `${…}` (yang
  isinya kode lagi), literal regex (TS) serta string mentah/tiga-kutip dan
  komentar blok **bersarang** (Dart) sebelum menilai pembuka komentar. Kutip
  ganjil dibatasi berhenti di `\n`, jadi kerusakan terburuknya satu baris.
- **Detektor DIBUKTIKAN bisa menuduh — dan buktinya permanen**: `butaNaif`
  disimpan **di dalam** kedua berkas uji sebagai alat ukur. Tiap sifat diuji
  berpasangan: sekali menuntut versi baru benar, sekali menuntut versi naif
  memang gagal di situ (`expect(butaNaif(app)).not.toContain('.route("/admin/tenants"')`,
  dan selisihnya > 4.000 aksara). Uji yang cuma menyatakan pengupasnya ada,
  tanpa pasangan itu, tak membuktikan ia perlu.
- **Kesetaraan port diverifikasi**: implementasi TS diadu dengan referensi
  Python atas **260 berkas** — sama persis; 12 berkas yang tampak berbeda
  ternyata cuma artefak indeks UTF-16 vs titik-kode (semuanya memuat emoji),
  dan setara lagi sesudah emoji dinetralkan.

### Bagian B — venanya, dengan pengurai yang benar

- **Populasi** (sapuan ulang, seluruh `apps/server/src`):

  | ukuran | angka |
  |---|---|
  | deklarasi rute berjalur literal | **263** |
  | pemanggilan `resolveBranchId(` | **61** |
  | pemakaian `terikatCabang(` | **35** di 13 berkas |
  | pembacaan `c.req.query("branch_id")` | **15** |

  Angka "511/515 rute" dari sapuan pertamaku **salah dan dikoreksi di sini**:
  pola `.get("…"` ikut menangkap `c.get("auth")`.

- **Rumusan mentah usulan #2 ternyata BERSIH, dan itu dikatakan begitu.** Dari
  39 pembacaan `auth.branch_id` di handler tanpa `resolveBranchId`, **34** ada
  di dalam cabang `terikatCabang(...)` dan **5** dicapai owner/admin — kelimanya
  benar: `GET /auth/me` ×2 memang melaporkan cabang penggunanya sendiri, dan
  tiga sisanya di middleware izin `izinkanManajemenAtauKaryawanCk` /
  `izinkanProduksi` (`app.ts:161,165,181`), tempat `auth.branch_id` dipakai
  sebagai **identitas**, bukan pilihan.

- **Yang tidak bersih ada satu lapis di bawahnya**: dari 15 pembacaan
  `c.req.query("branch_id")`, satu di rumahnya dan enam adalah penanda
  pelebaran `=== "all"` yang selalu berpasangan dengan `resolveBranchId`.
  **Delapan sisanya menyusun saringan cabang sendiri, dan tak satu pun
  memeriksa cabang itu milik perusahaan ini.**

- **Hasil: TEMUAN.** Terukur lewat HTTP sungguhan, owner Basooopa,
  `?branch_id=` satu UUID cabang perusahaan **lain**:

  | rute | pemilihnya | sebelum | sesudah |
  |---|---|---|---|
  | `GET /meja` | `resolveBranchId` | **404** ← aturannya | 404 |
  | `GET /menu` | tulisan tangan | 200, **80 dari 81** menu | **404** |
  | `GET /perlengkapan/beli` | tulisan tangan | 200, **0 dari 53** baris | **404** |
  | `GET /kebersihan/area` | `saringCabang` (bentuk saja) | 200, **2 dari 3** area | **404** |
  | `GET /kebersihan` | `saringCabang` | 200, 0 baris | **404** |
  | `GET /pengajuan` | tulisan tangan | 200, 0 baris | **404** |
  | `GET /absensi/rekap` | tulisan tangan | 200, 0 baris | **404** |
  | `POST /perlengkapan/beli/batal-semua` | tulisan tangan | 200 `{"ok":true,"jumlah":0}` | **404** |

  Yang terakhir intinya: **operasi massal melaporkan sukses atas cabang yang tak
  ada**. Operatornya mengira sudah membersihkan; tak ada satu baris pun
  tersentuh.

- **Bukan kebocoran lintas-perusahaan, dan itu ditulis apa adanya.**
  `company_id` selalu ikut di WHERE, jadi tak ada data perusahaan lain yang
  terlihat. Yang diperbaiki **letak aturannya**, bukan lubang data — aman yang
  datang dari konjungsi di kueri lain adalah aman yang bisa hilang tanpa ada
  yang menyadarinya. Kalimat itu bukan karanganku: komentar
  `cabangTujuanPenulisan` di berkas yang **sama** sudah menuliskannya, untuk
  paruh badan-permintaan dari aturan yang sama.

- **Dua rute malah baru SEMBUH.** Sebelum perbaikan
  `GET /perlengkapan/beli?branch_id=all` → **400** (nilai `"all"` masuk ke
  perbandingan kolom uuid) dan `GET /menu?branch_id=all` → katalog kosong —
  padahal `all` adalah nilai yang dipakai setiap daftar lain. Sesudahnya
  keduanya 200 dengan isi penuh (53 dan 81).

- **Tindak**: satu pintu baru bersebelahan dengan `pastikanCabang` —
  `cabangDariQuery(c)` di `apps/server/src/middleware/auth.ts`: tak dikirim /
  `all` → `null` (tak menyaring); bukan UUID → 400 bernama; UUID → 
  `pastikanCabang` → 404 bila bukan milik perusahaan ini. Delapan situs
  memakainya; `saringCabang` lokal di `kebersihan/routes.ts` dihapus karena
  aturannya pindah utuh.

- **Gerbang + bukti merah**: `apps/server/test/cabang-satu-pemilih.test.ts`
  (12 uji). Detektornya dipisah jadi fungsi murni supaya bukti merahnya bisa
  dijalankan atas masukan **sintetis** — kelima bentuk mentah yang dipakai
  kedelapan rute sebelum perbaikan diadukan satu per satu, dan ketiga bentuk
  `=== "all"` yang sah dipastikan **tidak** tertuduh. Lalu bukti merah atas
  pohon sungguhan: `menu/routes.ts` dikembalikan ke bentuk lamanya (suntikan
  di-assert mendarat lebih dulu), sapuan menuduh `modules/menu/routes.ts:289`
  — berkas dan baris yang tepat.
- **Perilakunya dijaga terpisah dari bentuknya**: `verify-api.sh` §239, 25
  asersi — kedelapan rute 404 untuk cabang asing, plus pasangan
  anti-hijau-palsu (cabang sendiri tetap 200, `all` tetap 200, `/menu` tanpa
  param tetap penuh, nilai sampah 400 bernama). Bentuk yang benar dengan hasil
  yang salah tetap bug, jadi keduanya perlu.
- **Anti-hijau-palsu untuk penyaringnya sendiri**: satu menu dibatasi ke cabang
  Pusat lewat `menu_branches`, lalu `?branch_id=` cabang LAIN **milik
  perusahaan yang sama** → 80 dari 81 (menunya hilang, benar), `?branch_id=`
  Pusat → 81. Jadi yang ditolak hanya cabang asing; penyaringan sahnya utuh.
- **Batas detektor, jujur**: gerbangnya melihat **bentuk pembacaan query**,
  bukan apa yang terjadi pada nilainya sesudah itu. Rute yang memanggil
  `cabangDariQuery` lalu mengabaikan hasilnya tetap hijau. Ia juga tak melihat
  `branch_id` yang datang lewat **badan** permintaan (itu wilayah
  `cabangTujuanPenulisan`) maupun lewat parameter jalur.
- **Gerbang**: typecheck bersih · `npm test` **2.147 lolos / 177 berkas** ·
  `verify-api.sh` **2.810 lolos, 0 gagal** (DB segar) · `audit:invarian` 26/0 ·
  build web bersih · `flutter analyze` bersih · `flutter test` **467**.

### Aturan 7 untuk ledger ini

> **ALAT UKURNYA IKUT DIUJI.** Sapuan yang tak dibuktikan membaca apa yang
> seharusnya dibacanya membuat setiap "BERSIH" di atasnya berarti "tidak
> terbaca", bukan "aman" — dan tak ada satu uji pun yang berubah warna saat itu
> terjadi. Aturan 1 menuntut detektornya bisa MENUDUH; aturan 7 menuntut ia
> juga bisa MELIHAT.

---

## `api()` yang URL-nya dirakit di variabel — web + server — 2026-08-23

Vena ketiga dari usulan lanjutan (usulan #3), dan ia berakhir dengan bentuk
yang sama seperti putaran lalu: **alatnya TEMUAN, venanya BERSIH.**

Usulan aslinya berbunyi "22 panggilan `api()` tak terbaca sapuan #25". Angka itu
**cocok persis**. Yang tidak diduga: dua kebutaan LAIN di gerbang yang sama,
keduanya lebih besar.

### Populasi

| ukuran | gerbang #25 | sesudah |
|---|---|---|
| panggilan `api(` yang TERLIHAT di `apps/web/src` | **303** | **322** |
| · URL literal diawali `/` | 300 | 300 |
| · URL dirakit di variabel | dilewati (**22**) | diresolusi |
| rute terpetakan | **247** | **273** |
| · ber-`resolveBranchId` | **56** | **58** |
| jalur **HANTU** yang dikarang pemeta | **4** | **0** |
| **pemanggil yang benar-benar DINILAI** | **13** | **75** |
| Dart · panggilan HTTP `lib/` literal / variabel | 165 / **3** | — |

**Tiga belas.** Gerbang yang entri #25 tulis sebagai "tujuh pintu diukur"
sesungguhnya menilai 13 dari 322 panggilan `api(` — bukan karena 13 yang
relevan, melainkan karena tiga kebutaan bertumpuk.

### Tiga sebabnya, masing-masing bisa ditunjuk barisnya

1. **Peta rute memakai `export const X = new Hono` PERTAMA untuk seluruh
   berkas.** `modules/customer/routes.ts` mengekspor dua Hono yang keduanya
   terpasang (`memberCariRoutes` → `/member-cari`, lalu `customerRoutes` →
   `/customer`), jadi sepuluh rute `/customer/*` tercatat sebagai HANTU
   `/member-cari/*`. Kelas yang sama dengan `re.search` yang memungut pembantu
   senama pertama di vena #18 — dan jalur hantu lebih buruk daripada jalur yang
   hilang: pemanggil bisa dicocokkan ke rute yang tak pernah ada.
2. **Modul yang lahir dari PABRIK tak terlihat sama sekali.**
   `export const produksiRoutes = buatRuteTambahStok("produksi")` (dan
   `pembelianRoutes = …("beli")`) tak pernah cocok dengan pola `= new Hono`,
   jadi **13 rute × 2 prefiks = 26 jalur** hilang, dua di antaranya memilih
   cabang (`GET /produksi`, `GET /pembelian`).
3. **Regex pemindai patah pada `;` di argumen tipe.**
   `api\s*(?:<[^;]{0,200}?>)?\s*\(` tak mengenali
   `api<{ ok: true; jumlah: number; tanggal: string }>("/stok/awal", …)` —
   **23 dari 322** panggilan tak pernah ada baginya.

Dan satu lagi yang ketemu SAAT MEMPERBAIKI, bukan saat mengintai:
normalisasi jalur mengubah `` `/meja/tata-letak${branchQuery}` `` jadi
`/meja/tata-letak:x`, yang tak cocok ke rute mana pun — jadi tiap pemanggil
yang menempelkan query lewat interpolasi ikut dilewati. Itu penyumbang terbesar
dari 13 → 75.

### Detektor DIBUKTIKAN bisa menuduh — dan buktinya berpasangan

Bukti merah yang paling menentukan, karena ia memisahkan gerbang lama dari yang
baru pada bug yang SAMA. `RekomendasiBeliPage.buildUrl()` dicabut
`branchQuery`-nya (suntikan di-assert mendarat lebih dulu):

| | pemanggil dinilai | hasil |
|---|---|---|
| pipa **lama** | 13 → **13** | **HIJAU** — `api(buildUrl())` dilewati, bugnya tak terlihat |
| gerbang **baru** | 75 | **MERAH** di `pages/produksi/RekomendasiBeliPage.tsx:89` |

Suntikan kedua (`MejaPage` kehilangan `${branchQuery}`) juga tertuduh di berkas
& baris yang tepat — **dan pipa lama pun menangkapnya** (13 → 14). Itu ditulis
apa adanya: untuk idiom "ekor `${branchQuery}`", kebutaan normalisasinya
**saling meniadakan** — URL yang membawa cabang tak terlihat, yang kehilangan
cabang jadi terlihat. Jadi kebutaan itu nyata sebagai cakupan, bukan sebagai
lubang untuk idiom itu sendiri.

Sebelas uji sintetis menjaga tiap bagian penelusurnya, tiap-tiap berpasangan
dengan bentuk lama yang digantikannya (`REGEX_LAMA` disimpan di dalam berkas
ujinya sebagai alat ukur, seperti `butaNaif` putaran lalu).

### Empat kali penelusurnya menuduh kode yang benar, dan semuanya diperbaiki

Tak satu pun dikirim; masing-masing ketemu karena tuduhannya diperiksa tangan.

1. `PerlengkapanPage:370` tertuduh atas `GET /perlengkapan` — panggilannya
   `method: item ? "PUT" : "POST"`, dan pembaca metodenya hanya mengenali
   `method: "PUT"`, jadi terbaca GET.
2. `KategoriManagerModal:37` tertuduh atas `GET /perlengkapan` — pencarian prop
   menyapu **tiap** `endpoint=` di seluruh `apps/web`, jadi ia mewarisi nilai
   milik `RiwayatHargaModal`. Diperbaiki: hanya tag komponen yang
   DIDEFINISIKAN di berkas itu.
3. `ShiftDetailModal:49` & `RiwayatPage:41` tertuduh atas `/shift` & `/penjualan` —
   ekor `${id}` yang merupakan RUAS jalur ikut dilucuti, jadi pemanggil DETAIL
   dicocokkan ke rute DAFTAR. Diperbaiki: ekor hanya dilucuti bila ia menempel
   pada ruas (`…tata-letak${q}`), bukan bila ia ruas tersendiri (`/penjualan/${id}`).
4. Penelusur versi pertama memungut literal template dengan regex, dan berhenti
   di backtick BERSARANG — `` `/rekomendasi/beli${branchQuery ? `…` : "?"}…` ``
   terpotong jadi `/rekomendasi/beli${branchQuery ? `. Akibatnya penelusurnya
   **tampak** bekerja (bukti merahnya menuduh, karena bentuk suntikannya
   sederhana) padahal pada kode sehat ia menyumbang **NOL** pemanggil. Ketahuan
   karena angka `telusur` dicetak dan ternyata 0 — bukan karena ada uji merah.

### Hasil: BERSIH

Dengan 75 pemanggil dinilai (dari 13), **nol** temuan perilaku. Ketujuh
tuduhan yang tersisa ditelusuri satu per satu dan semuanya sah; tiga di
antaranya BARU terlihat dan mendapat baris `DIKECUALIKAN` sendiri:

| baru terlihat | kenapa benar |
|---|---|
| `TimBerandaPage` → `GET /produksi`, `GET /pembelian` | `/beranda` hanya dirutekan untuk tim/kitchen/bar (`App.tsx:200`) — peran terikat cabang; sebelumnya tak terlihat karena modul pabrik |
| `StokAwalPage:129` → `POST /stok/awal` | cabang dikirim di BADAN, dan server memilihnya lebih dulu (`stok/routes.ts:621`); sebelumnya tak terlihat karena `;` di argumen tipe |

Keempat URL variabel yang bermuara ke rute pemilih cabang membawa cabangnya:
`RekomendasiBeliPage.buildUrl()` dan `TambahStokPage:358` sama-sama
menempelkan `branchQuery`.

**Mobile: 3 panggilan berjalur variabel, ketiganya diperiksa tangan, semuanya
benar** — `operasional_repository:148` mengirim `branch_id: 'all'`,
`perlengkapan_repository:199` menempelkan `?branch_id=` bersyarat, dan
`kasir_repository:241` (`setStrukCabang`) belum punya pemanggil layar sama
sekali. Tak ada gerbang baru dipasang untuk populasi 3 yang sudah bersih.

### Batas detektor, jujur

- Penelusur nilai berhenti di **dua lompatan**. Nilai yang berpindah lebih jauh
  dari itu (prop → prop → keadaan router → prop) tak akan teresolusi — dan
  yang tak teresolusi **disebut namanya** di uji PREMIS, bukan dilewati.
- Ia melihat nilai LITERAL. Endpoint yang dirakit dari potongan
  (`"/pro" + jenis`) tak terbaca.
- Ia menilai apakah cabang ada di URL, bukan apa yang dilakukan server dengan
  nilainya. Dua pemanggil yang mengirim cabang di BADAN tetap butuh baris
  pengecualian, dan itu memang benar: badan bukan URL.

### Gerbang

typecheck bersih · `npm test` **2.161 lolos / 177 berkas**. `verify-api` tak
dijalankan ulang — tak ada rute server yang disentuh, hanya berkas uji.

---

## Laporan Lama Pesanan di ponsel — mobile — 2026-08-23

Usulan #4, dan ia bukan perburuan bug melainkan **celah yang sudah tercatat**:
vena "fitur lama pengerjaan pesanan" memperbaiki medan yang tak terurai lalu
menuliskan sisanya sebagai batas yang jujur — *"`target_durasi_detik` per menu
dan laporan `/laporan/durasi-pesanan` belum ada di ponsel. Keduanya layar baru,
bukan medan yang tak terurai."*

- **Populasi**: **20 kunci kontrak** — `LaporanDurasiPesanan` (6),
  `DurasiMenuRow` (9), `DurasiRiwayatRow` (5). Dibaca `kakarut-mobile/lib`
  sebelum putaran ini: **0**. Pemanggilan `/laporan/durasi-pesanan` dari
  ponsel: **0**. Tab di `LaporanPage` ponsel: **4 → 5**.

- **DIKERJAKAN SEPARUH, DAN ITU KEPUTUSAN SADAR.** Usulan aslinya menyebut dua
  hal: laporannya DAN penyetel target per menu. Yang kedua **sengaja tidak
  dikerjakan**: `MenuHppPage` di ponsel menulis batasnya sendiri — *"Tambah/ubah
  menu tetap di web"* — dan menyeberanginya untuk satu medan akan membuat batas
  itu berhenti berarti apa-apa. Target tetap disetel dari `MenuFormPage` di web;
  ponsel membacanya saja, lengkap dengan kolom target dan penanda "lewat
  target". Ini dicatat sebagai keputusan, bukan sebagai pekerjaan yang lupa.

- **Fiksturnya HASIL SERVER, bukan karanganku.** Data dibuat lewat HTTP
  sungguhan: satu bill dua sajian di `POST /open-bill`, ditandai selesai
  berjarak **18** dan **27** detik lewat
  `POST /pesanan/open_bill/:id/item/:it/status`, dibayar lewat `POST /penjualan`,
  lalu menunya diberi `target_durasi_detik: 20` lewat `PUT /menu/:id` — yang
  badannya memang PARSIAL (`undefined` = jangan sentuh), jadi kirimannya cuma
  satu medan. Balasan `GET /laporan/durasi-pesanan` disimpan apa adanya sebagai
  `test/fikstur/laporan-durasi-server.json`:

  | | angka |
  |---|---|
  | `jumlah` · `rata_detik` | 8 · 6 |
  | `bertarget` · `lewat_target` | 2 · 1 |
  | baris "Kerupuk Pangsit" | rata 23 · median 23 · 18–27 · target 20 · 1 lewat · `lewat_target: true` |

  Fiksturnya memuat **ketiga** keadaan target sekaligus (tanpa target,
  bertarget-lewat, bertarget-tidak-lewat), dan itu diasersi sendiri — tanpa
  itu cabang yang tak pernah dilewati tak diuji.

- **Detektor DIBUKTIKAN bisa menuduh, dan bentuknya MEKANIS bukan sekali
  suntik.** Untuk **tiap** dari 20 kunci, fiksturnya diurai dua kali — utuh dan
  tanpa kunci itu — lalu hasilnya wajib BERBEDA. Parser yang diam-diam
  mengabaikan sebuah kunci memulangkan nilai yang sama pada kedua kali, dan
  ujinya merah. Diverifikasi dengan mencabut `median_detik` dari `fromJson`
  (suntikan di-assert mendarat): tepat uji `per_menu.median_detik` yang merah.
  Ini menutup kelas yang **nyaris terkirim** di vena #30 — `fromJson` yang
  melewatkan satu kunci tak melempar apa pun, `?? 0` memulangkan nol dengan
  tenang, dan `flutter analyze` tetap hijau.

- **PENJAGANYA SENDIRI HAMPA PADA PERCOBAAN PERTAMA, dan itu ketahuan karena
  disuntik.** Aturan "biasanya lewat target" tidak boleh dihitung ulang di Dart
  (server sudah mengirim `lewat_target`; aturannya milik `lewatTargetDurasi` di
  `@kakarut/shared`). Penjaga versi pertama memakai
  `median\w*\s*[<>]=?\s*\w*[Tt]arget` — menuntut kedua nama BERSEBELAHAN. Saat
  bentuk yang sungguhan disuntikkan (`m.medianDetik > (m.targetDetik ?? …)` —
  ada `m.`, ada kurung, ada `??`), penjaganya **diam** dan 32 uji tetap hijau.
  Diperlebar jadi `[^;\n]{0,40}` di antara keduanya; suntikan yang sama langsung
  merah. Penjaga yang tak menangkap bentuk yang benar-benar ditulis orang bukan
  penjaga.

- **Dirender, bukan cuma diurai.** Vena #30 sudah membuktikan membaca kode saja
  tak cukup — dua cacat tampilan grafik per jam ketemu dengan MERENDER dan
  keduanya lolos `analyze`. `BarisMenuDurasi` karena itu dibuat publik dan
  di-`pumpWidget`: angka sampai ke layar, penanda "lewat target" muncul HANYA
  saat server bilang begitu, dan menu tanpa target tak menampilkan kata
  "target" sama sekali.

- **Yang TIDAK disalin**: aturan `lewat_target` (dijaga uji di atas) dan
  perhitungan durasinya sendiri. Yang boleh disalin cuma `formatDurasi` — ia
  murni tampilan, dan komentarnya di `core/format.dart` sudah menyatakan itu
  sejak vena #30.

- **Satu layar, satu rentang, satu cabang**: tab kelima menonton
  `laporanRentangProvider` + `laporanCabangProvider` yang sama dengan keempat
  tab lain, bukan pemilihnya sendiri. Tab yang membawa pemilihnya sendiri
  membuat dua angka di layar yang sama diam-diam berbicara tentang periode yang
  berbeda.

- **Batas, jujur**: `nomor: null` (selesai selagi bill masih terbuka) dan
  `oleh: null` (data sebelum fitur ini) **tak muncul** di data hidup, jadi
  keduanya diuji dari map yang disusun tangan — dan disebut begitu di berkas
  ujinya, bukan disamarkan sebagai fikstur server.

- **Hasil**: **20 dari 20 kunci kini diurai dan tampil.** Tak ada perubahan
  server maupun web.
- **Gerbang**: `flutter analyze` bersih · `flutter test` **503 lolos** (dari
  467) pada 3.44.7. `verify-api` tidak dijalankan ulang — tak ada rute yang
  disentuh, dan itu disebutkan alih-alih didiamkan.
- **Tindak**: `LaporanDurasi` + `DurasiMenuRow` + `DurasiRiwayatRow` di
  `operasional_models.dart`, `getLaporanDurasi` + `laporanDurasiProvider` di
  `operasional_repository.dart`, tab `⏱ Lama Pesanan` di `laporan_page.dart`,
  `test/laporan_durasi_test.dart` (36 uji) + fikstur server. Mobile: PR #12

---

## Badan permintaan yang membuang kunci diam-diam — server — 2026-08-24

Usulan #5, dan ia lahir dari bug yang **sudah menggigit**: `PUT /meja/tata-letak`
menerima `branch_id` di badan, Zod membuangnya tanpa sepatah kata, dan
akibatnya HTTP **200** yang memindahkan denah cabang LAIN (vena #25). Yang
diperbaiki waktu itu pemanggilnya. Kelasnya tidak.

- **Populasi**:

  | ukuran | angka |
  |---|---|
  | rute terpetakan | **273** |
  | ber-`zValidator("json", …)` | **114** |
  | **`.strict()` sebelum putaran ini** | **0** |
  | sesudah | **112 strict, 2 dikecualikan** |
  | pemanggil web berbadan literal, disapu | 48 (+9 ber-`...spread`) |
  | pemanggil mobile berbadan literal, disapu | 49 (+1 spread) |
  | build ponsel yang pernah rilis, disapu semuanya | **7** (1.0.0+3 … +10) |

- **DETEKTORNYA BUKAN PENGURAI TEKS, dan itu keputusan yang dibayar.** Pembaca
  skema berbasis teks yang kubangun untuk pengintaian **menuduh enam kali, dan
  keenamnya cacatnya sendiri**: `:` terner dibaca sebagai pemisah kunci (2),
  spread objek di dalam `z.object({ …, ...KoordinatBody })`, `z.object(X)`
  ber-identifier telanjang, rantai `OpnameBody.omit({…}).extend({…})`, dan
  **tabrakan nama skema antar modul** (`SupplierBody` ada di dua modul; peta
  datarku menimpanya). Sesudah empat tuduhan palsu di usulan #3, alat pengukur
  vena ini diganti: **suite yang sudah ada** — 2.161 uji satuan + 2.810 asersi
  `verify-api.sh` lewat HTTP sungguhan — dijalankan terhadap build yang sudah
  strict. Apa pun yang merah adalah ketidakcocokan NYATA.

- **Fakta Zod DIJALANKAN, bukan diingat** (zod 4.4.3 terpasang): `.strict()`
  menurun lewat `.extend()`, `.partial()`, dan `.omit()`; kodenya
  `unrecognized_keys`. Keduanya dipaku uji, jadi zod yang berubah membuat
  ujinya merah alih-alih diam-diam salah menyimpulkan.

- **Hasil: TEMUAN — LIMA ketidakcocokan, semuanya ditemukan oleh suite:**

  1. `POST /rekomendasi/menu` (pratinjau) menerima `tujuan_branch_id` yang tak
     pernah ada di `RencanaBody`. Akibat yang lebih dalam: karena kuncinya
     dibuang, pratinjaunya jatuh ke `resolveBranchId(c)` → **cabang aktif
     pertama**, sementara faktur yang diterbitkan sesudahnya memakai
     `tujuan_branch_id`. Asersi §108 selama ini **mengukur cabang yang berbeda
     dari faktur yang dibuatnya**, dan lulus hanya karena kebetulan keduanya
     tak bergantung cabang.
  2. `POST /open-bill` — **4 panggilan** mengirim `is_dine_in`, medan milik
     `SaleBody`, bukan `BillBody`.
  3. `POST /kebersihan` menerima `tanggal` yang komentar skemanya sendiri sudah
     menyatakan *"SENGAJA tidak diterima — server yang menurunkannya"*. Kini 400
     yang menyebut kuncinya; ketujuh build ponsel disapu lebih dulu dan tak satu
     pun mengirimnya.
  4. Jembatan `/sync` meneruskan `branch_id` ke `/perlengkapan/:id/pakai` — rute
     yang membaca cabangnya dari QUERY dan tak pernah membaca kunci itu.
  5. `POST /shift/tutup` — bukan cacat melainkan **keputusan yang sudah
     tertulis**; jadi pengecualian, lihat di bawah.

- **KESALAHANKU, dan suite yang menangkapnya**: perbaikan pertama untuk (4)
  mencabut `branch_id` dari badan **sebelum** `panggilInternal` sempat
  mengangkatnya ke query. Perintahnya jadi diterima, tapi potongannya mendarat
  di cabang PERTAMA — persis bug yang §208 ada untuk mencegah, dibuat ulang
  oleh perbaikanku sendiri. §208 langsung merah. Bentuk akhirnya: cabangnya
  dioper eksplisit ke `panggilInternal`, kuncinya dicabut dari badan.

- **Dua pengecualian, bernama, dan yang satu BERTANGGAL**:

  | pintu | alasan |
  |---|---|
  | `TataLetakBody` (`PUT /meja/tata-letak`) | Ketujuh build rilis (1.0.0+3 … +10) mengirim `branch_id` di badan sini — **termasuk yang terpasang hari ini**, karena perbaikannya (`4e02a0b`) belum tayang, dan repo ini **tak punya gerbang versi klien**. `.strict()` berarti ponsel lama menerima 400 saat menyimpan denah: fitur yang sekarang jalan, mati saat deploy. **Syarat cabut ditulis di kodenya.** |
  | `POST /shift/tutup` (inline) | Aturannya sudah ditulis `verify-api` §152: *"klien yang mengirim field tak dikenal tak boleh gagal menutup shift — itu terjadi tepat saat kasir mau pulang."* |

- **Pesan galatnya diberi kalimat sendiri**: tanpa kasus `unrecognized_keys`,
  pesannya jatuh ke bawaan zod (bahasa Inggris) dan `labelJalur([])` cuma
  memulangkan "Isian". `validator.ts` ada justru karena pesan validasi pernah
  tampil `[object Object]`; menambah kelas galat tanpa kalimatnya akan
  mengulang kesalahan yang sama satu tingkat lebih kecil. Terukur lewat HTTP:
  `{"error":"Isian: isian tak dikenal: kunci_ngawur"}`, kode 400.

- **Gerbang + bukti merah**:
  `apps/server/test/badan-tak-menerima-kunci-asing.test.ts` (7 uji) menjaga
  BENTUKNYA — tiap skema `zValidator("json", …)` wajib strict, dengan
  `DIKECUALIKAN` bernama, uji pasangan yang menolak pengecualian basi, dan uji
  yang menolak gerbang-yang-dipenuhi-pengecualian. Ia **sengaja tidak membaca
  himpunan kunci** — justru bagian itu yang salah enam kali.
  Bukti merah dua lapis: mencabut `.strict()` dari `SajianBody` (suntikan
  di-assert mendarat) → gerbang menuduh `modules/pesanan/routes.ts:648` dan
  `:803`; dan lewat HTTP, kunci asing → **400 bernama**, badan sah → **201**,
  serta pengecualian denah meja → tetap **200**. `verify-api.sh` §240 memaku
  ketiganya sebagai perilaku.

- **Batas detektor, jujur**: suite ini menguji jalur yang DILEWATI 2.817 asersi.
  Rute yang tak punya asersi badan sama sekali tetap strict, tapi
  ketidakcocokannya baru ketahuan saat dipakai — dan itu justru bentuk yang
  diinginkan: 400 bernama, bukan 200 yang diam.
- **Gerbang**: typecheck bersih · `npm test` **2.169 lolos / 177 berkas** ·
  `verify-api.sh` **2.817 lolos, 0 gagal** (DB segar) · `audit:invarian` 26/0 ·
  build web bersih. Mobile tak tersentuh — 49 badan yang dikirim `lib/` hari ini
  sudah bersih, disapu bukan dikira.
- **Tindak**: `.strict()` di 112 badan (33 berkas), kasus `unrecognized_keys` di
  `lib/validator.ts`, `branch_id` dicabut dari badan di jembatan `/sync`, empat
  perbaikan di `verify-api.sh` sendiri, §240 baru, dan entri
  `docs/mobile/CHANGELOG-API.md` bertanda 🔴 WAJIB.

---

## ANTREAN HABIS — 2026-08-22

Kedua puluh satu vena di antrean awal sudah digarap. Yang tersisa di bawah
adalah **usulan baru**, lahir dari celah yang tercatat di entri-entri di atas —
bukan dari daftar awal.

### Usulan, diurut menurut apa yang sudah TERBUKTI menggigit

1. ~~**Stempel waktu dibandingkan sebagai teks — sapuan menyeluruh.**~~ —
   **TERGARAP**, lihat entri di atas. Yang KETIGA ketemu saat menulis
   penjaganya (urutan papan terbalik, terukur), dan penjaganya sendiri gagal
   pada bukti merahnya dua kali sebelum benar.
2. ~~**Rute yang memilih sendiri cabangnya, arah `auth.branch_id`.**~~ —
   **TERGARAP**, lihat entri di atas. Rumusan mentahnya BERSIH (39 pembacaan:
   34 di dalam `terikatCabang`, 5 benar). Temuannya satu lapis di bawah: 8 dari
   15 pembacaan `?branch_id=` menyusun saringan sendiri tanpa memeriksa
   kepemilikan — termasuk operasi massal yang melaporkan sukses atas cabang yang
   tak ada. Ditemukan lebih dulu: pengupas komentarku sendiri buta di 7 salinan.
3. ~~**`api()` yang URL-nya dirakit di variabel.**~~ — **TERGARAP**, lihat
   entri di atas. Angka 22-nya cocok persis, tapi venanya BERSIH dan yang
   TEMUAN justru gerbangnya: ia menilai **13** dari 322 panggilan `api(`, dan
   pemetanya mengarang 4 jalur hantu sambil kehilangan 31 rute. Sesudah
   diperbaiki: **75** pemanggil dinilai, nol temuan perilaku.
4. ~~**Layar baru: target durasi per menu & laporan `/laporan/durasi-pesanan`
   di ponsel.**~~ — **TERGARAP SEPARUH**, lihat entri di atas. Laporannya
   dikerjakan (20 dari 20 kunci kontrak kini diurai, tab kelima di Laporan);
   penyetel target per menu **sengaja tidak** — `MenuHppPage` menulis batasnya
   sendiri ("Tambah/ubah menu tetap di web"), dan batas itu dipertahankan.
5. ~~**Server menerima `branch_id` di badan `/meja/tata-letak` lalu
   membuangnya.**~~ — **TERGARAP**, lihat entri di atas. 0 → **112 dari 114**
   badan JSON kini strict (2 dikecualikan, satu bertanggal). Suite yang sudah
   ada — bukan pengurai teks — menemukan **lima** ketidakcocokan nyata, dan
   pengurai teksku sendiri menuduh **enam** kali dengan salah.

### Antrean kedua — usulan #6–#10, dari celah yang ditulis entri di atas — 2026-08-24

Kelima usulan pertama tergarap. Antrean ini **tidak dikarang**: tiap entri di
berkas ini diwajibkan menulis batas detektornya sendiri (aturan 4), dan
baris-baris "Batas:" itulah bahannya. Angka di bawah **sudah diukur baca-saja**.

6. **SQL mentah — populasi yang belum pernah disapu satu kali pun.**
   Dua entri menuliskannya sebagai batas, dan pada satu di antaranya sebuah
   temuan **1,61 MB lolos karena itu** (*"Daftar tabelnya DITULIS TANGAN, dan
   `customers` tak ada di dalamnya"*). Populasi: **247** template `` sql`…` ``,
   **62** kueri lengkap, **19** situs `db.execute`, **29** tanpa sebutan
   `company_id`, **21** SELECT baris tanpa `LIMIT`.
   Kandidat hidup sudah bernama: `GET /penerimaan/anomali`
   (`penerimaan/routes.ts:447`) memulangkan SELURUH baris menggantung tanpa
   `LIMIT` lalu me-`reduce`-nya di JS — kelas yang vena "Balasan daftar tanpa
   langit-langit" tegakkan atas 147 select drizzle, tak terlihat olehnya karena
   raw SQL. Saudaranya `stok/service.ts:694` **sudah** berbatas, jadi aturannya
   ada; yang terbuka satu pintu. Kandidat kedua:
   `open-bill/backfill.ts:23` — `UPDATE` tanpa pengurungan `company_id`.
7. **Peta medan → kolom yang tak pernah ada.** *"Gerbangnya menuntut ADANYA
   `.max()`, bukan bahwa angkanya cocok dengan kolom tujuannya."* 13 konstanta
   di `batas-angka.ts` menyebut kolomnya **di komentar saja**; ~20 presisi
   `numeric(p,s)` berbeda di `schema.ts`. Ketiga belasnya cocok hari ini
   (diperiksa) — yang diusulkan **memakukannya**, memakai penelusur nilai dari
   usulan #3 untuk mengikuti `body.X` → `.values({ kolom: body.X })`.
   Kerusakannya sudah terukur sebelumnya: 1e12 lolos Zod lalu **500**.
8. **Rute yang tak pernah diukur latensinya — 401 dari 469.** *"Yang diukur
   RUTE BACA tanpa parameter jalur (68 dari 469)."* Alatnya sudah ada
   (`scripts/ukur-latensi.sh`, yang menolak mengukur sampai premisnya terbukti);
   yang kecil cakupannya. Jalur TULIS justru yang paling mahal, dan nol yang
   pernah diukur.
9. **Galat yang dibalas DI DALAM respons sukses.** Arah `c.json({error}, 4xx)`
   sudah kuukur dan **BERSIH**: 4 kemunculan, semuanya di penangan galat pusat,
   berbanding 454 `new HTTPException`. Yang terbuka arah sebelahnya — teks galat
   di dalam balasan **200** (`alasan`/`sebab` per baris), permukaan yang sudah
   terbukti membocorkan SQL mentah & UUID.
10. **Kunci JSON yang dibaca lewat variabel di ponsel** (`j[k]`). **Separuhnya
    baru tertutup**: arah badan-permintaan kini dijaga server (112 dari 114
    badan menolak kunci tak dikenal), jadi yang tersisa arah BACA saja.

## Antrean vena — belum tergarap

Diurut kasar menurut (kerusakan bila terjadi) × (peluang pola "pintu saudara"
berlaku di situ).

### Server
- [x] ~~**I/O jaringan di dalam `db.transaction`**~~ — BERSIH, lihat entri di atas
- [x] ~~**Loop tak berbatas di dalam `db.transaction`**~~ — TEMUAN, lihat entri
      "Larik badan permintaan tanpa batas atas" di atas
- [x] ~~**N round-trip di dalam transaksi, walau sudah berbatas**~~ — TEMUAN,
      lihat entri di atas. 1,47 dtk → 0,012 dtk
- [x] ~~**Balasan tanpa LIMIT**~~ — TEMUAN, lihat entri di atas.
      1,53 MB → 0,046 MB dan 2,83 MB → 0,042 MB
- [x] ~~**Riwayat harga per-item sepanjang masa**~~ — TEMUAN, lihat entri di
      atas. 2,098 MB → 0,053 MB, ketujuh angka statistiknya identik
- [x] ~~**Zod tanpa batas atas**~~ — TEMUAN, lihat entri di atas. 77 dari 109
      telanjang; 500 → 400 bernama, dan batas lama 1e12 ternyata kelebihan satu
- [x] ~~**`e.message` sampai ke klien**~~ — TEMUAN, lihat entri di atas. 5 dari
      453; 4 digerbang super admin (terukur 403), 1 bisa dicapai kasir
- [x] ~~**Uang ditulis di luar pembantu bersama**~~ — TEMUAN, lihat entri di
      atas. Server & web bersih; mobile menyimpang Rp1 pada lembar pembayaran
- [x] ~~**Batas laju di luar email**~~ — TEMUAN, lihat entri di atas. Laporan
      agregat ternyata murah (0,035 dtk atas 50.111 penjualan); yang terbuka
      `POST /upload` — 432 GB/jam dari satu akun kasir
- [x] ~~**Isi berkas unggahan tak pernah diperiksa**~~ — TEMUAN, lihat entri di
      atas. Akibatnya tertahan dua penjagaan hilir yang belum dijaga uji

### Basis data & migrasi
- [x] ~~**Kebijakan `ON DELETE`**~~ — BERSIH, lihat entri di atas. 68 FK NO
      ACTION, 9 induk; `users`/`branches` tak pernah dihapus kode
- [x] ~~**Kebijakan `SET NULL` (18 FK)**~~ — TEMUAN, lihat entri di atas. Bill
      yang sudah dibayar muncul lagi sebagai pesanan aktif sesudah sampah
      dikosongkan
- [x] ~~**CHECK yang hilang**~~ — BERSIH pada datanya, lihat entri di atas.
      Artefaknya `npm run audit:invarian` (26 invarian) yang CI jalankan
      SESUDAH verify-api
- [x] ~~**Indeks vs WHERE yang benar-benar dipakai**~~ — BERSIH, lihat entri di
      atas. Ikut meralat angka laporan pada vena "Batas laju di luar email"

### Web
- [x] ~~**Kunci React Query tanpa `branch_id`**~~ — kuncinya BERSIH (166/166),
      tapi arah sebelahnya TEMUAN: 7 pintu web + 6 mobile memanggil rute
      ber-`resolveBranchId` tanpa `branch_id` → 404, dan satu di antaranya
      **200 yang tak memindahkan apa pun**
- [x] ~~**Uang dihitung ulang di klien**~~ — BERSIH, lihat entri di atas.
      34 dari 203 render rupiah web lahir di layar; rantai uang kasir
      diadu dengan server lewat 10 penjualan sungguhan — 0 selisih
- [x] ~~**Invalidasi sesudah mutasi**~~ — TEMUAN, lihat entri di atas.
      Bukan lewat cakupan (70 tuduhan, semuanya sah) melainkan lewat ILUSI
      AWALAN: `["menu"]` tak pernah mengenai `["menu-riwayat-harga"]` —
      riwayat 3 → 4 baris di server, panelnya tetap 3
- [x] ~~**Ponsel: tombol "Daftar" di layar masuk belum membawa alamatnya**~~ —
      SELESAI 2026-09-05, lihat entri "Layar masuk ponsel diam pada KODE
      penolakan" di atas. 4 kode × 3 permukaan: ponsel bercabang 0 → 1
      (`email_tak_dikenal` → `RegisterPage(emailAwal:)`). Temuan di gerbang:
      fikstur status BUTA terhadap objek `as const` di shared — sumber ke-4
      `konst:` ditambahkan, literal ponselnya kini terikat dua arah
- [ ] **`/register` & `/resend-verification` masih netral sementara `/login` di
      sebelahnya kini bicara** — ketimpangan yang lahir 2026-09-03 dan belum
      pernah ditanyakan ke pemilik. Keduanya permukaan enumerasi yang sama;
      sesudah `/login` dibuka, netralitas keduanya melindungi lebih sedikit
      daripada sebelumnya sambil tetap membuat orang yang salah ketik alamat
      di layar daftar tak tahu apa-apa. Pilihannya dua-duanya sah — dirapatkan
      ke `/login`, atau dibiarkan sebagai batas yang disengaja — tapi harus
      dipilih, bukan diwarisi
- [ ] **`StokMasukPage`/`StokMasukRow` masih DTO lokal halaman** — dideklarasikan
      di `TambahStokPage.tsx`, bukan `packages/shared`, sehingga Lampiran A &
      fikstur ponsel tak pernah melihatnya dan medan yang server kirim bisa
      hilang dari tipenya diam-diam (`qty_teks` sudah membuktikannya: dikirim
      sejak lama, tak pernah dideklarasikan, dirakit ulang di klien). ~40 kunci
      kontrak sekaligus — putaran tersendiri
- [ ] **`rekapWindow` ditembakkan sekali PER BARIS** — `GET /shift/selisih`
      (dan kini `/selisih/ringkas`) memanggilnya untuk tiap shift kandidat, dan
      ia sendiri 2+ kueri. Terukur 2026-09-03: ~30 ms pada 39 kandidat, tumbuh
      linier, ~150 ms di langit-langit 200. Satu agregat `GROUP BY shift`
      menggantikan N panggilan — belum dikerjakan karena angkanya belum
      menuntutnya, dan itu yang akan berubah lebih dulu
- [ ] **`StokPage:58` menulis aturan lokasi menu untuk kedua kalinya** — lahir
      dari entri "Central Kitchen ditawarkan sebagai lokasi menu". Ia berbunyi
      `selTipe !== "central_kitchen" && selTipe !== "kantor"`, benar hari ini
      dan komentarnya sendiri menyebut alasannya, tapi ia pengecualian bukan
      penyertaan: tipe cabang keempat kelak lolos diam-diam. Menyatukannya ke
      `bolehJadiLokasiMenu` menuntut keputusan lebih dulu soal `selTipe`
      `undefined` (selagi `/cabang` dalam perjalanan) yang hari ini berarti tab
      Stok Menu TAMPIL — mengalirkannya lewat helper membalik itu

### Mobile
- [ ] **`shift_repository.dart:54` menelan galat jadi NOL** — provider yang
      memberi makan lencana selisih kas berbunyi `catch (_) { return 0; }`,
      jadi jaringan putus atau 403 terbaca sebagai "tak ada yang menunggu
      keputusan". Aturan "lencana gagal ≠ lencana nol" sudah ditegakkan repo
      itu sendiri lewat `badgeAsync`; pintu ini terlewat. Ditemukan saat
      putaran lencana selisih di web (2026-09-03)
- [x] ~~**Enum status dibandingkan sebagai teks**~~ — BERSIH dua arah, lihat
      entri di atas. 156 perbandingan / 41 nilai diadu dengan 297 baris
      kontrak server; artefaknya tautan mekanis yang selama ini tak ada
- [x] ~~**Urutan pemutaran ulang antrean offline**~~ — TEMUAN, lihat entri
      di atas. Stempel ISO dibandingkan sebagai TEKS, dan `toIso8601String()`
      menulis 3 digit pecahan bila mikrodetiknya nol / 6 bila tidak →
      `shift_buka` bisa mendahului `absen_saya` (terukur: 400 vs 201)
- [x] ~~**Fitur lama pengerjaan pesanan**~~ — TEMUAN, lihat entri di atas.
      `durasi_detik` & `masuk_pada` dibuang mentah-mentah (terukur: server
      kirim 2 detik, ponsel tak menampilkan apa pun). Tersisa: target per
      menu & laporan durasi — keduanya LAYAR BARU, bukan medan tak terurai
- [x] ~~**`asData` sebagai pintu keluar `AsyncValue`**~~ — TEMUAN, lihat entri
      di atas. 40 situs / 12 berkas; 35 berbawaan yang runtuh, 13 tanpa
      keadaan gagal yang terbaca → 10 terdaftar beralasan. Terukur di layar:
      provider gagal → teks `[Pengajuan]`, NOL lencana
- [x] ~~**`.value` polos pada `AsyncValue`**~~ — TEMUAN, lihat entri di atas.
      101 situs / 44 ber-`??` / 40 runtuh; yang mahal justru BUKAN di situs
      itu melainkan di `catch (_) { return []; }` milik antrean offline —
      Rp150.000 pending terbaca 0 perintah dengan `hasError` tetap false
- [x] ~~**Masukan dari query tak punya rumah**~~ — TEMUAN, lihat entri di
      atas. 47 pembacaan, 0 `zValidator("query")`; `per_page=500` mendapat
      TIGA jawaban berbeda dari tiga pintu (100/200/200, bawaan 20/20/50).
      Satu utang putaran 23 ikut dibayar (`transfer` kini `rows_terpotong`)
- [x] ~~**Bentuk balasan ditentukan tabelnya**~~ — TEMUAN LATEN, lihat entri
      di atas. 298 situs `c.json`; `BARIS_PENUH` 6 → 0; aturan "rahasia tak
      pernah dikirim utuh" 0 pelanggaran dan kini DIJAGA. Pemindainya salah
      tiga kali, ketiganya ketahuan dari dua cara menghitung yang tak cocok
- [x] ~~**Menulis ke baris yang sudah dibuang**~~ — BERSIH, lihat entri di
      atas. 40 situs tulis; 4 tuduhan dicabut berturut-turut (tiap pencabutan
      mengajari pemindainya satu bentuk penjagaan), 1 perbaikan, 1 terdaftar
      beralasan. Terukur lewat HTTP: tombol dapur pada penjualan terbuang → 404
- [x] ~~**Periksa-dulu-baru-tulis tanpa penahan**~~ — SELESAI, lihat entri di
      atas. Peninjauan ulangnya terbayar dua arah: `pastikanSuperAdmin` memang
      utang (3/8 boot bersih → 8/8), sedangkan tuduhan atas pembuatan penyewa
      DICABUT — ia sudah ditahan indeks unik dan diukur §213 sejak sebelum
      alasan utangnya ditulis. **`MAKS_UTANG` 2 → 0**, `audit:invarian` 26 → 27
- [x] ~~**Selisih kas yang MUNCUL sesudah shift ditutup tak bisa diputuskan
      siapa pun**~~ — UTANG DIBAYAR, lihat entri di atas. 400 → 200, dan alat
      ukur §280 yang ikut mati karena perbaikan ini diganti + dibuktikan masih
      bisa menuduh (3 pelanggaran). `F` 50 → 48
- [x] ~~**Pemotongan daftar yang tak dikatakan**~~ — SELESAI di sisi server,
      lihat entri di atas. **`MAKS_UTANG` 8 → 0**; tujuh pintu memakai header,
      satu memakai kunci badan, tujuh layar web ikut menampilkannya. Aturan
      mekanis BARU: tiap rute ber-`potongLarik` wajib mengambil `BATAS + 1`
      DAN punya pembaca di layar
- [x] ~~**Gerbang ponsel tak bisa dijalankan dari sesi ini**~~ — SELESAI, lihat
      entri di atas. Yang membukanya bukan menambah izin melainkan memindahkan
      PEMICUNYA: `branches: [Production, claude]`. Push ke cabang kerja kini
      digerbangi CI, dan premis run-nya (event/branch/sha) diperiksa sebelum
      warnanya dipercaya
- [x] ~~**`DIPILAH` di `query-punya-rumah` berkunci `berkas:baris`**~~ —
      SELESAI, lihat entri di atas. 39 daftar adjudikasi disapu (327 kunci
      harfiah di 34 berkas); **1 daftar / 4 entri** berkunci nomor baris, kini
      berkunci `berkas:nama-parameter`. Aturannya — sudah ditulis di 4 berkas,
      dibayar 4 kali, dijaga 0 — akhirnya punya gerbang
- [x] ~~**Header `X-Kakarut-Terpotong` belum dirender ponsel**~~ — SELESAI
      2026-09-05, lihat entri "Sepuluh daftar ponsel yang dipotong server dan
      DIAM" di atas. 13 pengirim / 2 tak dipanggil / 1 dirender / **10 diam**
      → 11 rute lewat satu rumah `daftar_dipotong.dart`, 12 layar mengaku, 8
      situs lama pindah, 3 lencana "N+" (selisih kas dari ringkas server),
      `per_page` transfer 50 → 200. Daftar rutenya dicerminkan DUA ARAH di
      gerbang server. Semula: kini **delapan**
      rute mengirimnya (`/stok/penyesuaian` yang lama + tujuh yang dibayar
      2026-08-31), plus medan badan `riwayat_terpotong` pada laporan Lama
      Pesanan. `core/api_client.dart:97` sudah punya pembacanya dan **tepat
      SATU** layar memakainya (`sampah_page.dart:81`);
      `LaporanDurasi.fromJson` (`operasional_models.dart:1305`) belum mengurai
      medannya sama sekali. `riwayat_terpotong` sudah TERDAFTAR beralasan di
      `kunci-belum-dibaca.txt`, jadi utangnya kini berangka dan bernama.
      **Kini bisa digarap** — gerbang ponselnya sudah berjalan
- [x] ~~**Kegagalan kirim email yang tak terdengar di mana pun**~~ — TEMUAN
      dari LAPORAN BUG NYATA, lihat entri di atas. 5 pemanggil `kirimEmail`;
      3 bisu total. Gerbang yang ada (`galat-ditelan-beralasan`) sudah
      MENDAFTARKAN ketiganya dan meloloskannya — ia menuntut alasan tertulis,
      dan alasannya memang tertulis. **Alasan tertulis ≠ kabar tersampaikan.**
      Daftar telanan 22 → 20 entri
- [x] ~~**Surat yang tak pernah DICOBA dikirim**~~ — TEMUAN, lanjutan laporan
      bug yang sama; lihat entri di atas. 7 pintu membalas "cek email Anda"
      tanpa menyentuh penyedia, nol jejak. Alat yang cuma bisa melaporkan
      KEGAGALAN tak bisa membedakan "berhasil" dari "tak pernah terjadi"
- [x] ~~**Bug OTP — TERJAWAB oleh instrumennya sendiri**~~ — lihat entri di
      atas. Bukan bug email: akunnya sudah terverifikasi. Yang salah layar
      yang menjanjikan surat yang tak akan datang, plus "Terkirim" yang belum
      tentu terkirim (`info.rejected` dibuang). Keduanya dibayar dan dijaga
- [x] ~~**Layar daftar dua jalan + riwayat email di halaman Sistem**~~ —
      DIBALIK atas keputusan pemilik repo, lihat entri di atas. `/register`
      memasukkan akun aktif yang passwordnya cocok (bocorannya TEPAT SAMA
      dengan `/login`); layar tunggu kembali satu jalan; riwayat jadi sub-item
      Pengaturan Email. Klaim "akun tiba-tiba terverifikasi" dijawab dari
      backfill 0065 — bukan bug. Sambil lalu: peta label web membawa sebab
      kuburan, dan §279 distaging ulang seperti §280d
- [x] ~~**Daur hidup sesi**~~ — SELESAI, lihat entri di atas. Server benar di
      semua lengan (§287, 13 asersi: kedaluwarsa, tanda tangan asing,
      nonaktif/aktif lagi/arsip pada sesi yang hidup). Temuan di WEB: 401
      yang bisu — layar login kini mengatakan sebabnya
- [x] ~~**Kebenaran angka laporan**~~ — SELESAI, lihat entri di atas. Lima
      rute dibandingkan hitungan tangan (§286, 43 asersi): server cocok
      semua. Temuan di KLIEN: "omzet sebelum refund" dirakit dari satuan yang
      berbeda (94.200 vs 92.000) → medan `omzet_sebelum_refund` dari server.
      Empat halaman laporan kini punya e2e + penjaga statis
- [x] ~~**Alur lupa/reset password di web: nol uji browser**~~ — SELESAI, lihat
      entri di atas. 2 merah dari 4 kasus pada jalan pertama: akun belum
      terverifikasi ditolak masuk SESUDAH mereset lewat inbox-nya, dan tautan
      bekas tak punya jalan keluar. Klaim surat inline ketiga dibayar ke rumah
      bersama; populasi gerbangnya 3 → 4 layar
- [x] ~~**Ponsel masih pada alur TOKEN lama untuk verifikasi email**~~ —
      TEMUAN, dibayar 2026-09-02 (entri "Putaran PONSEL" di atas): layar kode
      6 angka + tautan tetap, jeda dari `retry_after_detik` (30 → 120 milik
      server, dan sudah berjalan saat layar dibuka), balasan sesi `/register`
      → `setSession` + keterangan, 401 → sebab diucapkan layar login. Uji
      di-commit lebih dulu; bukti merah CI-nya bukti KOMPILASI, bukan
      perilaku — ditulis apa adanya di entrinya
- [ ] **Jalur `/pembelian` halaman dokumen tak punya lengan peramban** —
      kolom biaya, buku dana faktur, dan blok supplier hanya dijaga verify-api
      §291 + penjaga statis; nol uji browser. Sebabnya bukan kelalaian
      melainkan kuota: `/auth/login` 10 per 5 menit per (IP+email) dan sepuluh
      berkas spec sudah memakai akun owner. **Yang membukanya** harus lebih
      dulu memberi e2e sesi per-worker yang tak membakar kuota (sudah ditulis
      sebagai syarat di kepala `playwright.config.ts`), atau memakai akun
      manajemen kedua yang belum ada di seed
- [ ] **Kuota login menahan spec e2e ke-11** — `/auth/login` 10 per 5 menit per
      (IP+email), cache sesi `e2e/util.ts` per-MODUL, tiap berkas spec satu
      proses; SEPULUH berkas sudah memakai akun owner, jadi berkas ke-11
      memerahkan berkas lain dengan 429. Sudah menggigit DUA putaran berturut
      (halaman dokumen faktur, lalu Permintaan Stok) dan keduanya menumpang
      `pengadaan-tabel.spec.ts` — berkas itu kini memuat delapan lengan dari
      tiga subjek. **Perbaikannya** `globalSetup` Playwright yang login SEKALI
      dan membagikan tokennya lewat berkas, sebagaimana sudah ditulis sebagai
      syarat di kepala `playwright.config.ts`; sesudah itu `workers` boleh naik
      lagi. Akibat yang terukur bila tak digarap: jalur `/pembelian` bentuk
      tabel dan seluruh layar owner berikutnya tak bisa dapat lengan peramban
- [ ] **Bacaan `AsyncValue` yang penerimanya variabel lokal** — gerbang
      `nilai_async` hanya melihat `ref.watch(P)`/`ref.read(P)`, jadi
      `final v = ref.watch(p); … v.value ?? kosong` di luar berkas yang sama
      tak terhitung. Belum diukur; dicatat sebagai batas yang diketahui
