/**
 * SAPUAN: penjaga yang dipasang di SEBAGIAN pintu saja.
 *
 * KENAPA UJI INI ADA.
 *
 * Sepanjang satu sesi audit, hampir setiap bug yang ditemukan berbentuk sama —
 * dan bentuknya BUKAN "tak ada yang memikirkan aturan ini". Aturannya selalu
 * sudah dipikirkan, ditulis, bahkan dikomentari panjang. Yang terjadi:
 * penjaganya dipasang di SATU pintu menuju keadaan yang dijaga, lalu pintu
 * lain ke keadaan yang sama dibiarkan terbuka.
 *
 *   · "perusahaan tak boleh kehilangan owner terakhir" dijaga pada jalur
 *     ARSIP — tidak pada jalur TURUN PERAN, yang menghilangkan owner persis
 *     sama. Satu klik, tanpa balapan: owner 2 → 1 → 0, dibalas 200.
 *   · terjemahan bentrok unik (`tanpaBentrok`) dipakai di delapan modul —
 *     semuanya jalur GANTI NAMA. Empat jalur MEMBUAT membalas 500.
 *   · saringan `harga_tebakan` ditegakkan di jalur MENULIS harga acuan —
 *     tidak di jalur MEMBACA, yang menampilkan keempat statistiknya.
 *   · aritmetika waktu yang aman dipasang di §138 — tidak di §198, yang kena
 *     persis sama sepuluh bulan kemudian.
 *   · kunci baris induk dipasang di `PUT /menu/:id` dan `PUT /bahan/:id/resep` —
 *     tidak di TIGA jalur "ganti seluruh daftar" sekerabat, yang semuanya 500.
 *     Salah satunya, `PUT /karyawan/:userId/tempat`, bahkan MENYEBUT pintu
 *     saudaranya dengan nama di komentarnya sendiri: "Menulis ke tabel yang
 *     sama dengan PUT /penyimpanan/:id/petugas → konsisten dua arah." Tahu ada
 *     dua pintu ternyata tidak sama dengan memasang penjaga di keduanya.
 *
 * Membaca modul satu per satu tidak menemukan bentuk ini; yang menemukannya
 * selalu sapuan mekanis. Uji ini memasang sapuan itu jadi gerbang.
 *
 * CARA KERJANYA. Tiap aturan sepasang pola: `tulis` (pernyataan yang MENCAPAI
 * keadaan yang dijaga) dan `penjaga` (penanda bahwa penjaganya ada di badan
 * yang sama). Badan = seukuran handler rute atau fungsi. Yang dilaporkan:
 * pintu yang cocok `tulis` tapi tidak `penjaga`.
 *
 * IA TIDAK MENUNTUT NOL. Sebagian pintu memang sah tanpa penjaga, dan
 * masing-masing tercatat di `dasar` DENGAN ALASAN. Yang dijaga: tak ada pintu
 * BARU yang terbuka diam-diam, dan pintu yang sudah dibereskan tak boleh
 * terbuka lagi.
 *
 * BATASNYA, supaya tak dikira lebih dari yang sebenarnya:
 *  · granularitasnya BADAN, jadi penjaga yang sah tapi tinggal di PEMANGGIL
 *    tetap terbaca "tanpa penjaga" (lihat entri `buatPerusahaanUntuk`);
 *  · dan ke arah sebaliknya — yang LEBIH BERBAHAYA — satu penjaga di mana pun
 *    dalam satu badan membuat SELURUH tulisan di badan itu lolos. `provisionGuest`
 *    (seed/guest.ts) adalah contoh nyatanya: `onConflictDoUpdate` di insert
 *    `users` paling atas menutupi insert `companies`, `branches`, dan
 *    `storageLocations` di bawahnya yang tak berpenjaga sama sekali. Badan yang
 *    panjang karena itu titik butanya, bukan titik kuatnya;
 *  · ia hanya melihat bentuk yang ditulis di TypeScript, bukan SQL mentah;
 *  · daftar tabel tiap aturan adalah pilihan, bukan kelengkapan. Untuk
 *    `bentrok-unik`: ada 32 tabel berindeks unik di skema ini, dan menyapu
 *    semuanya memunculkan 20 pintu terbuka. Yang didaftarkan hanya kelas yang
 *    sudah terbukti menyakiti — indeks unik atas nama YANG DIKETIK ORANG.
 *    Sisanya utang yang diukur, bukan wilayah yang dinyatakan bersih;
 *  · dan ia hanya tahu aturan yang didaftarkan di bawah. Ia tak menemukan
 *    aturan baru — ia menjaga yang sudah dibayar mahal supaya tak bocor lagi.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const AKAR = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Potong berkas jadi "badan" seukuran handler: dari pendaftaran rute atau
 * deklarasi fungsi sampai yang berikutnya.
 *
 * `const` hanya memotong bila ia di KOLOM NOL — deklarasi tingkat berkas.
 * Versi pertama memotong pada `const` mana pun, termasuk pembantu kecil DI
 * DALAM handler (`const slugUnik = (nama) => {`). Akibatnya satu handler
 * terbelah dan penjaganya tertinggal di potongan sebelah: sapuan ini menuduh
 * `POST /bahan/bulk` "tanpa penjaga" padahal `kunciAntrean`-nya ada enam baris
 * di atas, di badan yang sama menurut siapa pun yang membacanya. Tuduhan palsu
 * lebih merusak gerbang daripada diam: ia mengajari orang mengisi `dasar`.
 */
const BATAS =
  /^\s*\.(?:post|get|put|patch|delete)\(\s*"|^\s*(?:export\s+)?(?:async\s+)?function\s+\w+|^(?:export\s+)?const\s+\w+\s*(?::[^=]+)?=\s*(?:async\s*)?\(/gm;

function badan(src: string): { baris: number; teks: string }[] {
  const batas = [...src.matchAll(BATAS)].map((m) => m.index!);
  if (batas.length === 0) return [];
  batas.push(src.length);
  const out: { baris: number; teks: string }[] = [];
  for (let i = 0; i < batas.length - 1; i += 1) {
    out.push({
      baris: src.slice(0, batas[i]).split("\n").length,
      teks: src.slice(batas[i], batas[i + 1]),
    });
  }
  return out;
}

function berkasSumber(dir: string): string[] {
  const keluar: string[] = [];
  const jelajah = (d: string) => {
    for (const nama of readdirSync(d)) {
      const p = join(d, nama);
      if (statSync(p).isDirectory()) {
        if (nama !== "node_modules") jelajah(p);
      } else if (nama.endsWith(".ts") && !nama.includes(".test.")) {
        keluar.push(p);
      }
    }
  };
  jelajah(dir);
  return keluar;
}

interface Aturan {
  nama: string;
  /** apa yang rusak kalau pintunya terbuka — untuk pembaca yang menemukannya merah */
  kenapa: string;
  tulis: RegExp;
  penjaga: RegExp;
  /** pintu tanpa penjaga yang SUDAH ditimbang: path → berapa & kenapa */
  dasar: Record<string, { pintu: number; alasan: string }>;
}

const ATURAN: Aturan[] = [
  {
    nama: "owner-terakhir",
    kenapa:
      "Perusahaan tanpa owner terkunci dari seluruh fungsi requireRole(\"owner\") — " +
      "TERMASUK mengangkat owner baru. Tak ada jalan keluar dari dalam aplikasi.",
    // Menulis `role` atau `archivedAt` pada memberships = bisa menghapus owner.
    tulis: /\.update\(\s*memberships\s*\)[\s\S]{0,400}?\.set\(\s*\{[\s\S]{0,300}?(?:archivedAt|role)\s*:/,
    penjaga: /kunciAntrean\([^)]*"owner"/,
    dasar: {
      "modules/users/service.ts": {
        pintu: 1,
        alasan:
          "`arsipkanMembershipNonaktif` — backfill boot sekali jalan (digerbang " +
          "`sekaliSaja`) yang merapikan data pra-penyatuan status: ia hanya " +
          "menyentuh membership milik user yang MEMANG SUDAH `is_active=false`, " +
          "yaitu orang yang sudah tak bisa masuk sama sekali. Tak ada owner " +
          "berjalan yang bisa hilang karenanya",
      },
      "modules/onboarding/service.ts": {
        pintu: 1,
        alasan:
          "`terimaUndangan` menyetel `archivedAt: null` — ia MEMULIHKAN " +
          "keanggotaan, bukan menghapusnya. Arah sebaliknya dari yang dijaga, " +
          "jadi ia tak pernah bisa mengurangi jumlah owner",
      },
      "seed/guest.ts": {
        pintu: 1,
        alasan:
          "penyemai akun demo — berjalan saat provisioning, bukan atas permintaan " +
          "pengguna, dan hanya menyentuh perusahaan demo miliknya sendiri",
      },
    },
  },
  {
    nama: "bentrok-unik",
    kenapa:
      "Pra-cek 'sudah ada?' selalu punya jeda sebelum tulisannya; yang menjaga " +
      "keunikan adalah INDEKSNYA. Tanpa terjemahan, yang kalah balapan menerima " +
      "23505 mentah alias 500 — dan di web itu memicu overlay 'server sedang " +
      "diperbarui'.",
    /*
     * DAFTAR TABELNYA: yang indeks uniknya berdiri di atas nama YANG DIKETIK
     * ORANG. Versi pertama cuma `users|invitations|companies` — tiga tabel yang
     * kebetulan sudah dibereskan dengan tangan — dan karena itu ia MELEWATKAN
     * `/bahan` dan `/perlengkapan`, dua pintu master-data paling ramai di POS
     * ini, yang keduanya membalas 500. Yang menemukannya bukan sapuan ini
     * melainkan menembak kesepuluh endpoint pembuatan sekaligus; daftarnya lalu
     * dilebarkan supaya pintu berikutnya tak perlu ditemukan dengan cara itu.
     *
     * Kenapa berhenti di sini dan tidak memakai SELURUH tabel berindeks unik
     * (ada 32): diukur, itu memunculkan 20 pintu terbuka, dan mendaftarkan 20
     * entri `dasar` tanpa benar-benar memeriksa satu per satu justru melanggar
     * doktrin berkas ini sendiri. Sisanya sengaja ditinggalkan sebagai utang
     * yang DIUKUR, bukan dinyatakan bersih.
     */
    tulis:
      /\.insert\(\s*(?:users|invitations|companies|branches|suppliers|storageLocations|meja|ingredients|units|menuCategories|ingredientCategories|menus|customers|supplies)\s*\)/,
    /*
     * `bentrokUnik` (bukan cuma `…Pada`) dan `onConflict` (bukan cuma
     * `…DoNothing`) — versi pertama meleset pada keduanya, dan keduanya
     * menghasilkan tuduhan palsu: `kebersihan` memakai `bentrokUnik(err)` di
     * catch, `seed/guest.ts` memakai `onConflictDoUpdate`. `kunciAntrean` juga
     * penjaga yang sah di sini: ia MENCEGAH bentroknya, bukan menerjemahkannya.
     *
     * KOSAKATA PENJAGA INI SUDAH SALAH TIGA KALI, dan tiap kali akibatnya sama:
     * sapuan menuduh kode yang BENAR, lalu tuduhan palsu itu mengajari orang
     * mengisi `dasar` — persis cara sebuah gerbang berhenti menjaga. Jadi siapa
     * pun yang memakai BENTUK PENJAGA BARU wajib menambahkannya ke sini DAN ke
     * uji-diri di bawah. `.for("update")` masuk pada ronde ketiga, setelah ia
     * menuduh dua perbaikan supplier yang baru saja dipasang.
     */
    penjaga: /bentrokUnik|tanpaBentrok|onConflict|kunciAntrean|\.for\("(?:update|share)"\)/,
    dasar: {
      "modules/auth/superadmin.ts": {
        pintu: 1,
        alasan:
          "`pastikanSuperAdmin` berjalan saat BOOT di dalam try/catch yang sengaja " +
          "tak menggagalkan boot (lihat index.ts). Dua instance yang boot " +
          "bersamaan membuat satu di antaranya mencatat galat lalu lanjut — tak " +
          "ada pengguna yang menerima 500, dan akunnya tetap tepat satu",
      },
      "modules/onboarding/service.ts": {
        pintu: 1,
        alasan:
          "`buatPerusahaanUntuk` MEMANG dijaga, tapi penjaganya di PEMANGGIL — " +
          "`POST /onboarding/perusahaan` mengulang transaksinya saat " +
          "`companies_slug_unique` bentrok, sebab slug di sini dipilihkan sistem " +
          "(akhiran acak) dan bukan diketik orang. Sapuan ini bergranularitas " +
          "badan, jadi ia tak bisa melihat ke pemanggil",
      },
      // `seed/guest.ts` DIHAPUS dari daftar ini, dan bukan karena pintunya
      // ditutup: `provisionGuest` memang memakai `onConflictDoUpdate` pada
      // insert `users`-nya, jadi dulu ia tertuduh hanya karena pola penjaganya
      // cuma mengenal `onConflictDoNothing`. Yang memaksa penghapusannya uji
      // "`dasar` tak menyimpan entri yang sudah tak berlaku" di bawah.
      //
      // Yang perlu diketahui penerusnya: `provisionGuest` juga menyisipkan
      // `companies`, `branches`, dan `storageLocations` TANPA penjaga, dan
      // ketiganya kini TAK TERLIHAT sapuan ini — satu penjaga di awal badan
      // menutupi seluruh sisanya. Lihat catatan BATASNYA di kepala berkas.
    },
  },
  {
    nama: "ganti-daftar",
    kenapa:
      "\"Ganti seluruh daftar\" = HAPUS lalu SISIP. Saat daftarnya masih KOSONG, " +
      "HAPUS tak memegang baris apa pun — dua permintaan bersamaan sama-sama " +
      "lolos ke SISIP dan menabrak indeks pasangannya. Permintaannya IDEMPOTEN, " +
      "jadi pemicunya bukan dua admin: cukup SATU KLIK GANDA pada tombol Simpan.",
    /*
     * ATURAN KEDUA untuk tabel PASANGAN, dan ia ada karena `bentrok-unik` di
     * atas TIDAK menutupinya. Aturan itu menyasar keunikan NAMA; kelas ini
     * keunikan PASANGAN (induk, anak), dengan cara gagal dan penjaga yang
     * berbeda. Empat bug ditemukan di kelas ini — petugas rak, supplier bahan,
     * supplier perlengkapan, isi rak — dan sapuan ini tak akan melihat satu pun
     * seandainya daftar tabelnya cuma dilebarkan, sebab tabel-tabel ini memang
     * bukan tabel bernama.
     */
    tulis:
      /\.insert\(\s*(?:ingredientSuppliers|supplySuppliers|storageLocationIngredients|storageLocationPetugas|menuComponents|ingredientComponents|productionConsumptions)\s*\)/,
    /*
     * `FOR UPDATE` ikut dihitung penjaga, dan justru di sinilah ia paling
     * penting: mengunci baris INDUK adalah jawaban yang benar bila induknya
     * nyata (`PUT /bahan/:id/supplier`), sedangkan `kunciAntrean` dipakai bila
     * penulisannya menyeberang beberapa induk (`isi-rak`, `petugas-tempat`).
     */
    penjaga: /kunciAntrean|\.for\("(?:update|share)"\)|onConflict|tanpaBentrok|bentrokUnik/,
    dasar: {
      "modules/menu/routes.ts": {
        pintu: 1,
        alasan:
          "`replaceKomponen` MEMANG dijaga, tapi penjaganya di PEMANGGIL: " +
          "`PUT /menu/:id` meng-UPDATE baris `menus` lebih dulu di transaksi " +
          "yang sama, jadi kunci baris induknya menyerialkan penulisan ini. " +
          "Bukan dugaan — diukur: empat PUT serentak berbadan sama, tiga ronde, " +
          "nol 5xx, sementara ketiga jalur sekerabat yang TIDAK menyentuh " +
          "induknya jatuh di ronde yang sama. Sapuan ini bergranularitas badan, " +
          "jadi ia tak bisa melihat ke pemanggil",
      },
    },
  },
  {
    nama: "cuti-bertindih",
    kenapa:
      "Dua pengajuan hidup yang bertindih membuat rekap absen ambigu: " +
      "`petaIzin.set(\"<user>|<tanggal>\")` atas kueri tanpa ORDER BY memilih " +
      "yang kebetulan terbaca belakangan.",
    tulis: /\.insert\(\s*leaveRequests\s*\)/,
    penjaga: /kunciAntrean\([^)]*"pengajuan"/,
    dasar: {},
  },
  {
    nama: "email-berbatas",
    kenapa:
      "Endpoint yang mengirim surat ke alamat yang DITENTUKAN PEMANGGIL adalah " +
      "relai email. Tanpa batas laju ia bisa membanjiri korban — dan suratnya " +
      "keluar lewat SMTP perusahaan sendiri, jadi penyalahgunaan dari SATU akun " +
      "bisa membuat domain pengirimnya masuk daftar hitam. Yang ikut mati " +
      "sesudah itu adalah email reset password & verifikasi SELURUH tenant.",
    /*
     * Aturannya sudah tertulis dua kali di `auth/routes.ts` — `batasLupa`
     * ("cegah bom email ke korban") dan `batasVerifikasiKirim` ("cegah bom
     * email") — lalu pintu ketiga, `POST /karyawan/undang`, dibiarkan terbuka.
     *
     * TERUKUR sebelum diperbaiki: putaran undang → batalkan → undang terhadap
     * korban yang sama menghasilkan 20 dari 20 surat terkirim tanpa satu pun
     * 429, sementara `/auth/forgot-password` pada server yang sama berhenti di
     * 6. Pra-cek "sudah ada undangan pending" tak menutupnya, sebab
     * `DELETE /karyawan/undangan/:id` mencabutnya lagi.
     *
     * `await kirimEmail(`, bukan `kirimEmail(` polos: yang terakhir ikut
     * menuduh DEKLARASI fungsinya sendiri di `mail/service.ts`.
     */
    tulis: /await\s+kirimEmail\(/,
    penjaga: /rateLimit\(|\bbatas[A-Z]\w*/,
    dasar: {
      "lib/backup-peringatan.ts": {
        pintu: 1,
        alasan:
          "peringatan cadangan basi — dikirim PENJADWAL, bukan atas permintaan " +
          "siapa pun, dan tujuannya datang dari setelan platform bukan dari " +
          "badan permintaan. Bukan relai: tak ada pemanggil yang bisa memilih " +
          "alamatnya, jadi tak ada yang bisa dibanjiri",
      },
      "modules/auth/routes.ts": {
        pintu: 1,
        alasan:
          "`kirimTautanVerifikasi` adalah PEMBANTU, dan penjaganya ada di kedua " +
          "pemanggilnya: `POST /register` (`batasRegister`) dan `POST " +
          "/kirim-ulang-verifikasi` (`batasVerifikasiKirim`). Ini persis titik " +
          "buta yang ditulis di kepala berkas ini — granularitasnya BADAN, jadi " +
          "penjaga yang sah tapi tinggal di pemanggil terbaca 'tanpa penjaga'. " +
          "Diperiksa dengan tangan, bukan diasumsikan",
      },
      "modules/admin-system/routes.ts": {
        pintu: 1,
        alasan:
          "kirim email UJI dari panel super admin (`/admin/sistem/email-uji`) — " +
          "digerbang `requireSuperAdmin`, yaitu satu-dua akun operator platform " +
          "ini sendiri, bukan pemilik warung. Ia juga satu-satunya pemakai yang " +
          "TUJUANNYA memang mengirim satu surat untuk memastikan SMTP-nya hidup, " +
          "sehingga batas laju di situ akan menghalangi persis pekerjaan yang " +
          "sedang dilakukan orangnya. Diukur sebagai utang, bukan dinyatakan " +
          "aman: bila kelak panel itu dibuka ke peran lain, ia harus ikut " +
          "dibatasi",
      },
    },
  },
];

/** → path relatif → jumlah pintu tanpa penjaga */
function pintuTerbuka(a: Aturan): Map<string, { jumlah: number; baris: number[] }> {
  const peta = new Map<string, { jumlah: number; baris: number[] }>();
  for (const f of berkasSumber(AKAR)) {
    const src = readFileSync(f, "utf8");
    for (const b of badan(src)) {
      if (!a.tulis.test(b.teks)) continue;
      if (a.penjaga.test(b.teks)) continue;
      const rel = relative(AKAR, f).replaceAll("\\", "/");
      const p = peta.get(rel) ?? { jumlah: 0, baris: [] };
      p.jumlah += 1;
      p.baris.push(b.baris);
      peta.set(rel, p);
    }
  }
  return peta;
}

describe.each(ATURAN)("penjaga di semua pintu — $nama", (a) => {
  const terbuka = pintuTerbuka(a);

  it("tak ada BERKAS baru yang menulis tanpa penjaga", () => {
    const baru = [...terbuka.entries()]
      .filter(([f]) => !(f in a.dasar))
      .map(([f, p]) => `${f} (baris ${p.baris.join(", ")})`);
    expect(
      baru,
      baru.length === 0
        ? ""
        : `Pintu BARU tanpa penjaga «${a.nama}»:\n\n${baru.join("\n")}\n\n` +
          `${a.kenapa}\n\n` +
          "Pasang penjaganya di badan yang sama, ATAU daftarkan di `dasar` " +
          "DENGAN ALASAN yang bisa dibaca orang lain. Entri tanpa alasan " +
          "membuat daftar itu jadi tempat sampah, dan gerbangnya berhenti " +
          "menjaga apa pun.",
    ).toEqual([]);
  });

  it("berkas yang sudah ditimbang tidak menambah pintu", () => {
    const meluas = [...terbuka.entries()]
      .filter(([f, p]) => f in a.dasar && p.jumlah > a.dasar[f].pintu)
      .map(([f, p]) => `${f}: ${a.dasar[f].pintu} → ${p.jumlah} (baris ${p.baris.join(", ")})`);
    expect(
      meluas,
      meluas.length === 0
        ? ""
        : `Berkas ini menambah pintu tanpa penjaga «${a.nama}»:\n\n${meluas.join("\n")}\n\n` +
          "Pintu kedua bukan alasan menaikkan angka di `dasar` — alasan yang " +
          "tercatat berlaku untuk pintu yang ITU, bukan untuk yang baru.",
    ).toEqual([]);
  });

  it("`dasar` tak menyimpan entri yang sudah tak berlaku", () => {
    // Tanpa ini daftarnya membusuk: pintu yang SUDAH dijaga tetap tercatat
    // sebagai "boleh terbuka", dan pintu baru di berkas itu lolos diam-diam
    // dengan izin yang sudah kedaluwarsa.
    const basi = Object.keys(a.dasar).filter((f) => !terbuka.has(f));
    expect(
      basi,
      basi.length === 0 ? "" : `Entri \`dasar\` «${a.nama}» sudah tak ditemukan — hapus: ${basi.join(", ")}`,
    ).toEqual([]);
  });

  it("setiap entri `dasar` punya alasan yang benar-benar ditulis", () => {
    const kosong = Object.entries(a.dasar)
      .filter(([, v]) => v.alasan.trim().length < 40)
      .map(([f]) => f);
    expect(kosong, `Entri \`dasar\` «${a.nama}» tanpa alasan memadai: ${kosong.join(", ")}`).toEqual(
      [],
    );
  });
});

/**
 * ATURAN YANG BENTUKNYA BEDA: bukan "adakah penjaga di badan yang sama",
 * melainkan "penulisannya sendiri sudah salah bentuk".
 *
 * Menulis ke tabel LEDGER lewat `db` global berarti tulisan itu berdiri
 * sendiri — tak ada transaksi, jadi tak ada yang bisa dikunci dan tak ada
 * yang bisa di-rollback. Untuk ledger stok itu tak pernah benar: keputusan
 * yang mendahuluinya (cukup/tidak, selisihnya berapa) dibuat atas bacaan yang
 * sudah bisa basi saat tulisannya mendarat.
 *
 * Kelas ini bukan hipotesis. Dua pintu terakhir yang berbentuk begini —
 * `POST /perlengkapan/:id/pakai` dan `/:id/koreksi` — masing-masing terukur:
 * saldo jatuh ke −20, dan hitungan fisik mendarat di 0/10/10 padahal petugas
 * menghitung 5.
 *
 * Tak ada `dasar` di sini, dan memang tak boleh ada: berbeda dari aturan
 * berpenjaga di atas, tak terpikirkan alasan sah untuk menulis ledger stok di
 * luar transaksi. Kalau kelak ada, ia layak diperdebatkan di review — bukan
 * didiamkan lewat entri daftar.
 */
describe("ledger stok tak pernah ditulis di luar transaksi", () => {
  const LEDGER = "(?:supplyMutations|stockOpnames|saleConsumptions|productionConsumptions)";
  const LANGSUNG = new RegExp(`await db\\.(?:insert|update)\\(\\s*${LEDGER}\\s*\\)`);

  it("tak ada satu pun penulisan ledger lewat `db` global", () => {
    const temuan: string[] = [];
    for (const f of berkasSumber(AKAR)) {
      const src = readFileSync(f, "utf8");
      for (const b of badan(src)) {
        if (LANGSUNG.test(b.teks)) temuan.push(`${relative(AKAR, f).replaceAll("\\", "/")}:${b.baris}`);
      }
    }
    expect(
      temuan,
      temuan.length === 0
        ? ""
        : `Penulisan ledger stok DI LUAR transaksi:\n\n${temuan.join("\n")}\n\n` +
          "Bungkus baca+putus+tulis dalam satu `db.transaction`, dan ambil " +
          "`kunciAntrean` bila keputusannya bergantung pada saldo yang baru dibaca.",
    ).toEqual([]);
  });

  it("PASANGAN: detektornya mengenali bentuk yang SUNGGUHAN pernah ada", () => {
    // Tanpa ini, "nol temuan" cuma membuktikan regexnya tak pernah cocok.
    // Kedua contoh disalin dari kode sebelum diperbaiki.
    expect(LANGSUNG.test("await db.insert(supplyMutations).values({ tipe: 'pakai' });")).toBe(true);
    expect(LANGSUNG.test("await db.insert(stockOpnames).values({ qty });")).toBe(true);
    // …dan tidak menuduh bentuk yang benar:
    expect(LANGSUNG.test("await tx.insert(supplyMutations).values({ tipe: 'pakai' });")).toBe(false);
    expect(LANGSUNG.test("await db.insert(supplies).values({ nama });")).toBe(false);
  });
});

describe("detektornya benar-benar mengenali bentuknya", () => {
  /*
   * Pasangan yang wajib ada: pola yang salah ketik membuat SELURUH gerbang di
   * atas hijau selamanya, dan tak ada yang akan curiga — nol temuan terlihat
   * persis seperti nol masalah. Contoh di bawah disalin dari bentuk yang
   * SUNGGUHAN pernah ada di repo ini, bukan dikarang.
   */
  const contoh: [string, string, boolean][] = [
    [
      "owner-terakhir",
      'await tx.update(memberships).set({ archivedAt: new Date() }).where(eq(memberships.id, x));',
      true,
    ],
    [
      "owner-terakhir",
      'await tx.update(memberships).set({ role: targetRole, branchId: null }).where(eq(memberships.id, m.id));',
      true,
    ],
    [
      "bentrok-unik",
      'const [u] = await tx.insert(users).values({ email, passwordHash, nama }).returning();',
      true,
    ],
    ["cuti-bertindih", 'const [row] = await tx.insert(leaveRequests).values({ companyId }).returning();', true],
    // Dua pintu yang dulu LOLOS karena daftar tabelnya cuma memuat tiga nama —
    // dan keduanya membalas 500 di produksi sampai ditembak balapan.
    [
      "bentrok-unik",
      'const [row] = await db.insert(ingredients).values({ companyId, slug, kode, nama: body.nama }).returning();',
      true,
    ],
    [
      "bentrok-unik",
      'const [row] = await db.insert(supplies).values({ companyId, nama: body.nama, satuan: body.satuan }).returning();',
      true,
    ],
    // …dan yang TIDAK boleh tertuduh:
    ["owner-terakhir", 'await tx.update(memberships).set({ employeeCode: kode }).where(eq(x));', false],
    ["bentrok-unik", 'await tx.insert(memberships).values({ userId, companyId });', false],
    // `saleItems` bukan `sales`; batas kata harus memisahkannya
    ["bentrok-unik", 'await tx.insert(menuComponents).values({ menuId, ingredientId });', false],
  ];

  it.each(contoh)("%s mengenali: %s → %s", (nama, kode, harus) => {
    const a = ATURAN.find((x) => x.nama === nama)!;
    expect(a.tulis.test(kode)).toBe(harus);
  });

  it("pola penjaganya mengenali panggilan yang sungguhan dipakai", () => {
    const owner = ATURAN.find((a) => a.nama === "owner-terakhir")!;
    expect(owner.penjaga.test('await kunciAntrean(tx, "owner", auth.company_id!);')).toBe(true);
    expect(owner.penjaga.test('await kunciAntrean(tx, "pengajuan", a, b);')).toBe(false);
    const unik = ATURAN.find((a) => a.nama === "bentrok-unik")!;
    expect(unik.penjaga.test('if (bentrokUnikPada(e, "users_email_unique")) {')).toBe(true);
    expect(unik.penjaga.test("const x = 1;")).toBe(false);
    // Keempat bentuk penjaga yang SUNGGUHAN dipakai di repo ini. Tiga di antara
    // ini dulu tak dikenali, dan ketiganya menghasilkan tuduhan PALSU — yang
    // merusak gerbang persis sama parahnya dengan melewatkan pintu.
    expect(unik.penjaga.test("if (bentrokUnik(err)) {")).toBe(true); // kebersihan
    expect(unik.penjaga.test(".onConflictDoUpdate({ target: users.email })")).toBe(true); // seed/guest
    expect(unik.penjaga.test(".onConflictDoNothing()")).toBe(true);
    expect(unik.penjaga.test('await kunciAntrean(tx, "bahan-slug", companyId);')).toBe(true); // bulk
    expect(unik.penjaga.test('await tanpaBentrok("x", () => db.insert(y))')).toBe(true);
    expect(unik.penjaga.test('.where(eq(ingredients.id, id))\n  .for("update");')).toBe(true);

    const daftar = ATURAN.find((a) => a.nama === "ganti-daftar")!;
    // Empat bug kelas ini, disalin dari bentuk aslinya sebelum diperbaiki.
    expect(daftar.tulis.test("await tx.insert(storageLocationPetugas).values(uniqueIds.map(")).toBe(true);
    expect(daftar.tulis.test("await tx.insert(ingredientSuppliers).values(")).toBe(true);
    expect(daftar.tulis.test("await tx.insert(supplySuppliers).values(")).toBe(true);
    expect(daftar.tulis.test("await tx.insert(storageLocationIngredients).values(")).toBe(true);
    // …dan yang bukan tabel pasangan tak boleh tertuduh oleh aturan INI.
    expect(daftar.tulis.test("await tx.insert(ingredients).values({ slug })")).toBe(false);
    // Kedua bentuk penjaga yang sah untuk kelas ini, keduanya sungguhan dipakai.
    expect(daftar.penjaga.test('await kunciAntrean(tx, "isi-rak", companyId);')).toBe(true);
    expect(daftar.penjaga.test('.where(eq(supplies.id, item.id))\n  .for("update");')).toBe(true);
    expect(daftar.penjaga.test("await tx.delete(x); await tx.insert(y).values(z);")).toBe(false);
  });

  it("BATAS tak memotong pembantu kecil DI DALAM handler", () => {
    // Regresi langsung: potongan pada `const slugUnik = (` memisahkan
    // `kunciAntrean` dari INSERT yang dijaganya, dan sapuan ini lalu menuduh
    // perbaikan yang benar. Badan di bawah harus tetap SATU.
    const contoh = [
      '  .post("/bulk", requireRole("owner"), async (c) => {',
      "    const rows = await db.transaction(async (tx) => {",
      '      await kunciAntrean(tx, "bahan-slug", companyId);',
      "      const slugUnik = (nama: string): string => nama.toLowerCase();",
      "      return tx.insert(ingredients).values(items.map((b) => ({ slug: slugUnik(b.nama) })));",
      "    });",
      "  })",
    ].join("\n");
    const potong = badan(contoh);
    expect(potong).toHaveLength(1);
    const unik = ATURAN.find((a) => a.nama === "bentrok-unik")!;
    expect(unik.tulis.test(potong[0].teks)).toBe(true);
    expect(unik.penjaga.test(potong[0].teks)).toBe(true);
  });
});
