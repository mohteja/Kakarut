import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { angkaDari } from "@kakarut/shared";
import { useState } from "react";
import type {
  KategoriDto,
  PerlengkapanAturanDto,
  PerlengkapanAturanMetode,
  PerlengkapanMasterRow,
} from "@kakarut/shared";
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
import { TabelResponsif } from "../../components/TabelResponsif";
import { RiwayatHargaModal } from "../../components/RiwayatHargaModal";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
import { SupplierBahanModal } from "../bahan/SupplierBahanModal";

/** Label aturan konsumsi: "⏱ 1 / hari", "✋ manual (stock opname)", "(nonaktif)". */
function labelAturan(a: PerlengkapanAturanDto, satuan: string): string {
  if (a.metode === "manual") return "✋ manual (stock opname)";
  const per = a.per_hari === 1 ? "hari" : `${a.per_hari} hari`;
  const teks = `⏱ ${formatAngka(a.qty)} ${satuan} / ${per}`;
  return a.aktif ? teks : `${teks} (nonaktif)`;
}

type ModalState =
  | { jenis: "item"; item: PerlengkapanMasterRow | null }
  | { jenis: "aturan"; item: PerlengkapanMasterRow }
  | { jenis: "supplier"; item: PerlengkapanMasterRow }
  | null;

/**
 * MASTER perlengkapan non bahan baku (sendok, spons, sabun) — seperti halaman
 * Bahan Baku: pengaturan nama, kategori (master kategori yang sama dgn bahan),
 * supplier, harga, ecer/utuh, dilacak (wajib aturan konsumsi), dan rak simpan.
 * TANPA pemilih cabang: semua item tampil; tiap produk menunjukkan "ada di
 * cabang mana saja". Stok fisiknya dikelola di Stok → tab Perlengkapan.
 */
export function PerlengkapanPage() {
  const queryClient = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["perlengkapan-master"],
    queryFn: () => api<PerlengkapanMasterRow[]>("/perlengkapan/master"),
  });
  // kategori memakai MASTER yang sama dengan bahan baku
  const { data: kategoriList = [] } = useQuery({
    queryKey: ["kategori-bahan"],
    queryFn: () => api<KategoriDto[]>("/kategori-bahan"),
  });

  const [modal, setModal] = useState<ModalState>(null);
  const [riwayat, setRiwayat] = useState<PerlengkapanMasterRow | null>(null);
  const [cari, setCari] = useState("");

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-master"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
  };

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/perlengkapan/${id}`, { method: "DELETE" }),
    onSuccess: segarkan,
  });

  const tampil = (rows ?? []).filter((r) =>
    r.nama.toLowerCase().includes(cari.toLowerCase()),
  );

  return (
    <div className="max-w-6xl">
      <PageTitle
        aksi={
          <button onClick={() => setModal({ jenis: "item", item: null })} className={btnPrimary}>
            ➕ Tambah Perlengkapan
          </button>
        }
      >
        🧰 Perlengkapan
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Master barang <b>non bahan baku</b> (sendok, spons, sabun…) berlaku se-perusahaan —
        pengaturan <b>nama, kategori, supplier, harga, ecer/utuh, dilacak, dan rak simpan</b>.
        Item <b>dilacak</b> wajib punya <b>aturan konsumsi</b>. Saldo stok dilihat di halaman{" "}
        <b>Stok → tab Perlengkapan</b>.
      </div>
      <ErrorText error={hapus.error} />

      <div className="mb-3">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari perlengkapan…"
          className={`${inputClass} max-w-xs`}
        />
      </div>

      {isLoading ? (
        <Spinner />
      ) : tampil.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {cari
            ? "Tidak ada perlengkapan yang cocok."
            : "Belum ada perlengkapan. Tambahkan lewat “➕ Tambah Perlengkapan”."}
        </Card>
      ) : (
        <TabelResponsif
          data={tampil}
          kunci={(r) => r.id}
          kosong="Belum ada perlengkapan."
          kolom={[
            {
              judul: "Perlengkapan",
              hp: "judul",
              kelasSel: "font-medium",
              sel: (r) => (
                <>
                  <button
                    onClick={() => setRiwayat(r)}
                    title={`Riwayat harga & catat harga "${r.nama}"`}
                    className="text-left font-medium text-stone-800 hover:text-orange-600 hover:underline"
                  >
                    {r.nama}
                  </button>{" "}
                  <span className="text-xs font-normal text-stone-400">({r.satuan})</span>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-xs font-normal">
                    <span
                      className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600"
                      title={
                        r.boleh_eceran
                          ? "Boleh dibeli/dikirim eceran (per satuan)"
                          : "Harus utuh per kemasan — tidak dijual eceran"
                      }
                    >
                      {r.boleh_eceran ? "🧩 boleh ecer" : "📦 utuh kemasan"}
                    </span>
                    {r.dilacak && (
                      <span
                        className="rounded bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800"
                        title="Konsumsi item ini dipantau — wajib punya aturan konsumsi"
                      >
                        🎯 dilacak
                      </span>
                    )}
                    {r.rak_lokasi.map((rl) => (
                      <span
                        key={rl.rak_id}
                        className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600"
                        title={`Disimpan di ${rl.branch_nama} — atur di Tempat Penyimpanan`}
                      >
                        🗄 {rl.branch_nama} · {rl.rak_nama}
                      </span>
                    ))}
                    {r.catatan && <span className="text-stone-400">{r.catatan}</span>}
                  </div>
                </>
              ),
            },
            {
              judul: "Kategori",
              kelasSel: "text-stone-600",
              sel: (r) => r.kategori ?? <span className="text-stone-400">—</span>,
            },
            {
              judul: "Supplier",
              sel: (r) => (
                <button
                  onClick={() => setModal({ jenis: "supplier", item: r })}
                  title={`Atur supplier "${r.nama}" — beli di mana & supplier utama`}
                  className={`rounded-lg px-2 py-1 text-xs font-medium ${
                    r.supplier_utama
                      ? "text-stone-700 hover:bg-stone-100"
                      : "border border-dashed border-stone-300 text-stone-400 hover:bg-stone-50"
                  }`}
                >
                  {r.supplier_utama ? (
                    <>
                      ★ {r.supplier_utama}
                      {r.jumlah_supplier > 1 && ` +${r.jumlah_supplier - 1}`}
                    </>
                  ) : (
                    "+ Atur supplier"
                  )}
                </button>
              ),
            },
            {
              judul: "Harga Beli",
              kanan: true,
              sel: (r) => (r.harga_beli > 0 ? formatRupiah(r.harga_beli) : "—"),
            },
            {
              judul: "Stok Min",
              kanan: true,
              kelasSel: "text-stone-500",
              sel: (r) => (r.stok_minimum > 0 ? formatAngka(r.stok_minimum) : "—"),
            },
            {
              judul: "Ada di",
              sel: (r) =>
                r.lokasi.length === 0 ? (
                  <span className="text-xs text-stone-400">belum ada di cabang mana pun</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {r.lokasi.map((l) => (
                      <span
                        key={l.branch_id}
                        className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700"
                      >
                        🏪 {l.branch_nama}
                      </span>
                    ))}
                  </div>
                ),
            },
            {
              judul: "Aturan Konsumsi",
              sel: (r) =>
                r.lokasi.some((l) => l.aturan) ? (
                  <div className="space-y-0.5 text-xs text-stone-600">
                    {r.lokasi
                      .filter((l) => l.aturan)
                      .map((l) => (
                        <div key={l.branch_id} className="whitespace-nowrap">
                          <span className="text-stone-400">{l.branch_nama}:</span>{" "}
                          {labelAturan(l.aturan!, r.satuan)}
                        </div>
                      ))}
                  </div>
                ) : r.dilacak ? (
                  <button
                    onClick={() => setModal({ jenis: "aturan", item: r })}
                    className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                    title="Item dilacak wajib punya aturan konsumsi — klik untuk mengatur"
                  >
                    ⚠ wajib aturan — belum diatur
                  </button>
                ) : (
                  <span className="text-xs text-stone-400">belum diatur</span>
                ),
            },
            {
              hp: "aksi",
              kelasSel: "whitespace-nowrap text-right",
              sel: (r) => (
                <span className="flex flex-wrap justify-end gap-1.5">
                  <button
                    onClick={() => setModal({ jenis: "aturan", item: r })}
                    className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    ⏱ Aturan
                  </button>
                  <button
                    onClick={() => setModal({ jenis: "item", item: r })}
                    className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                  >
                    ✏️ Ubah
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Hapus perlengkapan "${r.nama}"? Riwayatnya tetap tersimpan.`))
                        hapus.mutate(r.id);
                    }}
                    className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    🗑
                  </button>
                </span>
              ),
            },
          ]}
        />
      )}

      {modal?.jenis === "item" && (
        <ItemModal
          item={modal.item}
          kategoriList={kategoriList}
          onClose={() => setModal(null)}
          onSukses={(baru) => {
            segarkan();
            // item BARU yang dilacak wajib beraturan → langsung buka modal Aturan
            if (baru) setModal({ jenis: "aturan", item: baru });
            else setModal(null);
          }}
        />
      )}
      {modal?.jenis === "aturan" && (
        <AturanModal item={modal.item} onClose={() => setModal(null)} onSukses={segarkan} />
      )}
      {modal?.jenis === "supplier" && (
        <SupplierBahanModal
          key={modal.item.id}
          bahan={modal.item}
          endpoint={`/perlengkapan/${modal.item.id}/supplier`}
          cacheKey="perlengkapan-supplier"
          invalidateKeys={[["perlengkapan-master"]]}
          onClose={() => setModal(null)}
        />
      )}
      {riwayat && (
        <RiwayatHargaModal
          key={riwayat.id}
          endpoint={`/perlengkapan/${riwayat.id}`}
          nama={riwayat.nama}
          satuan={riwayat.satuan}
          bolehUbah
          invalidateKeys={[["perlengkapan-master"], ["perlengkapan"]]}
          onClose={() => setRiwayat(null)}
        />
      )}
    </div>
  );
}

function ItemModal({
  item,
  kategoriList,
  onClose,
  onSukses,
}: {
  item: PerlengkapanMasterRow | null;
  kategoriList: KategoriDto[];
  onClose: () => void;
  /** baru ≠ null → item baru dgn dilacak=true (lanjut atur aturan konsumsi) */
  onSukses: (baru: PerlengkapanMasterRow | null) => void;
}) {
  const [nama, setNama] = useState(item?.nama ?? "");
  const [satuan, setSatuan] = useState(item?.satuan ?? "pcs");
  const [hargaBeli, setHargaBeli] = useState(item ? String(item.harga_beli) : "");
  const [stokMin, setStokMin] = useState(item ? String(item.stok_minimum) : "");
  const [catatan, setCatatan] = useState(item?.catatan ?? "");
  const [kategori, setKategori] = useState(item?.kategori ?? "");
  const [bolehEceran, setBolehEceran] = useState(item?.boleh_eceran ?? true);
  const [dilacak, setDilacak] = useState(item?.dilacak ?? false);
  const simpan = useMutation({
    mutationFn: () =>
      api<{ id: string; nama: string }>(item ? `/perlengkapan/${item.id}` : "/perlengkapan", {
        method: item ? "PATCH" : "POST",
        body: {
          nama: nama.trim(),
          satuan: satuan.trim() || "pcs",
          harga_beli: angkaDari(hargaBeli) || 0,
          stok_minimum: angkaDari(stokMin) || 0,
          catatan: catatan.trim() || null,
          kategori: kategori || null,
          boleh_eceran: bolehEceran,
          dilacak,
        },
      }),
    onSuccess: (d) => {
      // item BARU + dilacak → parent lanjut membuka modal Aturan Konsumsi
      onSukses(
        !item && dilacak
          ? {
              id: d.id,
              nama: nama.trim(),
              satuan: satuan.trim() || "pcs",
              harga_beli: angkaDari(hargaBeli) || 0,
              stok_minimum: angkaDari(stokMin) || 0,
              catatan: catatan.trim() || null,
              kategori: kategori || null,
              boleh_eceran: bolehEceran,
              dilacak,
              rak_lokasi: [],
              supplier_utama: null,
              jumlah_supplier: 0,
              lokasi: [],
            }
          : null,
      );
    },
  });
  return (
    <Modal open onClose={onClose} title={item ? `Ubah ${item.nama}` : "Tambah Perlengkapan"}>
      <div className="space-y-3">
        <label className="block text-sm">
          Nama
          <input value={nama} onChange={(e) => setNama(e.target.value)} className={inputClass} placeholder="mis. Sabun cuci piring" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Satuan
            <input value={satuan} onChange={(e) => setSatuan(e.target.value)} className={inputClass} placeholder="pcs / sachet / botol" />
          </label>
          <label className="block text-sm">
            Kategori
            <select value={kategori} onChange={(e) => setKategori(e.target.value)} className={inputClass}>
              <option value="">— tanpa kategori —</option>
              {/* kategori tersimpan yang sudah tak ada di master tetap tampil */}
              {kategori && !kategoriList.some((k) => k.nama === kategori) && (
                <option value={kategori}>{kategori}</option>
              )}
              {kategoriList.map((k) => (
                <option key={k.id} value={k.nama}>
                  {k.nama}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Harga beli / satuan (Rp)
            <input type="text" inputMode="decimal" value={hargaBeli} onChange={(e) => setHargaBeli(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm">
            Stok minimum (peringatan menipis)
            <input type="text"
            inputMode="decimal" value={stokMin} onChange={(e) => setStokMin(e.target.value)} className={inputClass} />
          </label>
        </div>
        <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
          🗄 <b>Rak simpan</b> diatur di menu <b>Tempat Penyimpanan</b> (per cabang, sama seperti
          bahan baku). Lokasi penyimpanan item ini tampil di kolom daftar Perlengkapan.
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={bolehEceran} onChange={(e) => setBolehEceran(e.target.checked)} />
          Boleh dibeli/dikirim <b>eceran</b> (per {satuan.trim() || "pcs"}) — hilangkan centang bila harus utuh per kemasan
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={dilacak} onChange={(e) => setDilacak(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Dilacak</b> — konsumsinya dipantau sistem.{" "}
            <span className="text-stone-500">
              Item dilacak <b>wajib punya aturan konsumsi</b>
              {!item && " (form aturan terbuka setelah simpan)"}.
            </span>
          </span>
        </label>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => simpan.mutate()}
            disabled={!nama.trim() || simpan.isPending}
            className={btnPrimary}
          >
            Simpan
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Aturan konsumsi berlaku PER CABANG — cabangnya dipilih di dalam modal
 * (halaman master tidak lagi punya pemilih cabang).
 */
function AturanModal({
  item,
  onClose,
  onSukses,
}: {
  item: PerlengkapanMasterRow;
  onClose: () => void;
  onSukses: () => void;
}) {
  const { cabang } = useBranch();
  // kantor tidak menyimpan stok — aturan hanya untuk store / central kitchen
  const opsi = cabang.filter((b) => b.tipe !== "kantor");
  const [branchId, setBranchId] = useState(
    item.lokasi[0]?.branch_id ?? opsi[0]?.id ?? "",
  );
  const aturan = item.lokasi.find((l) => l.branch_id === branchId)?.aturan ?? null;
  return (
    <Modal open onClose={onClose} title={`Aturan Konsumsi — ${item.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          Stok berkurang <b>otomatis</b> sesuai aturan — mis. sabun <b>1 sachet / hari</b> atau
          spons <b>1 pcs / 7 hari</b>. Aturan berlaku <b>per cabang</b>.
          {item.dilacak && (
            <>
              {" "}
              Item ini <b>dilacak</b> — aturan konsumsi <b>wajib</b> diatur.
            </>
          )}
        </div>
        <label className="block text-sm">
          Cabang
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={inputClass}
          >
            {opsi.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nama}
              </option>
            ))}
          </select>
        </label>
        {/* key = cabang → form ter-reset ke aturan cabang terpilih */}
        <AturanForm
          key={branchId}
          item={item}
          branchId={branchId}
          aturan={aturan}
          onClose={onClose}
          onSukses={onSukses}
        />
      </div>
    </Modal>
  );
}

function AturanForm({
  item,
  branchId,
  aturan,
  onClose,
  onSukses,
}: {
  item: PerlengkapanMasterRow;
  branchId: string;
  aturan: PerlengkapanAturanDto | null;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [metode, setMetode] = useState<PerlengkapanAturanMetode>(aturan?.metode ?? "otomatis");
  const [qty, setQty] = useState(aturan && aturan.qty > 0 ? String(aturan.qty) : "1");
  const [perHari, setPerHari] = useState(aturan ? String(aturan.per_hari) : "1");
  const [aktif, setAktif] = useState(aturan?.aktif ?? true);
  const [mulai, setMulai] = useState(aturan?.mulai ?? "");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/aturan?branch_id=${branchId}`, {
        method: "PUT",
        body: {
          metode,
          qty: metode === "manual" ? 0 : angkaDari(qty),
          per_hari: angkaDari(perHari) || 1,
          aktif: metode === "manual" ? true : aktif,
          mulai: metode === "manual" ? undefined : mulai || undefined,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <>
      {aturan && (
        <div className="text-xs text-stone-500">
          Aturan saat ini:{" "}
          {aturan.metode === "manual" ? (
            <b>manual (stock opname)</b>
          ) : (
            <>
              <b>
                {formatAngka(aturan.qty)} {item.satuan}
              </b>{" "}
              / {aturan.per_hari === 1 ? "hari" : `${aturan.per_hari} hari`}
              {aturan.aktif ? "" : " (nonaktif)"}
            </>
          )}
        </div>
      )}
      {/* metode konsumsi: manual (opname) vs otomatis (jadwal) */}
      <div className="space-y-1.5">
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            metode === "manual" ? "border-orange-400 bg-orange-50" : "border-stone-200 hover:bg-stone-50"
          }`}
        >
          <input
            type="radio"
            name="metode-aturan"
            checked={metode === "manual"}
            onChange={() => setMetode("manual")}
            className="mt-0.5"
          />
          <span>
            <b>✋ Manual — dari stock opname</b>
            <span className="block text-xs text-stone-500">
              Pemakaian dihitung saat <b>🧰 Opname Perlengkapan</b> (halaman Stok) — tanpa
              potongan harian otomatis.
            </span>
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            metode === "otomatis" ? "border-orange-400 bg-orange-50" : "border-stone-200 hover:bg-stone-50"
          }`}
        >
          <input
            type="radio"
            name="metode-aturan"
            checked={metode === "otomatis"}
            onChange={() => setMetode("otomatis")}
            className="mt-0.5"
          />
          <span>
            <b>⏱ Otomatis — terjadwal</b>
            <span className="block text-xs text-stone-500">
              Stok berkurang otomatis: terpakai sejumlah tertentu setiap beberapa hari.
            </span>
          </span>
        </label>
      </div>
      {metode === "otomatis" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Jumlah terpakai ({item.satuan})
              <input type="text"
            inputMode="decimal" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm">
              Setiap … hari
              <input type="text"
            inputMode="decimal" min={1} max={365} value={perHari} onChange={(e) => setPerHari(e.target.value)} className={inputClass} />
            </label>
          </div>
          <label className="block text-sm">
            Mulai berlaku (kosong = hari ini)
            <input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />
            Aturan aktif
          </label>
        </>
      )}
      <ErrorText error={kirim.error} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnSecondary}>Batal</button>
        <button
          onClick={() => kirim.mutate()}
          disabled={!branchId || (metode === "otomatis" && !(angkaDari(qty) > 0)) || kirim.isPending}
          className={btnPrimary}
        >
          Simpan Aturan
        </button>
      </div>
    </>
  );
}
