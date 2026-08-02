import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AbsensiRow,
  MejaDto,
  MemberCariRow,
  MenuDto,
  MenuStokDto,
  MetodeBayar,
  OpenBillDetail,
  OpenBillRow,
  Shift,
} from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
import { ReceiptModal, type SaleResult } from "./ReceiptModal";
import {
  KosongkanMejaModal,
  kelasStatus,
  labelStatus,
  useMejaStatus,
} from "../pengaturan/MejaStatusPanel";

/**
 * `MenuDto` darurat dari snapshot baris bill — dipakai HANYA saat katalog tak
 * lagi punya menunya (diarsipkan, atau dibatasi ke cabang lain).
 *
 * `is_active: false` supaya UI bisa menandainya; angka turunan (hpp, saran
 * harga) diisi nol karena memang tak diketahui dari sisi klien — yang ditagih
 * tetap `harga_satuan` bill yang dibawa di `hargaKunci`.
 */
function menuDariBarisBill(it: OpenBillDetail["items"][number]): MenuDto {
  return {
    id: it.menu_id,
    nama: it.menu_nama,
    kode: null,
    deskripsi: null,
    tipe: "regular",
    category_id: "",
    kategori: "",
    mult: null,
    base_menu_id: null,
    base_menu_nama: null,
    base_mult: null,
    harga_jual: it.harga_satuan,
    image_url: null,
    is_active: false,
    sort_order: 0,
    branch_ids: [],
    komponen: [],
    hpp: 0,
    hpp_dine_in: 0,
    harga_saran: 0,
    harga_jual_bulat: it.harga_satuan,
    food_cost_persen: 0,
  };
}

interface CartLine {
  menu: MenuDto;
  qty: number;
  /** null = ikut pengaturan transaksi */
  dineInOverride: boolean | null;
  /** catatan personalisasi baris (mis. "tanpa gula") */
  catatan: string;
  /** id baris open bill asal (bila keranjang ini dimuat dari bill) */
  billItemId?: string;
  /**
   * harga yang DIKUNCI di open bill saat dipesan. Ada nilainya → inilah yang
   * ditagih, bukan `menu.harga_jual` yang bisa saja sudah berubah.
   */
  hargaKunci?: number;
}

/** Harga yang benar-benar ditagih untuk satu baris keranjang. */
function hargaBaris(l: CartLine) {
  return l.hargaKunci ?? l.menu.harga_jual;
}

interface Kategori {
  id: string;
  nama: string;
  sort_order: number;
}

/**
 * Badge sisa porsi untuk kasir. `porsi` null → menu tak terlacak stoknya →
 * tak menampilkan apa pun. 0 → "Habis" (merah) + bahan PEMBATAS yang kosong
 * (biar jelas KENAPA habis & apa yang perlu ditambah/dikirim ke cabang);
 * sedikit (≤5) → oranye; sisanya hijau. `size` mengatur kepadatan untuk tile
 * kode yang mungil.
 */
function StokBadge({ stok, size = "md" }: { stok: MenuStokDto | undefined; size?: "sm" | "md" }) {
  const porsi = stok?.porsi;
  if (porsi == null) return null;
  const kecil = size === "sm";
  const base = kecil ? "text-[9px] leading-none" : "text-[11px]";
  if (porsi <= 0) {
    // bahan pembatas = bahan resep yang saldonya 0 di cabang ini → sumber "Habis".
    const kurang = stok?.pembatas?.nama;
    return (
      <span
        className={`font-semibold text-red-600 ${base}`}
        title={kurang ? `Habis — bahan "${kurang}" kosong di cabang ini` : "Habis"}
      >
        Habis{kurang && !kecil ? ` · ${kurang}` : ""}
      </span>
    );
  }
  const warna = porsi <= 5 ? "text-orange-600" : "text-emerald-600";
  return <span className={`font-medium ${warna} ${base}`}>Sisa {porsi}</span>;
}

export function KasirPage() {
  const { auth } = useAuth();
  // Kasir butuh satu cabang konkret (menu, meja, shift, open bill) — dari
  // Kantor berjualan atas nama cabang yang dipilih di CabangDataBar.
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const isKasir = auth?.user.role === "cashier";

  // Menu per lokasi: kasir difilter otomatis oleh server; owner/admin
  // mengirim cabang aktif via branchQuery agar tampilan sesuai lokasi.
  const { data: menus, isLoading } = useQuery({
    queryKey: ["menu", branchQuery],
    queryFn: () => api<MenuDto[]>(`/menu${branchQuery}`),
  });
  const { data: kategori = [] } = useQuery({
    queryKey: ["kategori"],
    queryFn: () => api<Kategori[]>("/kategori"),
  });
  const { data: mejaList = [], isLoading: mejaLoading } = useQuery({
    queryKey: ["meja", branchQuery],
    queryFn: () => api<MejaDto[]>(`/meja${branchQuery}`),
  });
  // Setelan PB1 terbaru dari server (snapshot login bisa basi bila
  // pengaturan perusahaan diubah saat sesi kasir masih terbuka)
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{
        company: { pb1_enabled: boolean; pb1_rate: number; diskon_maks_persen: number } | null;
      }>("/auth/me"),
  });
  const pb1Conf = me?.company ?? auth?.company;

  // Gerbang buka kasir: transaksi kasir hanya jalan bila ada shift TERBUKA di
  // cabang. `/shift/*` khusus peran kasir → hanya query saat isKasir.
  const { data: shiftAktif } = useQuery({
    queryKey: ["shift-aktif", branchQuery],
    queryFn: () => api<Shift | null>(`/shift/aktif${branchQuery}`),
    enabled: isKasir,
    refetchInterval: 30_000,
  });
  const kasirTutup = isKasir && shiftAktif === null;
  // Absensi hari ini di cabang — untuk cek apakah kasir sudah absen masuk
  // (syarat buka kasir). Cukup diambil saat gerbang muncul.
  const { data: absensiHariIni = [] } = useQuery({
    queryKey: ["absensi", branchQuery],
    queryFn: () => api<AbsensiRow[]>(`/absensi${branchQuery}`),
    enabled: kasirTutup,
  });
  // Sudah absen masuk & belum absen keluar hari ini → boleh buka kasir.
  const absenSaya = absensiHariIni.find((r) => r.user_id === auth?.user.sub);
  const sudahAbsen = !!(absenSaya?.masuk && !absenSaya?.keluar);
  const [modalAwalGate, setModalAwalGate] = useState("");

  const [aktifKategori, setAktifKategori] = useState<string | null>(null);
  const [cariMenu, setCariMenu] = useState("");
  // Mode tampilan katalog: "foto" (kartu thumbnail) / "kode" (ringkas per kategori)
  const [tampilan, setTampilan] = useState<"foto" | "kode">(() => {
    try {
      return localStorage.getItem("kakarut.kasirTampilan") === "kode" ? "kode" : "foto";
    } catch {
      return "foto";
    }
  });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mejaId, setMejaId] = useState<string | null>(null);
  // Modal pilih meja muncul lebih dulu tiap memulai transaksi (sebelum keranjang).
  // Otomatis untuk kasir; owner/admin membukanya lewat tombol "Pilih/Ganti".
  const [mejaModalOpen, setMejaModalOpen] = useState(isKasir);
  const [mejaCari, setMejaCari] = useState("");
  // meja yang sedang dikonfirmasi untuk dibereskan (dari modal Pilih Meja)
  const [kosongkanId, setKosongkanId] = useState<string | null>(null);
  const [konsumenNama, setKonsumenNama] = useState("");
  const [konsumenWa, setKonsumenWa] = useState("");
  // Autocomplete member: q pencarian + apakah dropdown terbuka
  const [cariMember, setCariMember] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);
  const [diskonTipe, setDiskonTipe] = useState<"persen" | "nominal">("nominal");
  const [diskonNilai, setDiskonNilai] = useState("");
  const [metodeBayar, setMetodeBayar] = useState<MetodeBayar>("tunai");
  const [uangDiterima, setUangDiterima] = useState("");
  const [struk, setStruk] = useState<SaleResult | null>(null);
  // Modal "Resume Order" muncul saat tombol Lanjut ditekan
  const [resumeOpen, setResumeOpen] = useState(false);
  /**
   * DUA LANGKAH, bukan satu layar.
   *
   * Membaca ulang pesanan dan menerima uang adalah dua pekerjaan berbeda:
   * yang pertama dicocokkan dengan tamu ("betul, tiga porsi?"), yang kedua
   * dengan uang di tangan. Menggabungkannya membuat kasir memilih metode bayar
   * sambil masih mengoreksi pesanan — nominal "uang pas" ikut bergeser setiap
   * diskon diubah, dan tak ada satu titik pun di mana pesanan dinyatakan benar.
   *
   * Jadi: `resume` (pesanan + diskon + total) → `bayar` (metode + uang). Tombol
   * kembali tetap ada supaya pesanan masih bisa dikoreksi tanpa menutup modal.
   */
  const [langkahBayar, setLangkahBayar] = useState<"resume" | "bayar">("resume");
  // id open bill yang sedang dibuka/diedit (null = pesanan baru)
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  /**
   * "Meja ini sudah punya bill berjalan."
   *
   * SATU MEJA DINE-IN = SATU BILL. Server menolak bill kedua dengan 409
   * `meja_sudah_ada_bill`; layar ini mendahuluinya supaya kasir tak perlu
   * menabrak galat dulu. Jalan keluarnya cuma satu: tambahkan pesanan ke bill
   * yang sudah ada.
   */
  const [billGandaOpen, setBillGandaOpen] = useState(false);
  /**
   * Meja SUDAH DIBAYAR tapi belum dibereskan, lalu dipilih lagi.
   *
   * Dua kejadian yang berbeda mendarat di sini dan tak bisa dibedakan server:
   * tamu yang sama memesan lagi setelah membayar, ATAU tamu baru duduk di meja
   * yang belum dibereskan. Keduanya sah, jadi kasir yang memutuskan.
   *
   * Kalau tak ditanya dan ternyata tamu baru, `sejak` tetap menunjuk transaksi
   * tamu SEBELUMNYA — papan bilang "sudah duduk 2 jam" untuk orang yang baru
   * lima menit duduk, dan salahnya bertahan sampai jendela okupansi 12 jam
   * meluruhkannya sendiri.
   */
  const [tamuMejaId, setTamuMejaId] = useState<string | null>(null);
  /**
   * Konfirmasi "yakin ganti meja?" saat keranjang sudah terisi.
   *
   * Menukar meja diam-diam itu berbahaya dua arah: pesanan yang sudah diketik
   * untuk meja lama bisa ikut terbawa ke meja baru tanpa disadari, atau justru
   * hilang karena kasir mengira ganti meja = mulai dari nol. Jadi kasir yang
   * memutuskan: bawa pesanannya, simpan dulu jadi Open Bill di meja lama, atau
   * buang.
   */
  const [gantiMejaOpen, setGantiMejaOpen] = useState(false);

  const { data: openBills = [] } = useQuery({
    queryKey: ["open-bill", branchQuery],
    queryFn: () => api<OpenBillRow[]>(`/open-bill${branchQuery}`),
  });

  // Sisa porsi tiap menu di cabang aktif (info "sisa 2 lagi" untuk kasir).
  const { data: ketersediaan = [] } = useQuery({
    queryKey: ["menu-ketersediaan", branchQuery],
    queryFn: () => api<MenuStokDto[]>(`/menu/ketersediaan${branchQuery}`),
  });
  const sisaByMenu = useMemo(
    () => new Map(ketersediaan.map((k) => [k.menu_id, k])),
    [ketersediaan],
  );

  // Autocomplete member: cari nama/WA yang cocok saat mengetik salah satu field.
  const { data: memberSaran = [] } = useQuery({
    queryKey: ["member-cari", cariMember.trim()],
    queryFn: () =>
      api<MemberCariRow[]>(`/member-cari?q=${encodeURIComponent(cariMember.trim())}`),
    enabled: memberOpen && cariMember.trim().length >= 1,
  });

  // Pilih member dari dropdown → isi nama & WA sekaligus, tutup dropdown.
  function pilihMember(m: MemberCariRow) {
    setKonsumenNama(m.nama);
    setKonsumenWa(m.wa);
    setMemberOpen(false);
    setCariMember("");
  }

  // Status okupansi meja — MEMBERI TAHU, TIDAK MELARANG. `mejaAktif` di bawah
  // sengaja TIDAK disaring berdasarkan status: efek di bawahnya melepas
  // `mejaId` begitu meja hilang dari daftar aktif, sehingga menyembunyikan meja
  // terisi akan membatalkan pemasangan meja saat melanjutkan open bill (bill
  // sah jadi tak bisa ditagih) dan — lebih halus — membuat `dineIn` jatuh ke
  // nilai cadangan `true`, sehingga pesanan bawa pulang terbukukan sebagai
  // makan di tempat dengan HPP yang salah. Satu meja dua bill juga sah di sini.
  const { data: mejaStatus = [] } = useMejaStatus(branchQuery, isKasir);
  const statusMeja = useMemo(
    () => new Map(mejaStatus.map((s) => [s.meja_id, s])),
    [mejaStatus],
  );
  // Bill yang masih berjalan di meja terpilih — dicocokkan lewat `meja_id`,
  // BUKAN `meja_label`: label itu snapshot saat bill dibuat, jadi mencocokkan
  // lewat nama akan gagal sunyi begitu mejanya diganti nama.
  const billDiMeja = useMemo(
    () => (mejaId ? openBills.filter((b) => b.meja_id === mejaId) : []),
    [openBills, mejaId],
  );
  /**
   * MEJA DULU, BARU MENU.
   *
   * Tanpa meja, transaksi ini memang tak bisa diselesaikan — kedua tombol di
   * kaki keranjang sudah mati sejak awal. Yang salah selama ini: kasir tetap
   * bisa mengisi keranjang lebih dulu, lalu baru menabrak tombol mati di ujung
   * dan harus mundur mencari meja sambil pembeli menunggu. Jadi katalognya
   * ditutup sampai mejanya dipilih — sama seperti aplikasi mobile.
   */
  const perluPilihMeja = !mejaId;
  const mejaAktif = useMemo(() => mejaList.filter((m) => m.is_active), [mejaList]);
  const mejaTerpilih = mejaAktif.find((m) => m.id === mejaId) ?? null;
  /**
   * Bill yang sedang dibuka, menurut catatan SERVER (bukan pilihan di layar).
   * Dipakai memastikan perpindahan meja terlihat sebelum disimpan: kasir menekan
   * Ganti, mejanya berubah di layar, tapi kartu Open Bill masih menyebut meja
   * lama — karena itu memang belum tersimpan. Tanpa keterangan, itu terbaca
   * "ganti mejanya tidak berpengaruh".
   */
  const billDibuka = editingBillId ? openBills.find((b) => b.id === editingBillId) : undefined;
  const pindahMeja =
    billDibuka && mejaId && billDibuka.meja_id !== mejaId ? billDibuka : undefined;
  // Meja menentukan mode transaksi: meja bernomor = dine-in (default), meja
  // Ruang Tunggu = bawa pulang. Sebelum meja dipilih, tampilan default dine-in.
  const dineIn = mejaTerpilih ? mejaTerpilih.tipe === "dine_in" : true;
  // Pencarian meja: cocok sebagian (mis. ketik "8" → "Meja 8"), tak harus persis.
  const mejaCocok = useMemo(() => {
    const q = mejaCari.trim().toLowerCase();
    if (!q) return mejaAktif;
    return mejaAktif.filter((m) => m.nama.toLowerCase().includes(q));
  }, [mejaAktif, mejaCari]);

  // Bila meja terpilih dinonaktifkan/dihapus dari master, lepaskan pilihan.
  useEffect(() => {
    if (mejaId && !mejaAktif.some((m) => m.id === mejaId)) setMejaId(null);
  }, [mejaId, mejaAktif]);

  // Ganti cabang data di tengah sesi (dari Kantor) → keranjang, open bill,
  // dan data konsumen milik cabang sebelumnya tidak boleh terbawa: transaksi
  // akan terkirim dengan branch_id BARU sementara isinya dari katalog lama.
  const cabangSebelum = useRef(branchId);
  useEffect(() => {
    if (cabangSebelum.current === branchId) return;
    cabangSebelum.current = branchId;
    resetTransaksi();
  }, [branchId]);

  // Reset kotak pencarian tiap modal dibuka.
  useEffect(() => {
    if (mejaModalOpen) setMejaCari("");
  }, [mejaModalOpen]);

  // Simpan preferensi tampilan katalog (foto / kode) antar sesi.
  useEffect(() => {
    try {
      localStorage.setItem("kakarut.kasirTampilan", tampilan);
    } catch {
      /* localStorage tak tersedia */
    }
  }, [tampilan]);

  function pilihMeja(id: string) {
    // Meja lunas-tapi-belum-dibereskan: tanya dulu tamunya sama atau baru.
    const st = statusMeja.get(id);
    if (st?.lunas_masih_duduk) {
      setTamuMejaId(id);
      return;
    }
    setMejaId(id);
    setMejaModalOpen(false);

    /**
     * Meja dine-in yang masih punya bill BELUM DIBAYAR → tampilkan pesanannya.
     *
     * Sebelum ini memilih meja hanya menyetel `mejaId`. Kasir lalu melihat
     * keranjang kosong, mengira mejanya kosong, mengetik pesanan dari nol —
     * dan baru ditolak 409 di tombol Simpan, harus mundur lagi. Pesanan yang
     * sedang berjalan di meja itu memang yang paling ingin ia lihat.
     *
     * Ruang Tunggu DIKECUALIKAN: ia sengaja boleh menampung banyak bill bawa
     * pulang sekaligus (tak kena aturan satu-meja-satu-bill), jadi memuat
     * salah satunya justru menebak yang salah.
     */
    const m = mejaAktif.find((x) => x.id === id);
    if (m?.tipe !== "dine_in") return;
    const billDiSitu = openBills.filter((b) => b.meja_id === id);
    if (billDiSitu.length === 0) return;
    // Sudah membuka bill meja itu → tak ada yang perlu dimuat lagi.
    if (billDiSitu.some((b) => b.id === editingBillId)) return;
    // Keranjang kosong & cuma satu bill → muat langsung, tak ada yang hilang.
    if (billDiSitu.length === 1 && cart.length === 0) {
      void bukaBill(billDiSitu[0].id);
      return;
    }
    // Keranjang terisi (ada yang bisa hilang) atau lebih dari satu bill →
    // biarkan kasir memilih; modalnya sudah memperingatkan soal tertimpa.
    setBillGandaOpen(true);
  }

  /** "Tamu yang sama" — lanjut di meja itu, konsumennya dibawa supaya member tak terputus. */
  function lanjutTamuSama(id: string) {
    const st = statusMeja.get(id);
    setMejaId(id);
    if (st?.konsumen_nama) setKonsumenNama(st.konsumen_nama);
    if (st?.konsumen_wa) setKonsumenWa(st.konsumen_wa);
    setTamuMejaId(null);
    setMejaModalOpen(false);
  }

  const kategoriTampil = useMemo(() => {
    const adaMenu = new Set((menus ?? []).map((m) => m.category_id));
    return kategori.filter((k) => adaMenu.has(k.id));
  }, [kategori, menus]);

  const menuTampil = useMemo(() => {
    const q = cariMenu.trim().toLowerCase();
    const list = menus ?? [];
    // pencarian nama/kode menu berlaku lintas kategori; tanpa pencarian → filter kategori
    if (q)
      return list.filter(
        (m) => m.nama.toLowerCase().includes(q) || (m.kode?.toLowerCase().includes(q) ?? false),
      );
    if (!aktifKategori) return list;
    return list.filter((m) => m.category_id === aktifKategori);
  }, [menus, aktifKategori, cariMenu]);

  // Tampilan "kode": semua menu dikelompokkan per kategori (lintas kategori,
  // mengabaikan kategori aktif) — semua kategori tampil sekaligus. Pencarian
  // nama/kode tetap berlaku.
  const menuKodeGroups = useMemo(() => {
    const q = cariMenu.trim().toLowerCase();
    const list = (menus ?? []).filter(
      (m) => !q || m.nama.toLowerCase().includes(q) || (m.kode?.toLowerCase().includes(q) ?? false),
    );
    const byCat = new Map<string, MenuDto[]>();
    for (const m of list) {
      const arr = byCat.get(m.category_id) ?? [];
      arr.push(m);
      byCat.set(m.category_id, arr);
    }
    return kategoriTampil
      .map((k) => ({ kategori: k, items: byCat.get(k.id) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [menus, cariMenu, kategoriTampil]);

  function tambah(menu: MenuDto) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.menu.id === menu.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...prev, { menu, qty: 1, dineInOverride: null, catatan: "" }];
    });
  }

  function ubahCatatanLine(menuId: string, val: string) {
    setCart((prev) => prev.map((l) => (l.menu.id === menuId ? { ...l, catatan: val } : l)));
  }

  function ubahQty(menuId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.menu.id !== menuId) return l;
          /**
           * Baris yang SUDAH masuk bill sudah tayang di papan dapur sejak bill
           * disimpan — bisa jadi sudah dimasak. Menghapusnya dari keranjang
           * membuat `PUT` membuangnya dari bill, dan barisnya lenyap dari papan
           * tanpa jejak siapa pun: dapur kehilangan pekerjaan yang sudah
           * dikerjakan tanpa ada yang bisa menjelaskan ke mana.
           *
           * Jadi qty-nya dijaga minimal 1. Membatalkannya lewat Papan Pesanan,
           * yang menyimpan pelaku & waktunya. Penjagaan ditaruh DI SINI, bukan
           * cuma di tombolnya, supaya tak ada jalur lain yang melewatinya.
           */
          const minQty = l.billItemId ? 1 : 0;
          return { ...l, qty: Math.max(minQty, l.qty + delta) };
        })
        .filter((l) => l.qty > 0),
    );
  }

  function toggleLineDineIn(menuId: string) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.menu.id !== menuId) return l;
        const efektif = l.dineInOverride ?? dineIn;
        return { ...l, dineInOverride: !efektif };
      }),
    );
  }

  const subtotal = cart.reduce((a, l) => a + hargaBaris(l) * l.qty, 0);
  // diskon per transaksi (cermin logika server: clamp ke [0, subtotal])
  const diskonNilaiNum = Number(diskonNilai) || 0;
  const diskonRaw =
    diskonNilaiNum <= 0
      ? 0
      : diskonTipe === "persen"
        ? Math.min(subtotal, Math.round((subtotal * Math.min(100, diskonNilaiNum)) / 100))
        : Math.min(subtotal, Math.round(diskonNilaiNum));
  // batas diskon utk KASIR (owner/admin bebas → 100%)
  const maksDiskonPersen = isKasir ? (pb1Conf?.diskon_maks_persen ?? 100) : 100;
  const diskonBoleh = !isKasir || maksDiskonPersen > 0;
  const capNominal = Math.floor((subtotal * maksDiskonPersen) / 100);
  const diskon = Math.min(diskonRaw, capNominal);
  const diskonDibatasi = diskon < diskonRaw;
  const subtotalNet = subtotal - diskon;
  const pb1 = pb1Conf?.pb1_enabled ? Math.round(subtotalNet * (pb1Conf.pb1_rate / 100)) : 0;
  const total = subtotalNet + pb1;
  // pembayaran tunai: uang diterima → kembalian; kurang = uang < total
  const uangNum = Number(uangDiterima) || 0;
  const uangKurang = metodeBayar === "tunai" && uangNum > 0 && uangNum < total;
  const kembalian = metodeBayar === "tunai" && uangNum > total ? uangNum - total : 0;

  const bayar = useMutation({
    mutationFn: () =>
      api<SaleResult>("/penjualan", {
        method: "POST",
        body: {
          ...(!isKasir && branchId ? { branch_id: branchId } : {}),
          is_dine_in: dineIn,
          meja_id: mejaId ?? undefined,
          ...(konsumenNama.trim() ? { customer_nama: konsumenNama.trim() } : {}),
          ...(konsumenWa.trim() ? { customer_wa: konsumenWa.trim() } : {}),
          metode_bayar: metodeBayar,
          ...(metodeBayar === "tunai" && uangNum > 0 ? { uang_diterima: uangNum } : {}),
          // Yang DIKIRIM harus sama persis dengan yang DITAMPILKAN. `diskon` di
          // atas sudah dipotong ke jatah maksimal kasir, dan layar resume sudah
          // menuliskan angka terpotong itu berikut totalnya — uang yang
          // diterima kasir mengikuti angka itu. Mengirim `diskonNilaiNum`
          // mentah membuat server menghitung diskon PENUH, mendapati diskon itu
          // melebihi batas kasir, lalu menolak seluruh transaksi dengan 400 —
          // padahal layarnya sudah menulis "dibatasi" seolah sudah diurus, dan
          // kasir tak punya petunjuk bahwa ia harus mengetik ulang diskonnya.
          //
          // Saat terpotong, kirim sebagai NOMINAL: persentasenya memang tidak
          // jadi dipakai, jadi menyimpannya sebagai "persen" akan membuat struk
          // menulis "Diskon (20%)" di sebelah nilai 10% — angka yang tak pernah
          // terjadi. Saat tidak terpotong, kirim apa adanya agar persentasenya
          // tetap tercatat untuk laporan.
          ...(diskon > 0
            ? diskonDibatasi
              ? { diskon_tipe: "nominal" as const, diskon_nilai: diskon }
              : { diskon_tipe: diskonTipe, diskon_nilai: diskonNilaiNum }
            : {}),
          // membayar open bill → server menagih harga yang dikunci di bill
          ...(editingBillId ? { open_bill_id: editingBillId } : {}),
          items: cart.map((l) => ({
            menu_id: l.menu.id,
            qty: l.qty,
            ...(l.dineInOverride !== null ? { is_dine_in: l.dineInOverride } : {}),
            ...(l.catatan.trim() ? { catatan: l.catatan.trim() } : {}),
            ...(editingBillId && l.billItemId ? { open_bill_item_id: l.billItemId } : {}),
          })),
        },
      }),
    onSuccess: (data) => {
      setStruk(data);
      setResumeOpen(false);
      // bill ditutup SERVER di dalam transaksi createSale (open_bills.closed_at
      // + sale_id). Dulu dikirim dari sini sebagai DELETE fire-and-forget —
      // gagal diam-diam bila jaringan putus, dan jalur sinkron offline tak
      // pernah mengirimnya sama sekali, jadi bill hantu menumpuk.
      resetTransaksi();
      // modal pilih meja dibuka lagi saat struk ditutup (transaksi berikutnya)
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["laporan"] });
      queryClient.invalidateQueries({ queryKey: ["penjualan"] });
      queryClient.invalidateQueries({ queryKey: ["open-bill"] });
      queryClient.invalidateQueries({ queryKey: ["menu-ketersediaan"] });
      // papan pesanan dapur/bar: kartu berpindah dari "belum dibayar" ke
      // penjualan pada detik ini juga, jangan tunggu polling 15 dtk berikutnya
      queryClient.invalidateQueries({ queryKey: ["pesanan"] });
      // meja langsung tertandai terisi — transaksi lunas TIDAK mengosongkannya
      queryClient.invalidateQueries({ queryKey: ["meja-status"] });
    },
  });

  // Kosongkan seluruh state transaksi (dipakai setelah bayar / simpan bill).
  function resetTransaksi() {
    setCart([]);
    setKonsumenNama("");
    setKonsumenWa("");
    setCariMember("");
    setMemberOpen(false);
    setDiskonNilai("");
    setMetodeBayar("tunai");
    setUangDiterima("");
    setLangkahBayar("resume");
    setMejaId(null);
    setEditingBillId(null);
  }

  /**
   * "Tamu baru" — bereskan meja dulu, lalu pakai untuk tamu berikutnya.
   *
   * Pengosongan HARUS lewat server, bukan sekadar tidak ditanya lagi: batasnya
   * ditulis ke `meja_kosong_logs`, dan itulah yang memotong hitungan "sudah
   * duduk berapa lama". Tanpa panggilan ini, `sejak` tetap menunjuk transaksi
   * tamu sebelumnya.
   *
   * Meja lunas tak punya tagihan berjalan, jadi tak perlu `paksa` — server
   * menjawab 200 langsung.
   */
  const bereskanLaluPakai = useMutation({
    mutationFn: (id: string) =>
      api(`/meja/${id}/kosongkan${branchQuery}`, { method: "POST", body: {} }),
    onSuccess: (_d, id) => {
      setMejaId(id);
      setKonsumenNama("");
      setKonsumenWa("");
      setTamuMejaId(null);
      setMejaModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["meja-status"] });
    },
  });

  // Simpan keranjang sebagai open bill (belum dibayar) — buat baru / perbarui.
  const simpanBill = useMutation({
    mutationFn: () => {
      const body = {
        ...(!isKasir && branchId ? { branch_id: branchId } : {}),
        meja_id: mejaId ?? undefined,
        ...(konsumenNama.trim() ? { customer_nama: konsumenNama.trim() } : {}),
        ...(konsumenWa.trim() ? { customer_wa: konsumenWa.trim() } : {}),
        items: cart.map((l) => ({
          // baris lama dikirim ber-id agar harga terkuncinya dipertahankan;
          // baris tanpa id = tambahan baru → memakai harga hari ini
          ...(l.billItemId ? { id: l.billItemId } : {}),
          menu_id: l.menu.id,
          qty: l.qty,
          ...(l.dineInOverride !== null ? { dine_in_override: l.dineInOverride } : {}),
          ...(l.catatan.trim() ? { catatan: l.catatan.trim() } : {}),
        })),
      };
      return editingBillId
        ? api(`/open-bill/${editingBillId}`, { method: "PUT", body })
        : api("/open-bill", { method: "POST", body });
    },
    onSuccess: () => {
      resetTransaksi();
      queryClient.invalidateQueries({ queryKey: ["open-bill"] });
      // open bill = pesanan yang belum dibayar → langsung tampil di papan dapur
      queryClient.invalidateQueries({ queryKey: ["pesanan"] });
      queryClient.invalidateQueries({ queryKey: ["meja-status"] });
    },
  });

  // Buka kasir dari gerbang (butuh sudah absen masuk — divalidasi juga di
  // server). Sukses → shift-aktif ter-invalidate → gerbang tertutup.
  const bukaKasir = useMutation({
    mutationFn: () =>
      api<Shift>(`/shift/buka${branchQuery}`, {
        method: "POST",
        body: { modal_awal: Number(modalAwalGate) || 0 },
      }),
    onSuccess: () => {
      setModalAwalGate("");
      queryClient.invalidateQueries({ queryKey: ["shift-aktif"] });
      queryClient.invalidateQueries({ queryKey: ["shift-riwayat"] });
    },
  });

  // Buka open bill → muat kembali item & data ke keranjang untuk dilanjut/bayar.
  async function bukaBill(id: string) {
    const bill = await api<OpenBillDetail>(`/open-bill/${id}`);
    const menuById = new Map((menus ?? []).map((m) => [m.id, m]));
    const lines: CartLine[] = [];
    for (const it of bill.items) {
      // TIDAK BOLEH ada baris bill yang hilang di sini.
      //
      // `GET /menu` menyaring menu nonaktif (dan menu yang dibatasi ke cabang
      // lain), jadi baris bill yang menunya baru diarsipkan — "bakso habis" —
      // tak punya pasangan di katalog. Dulu baris itu dilewati: ia lenyap dari
      // keranjang tanpa ada yang menekan apa pun, lalu `PUT` menghapusnya dari
      // bill. Tamu sudah memakannya, tak ada galat, tak ada jejak.
      //
      // Jadi kalau katalog tak punya menunya, barisnya disusun dari SNAPSHOT
      // bill sendiri (`menu_nama` + `harga_satuan`) — cukup untuk ditampilkan,
      // ditagih, dan dikirim balik utuh.
      const menu = menuById.get(it.menu_id) ?? menuDariBarisBill(it);
      // harga & id baris ikut dibawa: yang ditagih adalah harga saat dipesan,
      // dan id-nya dipakai agar PUT/bayar tidak kehilangan kunci harga itu
      lines.push({
        menu,
        qty: it.qty,
        dineInOverride: it.dine_in_override,
        catatan: it.catatan ?? "",
        billItemId: it.id,
        hargaKunci: it.harga_satuan,
      });
    }
    setCart(lines);
    setMejaId(bill.meja_id);
    setKonsumenNama(bill.customer_nama ?? "");
    setKonsumenWa(bill.customer_wa ?? "");
    setEditingBillId(id);
    setMejaModalOpen(false);
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100vh-3rem)]">
      <CabangDataBar />
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
      {/* Katalog — di BAWAH keranjang pada mobile, kiri pada desktop */}
      <div className="order-2 flex min-w-0 flex-col md:order-1 md:flex-1">
        {/* Pencarian menu — di atas kategori */}
        <input
          value={cariMenu}
          onChange={(e) => {
            setCariMenu(e.target.value);
            if (e.target.value) setAktifKategori(null);
          }}
          disabled={perluPilihMeja}
          placeholder={perluPilihMeja ? "🔍 Pilih meja dulu…" : "🔍 Cari menu / kode…"}
          className="mb-3 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        />
        {/* Toggle tampilan: foto (thumbnail) / kode (ringkas per kategori) */}
        <div className={`mb-3 flex items-center gap-2 ${perluPilihMeja ? "hidden" : ""}`}>
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm">
            <button
              type="button"
              onClick={() => setTampilan("foto")}
              className={`px-3 py-1.5 font-medium ${
                tampilan === "foto"
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              🖼 Foto
            </button>
            <button
              type="button"
              onClick={() => setTampilan("kode")}
              className={`px-3 py-1.5 font-medium ${
                tampilan === "kode"
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              🔤 Kode
            </button>
          </div>
        </div>

        {/* Kategori — hanya pada tampilan foto; tampilan kode menampilkan semua kategori sekaligus */}
        {!perluPilihMeja && tampilan === "foto" && (
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                setAktifKategori(null);
                setCariMenu("");
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                aktifKategori === null && !cariMenu
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              Semua
            </button>
            {kategoriTampil.map((k) => (
              <button
                key={k.id}
                onClick={() => {
                  setAktifKategori(k.id);
                  setCariMenu("");
                }}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  aktifKategori === k.id && !cariMenu
                    ? "bg-orange-600 text-white"
                    : "bg-white text-stone-600 hover:bg-stone-50"
                }`}
              >
                {k.nama}
              </button>
            ))}
          </div>
        )}

        {perluPilihMeja ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center md:flex-1">
            <div className="text-4xl">🍽</div>
            <div className="text-base font-bold text-stone-700">Pilih meja dulu</div>
            <p className="max-w-xs text-sm text-stone-500">
              Menu terbuka setelah mejanya dipilih. Untuk pesanan bawa pulang, pilih{" "}
              <b>Ruang Tunggu</b>.
            </p>
            <button onClick={() => setMejaModalOpen(true)} className={`${btnPrimary} mt-1`}>
              🍽 Pilih meja
            </button>
          </div>
        ) : tampilan === "foto" ? (
          <div className="grid auto-rows-min grid-cols-2 gap-3 pb-4 md:flex-1 md:grid-cols-3 md:overflow-y-auto xl:grid-cols-4">
            {menuTampil.map((m) => (
              <button
                key={m.id}
                onClick={() => tambah(m)}
                className="flex flex-col rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-orange-400 hover:shadow"
              >
                {m.image_url ? (
                  <img
                    src={m.image_url}
                    alt={m.nama}
                    className="mb-2 h-20 w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg bg-orange-50 text-2xl">
                    🍜
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  {m.kode && (
                    <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[11px] font-bold leading-tight text-orange-700">
                      {m.kode}
                    </span>
                  )}
                  <div className="line-clamp-2 text-sm font-semibold text-stone-800">{m.nama}</div>
                </div>
                {/* Isi menu — kasir bisa langsung menjawab "isinya apa?" */}
                {m.deskripsi && (
                  <div className="line-clamp-2 pt-0.5 text-[11px] leading-snug text-stone-500">
                    {m.deskripsi}
                  </div>
                )}
                {/* Sisa porsi di bawah nama menu — kasir bisa infokan ke konsumen */}
                <div className="pt-0.5">
                  <StokBadge stok={sisaByMenu.get(m.id)} />
                </div>
                <div className="mt-auto pt-1 text-sm font-bold text-orange-600">
                  {formatRupiah(m.harga_jual)}
                </div>
              </button>
            ))}
            {menuTampil.length === 0 && (
              <div className="col-span-full py-10 text-center text-stone-400">
                {cariMenu ? `Menu "${cariMenu}" tidak ditemukan.` : "Tidak ada menu di kategori ini."}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 pb-4 md:flex-1 md:overflow-y-auto">
            {menuKodeGroups.map((g) => (
              <div key={g.kategori.id}>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-400">
                  {g.kategori.nama}
                </div>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
                  {g.items.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => tambah(m)}
                      title={m.deskripsi ? `${m.nama} — ${m.deskripsi}` : m.nama}
                      className="flex flex-col items-center justify-center rounded-md border border-stone-200 bg-white px-1 py-1.5 text-center transition hover:border-orange-400 hover:shadow-sm"
                    >
                      <span className="max-w-full truncate font-mono text-xs font-bold leading-none text-stone-800">
                        {m.kode ?? "—"}
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-orange-600">
                        {formatAngka(m.harga_jual, 0)}
                      </span>
                      {/* Sisa porsi di bawah kode + harga */}
                      <StokBadge stok={sisaByMenu.get(m.id)} size="sm" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {menuKodeGroups.length === 0 && (
              <div className="py-10 text-center text-stone-400">
                {cariMenu ? `Menu "${cariMenu}" tidak ditemukan.` : "Belum ada menu."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keranjang — di ATAS pada mobile, kanan pada desktop */}
      <Card className="order-1 flex w-full shrink-0 flex-col p-4 md:order-2 md:w-96">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-bold text-stone-800">Keranjang</h2>
            <Link
              to="/kasir/riwayat"
              className="text-xs font-medium text-orange-600 hover:underline"
            >
              🕘 Riwayat
            </Link>
          </div>
          <Link
            to="/pengaturan/meja"
            className="text-xs font-medium text-stone-400 hover:text-orange-600 hover:underline"
          >
            ⚙ Atur meja
          </Link>
        </div>

        {/* Pemilih Open Bill (di atas) — pesanan tersimpan yang belum dibayar */}
        {openBills.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="mb-1 px-1 text-xs font-semibold text-amber-800">
              📋 Open Bill ({openBills.length}) — ketuk untuk buka
            </div>
            <div className="flex flex-wrap gap-1.5">
              {openBills.map((b) => (
                <button
                  key={b.id}
                  onClick={() => void bukaBill(b.id)}
                  className={`rounded-lg border px-2 py-1 text-left text-xs ${
                    editingBillId === b.id
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  <span className="font-semibold">{b.meja_label || b.customer_nama || "Bill"}</span>
                  <span className="ml-1 opacity-80">· {b.jumlah_item} item</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Meja terpilih (dipilih lewat modal di awal transaksi) + tombol ganti */}
        <button
          onClick={() => {
            // Keranjang kosong = tak ada yang bisa hilang → langsung ke pemilih.
            if (cart.length > 0 && mejaId) setGantiMejaOpen(true);
            else setMejaModalOpen(true);
          }}
          className={`mb-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
            mejaTerpilih
              ? dineIn
                ? "border-blue-200 bg-blue-50"
                : "border-amber-200 bg-amber-50"
              : "border-dashed border-stone-300 bg-stone-50"
          }`}
        >
          <span className="min-w-0">
            <span className="block text-xs text-stone-500">Meja</span>
            {mejaTerpilih ? (
              <span className="font-semibold text-stone-800">
                {mejaTerpilih.tipe === "takeaway" ? `🥡 ${mejaTerpilih.nama}` : mejaTerpilih.nama}
                <span
                  className={`ml-2 text-xs font-medium ${dineIn ? "text-blue-600" : "text-amber-600"}`}
                >
                  {dineIn ? "Dine-in" : "Bawa pulang"}
                </span>
              </span>
            ) : (
              <span className="font-semibold text-stone-400">Belum dipilih</span>
            )}
          </span>
          <span className="shrink-0 text-sm font-medium text-orange-600">
            {mejaTerpilih ? "Ganti" : "Pilih"}
          </span>
        </button>

        {/* Perpindahan meja belum tersimpan — katakan apa adanya, termasuk meja
            asalnya, supaya kasir tahu perubahannya tercatat dan tahu cara
            membatalkannya (pilih kembali meja asal). */}
        {pindahMeja && (
          <div className="-mt-1 mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
            Bill ini masih tercatat di <b>{pindahMeja.meja_label ?? "tanpa meja"}</b>. Menekan{" "}
            <b>Perbarui Bill</b> akan <b>memindahkannya</b> ke{" "}
            <b>{mejaTerpilih?.nama ?? "meja ini"}</b>. Batal? Pilih kembali{" "}
            {pindahMeja.meja_label ?? "meja asalnya"}.
          </div>
        )}

        {/* Konsumen/member (opsional) — di bawah meja; ketik nama ATAU WA →
            dropdown member muncul, pilih untuk isi keduanya sekaligus. */}
        <div className="relative mb-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={konsumenNama}
              onChange={(e) => {
                setKonsumenNama(e.target.value);
                setCariMember(e.target.value);
                setMemberOpen(true);
              }}
              onFocus={() => {
                setCariMember(konsumenNama);
                setMemberOpen(true);
              }}
              onBlur={() => setTimeout(() => setMemberOpen(false), 150)}
              placeholder="👤 Nama konsumen"
              autoComplete="off"
              className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
            />
            <input
              value={konsumenWa}
              onChange={(e) => {
                setKonsumenWa(e.target.value);
                setCariMember(e.target.value);
                setMemberOpen(true);
              }}
              onFocus={() => {
                setCariMember(konsumenWa);
                setMemberOpen(true);
              }}
              onBlur={() => setTimeout(() => setMemberOpen(false), 150)}
              inputMode="tel"
              placeholder="📱 No. WhatsApp"
              autoComplete="off"
              className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
            />
          </div>
          {memberOpen && memberSaran.length > 0 && (
            <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
              {memberSaran.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    // mouseDown mendahului blur → cegah dropdown tertutup sebelum klik
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pilihMember(m)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-orange-50"
                  >
                    <span className="truncate font-medium text-stone-800">{m.nama}</span>
                    <span className="shrink-0 font-mono text-xs text-stone-500">{m.wa}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Keterangan warna, sekali di atas daftar — menjawab "kenapa baris ini
            tak bisa dihapus" tanpa menempelkan peringatan di setiap baris. */}
        {editingBillId && cart.some((l) => l.billItemId) && (
          <div className="mb-2 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-[11px] leading-snug text-stone-600">
            <b className="text-emerald-800">✓ Sudah masuk pesanan</b> = sudah tayang di papan
            dapur, jadi tak bisa dihapus dari sini — batalkan lewat <b>Papan Pesanan</b> supaya
            ada jejaknya. <b className="text-orange-800">Baru</b> = tambahan yang belum
            disimpan.
          </div>
        )}
        <div className="space-y-2 md:flex-1 md:overflow-y-auto">
          {cart.length === 0 && (
            <div className="py-10 text-center text-sm text-stone-400">
              {/* Jangan menyuruh "ketuk menu" saat katalognya memang masih
                  tertutup — dua petunjuk yang bertabrakan justru bikin kasir
                  mencari-cari menu yang tak ada. */}
              {perluPilihMeja ? "Pilih meja dulu, menunya menyusul." : "Ketuk menu untuk menambahkan."}
            </div>
          )}
          {cart.map((l) => {
            const efektifDineIn = l.dineInOverride ?? dineIn;
            // Saat MEMPERBARUI bill: bedakan baris yang sudah tayang di papan
            // dapur dari baris yang baru diketik. Tanpa itu kasir tak tahu mana
            // yang sudah diproses, dan tak tahu kenapa satu baris tak bisa
            // dihapus sementara yang lain bisa. Pada transaksi baru semua baris
            // memang baru, jadi penandanya tak perlu muncul.
            const sudahKeDapur = editingBillId != null && l.billItemId != null;
            const barisBaru = editingBillId != null && l.billItemId == null;
            return (
              <div
                key={l.menu.id}
                className={`rounded-lg border p-2 ${
                  sudahKeDapur
                    ? "border-emerald-200 bg-emerald-50/40"
                    : barisBaru
                      ? "border-orange-300 bg-orange-50/40"
                      : "border-stone-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-stone-800">
                      {l.menu.nama}
                    </div>
                    <div className="text-xs text-stone-500">
                      {formatRupiah(hargaBaris(l))} ×{" "}
                      <span className="font-semibold">{l.qty}</span>
                    </div>
                    {/* Menu sudah diarsipkan setelah bill dibuat: barisnya tetap
                        ditagih di harga saat dipesan, tapi katakan apa adanya
                        supaya kasir tak mencarinya di katalog. */}
                    {l.billItemId && !l.menu.is_active && (
                      <div className="mt-0.5 inline-flex items-center rounded-full bg-stone-200 px-1.5 py-0.5 text-[11px] font-semibold text-stone-700">
                        menu sudah tak aktif — tetap ditagih
                      </div>
                    )}
                    {sudahKeDapur && (
                      <div className="mt-0.5 inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                        ✓ Sudah masuk pesanan
                      </div>
                    )}
                    {barisBaru && (
                      <div className="mt-0.5 inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800">
                        Baru — belum disimpan
                      </div>
                    )}
                    {/* Harga menu berubah setelah bill dibuat: pembeli tetap
                        ditagih harga saat memesan — katakan apa adanya. */}
                    {l.hargaKunci != null && l.hargaKunci !== l.menu.harga_jual && (
                      <div
                        className="text-[11px] text-amber-700"
                        title={`Harga menu sekarang ${formatRupiah(l.menu.harga_jual)}`}
                      >
                        🔒 harga saat dipesan (menu kini {formatRupiah(l.menu.harga_jual)})
                      </div>
                    )}
                  </div>
                  <div className="text-sm font-bold text-stone-800">
                    {formatRupiah(hargaBaris(l) * l.qty)}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => toggleLineDineIn(l.menu.id)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      efektifDineIn
                        ? "bg-blue-100 text-blue-700"
                        : "bg-stone-100 text-stone-600"
                    }`}
                    title="Ganti dine-in / bawa pulang untuk baris ini"
                  >
                    {efektifDineIn ? "Dine-in" : "Bawa pulang"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => ubahQty(l.menu.id, -1)}
                      disabled={sudahKeDapur && l.qty <= 1}
                      title={
                        sudahKeDapur && l.qty <= 1
                          ? "Sudah masuk pesanan — batalkan dari Papan Pesanan supaya ada jejaknya"
                          : "Kurangi jumlah"
                      }
                      className="h-7 w-7 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-300 disabled:hover:bg-transparent"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
                    <button
                      onClick={() => ubahQty(l.menu.id, 1)}
                      className="h-7 w-7 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50"
                    >
                      +
                    </button>
                  </div>
                </div>
                <input
                  value={l.catatan}
                  onChange={(e) => ubahCatatanLine(l.menu.id, e.target.value)}
                  placeholder="Catatan (mis. tanpa gula, tanpa mie)"
                  className="mt-2 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-xs focus:border-orange-400 focus:bg-white focus:outline-none"
                />
                {/* Peringatan bila pesanan melebihi stok tersisa (mis. pesan 3, sisa 2) */}
                {(() => {
                  const sisa = sisaByMenu.get(l.menu.id)?.porsi;
                  if (sisa == null || l.qty <= sisa) return null;
                  return (
                    <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                      ⚠ {sisa <= 0 ? "Stok habis" : `Stok hanya sisa ${sisa}`} — pesanan {l.qty}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          <div className="flex justify-between text-base font-bold text-stone-800">
            <span>Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          <ErrorText error={simpanBill.error} />
          {cart.length > 0 && !mejaId && (
            <div className="text-center text-xs font-medium text-amber-600">
              Pilih meja dulu untuk melanjutkan.
            </div>
          )}
          {/* Setelah meja & menu: pilih simpan Open Bill atau Lanjut ke pembayaran */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                // Bill BARU di meja yang sudah punya bill berjalan → tanya dulu.
                // Saat memperbarui bill (editingBillId terisi) tak ada yang
                // perlu ditanya: itu memang bill yang sama.
                if (!editingBillId && billDiMeja.length > 0) setBillGandaOpen(true);
                else simpanBill.mutate();
              }}
              disabled={cart.length === 0 || !mejaId || simpanBill.isPending}
              className={`${btnSecondary} py-3`}
            >
              {simpanBill.isPending ? "Menyimpan…" : editingBillId ? "💾 Perbarui Bill" : "📋 Open Bill"}
            </button>
            <button
              onClick={() => {
                // selalu mulai dari baca-ulang pesanan, bukan dari layar uang
                setLangkahBayar("resume");
                setResumeOpen(true);
              }}
              disabled={cart.length === 0 || !mejaId}
              className={`${btnPrimary} py-3`}
            >
              Lanjut →
            </button>
          </div>
        </div>
      </Card>

      {/* Modal dua langkah: (1) Resume Order — baca ulang pesanan + diskon,
          (2) Pembayaran — metode + uang diterima. Lihat catatan `langkahBayar`. */}
      {resumeOpen && !struk && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setResumeOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-stone-800">
                  {langkahBayar === "resume" ? "Resume Order" : "Pembayaran"}
                </h2>
                <div className="text-xs font-medium text-stone-400">
                  {langkahBayar === "resume"
                    ? "Langkah 1 dari 2 · cocokkan pesanan dengan tamu"
                    : "Langkah 2 dari 2 · terima uang"}
                </div>
              </div>
              <button
                onClick={() => setResumeOpen(false)}
                className="text-stone-400 hover:text-stone-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>
            <div className="mb-3 text-sm text-stone-500">
              {mejaTerpilih
                ? mejaTerpilih.tipe === "takeaway"
                  ? `🥡 ${mejaTerpilih.nama}`
                  : mejaTerpilih.nama
                : "Tanpa meja"}
              {" · "}
              {dineIn ? "Dine-in" : "Bawa pulang"}
              {konsumenNama.trim() ? ` · 👤 ${konsumenNama.trim()}` : ""}
              {` · ${cart.reduce((a, l) => a + l.qty, 0)} item`}
            </div>

            {/* Baca ulang pesanan — hanya di langkah resume. Di langkah bayar,
                yang dibutuhkan kasir cuma nominal; daftar panjang justru
                menutupi angka yang harus ia baca ke tamu. */}
            {langkahBayar === "resume" && (
            <div className="mb-3 divide-y divide-stone-100 rounded-lg border border-stone-200">
              {cart.map((l) => (
                <div
                  key={l.menu.id}
                  className="flex items-start justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-stone-800">{l.qty}×</span> {l.menu.nama}
                    {l.catatan.trim() && (
                      <span className="block text-xs text-stone-400">* {l.catatan.trim()}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-medium text-stone-700">
                    {formatRupiah(hargaBaris(l) * l.qty)}
                  </span>
                </div>
              ))}
            </div>
            )}

            <div className="space-y-2">
              {langkahBayar === "resume" && (
              <div className="flex justify-between text-sm text-stone-600">
                <span>Subtotal</span>
                <span>{formatRupiah(subtotal)}</span>
              </div>
              )}
              {/* Diskon per transaksi: toggle %/Rp + input (dibatasi utk kasir).
                  Hanya di langkah resume — diskon adalah bagian dari "apakah
                  pesanan ini sudah benar", bukan bagian dari menerima uang.
                  Kalau bisa diubah di layar bayar, nominal "uang pas" yang sudah
                  diketik jadi basi tanpa kasir menyadarinya. */}
              {langkahBayar === "resume" && (
              <div>
                <div className="flex items-center justify-between gap-2 text-sm text-stone-600">
                  <div className="flex items-center gap-1.5">
                    <span>Diskon</span>
                    <div className="flex overflow-hidden rounded-md border border-stone-300 text-xs">
                      <button
                        type="button"
                        disabled={!diskonBoleh}
                        onClick={() => setDiskonTipe("nominal")}
                        className={`px-2 py-1 font-medium disabled:opacity-40 ${diskonTipe === "nominal" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                      >
                        Rp
                      </button>
                      <button
                        type="button"
                        disabled={!diskonBoleh}
                        onClick={() => setDiskonTipe("persen")}
                        className={`px-2 py-1 font-medium disabled:opacity-40 ${diskonTipe === "persen" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                      >
                        %
                      </button>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={diskonTipe === "persen" ? (isKasir ? maksDiskonPersen : 100) : undefined}
                      disabled={!diskonBoleh}
                      value={diskonNilai}
                      onChange={(e) => setDiskonNilai(e.target.value)}
                      placeholder="0"
                      className="w-20 rounded-md border border-stone-300 px-2 py-1 text-right text-sm disabled:bg-stone-100"
                    />
                  </div>
                  <span className="text-red-600">
                    {diskon > 0 ? `−${formatRupiah(diskon)}` : "—"}
                  </span>
                </div>
                {isKasir && maksDiskonPersen < 100 && (
                  <div className="mt-0.5 text-right text-xs text-stone-400">
                    {maksDiskonPersen === 0
                      ? "Diskon hanya oleh owner/admin"
                      : `Maks diskon kasir ${maksDiskonPersen}%${diskonDibatasi ? " · dibatasi" : ""}`}
                  </div>
                )}
              </div>
              )}
              {langkahBayar === "resume" && pb1 > 0 && (
                <div className="flex justify-between text-sm text-stone-600">
                  <span>PB1 ({pb1Conf?.pb1_rate}%)</span>
                  <span>{formatRupiah(pb1)}</span>
                </div>
              )}
              {/* Total: di langkah bayar ini angka yang dibacakan ke tamu, jadi
                  dijadikan kotak — bukan satu baris di antara baris lain. */}
              {langkahBayar === "resume" ? (
                <div className="flex justify-between text-xl font-bold text-stone-800">
                  <span>Total</span>
                  <span>{formatRupiah(total)}</span>
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-center">
                  <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">
                    Total tagihan
                  </div>
                  <div className="text-3xl font-bold text-stone-800">{formatRupiah(total)}</div>
                  {diskon > 0 && (
                    <div className="text-xs text-stone-500">
                      sudah termasuk diskon {formatRupiah(diskon)}
                    </div>
                  )}
                </div>
              )}

              {/* Metode pembayaran — langkah 2 saja */}
              {langkahBayar === "bayar" && (
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {(["tunai", "qris", "transfer"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetodeBayar(m)}
                    className={`rounded-lg border px-2 py-1.5 text-sm font-medium ${
                      metodeBayar === m
                        ? "border-orange-600 bg-orange-600 text-white"
                        : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    {m === "tunai" ? "💵 Tunai" : m === "qris" ? "📱 QRIS" : "🏦 Transfer"}
                  </button>
                ))}
              </div>
              )}
              {langkahBayar === "bayar" && metodeBayar === "tunai" && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    {/* nominal berformat: prefix Rp + pemisah ribuan (titik).
                        state uangDiterima disimpan sebagai angka mentah (digit). */}
                    <div className="relative w-full">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-stone-400">
                        Rp
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={uangDiterima ? formatAngka(Number(uangDiterima), 0) : ""}
                        onChange={(e) => setUangDiterima(e.target.value.replace(/\D/g, ""))}
                        placeholder="Uang diterima"
                        className="w-full rounded-lg border border-stone-300 py-1.5 pl-9 pr-3 text-right text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setUangDiterima(String(total))}
                      className="shrink-0 rounded-lg border border-stone-300 px-2 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                    >
                      Uang pas
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[20000, 50000, 100000].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setUangDiterima(String(n))}
                        className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                      >
                        {formatRupiah(n)}
                      </button>
                    ))}
                  </div>
                  {uangNum > 0 && (
                    <div
                      className={`flex justify-between text-sm font-semibold ${uangKurang ? "text-red-600" : "text-green-600"}`}
                    >
                      <span>{uangKurang ? "Uang kurang" : "Kembalian"}</span>
                      <span>{formatRupiah(uangKurang ? total - uangNum : kembalian)}</span>
                    </div>
                  )}
                </div>
              )}

              {langkahBayar === "resume" ? (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button onClick={() => setResumeOpen(false)} className={`${btnSecondary} py-3`}>
                    ← Kembali
                  </button>
                  <button
                    onClick={() => setLangkahBayar("bayar")}
                    className={`${btnPrimary} py-3`}
                  >
                    Lanjut ke Pembayaran →
                  </button>
                </div>
              ) : (
                <>
                  <ErrorText error={bayar.error} />
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {/* Kembali ke resume, BUKAN menutup modal — pesanan masih
                        bisa dikoreksi tanpa kehilangan konteks pembayaran. */}
                    <button
                      onClick={() => setLangkahBayar("resume")}
                      className={`${btnSecondary} py-3`}
                    >
                      ← Ubah pesanan
                    </button>
                    <button
                      onClick={() => bayar.mutate()}
                      disabled={uangKurang || bayar.isPending}
                      className={`${btnPrimary} py-3`}
                    >
                      {bayar.isPending ? "Menyimpan…" : "💾 Simpan & Cetak"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gerbang Buka Kasir — bila belum ada shift terbuka, transaksi diblokir.
          Overlay HANYA menutup area kasir (kanan sidebar), BUKAN sidebar/header:
          user tetap bisa Absen, SO, kelola shift, atau keluar tanpa buka kasir.
          Karena itu md:left-56 (lebar sidebar) + z-20 (di bawah header z-30 &
          drawer z-50 mobile, di atas konten kasir). */}
      {kasirTutup && !struk && (
        <div className="fixed inset-y-0 right-0 left-0 z-20 flex items-center justify-center bg-black/60 p-4 md:left-56">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-1 text-center text-4xl">🔒</div>
            <h2 className="text-center text-lg font-bold text-stone-800">Kasir Belum Dibuka</h2>
            <p className="mt-1 mb-4 text-center text-sm text-stone-500">
              Transaksi belum bisa dilakukan. Buka kasir dulu untuk mulai berjualan.
            </p>

            {/* Syarat: kasir harus sudah absen masuk hari ini */}
            {sudahAbsen ? (
              <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                ✓ Sudah absen masuk hari ini
              </div>
            ) : (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <div className="text-sm font-semibold text-amber-800">
                  Anda belum absen masuk
                </div>
                <div className="mt-0.5 text-xs text-amber-700">
                  Absen masuk dulu sebelum membuka kasir.
                </div>
                <Link
                  to="/absen"
                  className={`${btnPrimary} mt-2 flex w-full items-center justify-center py-2.5`}
                >
                  🖐 Absen Sekarang
                </Link>
              </div>
            )}

            <label className="mb-1 block text-sm font-medium text-stone-700">
              Modal awal (Rp)
            </label>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={modalAwalGate}
              onChange={(e) => setModalAwalGate(e.target.value)}
              placeholder="mis. 200000"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-stone-400">Uang tunai di laci saat mulai shift.</p>
            <ErrorText error={bukaKasir.error} />
            <button
              onClick={() => bukaKasir.mutate()}
              disabled={bukaKasir.isPending}
              className={`${btnPrimary} mt-3 w-full py-3`}
            >
              {bukaKasir.isPending ? "Membuka…" : "🔓 Buka Kasir"}
            </button>
            <Link
              to="/kasir/tutup"
              className="mt-2 block text-center text-xs text-stone-400 hover:text-orange-600 hover:underline"
            >
              Kelola shift (tutup / riwayat) →
            </Link>
          </div>
        </div>
      )}

      {/* Modal pilih meja — muncul lebih dulu tiap memulai transaksi. TIDAK
          muncul saat kasir belum dibuka (gerbang Buka Kasir yang tampil), supaya
          sidebar tetap bebas diklik (Absen/SO/keluar tanpa buka kasir). */}
      {mejaModalOpen && !struk && !kasirTutup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setMejaModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-800">Pilih Meja</h2>
              <button
                onClick={() => setMejaModalOpen(false)}
                className="text-stone-400 hover:text-stone-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-stone-500">
              Pilih meja untuk memulai transaksi. Meja bernomor = dine-in; <b>Ruang Tunggu</b> =
              bawa pulang (take away).
            </p>

            {mejaLoading ? (
              <div className="p-6 text-center text-sm text-stone-400">Memuat meja…</div>
            ) : mejaAktif.length === 0 ? (
              <div className="rounded-lg bg-stone-50 p-6 text-center text-sm text-stone-500">
                Belum ada meja aktif.{" "}
                <Link
                  to="/pengaturan/meja"
                  onClick={() => setMejaModalOpen(false)}
                  className="font-medium text-orange-600 hover:underline"
                >
                  Atur meja dulu →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Pencarian: ketik nomor/kata, cocok sebagian (mis. "8" → Meja 8) */}
                <input
                  autoFocus
                  value={mejaCari}
                  onChange={(e) => setMejaCari(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mejaCocok.length === 1) pilihMeja(mejaCocok[0].id);
                  }}
                  placeholder="Cari meja… (mis. 8 atau ruang tunggu)"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
                />
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {mejaCocok.length === 0 && (
                    <div className="py-6 text-center text-sm text-stone-400">
                      Tidak ada meja cocok "{mejaCari}".
                    </div>
                  )}
                  {mejaCocok.map((m) => {
                    const takeaway = m.tipe === "takeaway";
                    const dipilih = mejaId === m.id;
                    const st = statusMeja.get(m.id);
                    return (
                      <div
                        key={m.id}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold ${
                          dipilih
                            ? takeaway
                              ? "border-amber-500 bg-amber-500 text-white"
                              : "border-blue-600 bg-blue-600 text-white"
                            : takeaway
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : st
                                ? kelasStatus(st)
                                : "border-stone-200 bg-white text-stone-700"
                        }`}
                      >
                        {/* Meja terisi TETAP bisa dipilih — melanjutkan bill di
                            meja itu justru wajib, dan penjualan langsung di meja
                            terisi juga sah. Yang ditolak server hanya bill KEDUA
                            (409 `meja_sudah_ada_bill`), bukan pemilihan mejanya. */}
                        <button
                          onClick={() => pilihMeja(m.id)}
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                        >
                          <span className="truncate">{takeaway ? `🥡 ${m.nama}` : m.nama}</span>
                          <span
                            className={`shrink-0 text-xs font-medium ${dipilih ? "text-white/80" : "opacity-80"}`}
                          >
                            {takeaway ? "Take away" : st ? labelStatus(st) : "Dine-in"}
                          </span>
                        </button>
                        {st?.status === "isi" && (
                          <button
                            onClick={() => setKosongkanId(m.id)}
                            className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${
                              dipilih
                                ? "bg-white/20 text-white hover:bg-white/30"
                                : "bg-green-600 text-white hover:bg-green-700"
                            }`}
                          >
                            ✓ Kosongkan
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Link
                  to="/pengaturan/meja"
                  onClick={() => setMejaModalOpen(false)}
                  className="block text-center text-xs text-stone-400 hover:text-orange-600 hover:underline"
                >
                  ⚙ Atur / tambah meja
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {struk && (
        <ReceiptModal
          data={struk}
          onClose={() => {
            setStruk(null);
            setMejaModalOpen(isKasir); // kasir: lanjut pilih meja transaksi berikutnya
          }}
        />
      )}

      {/* Bereskan meja langsung dari modal Pilih Meja — layar tempat kasir
          sudah berdiri puluhan kali sehari, jadi tak perlu bolak-balik ke
          halaman Meja hanya untuk satu ketukan. */}
      {kosongkanId && statusMeja.get(kosongkanId) && (
        <KosongkanMejaModal
          meja={statusMeja.get(kosongkanId)!}
          branchQuery={branchQuery}
          onClose={() => setKosongkanId(null)}
        />
      )}

      {/* "Yakin ganti meja?" — muncul HANYA bila keranjang terisi, karena hanya
          di situ ada yang bisa hilang. Tiga jalan keluar, semuanya menyebut
          akibatnya ke pesanan yang sudah diketik; tak ada yang menghapus tanpa
          diminta. */}
      {gantiMejaOpen && (
        <Modal open onClose={() => setGantiMejaOpen(false)} title="Yakin ganti meja?">
          <p className="text-sm text-stone-600">
            Ada <b>{cart.length} pesanan</b> di keranjang untuk{" "}
            <b>{mejaTerpilih?.nama ?? "meja ini"}</b>. Pesanannya mau diapakan?
          </p>
          <ErrorText error={simpanBill.error} />
          <div className="mt-3 space-y-2">
            <button
              onClick={() => {
                // Keranjang dibiarkan utuh — pilihan meja berikutnya yang
                // menentukan ke mana pesanan ini dibukukan.
                setGantiMejaOpen(false);
                setMejaModalOpen(true);
              }}
              disabled={simpanBill.isPending}
              className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-3 text-left hover:bg-blue-100 disabled:opacity-50"
            >
              <span className="block text-sm font-bold text-blue-900">
                🍽 Bawa pesanan ini ke meja baru
              </span>
              <span className="block text-xs text-blue-700">
                Salah pilih meja — keranjang ikut pindah, tak ada yang hilang.
              </span>
            </button>
            <button
              onClick={async () => {
                // Pesanan meja LAMA diamankan dulu jadi bill, baru pindah.
                await simpanBill.mutateAsync().catch(() => null);
                if (simpanBill.isError) return;
                setGantiMejaOpen(false);
                setMejaModalOpen(true);
              }}
              disabled={simpanBill.isPending}
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-left hover:bg-amber-100 disabled:opacity-50"
            >
              <span className="block text-sm font-bold text-amber-900">
                {simpanBill.isPending
                  ? "Menyimpan…"
                  : editingBillId
                    ? `💾 Simpan perubahan di ${mejaTerpilih?.nama ?? "meja ini"} dulu`
                    : `💾 Simpan jadi Open Bill di ${mejaTerpilih?.nama ?? "meja ini"}`}
              </span>
              <span className="block text-xs text-amber-700">
                Pesanan ini tetap tertagih di meja lama, lalu keranjang bersih untuk meja baru.
              </span>
            </button>
            <button
              onClick={() => {
                // Baris yang SUDAH jadi bill tak dihapus dari sini — bill-nya
                // tetap utuh di server, yang dibuang hanya suntingan di layar.
                // Menghapus bill sungguhan harus lewat jalur yang berjejak.
                resetTransaksi();
                setGantiMejaOpen(false);
                setMejaModalOpen(true);
              }}
              disabled={simpanBill.isPending}
              className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-left hover:bg-red-100 disabled:opacity-50"
            >
              <span className="block text-sm font-bold text-red-900">
                {editingBillId ? "↩ Tinggalkan perubahan" : "🗑 Hapus pesanan ini"}
              </span>
              <span className="block text-xs text-red-700">
                {editingBillId
                  ? "Bill tetap seperti yang sudah tersimpan — hanya suntingan di layar yang dibuang."
                  : "Keranjang dikosongkan, tak ada yang tersimpan."}
              </span>
            </button>
          </div>
          <button
            onClick={() => setGantiMejaOpen(false)}
            disabled={simpanBill.isPending}
            className={`${btnSecondary} mt-3 w-full`}
          >
            Batal, tetap di {mejaTerpilih?.nama ?? "meja ini"}
          </button>
        </Modal>
      )}

      {/* Meja SUDAH DIBAYAR tapi belum dibereskan. Server tak bisa membedakan
          "tamu sama pesan lagi" dari "tamu baru duduk", jadi kasir memutuskan —
          dan pilihan "tamu baru" memanggil /kosongkan supaya hitungan lama
          duduk mulai dari nol. Tanpa langkah itu papan bilang "sudah 2 jam"
          untuk orang yang baru lima menit duduk. */}
      {tamuMejaId && statusMeja.get(tamuMejaId) && (
        <Modal
          open
          onClose={() => setTamuMejaId(null)}
          title={`${statusMeja.get(tamuMejaId)!.nama} — tamu yang sama atau tamu baru?`}
        >
          <p className="text-sm text-stone-600">
            Meja ini <b>sudah dibayar</b> tapi belum dibereskan (
            {labelStatus(statusMeja.get(tamuMejaId)!).replace("✓ Sudah bayar · ", "")}).
            {statusMeja.get(tamuMejaId)!.konsumen_nama && (
              <>
                {" "}
                Konsumen terakhir: <b>{statusMeja.get(tamuMejaId)!.konsumen_nama}</b>.
              </>
            )}
          </p>
          <ErrorText error={bereskanLaluPakai.error} />
          <div className="mt-3 space-y-2">
            <button
              onClick={() => lanjutTamuSama(tamuMejaId)}
              disabled={bereskanLaluPakai.isPending}
              className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-3 text-left hover:bg-blue-100 disabled:opacity-50"
            >
              <span className="block text-sm font-bold text-blue-900">
                🍽 Tamu yang sama — tambah pesanan
              </span>
              <span className="block text-xs text-blue-700">
                Meja tetap terisi sejak tamu datang
                {statusMeja.get(tamuMejaId)!.konsumen_nama
                  ? ", nama konsumen diisi otomatis"
                  : ""}
                .
              </span>
            </button>
            <button
              onClick={() => bereskanLaluPakai.mutate(tamuMejaId)}
              disabled={bereskanLaluPakai.isPending}
              className="w-full rounded-lg border border-green-300 bg-green-50 px-3 py-3 text-left hover:bg-green-100 disabled:opacity-50"
            >
              <span className="block text-sm font-bold text-green-900">
                {bereskanLaluPakai.isPending ? "Membereskan…" : "✓ Tamu baru — bereskan meja dulu"}
              </span>
              <span className="block text-xs text-green-700">
                Hitungan lama duduk mulai dari nol, konsumen dikosongkan.
              </span>
            </button>
          </div>
          <button
            onClick={() => setTamuMejaId(null)}
            className={`${btnSecondary} mt-3 w-full`}
          >
            Batal, pilih meja lain
          </button>
        </Modal>
      )}

      {/* SATU MEJA DINE-IN = SATU BILL. Pesanan tambahan wajib masuk ke bill
          yang sudah ada — dua bill di satu meja membuat salah satunya
          tertinggal tak tertagih saat tamu pulang, dan tak ada yang tahu sampai
          selisih muncul di tutup kasir. Server juga menolaknya (409
          `meja_sudah_ada_bill`); modal ini cuma mendahului supaya kasir tak
          perlu menabrak galat dulu. */}
      {billGandaOpen && (
        <Modal
          open
          onClose={() => setBillGandaOpen(false)}
          title={`${mejaTerpilih?.nama ?? "Meja ini"} sudah punya bill berjalan`}
        >
          <p className="text-sm text-stone-600">
            Selama bill itu belum dibayar, <b>pesanan tambahan masuk ke bill yang sama</b> —
            bukan bill baru. Buka bill-nya, tambahkan pesanan ini, lalu simpan.
          </p>
          <div className="mt-3 space-y-1.5">
            {billDiMeja.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setBillGandaOpen(false);
                  void bukaBill(b.id);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm font-semibold text-amber-900 hover:bg-amber-100"
              >
                <span className="truncate">
                  📋 {b.customer_nama || b.meja_label || "Bill"}
                  <span className="ml-1 font-normal opacity-70">· {b.jumlah_item} item</span>
                </span>
                <span className="shrink-0 text-xs font-medium">Buka bill →</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Membuka bill akan <b>menimpa keranjang</b> yang sekarang — catat dulu pesanan
            yang belum masuk, lalu tambahkan setelah bill terbuka.
          </p>
          <div className="mt-4">
            <button onClick={() => setBillGandaOpen(false)} className={`${btnSecondary} w-full`}>
              Tutup
            </button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}
