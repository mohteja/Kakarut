import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { AnalisisHargaRow, MenuPriceLogRow, TerapkanSaranHasil } from "@kakarut/shared";
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
import { formatAngka, formatRupiah, formatTanggalRingkas } from "../../lib/format";

const SEBAB_LABEL: Record<MenuPriceLogRow["sebab"], string> = {
  buat: "menu dibuat",
  manual: "diubah manual",
  terapkan_saran: "terapkan harga saran",
};

/** Rincian satu menu: penyumbang HPP + riwayat perubahan harga jualnya. */
function Rincian({ row }: { row: AnalisisHargaRow }) {
  const { data: riwayat } = useQuery({
    queryKey: ["menu-riwayat-harga", row.id],
    queryFn: () => api<MenuPriceLogRow[]>(`/menu/${row.id}/riwayat-harga`),
  });

  return (
    <div className="mt-3 space-y-3 border-t border-stone-200 pt-3">
      <div>
        <div className="mb-1 text-xs font-semibold text-stone-500">
          Penyumbang HPP terbesar — perhatikan tanggalnya
        </div>
        {row.penyumbang.length === 0 ? (
          <p className="text-sm text-stone-400">Menu ini belum punya resep.</p>
        ) : (
          <div className="space-y-1">
            {row.penyumbang.map((p) => {
              // Bahan yang bergerak SETELAH menu terakhir disimpan = penjelasan
              // langsung kenapa food cost naik tanpa harga jual disentuh.
              const setelahMenu = p.bahan_diperbarui > row.menu_diperbarui;
              return (
                <div
                  key={p.ingredient_id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                >
                  <span className="min-w-32 flex-1 font-medium text-stone-700">{p.nama}</span>
                  <span className="text-xs text-stone-500">
                    {formatAngka(p.qty)} {p.satuan} × Rp {formatAngka(p.harga_per_unit, 2)}
                  </span>
                  <span className="font-semibold text-stone-700">
                    {formatRupiah(p.kontribusi)}
                  </span>
                  <span className="text-xs text-stone-400">({p.persen_hpp.toFixed(0)}%)</span>
                  <span
                    className={`w-full text-xs ${setelahMenu ? "font-medium text-red-600" : "text-stone-400"}`}
                  >
                    harga bahan diperbarui {formatTanggalRingkas(p.bahan_diperbarui)}
                    {p.harga_dilaporkan_pada &&
                      ` · terakhir dilaporkan ${formatTanggalRingkas(p.harga_dilaporkan_pada)}`}
                    {setelahMenu && " — SETELAH harga menu terakhir disimpan"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold text-stone-500">Riwayat harga jual</div>
        {!riwayat ? (
          <p className="text-xs text-stone-400">Memuat…</p>
        ) : riwayat.length === 0 ? (
          <p className="text-xs text-stone-400">
            Belum ada catatan — menu ini dibuat sebelum riwayat harga dicatat.
          </p>
        ) : (
          <div className="space-y-0.5 text-xs text-stone-600">
            {riwayat.map((r) => (
              <div key={r.id} className="flex flex-wrap gap-x-2">
                <span className="text-stone-400">{formatTanggalRingkas(r.created_at)}</span>
                <span>
                  {r.harga_lama != null ? `${formatRupiah(r.harga_lama)} → ` : ""}
                  <b>{formatRupiah(r.harga_baru)}</b>
                </span>
                <span className="text-stone-400">
                  {SEBAB_LABEL[r.sebab]}
                  {r.oleh ? ` · ${r.oleh}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ANALISIS HARGA — halaman yang menjawab "kenapa food cost menu saya naik
 * padahal harga jualnya tidak pernah saya ubah".
 *
 * HPP tidak pernah disimpan; ia dihitung ulang tiap saat dari harga bahan yang
 * berlaku SEKARANG. Jadi menu bisa hanyut tanpa ada yang menyentuhnya. Di sini
 * tanggal menu terakhir disimpan disandingkan dengan tanggal tiap bahan
 * penyumbangnya terakhir bergerak, dan harga jual bisa disamakan ulang dengan
 * harga saran secara massal.
 */
export function AnalisisHargaPage() {
  const queryClient = useQueryClient();
  const { data: rows, isLoading, error: gagalMuat } = useQuery({
    queryKey: ["menu-analisis-harga"],
    queryFn: () => api<AnalisisHargaRow[]>("/menu/analisis-harga"),
  });
  const [hanyaLewat, setHanyaLewat] = useState(true);
  const [cari, setCari] = useState("");
  const [filterKat, setFilterKat] = useState("");
  const [buka, setBuka] = useState<string | null>(null);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [hasil, setHasil] = useState<TerapkanSaranHasil | null>(null);

  const terapkan = useMutation({
    mutationFn: (ids: string[]) =>
      api<TerapkanSaranHasil>("/menu/terapkan-saran", { method: "POST", body: { ids } }),
    onSuccess: (h) => {
      setHasil(h);
      setPilih(new Set());
      queryClient.invalidateQueries({ queryKey: ["menu-analisis-harga"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] });
    },
  });

  if (isLoading) return <Spinner />;
  const semua = rows ?? [];
  const ambang = semua[0]?.food_cost_maks ?? 40;
  const lewat = semua.filter((r) => r.food_cost_persen > ambang);
  // Chip kategori dari SELURUH baris supaya daftarnya tidak menyusut saat
  // mengetik di kotak cari / berpindah tab ambang.
  const kategoriList = [...new Set(semua.map((r) => r.kategori))];
  const q = cari.trim().toLowerCase();
  const tampil = (hanyaLewat ? lewat : semua)
    .filter((r) => (filterKat ? r.kategori === filterKat : true))
    .filter((r) =>
      q === ""
        ? true
        : r.nama.toLowerCase().includes(q) || (r.kode ?? "").toLowerCase().includes(q),
    );
  const disaring = q !== "" || filterKat !== "";

  const togglePilih = (id: string) =>
    setPilih((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Selisih rupiah dari harga saran — dipakai di konfirmasi, karena ini
  // mengubah harga yang benar-benar ditagih ke pembeli.
  const terpilih = semua.filter((r) => pilih.has(r.id));
  const selisih = terpilih.reduce((t, r) => t + (r.harga_jual_bulat - r.harga_jual), 0);

  const jalankan = () => {
    const daftar = terpilih
      .slice(0, 8)
      .map((r) => `• ${r.nama}: ${formatRupiah(r.harga_jual)} → ${formatRupiah(r.harga_jual_bulat)}`)
      .join("\n");
    const sisa = terpilih.length > 8 ? `\n… dan ${terpilih.length - 8} menu lain` : "";
    const arah = selisih >= 0 ? "naik" : "turun";
    if (
      confirm(
        `Ubah harga jual ${terpilih.length} menu menjadi harga saran?\n\n${daftar}${sisa}\n\n` +
          `Total ${arah} ${formatRupiah(Math.abs(selisih))}. Harga ini yang ditagih ke pembeli.`,
      )
    ) {
      terapkan.mutate([...pilih]);
    }
  };

  return (
    <div>
      <PageTitle
        aksi={
          <Link to="/menu" className={btnSecondary}>
            ← Menu
          </Link>
        }
      >
        Analisis Harga
      </PageTitle>

      <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        HPP <b>tidak disimpan</b> — selalu dihitung ulang dari harga bahan yang berlaku sekarang.
        Karena itu food cost bisa naik walau harga jual tidak pernah diubah. Buka sebuah menu untuk
        melihat bahan mana yang bergerak dan kapan. Ambang sehat perusahaan:{" "}
        <b>{formatAngka(ambang, 0)}%</b> (
        <Link to="/pengaturan/perusahaan" className="underline">
          ubah
        </Link>
        ).
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setHanyaLewat(true)}
          className={hanyaLewat ? btnPrimary : btnSecondary}
        >
          ⚠ Di atas ambang ({lewat.length})
        </button>
        <button
          onClick={() => setHanyaLewat(false)}
          className={!hanyaLewat ? btnPrimary : btnSecondary}
        >
          Semua menu ({semua.length})
        </button>
        <span className="flex-1" />
        {pilih.size > 0 && (
          <button onClick={jalankan} disabled={terapkan.isPending} className={btnPrimary}>
            {terapkan.isPending
              ? "Menerapkan…"
              : `Terapkan harga saran (${pilih.size})`}
          </button>
        )}
      </div>

      {/* Cari + filter kategori */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="🔍 Cari menu / kode…"
          aria-label="Cari menu"
          className={`${inputClass} max-w-72`}
        />
        {kategoriList.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setFilterKat("")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filterKat === ""
                  ? "bg-orange-600 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              Semua
            </button>
            {kategoriList.map((k) => (
              <button
                key={k}
                onClick={() => setFilterKat(filterKat === k ? "" : k)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  filterKat === k
                    ? "bg-orange-600 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        {disaring && (
          <span className="text-xs text-stone-500">{tampil.length} menu cocok</span>
        )}
      </div>
      <ErrorText error={terapkan.error} />

      {hasil && (
        <div className="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          <b>{hasil.diperbarui} menu</b> diperbarui
          {hasil.dilewati > 0 && `, ${hasil.dilewati} dilewati (harga sudah sama)`}.
        </div>
      )}

      {/*
        GAGAL MEMUAT ≠ SEMUA MENU SEHAT. Tanpa cabang ini, bacaan yang ditolak
        server berakhir sebagai "Tidak ada menu di atas ambang — 👍": halaman ini
        MENGUCAPKAN SELAMAT atas keadaan yang tak pernah ia lihat.
        Dan tak ada apa pun di luar layar yang membantahnya. Di gudang, rak yang
        penuh langsung menyanggah daftar kiriman yang kosong; food cost tak
        terlihat, jadi halaman inilah satu-satunya alat ukurnya. Pemilik yang
        percaya jempolnya tidak menaikkan harga menu yang sebenarnya sudah
        lewat ambang — dan tak pernah tahu ia melewatkannya.
        Alasan & bentuknya sama dengan penjagaan di RiwayatPage.
      */}
      {gagalMuat ? (
        <Card className="p-4">
          <ErrorText error={gagalMuat} />
          <div className="mt-2 text-sm text-stone-500">
            Analisis harga tidak bisa dimuat, jadi kosongnya daftar di bawah{" "}
            <b>bukan</b> berarti semua menu sudah sehat. Muat ulang halaman setelah
            masalahnya beres.
          </div>
        </Card>
      ) : tampil.length === 0 ? (
        <Card className="p-6 text-center text-sm text-stone-500">
          {disaring
            ? `Tidak ada menu yang cocok${q ? ` dengan "${cari.trim()}"` : ""}${
                filterKat ? ` di kategori "${filterKat}"` : ""
              }${hanyaLewat ? " di atas ambang" : ""}.`
            : hanyaLewat
              ? `Tidak ada menu di atas ambang ${formatAngka(ambang, 0)}%. 👍`
              : "Belum ada menu."}
        </Card>
      ) : (
        <div className="space-y-2">
          {tampil.map((r) => {
            const lewatAmbang = r.food_cost_persen > ambang;
            const terbuka = buka === r.id;
            return (
              <Card key={r.id} className="p-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={pilih.has(r.id)}
                    onChange={() => togglePilih(r.id)}
                    className="mt-1"
                    aria-label={`Pilih ${r.nama}`}
                  />
                  <button
                    type="button"
                    onClick={() => setBuka(terbuka ? null : r.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold text-stone-800">{r.nama}</span>
                      <span className="text-xs text-stone-400">{r.kategori}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-sm text-stone-600">
                      <span>
                        Jual <b>{formatRupiah(r.harga_jual)}</b>
                      </span>
                      <span>HPP {formatRupiah(r.hpp)}</span>
                      <span
                        className={
                          lewatAmbang ? "font-bold text-red-600" : "font-semibold text-green-600"
                        }
                      >
                        {lewatAmbang && "⚠ "}
                        {r.food_cost_persen.toFixed(1)}%
                      </span>
                      {r.harga_jual_bulat !== r.harga_jual && (
                        <span className="text-xs text-stone-400">
                          saran {formatRupiah(r.harga_jual_bulat)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-stone-400">
                      Harga menu terakhir disimpan {formatTanggalRingkas(r.menu_diperbarui)} ·{" "}
                      {terbuka ? "tutup rincian" : "lihat rincian"}
                    </div>
                  </button>
                </div>
                {terbuka && <Rincian row={r} />}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
