import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  PANDUAN_MARKUP,
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
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
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
  const [categoryId, setCategoryId] = useState("");
  const [tipe, setTipe] = useState<"regular" | "paket">("regular");
  const [mult, setMult] = useState("2");
  const [baseMenuId, setBaseMenuId] = useState("");
  const [baseMult, setBaseMult] = useState("2");
  const [hargaJual, setHargaJual] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [komponen, setKomponen] = useState<KomponenForm[]>([]);
  /** pembatasan lokasi (mode Pro) — [] = tampil di semua lokasi */
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const dimuat = useRef(false);

  // muat data saat edit
  useEffect(() => {
    if (!id || dimuat.current || !menuEdit) return;
    const m = menuEdit;
    dimuat.current = true;
    setNama(m.nama);
    setKode(m.kode ?? "");
    setCategoryId(m.category_id);
    setTipe(m.tipe);
    setMult(String(m.mult ?? 2));
    setBaseMenuId(m.base_menu_id ?? "");
    setBaseMult(String(m.base_mult ?? 2));
    setHargaJual(String(m.harga_jual));
    setImageUrl(m.image_url);
    setIsActive(m.is_active);
    setKomponen(
      m.komponen.map((k) => ({ ingredient_id: k.ingredient_id, qty: String(k.qty) })),
    );
    setBranchIds(m.branch_ids ?? []);
  }, [id, menuEdit]);

  const bahanById = useMemo(() => new Map((bahan ?? []).map((b) => [b.id, b])), [bahan]);

  // Preview HPP live (rumus sama dengan server, dari @kakarut/shared).
  // Harga per satuan resep (harga_per_unit) diambil apa adanya dari master
  // bahan — aturan resep diubah di halaman Bahan Baku, bukan dari sini.
  const preview = useMemo(() => {
    const komponenHpp = komponen
      .filter((k) => k.ingredient_id && Number(k.qty) > 0)
      .map((k) => {
        const b = bahanById.get(k.ingredient_id);
        return {
          qty: Number(k.qty),
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
      const saran = hargaSaranPaket(baseHpp, Number(baseMult) || 0, ownHpp);
      return {
        hpp: baseHpp + ownHpp,
        hppDineIn: (base?.hpp_dine_in ?? 0) + ownHppDineIn,
        saran,
        bulat: hargaJualBulat(saran),
      };
    }
    const saran = hargaSaran(ownHpp, Number(mult) || 0);
    return { hpp: ownHpp, hppDineIn: ownHppDineIn, saran, bulat: hargaJualBulat(saran) };
  }, [komponen, bahanById, tipe, mult, baseMenuId, baseMult, menus]);

  const simpan = useMutation({
    mutationFn: async () => {
      const body = {
        nama,
        kode: kode.trim() || null,
        category_id: categoryId,
        tipe,
        mult: tipe === "regular" ? Number(mult) : null,
        base_menu_id: tipe === "paket" ? baseMenuId : null,
        base_mult: tipe === "paket" ? Number(baseMult) : null,
        harga_jual: Number(hargaJual),
        image_url: imageUrl,
        is_active: isActive,
        komponen: komponen
          .filter((k) => k.ingredient_id && Number(k.qty) > 0)
          .map((k) => ({ ingredient_id: k.ingredient_id, qty: Number(k.qty) })),
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
                  type="number"
                  min="0"
                  step="any"
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
                    type="number"
                    min="0"
                    step="any"
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
                  type="number"
                  min="0"
                  value={hargaJual}
                  onChange={(e) => setHargaJual(e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setHargaJual(String(preview.bulat))}
                  className={btnSecondary}
                  title="Pakai harga saran bulat"
                >
                  Pakai saran
                </button>
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
              const hargaKomponen = b ? b.harga_per_unit * Number(k.qty || 0) : 0;
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
                            type="number"
                            min="0.0001"
                            step="any"
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
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 font-semibold text-stone-700">Preview harga (live)</h2>
          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-5">
            <div>
              <div className="text-stone-500">HPP</div>
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
                {Number(hargaJual) > 0
                  ? `${foodCostPersen(preview.hpp, Number(hargaJual)).toFixed(1)}%`
                  : "—"}
              </div>
            </div>
          </div>
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

        <ErrorText error={simpan.error} />
        <div className="flex gap-2">
          <button type="submit" disabled={simpan.isPending} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan Menu"}
          </button>
          <Link to="/menu" className={btnSecondary}>
            Batal
          </Link>
        </div>
      </form>
    </div>
  );
}
