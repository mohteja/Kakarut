import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { BahanDto, BahanKategori, BahanResepRow, SatuanDto } from "@kakarut/shared";
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
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

/** Baris editor resep (bahan mentah per 1 batch bahan jadi). */
interface ResepDraft {
  ingredient_id: string;
  qty: string;
}

/** Form buat bahan jadi (produksi) baru dari halaman Resep. */
interface BahanBaruForm {
  kode: string;
  nama: string;
  harga_beli: string;
  isi: string;
  satuan: string;
  kategori: BahanKategori;
  stok_minimum: string;
}

/**
 * Halaman Resep produksi (BOM): master-detail. Kiri = daftar bahan jenis
 * "produksi"; kanan = editor resep bahan terpilih (bahan mentah per 1 batch).
 * Dipisah dari form Bahan Baku agar keduanya tak bercampur. Owner/admin bisa
 * mengubah; peran tim hanya melihat. Dipakai ulang endpoint /bahan/:id/resep.
 */
export function ResepPage() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";

  const { data: bahan, isLoading } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  const semua = bahan ?? [];
  const produksi = semua.filter((b) => b.pengadaan === "produksi");

  const [cari, setCari] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dipilih = produksi.find((b) => b.id === selectedId) ?? null;

  // Ringkasan jumlah bahan mentah per bahan produksi (utk badge di daftar).
  // Satu query batch (Promise.all) — jumlah bahan produksi biasanya sedikit.
  const producedIds = produksi.map((b) => b.id).sort();
  const { data: ringkas } = useQuery({
    queryKey: ["resep-ringkas", producedIds],
    enabled: producedIds.length > 0,
    queryFn: async () => {
      const pasang = await Promise.all(
        producedIds.map(async (id) => {
          try {
            const rows = await api<BahanResepRow[]>(`/bahan/${id}/resep`);
            return [id, rows.length] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      return Object.fromEntries(pasang) as Record<string, number | null>;
    },
  });

  // Muat resep bahan terpilih. react-query membuang respons basi saat ganti
  // bahan cepat (key berubah → tak menimpa panel bahan lain).
  const {
    data: resepServer,
    isLoading: resepLoading,
    isError: resepGagal,
  } = useQuery({
    queryKey: ["bahan-resep", selectedId],
    enabled: !!selectedId,
    queryFn: () => api<BahanResepRow[]>(`/bahan/${selectedId}/resep`),
  });

  // Draft editor lokal, di-seed dari resep server tiap kali data/bahan berubah.
  const [resep, setResep] = useState<ResepDraft[]>([]);
  useEffect(() => {
    if (resepServer) {
      setResep(
        resepServer.map((r) => ({ ingredient_id: r.ingredient_id, qty: String(r.qty) })),
      );
    } else {
      setResep([]);
    }
  }, [resepServer, selectedId]);

  const simpan = useMutation({
    mutationFn: () =>
      api(`/bahan/${selectedId}/resep`, {
        method: "PUT",
        body: {
          komponen: resep
            .filter((r) => r.ingredient_id && Number(r.qty) > 0)
            .map((r) => ({ ingredient_id: r.ingredient_id, qty: Number(r.qty) })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP bisa berubah
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  // Master satuan (dropdown form buat bahan produksi)
  const { data: satuanList } = useQuery({
    queryKey: ["satuan"],
    queryFn: () => api<SatuanDto[]>("/satuan"),
  });
  // Buat bahan produksi baru langsung dari halaman Resep (produksi terpisah
  // dari Bahan Baku beli). Setelah dibuat → langsung terpilih untuk atur resep.
  const [formBaru, setFormBaru] = useState<BahanBaruForm | null>(null);
  const buatBahan = useMutation({
    mutationFn: (f: BahanBaruForm) =>
      api<BahanDto>("/bahan", {
        method: "POST",
        body: {
          kode: f.kode.trim() || null,
          nama: f.nama.trim(),
          harga_beli: Number(f.harga_beli) || 0,
          isi: Number(f.isi),
          satuan: f.satuan.trim() || "pcs",
          kategori: f.kategori,
          pengadaan: "produksi",
          track_stok: true,
          stok_minimum: Number(f.stok_minimum) || 0,
        },
      }),
    onSuccess: (b) => {
      setFormBaru(null);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["resep-ringkas"] });
      setSelectedId(b.id);
    },
  });

  if (isLoading) return <Spinner />;

  const daftar = produksi
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()))
    .sort((a, b) => a.nama.localeCompare(b.nama));

  const estimasi = resep.reduce((a, r) => {
    const x = semua.find((b) => b.id === r.ingredient_id);
    return a + (x ? (Number(r.qty) || 0) * x.harga_per_unit : 0);
  }, 0);

  const satuanDefault = satuanList?.some((s) => s.nama === "pcs")
    ? "pcs"
    : satuanList?.[0]?.nama ?? "pcs";
  const bukaFormBaru = () =>
    setFormBaru({
      kode: "",
      nama: "",
      harga_beli: "",
      isi: "1",
      satuan: satuanDefault,
      kategori: "baso",
      stok_minimum: "0",
    });

  return (
    <div>
      <PageTitle
        aksi={
          bolehUbah ? (
            <button onClick={bukaFormBaru} className={btnPrimary}>
              + Bahan produksi
            </button>
          ) : undefined
        }
      >
        🧾 Resep Produksi
      </PageTitle>
      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Atur bahan mentah yang dibutuhkan untuk memproduksi <b>1 batch</b> tiap bahan jenis
        produksi. Dipakai untuk <b>rencana belanja bahan produksi</b> dan <b>pemotongan stok
        bahan mentah otomatis</b> saat produksi selesai.
      </div>

      {produksi.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada bahan produksi.{" "}
          {bolehUbah ? (
            <button onClick={bukaFormBaru} className="font-medium text-orange-600 hover:underline">
              + Buat bahan produksi
            </button>
          ) : (
            <Link to="/bahan" className="font-medium text-orange-600 hover:underline">
              Bahan Baku
            </Link>
          )}{" "}
          untuk membuat bahan yang diproduksi sendiri lalu mengatur resepnya.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          {/* Kiri: daftar bahan produksi */}
          <Card className="p-3">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari bahan produksi…"
              className={`${inputClass} mb-2`}
            />
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {daftar.map((b) => {
                const n = ringkas?.[b.id];
                const aktif = b.id === selectedId;
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`block w-full rounded-lg px-3 py-2 text-left transition ${
                      aktif ? "bg-orange-600 text-white" : "hover:bg-stone-100"
                    }`}
                  >
                    <div className="text-sm font-semibold">{b.nama}</div>
                    <div className={`text-xs ${aktif ? "text-orange-100" : "text-stone-500"}`}>
                      batch {formatAngka(b.isi)} {b.satuan} ·{" "}
                      {n == null ? "—" : n > 0 ? `${n} bahan mentah` : "belum ada resep"}
                    </div>
                  </button>
                );
              })}
              {daftar.length === 0 && (
                <div className="py-6 text-center text-sm text-stone-400">
                  Tidak ada yang cocok.
                </div>
              )}
            </div>
          </Card>

          {/* Kanan: editor resep bahan terpilih */}
          <Card className="p-4">
            {!dipilih ? (
              <div className="py-16 text-center text-sm text-stone-400">
                Pilih bahan produksi di kiri untuk mengatur resepnya.
              </div>
            ) : (
              <div>
                <div className="mb-1 text-lg font-bold text-stone-800">{dipilih.nama}</div>
                <div className="mb-4 text-sm text-stone-500">
                  Resep per 1 batch = {formatAngka(dipilih.isi)} {dipilih.satuan}
                </div>

                {resepLoading ? (
                  <Spinner />
                ) : resepGagal ? (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Resep gagal dimuat.{" "}
                    <button
                      onClick={() =>
                        queryClient.invalidateQueries({ queryKey: ["bahan-resep", selectedId] })
                      }
                      className="font-semibold underline"
                    >
                      Muat ulang
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {resep.map((r, i) => {
                        // nilai terpilih selalu punya option (walau bahan
                        // berubah jenis/nonaktif), sisanya beli+aktif+belum dipakai
                        const pilihan = semua.filter(
                          (x) =>
                            x.id === r.ingredient_id ||
                            (x.pengadaan === "beli" &&
                              x.is_active &&
                              x.id !== dipilih.id &&
                              !resep.some((lain, j) => j !== i && lain.ingredient_id === x.id)),
                        );
                        const terpilih = semua.find((x) => x.id === r.ingredient_id);
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <select
                              value={r.ingredient_id}
                              onChange={(e) => {
                                const salinan = [...resep];
                                salinan[i] = { ...salinan[i], ingredient_id: e.target.value };
                                setResep(salinan);
                              }}
                              className={`${inputClass} flex-1`}
                              disabled={!bolehUbah}
                              required
                            >
                              <option value="">— pilih bahan mentah —</option>
                              {r.ingredient_id &&
                                !semua.some((x) => x.id === r.ingredient_id) && (
                                  <option value={r.ingredient_id}>(bahan nonaktif)</option>
                                )}
                              {pilihan.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.nama}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0.0001"
                              step="any"
                              value={r.qty}
                              onChange={(e) => {
                                const salinan = [...resep];
                                salinan[i] = { ...salinan[i], qty: e.target.value };
                                setResep(salinan);
                              }}
                              placeholder="qty"
                              className="w-24 shrink-0 rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-orange-500 focus:outline-none"
                              disabled={!bolehUbah}
                              required
                            />
                            <span className="w-12 shrink-0 text-xs text-stone-500">
                              {terpilih?.satuan ?? ""}
                            </span>
                            {bolehUbah && (
                              <button
                                type="button"
                                onClick={() => setResep(resep.filter((_, j) => j !== i))}
                                className="shrink-0 text-sm font-medium text-red-500 hover:underline"
                                aria-label="Hapus baris resep"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {resep.length === 0 && (
                        <div className="rounded-lg bg-stone-50 py-6 text-center text-sm text-stone-400">
                          Belum ada bahan mentah pada resep ini.
                        </div>
                      )}
                    </div>

                    {bolehUbah && (
                      <button
                        type="button"
                        onClick={() => setResep([...resep, { ingredient_id: "", qty: "" }])}
                        className="mt-2 text-sm font-medium text-orange-600 hover:underline"
                      >
                        + Tambah bahan mentah
                      </button>
                    )}

                    {resep.some((r) => r.ingredient_id && Number(r.qty) > 0) && (
                      <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
                        Estimasi biaya bahan per batch: <b>{formatRupiah(estimasi)}</b> —
                        bandingkan dengan harga beli batch{" "}
                        <b>{formatRupiah(dipilih.harga_beli)}</b>.
                      </div>
                    )}

                    {bolehUbah && (
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          onClick={() => simpan.mutate()}
                          disabled={simpan.isPending}
                          className={btnPrimary}
                        >
                          Simpan Resep
                        </button>
                        {simpan.isSuccess && !simpan.isPending && (
                          <span className="text-sm font-medium text-green-600">✓ Tersimpan</span>
                        )}
                      </div>
                    )}
                    <ErrorText error={simpan.error} />
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={formBaru !== null}
        onClose={() => setFormBaru(null)}
        title="Bahan produksi baru"
      >
        {formBaru && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              buatBahan.mutate(formBaru);
            }}
            className="space-y-3"
          >
            <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-stone-600">
              Bahan yang <b>diproduksi sendiri</b> (mis. baso). Setelah dibuat, atur resep bahan
              mentahnya di panel kanan.
            </p>
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Kode</label>
                <input
                  value={formBaru.kode}
                  onChange={(e) => setFormBaru({ ...formBaru, kode: e.target.value })}
                  className={inputClass}
                  placeholder="otomatis"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Nama</label>
                <input
                  required
                  autoFocus
                  value={formBaru.nama}
                  onChange={(e) => setFormBaru({ ...formBaru, nama: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Harga/batch (Rp)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formBaru.harga_beli}
                  onChange={(e) => setFormBaru({ ...formBaru, harga_beli: e.target.value })}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Isi/batch</label>
                <input
                  required
                  type="number"
                  min="0.0001"
                  step="any"
                  value={formBaru.isi}
                  onChange={(e) => setFormBaru({ ...formBaru, isi: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Satuan</label>
                <select
                  value={formBaru.satuan}
                  onChange={(e) => setFormBaru({ ...formBaru, satuan: e.target.value })}
                  className={inputClass}
                >
                  {!satuanList?.some((s) => s.nama === formBaru.satuan) && formBaru.satuan && (
                    <option value={formBaru.satuan}>{formBaru.satuan}</option>
                  )}
                  {(satuanList ?? []).map((s) => (
                    <option key={s.id} value={s.nama}>
                      {s.nama}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Kategori</label>
                <select
                  value={formBaru.kategori}
                  onChange={(e) =>
                    setFormBaru({ ...formBaru, kategori: e.target.value as BahanKategori })
                  }
                  className={inputClass}
                >
                  <option value="baso">baso</option>
                  <option value="minuman">minuman</option>
                  <option value="lain">lain</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Stok minimum</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formBaru.stok_minimum}
                  onChange={(e) => setFormBaru({ ...formBaru, stok_minimum: e.target.value })}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
            </div>
            <ErrorText error={buatBahan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setFormBaru(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={buatBahan.isPending} className={btnPrimary}>
                Simpan &amp; atur resep
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
