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
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah } from "../../lib/format";

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

  const [nama, setNama] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tipe, setTipe] = useState<"regular" | "paket">("regular");
  const [mult, setMult] = useState("2");
  const [baseMenuId, setBaseMenuId] = useState("");
  const [baseMult, setBaseMult] = useState("2");
  const [hargaJual, setHargaJual] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [komponen, setKomponen] = useState<KomponenForm[]>([]);
  const dimuat = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);

  // muat data saat edit
  useEffect(() => {
    if (!id || dimuat.current || !menus) return;
    const m = menus.find((x) => x.id === id);
    if (!m) return;
    dimuat.current = true;
    setNama(m.nama);
    setCategoryId(m.category_id);
    setTipe(m.tipe);
    setMult(String(m.mult ?? 2));
    setBaseMenuId(m.base_menu_id ?? "");
    setBaseMult(String(m.base_mult ?? 2));
    setHargaJual(String(m.harga_jual));
    setImageUrl(m.image_url);
    setKomponen(
      m.komponen.map((k) => ({ ingredient_id: k.ingredient_id, qty: String(k.qty) })),
    );
  }, [id, menus]);

  const bahanById = useMemo(() => new Map((bahan ?? []).map((b) => [b.id, b])), [bahan]);

  // Preview HPP live (rumus sama dengan server, dari @kakarut/shared)
  const preview = useMemo(() => {
    const komponenHpp = komponen
      .filter((k) => k.ingredient_id && Number(k.qty) > 0)
      .map((k) => {
        const b = bahanById.get(k.ingredient_id)!;
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
    mutationFn: () => {
      const body = {
        nama,
        category_id: categoryId,
        tipe,
        mult: tipe === "regular" ? Number(mult) : null,
        base_menu_id: tipe === "paket" ? baseMenuId : null,
        base_mult: tipe === "paket" ? Number(baseMult) : null,
        harga_jual: Number(hargaJual),
        image_url: imageUrl,
        komponen: komponen
          .filter((k) => k.ingredient_id && Number(k.qty) > 0)
          .map((k) => ({ ingredient_id: k.ingredient_id, qty: Number(k.qty) })),
      };
      return id
        ? api(`/menu/${id}`, { method: "PUT", body })
        : api("/menu", { method: "POST", body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu"] });
      navigate("/menu");
    },
  });

  async function uploadGambar(file: File) {
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await api<{ url: string }>("/upload?tujuan=menu", {
        method: "POST",
        formData: fd,
      });
      setImageUrl(url);
    } catch (e) {
      setUploadError(e);
    }
  }

  if (!bahan || !kategori || (id && !menus)) return <Spinner />;

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
              <div className="flex items-center gap-3">
                {imageUrl && (
                  <img src={imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadGambar(f);
                  }}
                  className="text-sm"
                />
              </div>
              <ErrorText error={uploadError} />
            </div>
          </div>
        </Card>

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
          <div className="space-y-2">
            {komponen.map((k, i) => {
              const b = k.ingredient_id ? bahanById.get(k.ingredient_id) : undefined;
              return (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={k.ingredient_id}
                    onChange={(e) => {
                      const copy = [...komponen];
                      copy[i] = { ...copy[i], ingredient_id: e.target.value };
                      setKomponen(copy);
                    }}
                    className={`${inputClass} flex-1`}
                  >
                    <option value="">— pilih bahan —</option>
                    {bahan.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nama} ({formatRupiah(x.harga_per_unit)}/unit)
                      </option>
                    ))}
                  </select>
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
                    className="w-24 rounded-lg border border-stone-300 px-2 py-2 text-right text-sm"
                  />
                  <div className="w-24 text-right text-sm text-stone-500">
                    {b ? formatRupiah(b.harga_per_unit * Number(k.qty || 0)) : "—"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setKomponen(komponen.filter((_, j) => j !== i))}
                    className="text-red-500 hover:text-red-700"
                    aria-label="Hapus komponen"
                  >
                    ✕
                  </button>
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
