import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  PANDUAN_MARKUP,
  angkaDari,
  teksAngka,
  draftIsiMenu,
  foodCostPersen,
  hargaJualBulat,
  hargaSaran,
  hargaSaranPaket,
  hitungHpp,
  type BahanDto,
  type MenuDto,
} from "@kakarut/shared";
import { BahanPicker } from "../../components/BahanPicker";
import { ImageUpload } from "../../components/ImageUpload";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { labelCabang, useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
import { useCompanyMode } from "../../lib/useCompanyMode";

interface Kategori {
  id: string;
  nama: string;
  sort_order: number;
}

interface KomponenForm {
  ingredient_id: string;
  qty: string;
}

export function MenuFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isPro } = useCompanyMode();
  const { cabang } = useBranch();

  const { data: bahan } = useQuery({
    queryKey: ["bahan", "ringkas"],
    queryFn: () => api<BahanDto[]>("/bahan?ringkas=1"),
  });
  const { data: kategori } = useQuery({
    queryKey: ["kategori"],
    queryFn: () => api<Kategori[]>("/kategori"),
  });
  const { data: menus } = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuDto[]>("/menu"),
  });
  // Muat via /menu/:id (bukan daftar aktif) agar menu nonaktif tetap bisa diedit
  const { data: menuEdit } = useQuery({
    queryKey: ["menu", id],
    queryFn: () => api<MenuDto>(`/menu/${id}`),
    enabled: Boolean(id),
  });

  const [nama, setNama] = useState("");
  const [kode, setKode] = useState("");
  const [deskripsi, setDeskripsi] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tipe, setTipe] = useState<"regular" | "paket">("regular");
  const [mult, setMult] = useState("2");
  const [baseMenuId, setBaseMenuId] = useState("");
  const [baseMult, setBaseMult] = useState("2");
  const [hargaJual, setHargaJual] = useState("");
  /*
   * Target penyajian diketik dalam MENIT, disimpan dalam DETIK.
   *
   * Yang mengisinya memikirkan "sepuluh menit", bukan "600 detik"; kotak yang
   * meminta detik akan diisi "10" oleh separuh orang dan target sepuluh detik
   * membuat seluruh laporan berkata menu ini selalu terlambat. Kosong = tak
   * ditetapkan, dan menu tanpa target tidak dinilai laporan durasi.
   */
  const [targetMenit, setTargetMenit] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [komponen, setKomponen] = useState<KomponenForm[]>([]);
  /** pembatasan lokasi (mode Pro) — [] = tampil di semua lokasi */
  const [branchIds, setBranchIds] = useState<string[]>([]);
  /** dialog "menu ini belum punya kemasan take away" sedang terbuka */
  const [tanyaKemasan, setTanyaKemasan] = useState(false);
  const dimuat = useRef(false);

  // muat data saat edit
  useEffect(() => {
    if (!id || dimuat.current || !menuEdit) return;
    const m = menuEdit;
    dimuat.current = true;
    setNama(m.nama);
    setKode(m.kode ?? "");
    setDeskripsi(m.deskripsi ?? "");
    setCategoryId(m.category_id);
    setTipe(m.tipe);
    setMult(teksAngka(m.mult ?? 2));
    setBaseMenuId(m.base_menu_id ?? "");
    setBaseMult(teksAngka(m.base_mult ?? 2));
    setHargaJual(teksAngka(m.harga_jual));
    setTargetMenit(
      m.target_durasi_detik == null ? "" : teksAngka(Math.round(m.target_durasi_detik / 60)),
    );
    setImageUrl(m.image_url);
    setIsActive(m.is_active);
    setKomponen(
      m.komponen.map((k) => ({ ingredient_id: k.ingredient_id, qty: teksAngka(k.qty) })),
    );
    setBranchIds(m.branch_ids ?? []);
  }, [id, menuEdit]);

  const bahanById = useMemo(() => new Map((bahan ?? []).map((b) => [b.id, b])), [bahan]);

  // Preview HPP live (rumus sama dengan server, dari @kakarut/shared).
  // Harga per satuan resep (harga_per_unit) diambil apa adanya dari master
  // bahan — aturan resep diubah di halaman Bahan Baku, bukan dari sini.
  const preview = useMemo(() => {
    const komponenHpp = komponen
      .filter((k) => k.ingredient_id && angkaDari(k.qty) > 0)
      .map((k) => {
        const b = bahanById.get(k.ingredient_id);
        return {
          qty: angkaDari(k.qty),
          hargaPerUnit: b?.harga_per_unit ?? 0,
          isPackaging: b?.is_packaging ?? false,
          isComplement: b?.is_complement ?? false,
        };
      });
    const ownHpp = hitungHpp(komponenHpp);
    const ownHppDineIn = hitungHpp(komponenHpp, true);

    if (tipe === "paket") {
      const base = menus?.find((m) => m.id === baseMenuId);
      const baseHpp = base?.hpp ?? 0;
      const saran = hargaSaranPaket(baseHpp, angkaDari(baseMult) || 0, ownHpp);
      return {
        hpp: baseHpp + ownHpp,
        hppDineIn: (base?.hpp_dine_in ?? 0) + ownHppDineIn,
        saran,
        bulat: hargaJualBulat(saran),
      };
    }
    const saran = hargaSaran(ownHpp, angkaDari(mult) || 0);
    return { hpp: ownHpp, hppDineIn: ownHppDineIn, saran, bulat: hargaJualBulat(saran) };
  }, [komponen, bahanById, tipe, mult, baseMenuId, baseMult, menus]);

  /**
   * Apakah menu ini punya bahan KEMASAN TAKE AWAY?
   *
   * Semua menu bisa dijual bawa pulang, jadi tiap menu semestinya punya
   * kemasannya. Tanpa satu pun komponen ber-`is_packaging`, `hitungHpp` bawa
   * pulang dan dine-in menghasilkan angka yang SAMA (lihat `qtyEfektif` di
   * @kakarut/shared) — artinya biaya dus/box tak pernah masuk laba-rugi dan
   * stok kemasan tak pernah berkurang saat pesanan dibawa pulang.
   *
   * Menu paket: resep menu dasarnya tidak ada di `komponen` (yang diedit di
   * sini hanya toppingnya), jadi kemasan bisa saja diwarisi dari sana —
   * `GET /menu` sudah mengirim `komponen` lengkap untuk tiap menu.
   */
  const punyaKemasan = useMemo(() => {
    const sendiri = komponen.some(
      (k) => angkaDari(k.qty) > 0 && bahanById.get(k.ingredient_id)?.is_packaging,
    );
    if (sendiri) return true;
    if (tipe !== "paket" || !baseMenuId) return false;
    return menus?.find((m) => m.id === baseMenuId)?.komponen.some((k) => k.is_packaging) ?? false;
  }, [komponen, bahanById, tipe, baseMenuId, menus]);

  /**
   * Menu tanpa resep sama sekali belum punya HPP apa pun — menegurnya soal
   * kemasan hanya jadi bising. Peringatan baru berlaku begitu resepnya diisi.
   *
   * "Resepnya" untuk PAKET tidak berada di `komponen`. Yang diedit di halaman
   * ini hanya toppingnya; resep menu dasarnya diwarisi, dan `preview` di atas
   * memang menjumlahkannya (`hpp: baseHpp + ownHpp`). Jadi paket TANPA topping
   * sekalipun punya HPP penuh — dan justru itu bentuk paket yang paling lazim
   * ("menu yang sama, harga bundel", tanpa tambahan apa pun).
   *
   * Sebelum ini `adaResep` hanya melihat `komponen`, sementara `punyaKemasan`
   * tepat di atasnya SUDAH melihat menu dasar. Dua paruh dari satu syarat yang
   * sama tak sepakat di mana resep paket berada, dan yang kalah adalah
   * peringatannya: paket tanpa topping atas menu dasar tanpa kemasan lolos
   * simpan tanpa dialog apa pun — persis kasus yang diminta ditanyakan.
   */
  const resepDasarPaket =
    tipe === "paket" && baseMenuId
      ? (menus?.find((m) => m.id === baseMenuId)?.komponen.length ?? 0) > 0
      : false;
  const adaResep =
    komponen.some((k) => k.ingredient_id && angkaDari(k.qty) > 0) || resepDasarPaket;
  const perluKemasan = adaResep && !punyaKemasan;

  /**
   * Baris resep yang SUDAH DIISI takarannya tapi tidak akan ikut tersimpan.
   *
   * Penyaring kiriman memakai `angkaDari(k.qty) > 0`, jadi takaran tak terbaca
   * gagal perbandingan itu dan barisnya dibuang DI SISI KLIEN — tak pernah
   * sampai ke server, tak pernah jadi galat. Tombol Simpan tidak menahannya
   * sama sekali.
   *
   * Di halaman ini kerusakannya paling AWET, karena yang disimpan adalah
   * ATURAN, bukan satu transaksi: resep menu yang kehilangan satu bahan akan
   * (a) menghitung HPP tanpa biaya bahan itu — food cost terlihat lebih sehat
   * daripada kenyataannya — dan (b) tidak pernah memotong stoknya pada SETIAP
   * penjualan menu itu, selamanya, sampai ada yang sadar. Salah ketik sekali,
   * salahnya berulang tiap hari.
   *
   * Nol dan minus ikut terjaring lewat `!(… > 0)` yang sama: keduanya terbaca
   * sebagai angka, tapi nasib barisnya persis sama.
   */
  const qtyTerbuang = komponen
    .filter((k) => k.ingredient_id && k.qty.trim() !== "" && !(angkaDari(k.qty) > 0))
    .map((k) => bahanById.get(k.ingredient_id)?.nama)
    .filter((n): n is string => !!n);

  /**
   * Draf "isi menu" dari baris resep yang SEDANG diedit (belum tentu tersimpan),
   * memakai fungsi yang sama dengan dokumentasi kontrak. Kemasan & pelengkap
   * dibuang, takaran pecahan dibulatkan — hasilnya tetap harus dirapikan user.
   */
  function draftDariResep(): string {
    const isi = komponen
      .filter((k) => k.ingredient_id && angkaDari(k.qty) > 0)
      .map((k) => {
        const b = bahanById.get(k.ingredient_id);
        return {
          nama: b?.nama ?? "",
          qty: angkaDari(k.qty),
          satuan: b?.satuan ?? "",
          is_packaging: b?.is_packaging ?? false,
          is_complement: b?.is_complement ?? false,
        };
      })
      .filter((k) => k.nama);
    // Menu paket: isi menu dasar tak ada di `komponen`, sebut terpisah.
    const base = tipe === "paket" ? menus?.find((m) => m.id === baseMenuId) : null;
    const prefix = base ? `${angkaDari(baseMult) || 1}\u00d7 ${base.nama}` : null;
    return draftIsiMenu(isi, prefix);
  }

  const simpan = useMutation({
    mutationFn: async () => {
      const body = {
        nama,
        kode: kode.trim() || null,
        deskripsi: deskripsi.trim() || null,
        category_id: categoryId,
        tipe,
        mult: tipe === "regular" ? angkaDari(mult) : null,
        base_menu_id: tipe === "paket" ? baseMenuId : null,
        base_mult: tipe === "paket" ? angkaDari(baseMult) : null,
        harga_jual: angkaDari(hargaJual),
        image_url: imageUrl,
        // Kosong → null (hapus target), bukan 0: server menolak 0 dan target
        // nol tak punya arti apa pun.
        target_durasi_detik: targetMenit.trim() ? angkaDari(targetMenit) * 60 : null,
        is_active: isActive,
        komponen: komponen
          .filter((k) => k.ingredient_id && angkaDari(k.qty) > 0)
          .map((k) => ({ ingredient_id: k.ingredient_id, qty: angkaDari(k.qty) })),
        // hanya cabang store (POS) yang jadi lokasi menu — buang id non-store
        // (mis. central kitchen dari data lama) agar simpan tak ditolak server
        branch_ids: branchIds.filter((bid) =>
          cabang.some((b) => b.id === bid && b.tipe === "store"),
        ),
      };
      return id
        ? api(`/menu/${id}`, { method: "PUT", body })
        : api("/menu", { method: "POST", body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      navigate("/menu");
    },
  });

  if (!bahan || !kategori || (id && !menuEdit)) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <PageTitle>{id ? "Ubah Menu" : "Tambah Menu"}</PageTitle>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Takaran tak terbaca ditahan LEBIH DULU: menyimpan resep yang
          // diam-diam kehilangan bahan lebih merusak daripada menyimpannya
          // tanpa kemasan, dan tombolnya pun sudah mati — ini pagar keduanya.
          if (qtyTerbuang.length > 0) return;
          // Konfirmasi dulu bila menu berresep ini belum punya kemasan take
          // away — bukan larangan (ada menu yang memang tak pernah dibawa
          // pulang), tapi keputusannya harus disadari, bukan kelewatan.
          if (perluKemasan) {
            setTanyaKemasan(true);
            return;
          }
          simpan.mutate();
        }}
        className="space-y-5"
      >
        <Card className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama menu</label>
              <input required value={nama} onChange={(e) => setNama(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Kode menu <span className="font-normal text-stone-400">(opsional)</span>
              </label>
              <input
                value={kode}
                onChange={(e) => setKode(e.target.value)}
                maxLength={20}
                placeholder="Kosongkan untuk otomatis"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-500">
                Kosongkan untuk <b>generate otomatis</b> dari nama menu.
              </p>
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium">
                  Isi menu <span className="font-normal text-stone-400">(opsional)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setDeskripsi(draftDariResep())}
                  disabled={komponen.length === 0}
                  className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                >
                  📋 Ambil dari resep
                </button>
              </div>
              <textarea
                value={deskripsi}
                onChange={(e) => setDeskripsi(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="mis. 1 baso urat besar, 2 baso kecil, 2 baso aci, 1 mie"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-500">
                Tampil di <b>Daftar Menu</b> (layar &amp; cetak) dan kartu menu kasir. Tombol
                “Ambil dari resep” hanya membuat <b>draf</b> — resep itu dokumen biaya, jadi
                takarannya bisa pecahan dan memuat kemasan; rapikan dulu sebelum disimpan.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Kategori</label>
              <select
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={inputClass}
              >
                <option value="">— pilih —</option>
                {kategori.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Tipe</label>
              <select
                value={tipe}
                onChange={(e) => setTipe(e.target.value as "regular" | "paket")}
                className={inputClass}
              >
                <option value="regular">Reguler (HPP × markup)</option>
                <option value="paket">Paket (menu dasar + topping tanpa markup)</option>
              </select>
            </div>
            {tipe === "regular" ? (
              <div>
                <label className="mb-1 block text-sm font-medium">Markup (mult)</label>
                <input
                  required
                  /* Markup menentukan harga jual. `type="number"` MEMBUANG koma
                     saat diketik — "2,5" tersimpan "25" tanpa `badInput`, jadi
                     markup 2,5× diam-diam jadi 25×. Koma adalah pemisah desimal
                     bahasa Indonesia; `angkaDari` yang membacanya. */
                  type="text"
                  inputMode="decimal"
                  value={mult}
                  onChange={(e) => setMult(e.target.value)}
                  className={inputClass}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium">Menu dasar</label>
                  <select
                    required
                    value={baseMenuId}
                    onChange={(e) => setBaseMenuId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">— pilih —</option>
                    {(menus ?? [])
                      .filter((m) => m.tipe === "regular" && m.id !== id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nama}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Markup menu dasar (base_mult)</label>
                  <input
                    required
                    type="text"
                    inputMode="decimal"
                    value={baseMult}
                    onChange={(e) => setBaseMult(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">Harga jual (Rp)</label>
              <div className="flex gap-2">
                <input
                  required
                  /* Harga jual: angka paling menentukan di aplikasi ini.
                     `type="number"` menyimpan "15.000" sebagai 15. */
                  type="text"
                  inputMode="numeric"
                  value={hargaJual ? formatAngka(angkaDari(hargaJual), 0) : ""}
                  onChange={(e) => setHargaJual(e.target.value.replace(/\D/g, ""))}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setHargaJual(teksAngka(preview.bulat))}
                  className={btnSecondary}
                  title="Pakai harga saran bulat"
                >
                  Pakai saran
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Target waktu penyajian (menit)
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="kosongkan bila tak ditargetkan"
                value={targetMenit}
                onChange={(e) => setTargetMenit(e.target.value.replace(/\D/g, ""))}
                className={inputClass}
              />
              <div className="mt-1 text-xs text-stone-500">
                Dipakai Laporan Durasi Pesanan untuk menandai menu yang biasanya lewat.
                Kosongkan bila menu ini tak perlu dinilai.
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Foto menu</label>
              <ImageUpload value={imageUrl} onChange={setImageUrl} tujuan="menu" placeholder="🍜" />
            </div>
          </div>
        </Card>

        {/* Pembatasan lokasi hanya relevan di mode Pro (multi-lokasi).
            Kantor bukan lokasi penjualan → tidak ditawarkan. */}
        {isPro && cabang.some((b) => b.is_active && b.tipe === "store") && (
          <Card className="space-y-3 p-4">
            <div className="text-sm font-semibold text-stone-700">📍 Tampil di lokasi</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={branchIds.length === 0}
                onChange={(e) => {
                  if (e.target.checked) setBranchIds([]);
                  else
                    setBranchIds(
                      cabang.filter((b) => b.is_active && b.tipe === "store").map((b) => b.id),
                    );
                }}
              />
              <span className="font-medium">Semua lokasi</span>
              <span className="text-xs text-stone-400">(default)</span>
            </label>
            {branchIds.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
                {cabang
                  .filter((b) => b.is_active && b.tipe === "store")
                  .map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={branchIds.includes(b.id)}
                        onChange={(e) =>
                          setBranchIds(
                            e.target.checked
                              ? [...branchIds, b.id]
                              : branchIds.filter((x) => x !== b.id),
                          )
                        }
                      />
                      {labelCabang(b)}
                    </label>
                  ))}
              </div>
            )}
            <p className="text-xs text-stone-500">
              Menu yang dibatasi hanya muncul &amp; bisa terjual di lokasi terpilih — kasir
              lokasi lain tidak melihatnya.
            </p>
          </Card>
        )}

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-stone-700">
              {tipe === "paket" ? "Topping paket" : "Komponen resep"} ({komponen.length})
            </h2>
            <button
              type="button"
              onClick={() => setKomponen([...komponen, { ingredient_id: "", qty: "1" }])}
              className={btnSecondary}
            >
              + Tambah bahan
            </button>
          </div>
          <div className="space-y-3">
            {komponen.map((k, i) => {
              const b = k.ingredient_id ? bahanById.get(k.ingredient_id) : undefined;
              const hargaKomponen = b ? b.harga_per_unit * angkaDari(k.qty || 0) : 0;
              return (
                <div key={i} className="rounded-lg border border-stone-200 p-3">
                  <div className="flex items-center gap-2">
                    <BahanPicker
                      bahan={bahan}
                      value={k.ingredient_id}
                      onChange={(id) => {
                        const copy = [...komponen];
                        copy[i] = { ...copy[i], ingredient_id: id };
                        setKomponen(copy);
                      }}
                      placeholder="— pilih bahan —"
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setKomponen(komponen.filter((_, j) => j !== i))}
                      className="text-red-500 hover:text-red-700"
                      aria-label="Hapus komponen"
                    >
                      ✕
                    </button>
                  </div>
                  {b && (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Takaran resep ({b.satuan})
                          </label>
                          <input
                            /* Takaran resep hampir selalu pecahan ("0,5" kg).
                               Lihat catatan pada Markup di atas. */
                            type="text"
                            inputMode="decimal"
                            value={k.qty}
                            onChange={(e) => {
                              const copy = [...komponen];
                              copy[i] = { ...copy[i], qty: e.target.value };
                              setKomponen(copy);
                            }}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Satuan resep
                          </label>
                          <input
                            value={b.satuan}
                            readOnly
                            tabIndex={-1}
                            className={`${inputClass} bg-stone-50 text-stone-500`}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Harga per {b.satuan}
                          </label>
                          <input
                            value={`Rp ${formatAngka(b.harga_per_unit, 2)}`}
                            readOnly
                            tabIndex={-1}
                            className={`${inputClass} bg-stone-50 text-stone-500`}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-500">
                            Harga komponen
                          </label>
                          <input
                            value={formatRupiah(hargaKomponen)}
                            readOnly
                            tabIndex={-1}
                            className={`${inputClass} bg-orange-50 font-semibold text-orange-700`}
                          />
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-stone-500">
                        Satuan &amp; harga mengikuti <b>aturan resep</b> bahan — ubah dari
                        halaman{" "}
                        <Link to="/bahan" className="font-medium text-orange-600 hover:underline">
                          Bahan Baku
                        </Link>
                        .
                      </p>
                    </>
                  )}
                </div>
              );
            })}
            {komponen.length === 0 && (
              <div className="py-4 text-center text-sm text-stone-400">
                Belum ada komponen. HPP = 0.
              </div>
            )}
          </div>
          {perluKemasan && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              🥡 <b>Semua menu bisa dijual bawa pulang.</b> Menu ini belum punya bahan{" "}
              <b>Kemasan TA</b>, jadi HPP bawa pulang sama dengan HPP dine-in — biaya dus/box
              tidak pernah masuk laba-rugi dan stok kemasan tidak berkurang saat pesanan
              dibawa pulang. Tandai bahan kemasannya dengan centang <b>🥡 Kemasan TA</b> di{" "}
              <Link to="/bahan" className="font-medium text-orange-600 hover:underline">
                Bahan Baku
              </Link>
              , lalu tambahkan ke resep menu ini.
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 font-semibold text-stone-700">Preview harga (live)</h2>
          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-5">
            <div>
              {/* `preview.hpp` memakai `hitungHpp(k)` dengan dineIn=false — itu
                  memang HPP bawa pulang (kemasan penuh). Label lamanya cuma
                  "HPP" dan menyembunyikan fakta itu tepat di layar tempat
                  kemasan take away semestinya diputuskan. */}
              <div className="text-stone-500">HPP bawa pulang</div>
              <div className="text-lg font-bold">{formatRupiah(preview.hpp)}</div>
            </div>
            <div>
              <div className="text-stone-500">HPP dine-in</div>
              <div className="text-lg font-bold">{formatRupiah(preview.hppDineIn)}</div>
            </div>
            <div>
              <div className="text-stone-500">Harga saran</div>
              <div className="text-lg font-bold">{formatRupiah(preview.saran)}</div>
            </div>
            <div>
              <div className="text-stone-500">Saran bulat</div>
              <div className="text-lg font-bold text-orange-600">
                {formatRupiah(preview.bulat)}
              </div>
            </div>
            <div>
              <div className="text-stone-500">Food cost</div>
              <div className="text-lg font-bold">
                {angkaDari(hargaJual) > 0
                  ? `${foodCostPersen(preview.hpp, angkaDari(hargaJual)).toFixed(1)}%`
                  : "—"}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Selisih <b>bawa pulang</b> vs <b>dine-in</b> = bahan bertanda 🥡 Kemasan TA (dihitung
            penuh saat bawa pulang, dilewati saat makan di tempat) + separuh takaran bahan
            pelengkap. Selisih Rp 0 berarti menu ini belum punya kemasan take away.
          </p>
          <details className="mt-3 text-sm text-stone-500">
            <summary className="cursor-pointer font-medium">Panduan markup per kategori</summary>
            <table className="mt-2 w-full max-w-lg">
              <tbody>
                {PANDUAN_MARKUP.map((p) => (
                  <tr key={p.kategori} className="border-b border-stone-100">
                    <td className="py-1 pr-4">{p.kategori}</td>
                    <td className="py-1 pr-4">{p.persen}%</td>
                    <td className="py-1 text-stone-400">{p.keterangan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>

        {qtyTerbuang.length > 0 && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            Takaran pada <b>{qtyTerbuang.join(", ")}</b> belum terbaca sebagai angka lebih dari
            0 — tulis seperti <b>0,25</b> atau <b>100</b>. Tanpa itu bahannya tidak ikut masuk
            resep, jadi HPP-nya kurang hitung dan stoknya tak pernah terpotong saat menu ini
            terjual.
          </div>
        )}
        <ErrorText error={simpan.error} />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={simpan.isPending || qtyTerbuang.length > 0}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "Simpan Menu"}
          </button>
          <Link to="/menu" className={btnSecondary}>
            Batal
          </Link>
        </div>
      </form>

      {/*
        Konfirmasi, bukan larangan: ada menu yang memang tak pernah dibawa
        pulang. Yang tak boleh terjadi adalah menyimpan menu tanpa kemasan
        TANPA SADAR — akibatnya baru muncul berbulan-bulan kemudian sebagai
        laba yang terlihat lebih besar dari kenyataan.
      */}
      <Modal
        open={tanyaKemasan}
        onClose={() => setTanyaKemasan(false)}
        title="Menu ini belum punya kemasan take away"
      >
        <div className="space-y-4 text-sm text-stone-700">
          <p>
            <b>Semua menu bisa dijual bawa pulang.</b> Resep menu{" "}
            <b>{nama || "ini"}</b> belum memuat bahan bertanda <b>🥡 Kemasan TA</b>.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-stone-600">
            <li>
              HPP bawa pulang = HPP dine-in ({formatRupiah(preview.hpp)}) — biaya dus/box
              tidak pernah masuk laba-rugi.
            </li>
            <li>Stok kemasan tidak berkurang saat pesanan ini dibawa pulang.</li>
          </ul>
          <p className="text-stone-500">
            Tandai bahan kemasannya dengan centang <b>🥡 Kemasan TA</b> di halaman Bahan Baku,
            lalu tambahkan ke resep menu ini.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTanyaKemasan(false)}
              className={btnPrimary}
              autoFocus
            >
              Tambah kemasan dulu
            </button>
            <button
              type="button"
              onClick={() => {
                setTanyaKemasan(false);
                simpan.mutate();
              }}
              disabled={simpan.isPending}
              className={btnSecondary}
            >
              Simpan tanpa kemasan
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
