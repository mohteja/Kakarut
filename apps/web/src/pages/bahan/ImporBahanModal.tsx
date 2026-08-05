import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BahanDto, BahanImportMode, BahanImportResult } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary } from "../../components/ui";
import { api } from "../../lib/api";
import { buatCsvBahan, keRowsImpor, parseCsv, type TerbacaCsv } from "../../lib/bahanCsv";
import { unduhCsv } from "../../lib/unduh";

/**
 * Impor bahan baku dari CSV: unduh template (berisi data lama) → edit → unggah →
 * pilih "Perbarui semua" (upsert) atau "Tambah yang baru" (insert-only). Kolom
 * CSV persis form Tambah/Ubah — lihat lib/bahanCsv.ts.
 */
export function ImporBahanModal({ bahan, onClose }: { bahan: BahanDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [terbaca, setTerbaca] = useState<TerbacaCsv | null>(null);
  const [namaFile, setNamaFile] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasil, setHasil] = useState<BahanImportResult | null>(null);

  const impor = useMutation({
    mutationFn: (mode: BahanImportMode) =>
      api<BahanImportResult>("/bahan/import", {
        method: "POST",
        body: { mode, items: terbaca!.rows },
      }),
    onSuccess: (r) => {
      setHasil(r);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setNamaFile(f.name);
    setParseError(null);
    setHasil(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const tabel = parseCsv(String(reader.result ?? ""));
        const t = keRowsImpor(tabel);
        if (t.rows.length === 0) {
          setParseError("Tidak ada baris bahan terbaca — pastikan ada kolom 'nama' berisi data.");
          setTerbaca(null);
        } else {
          setTerbaca(t);
        }
      } catch {
        setParseError("Gagal membaca file — pastikan format CSV benar.");
        setTerbaca(null);
      }
    };
    reader.readAsText(f);
  }

  return (
    <Modal open onClose={onClose} title="📥 Impor Bahan Baku dari CSV" lebar="max-w-xl">
      {hasil ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            ✅ Impor selesai — <b>{hasil.ditambah}</b> ditambah, <b>{hasil.diperbarui}</b>{" "}
            diperbarui
            {hasil.dipulihkan > 0 && (
              <>
                , <b>{hasil.dipulihkan}</b> dipulihkan dari Tempat Sampah
              </>
            )}
            {hasil.dilewati > 0 && (
              <>
                , <b>{hasil.dilewati}</b> dilewati (sudah ada)
              </>
            )}
            .
          </div>
          {hasil.gagal.length > 0 && (
            <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              <b>{hasil.gagal.length} baris gagal:</b>
              <ul className="mt-1 list-inside list-disc">
                {hasil.gagal.slice(0, 10).map((g, i) => (
                  <li key={i}>
                    {g.nama}: {g.alasan}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={onClose} className={btnPrimary}>
              Selesai
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Langkah 1: unduh template */}
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="mb-1 text-sm font-semibold text-stone-700">
              1. Unduh template CSV
            </div>
            <p className="mb-2 text-xs text-stone-500">
              {bahan.length > 0
                ? `Template berisi ${bahan.length} bahan yang sudah ada — tinggal edit angkanya, atau tambah baris baru di bawah.`
                : "Template berisi contoh 1 baris — hapus baris contoh, lalu isi bahan Anda."}{" "}
              Kolomnya <b>sama dengan form Tambah/Ubah Bahan Baku</b>. <b>jenis</b>: beli /
              produksi. <b>boleh_eceran</b>, <b>lacak_stok</b>, <b>kemasan</b>, <b>complement</b>:
              ya / tidak.
            </p>
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              💡 Tulis <b>harga_beli</b> sebagai angka saja <b>tanpa "Rp"</b> — contoh{" "}
              <code className="rounded bg-white px-1">10000</code>, bukan{" "}
              <code className="rounded bg-white px-1">Rp 10.000</code>. (Titik/koma ribuan tetap
              terbaca, tapi lebih aman ditulis polos.)
            </p>
            <button
              onClick={() => unduhCsv("template-bahan-baku.csv", buatCsvBahan(bahan))}
              className={btnSecondary}
            >
              ⬇ Unduh template CSV
            </button>
          </div>

          {/* Langkah 2: unggah */}
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="mb-1 text-sm font-semibold text-stone-700">2. Unggah CSV terisi</div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              aria-label="Unggah file CSV bahan baku"
              className="block w-full text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-orange-700 hover:file:bg-orange-200"
            />
            {parseError && (
              <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {parseError}
              </div>
            )}
            {terbaca && (
              <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                📄 <b>{namaFile}</b> — <b>{terbaca.rows.length}</b> baris bahan terbaca
                {terbaca.dilewatiTanpaNama > 0 && (
                  <> · {terbaca.dilewatiTanpaNama} baris tanpa nama dilewati</>
                )}
                .
              </div>
            )}
            {/*
              Kolom yang tak ada di berkas TIDAK diisi nilai default — nilainya
              dibiarkan apa adanya. Itu perilaku yang benar, tapi tetap harus
              disebut: yang mengira berkasnya mengatur SEMUA kolom perlu tahu
              kolom mana yang sebenarnya tak ia sentuh.
            */}
            {terbaca && terbaca.kolomHilang.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ℹ️ Berkas ini tidak punya kolom{" "}
                <b>{terbaca.kolomHilang.join(", ")}</b>. Nilai kolom itu pada bahan yang sudah
                ada <b>dibiarkan apa adanya</b> (tidak dikosongkan). Bahan baru memakai nilai
                bawaan. Ingin mengubahnya juga? Mulai dari <b>template</b> di atas.
              </div>
            )}
            {terbaca && terbaca.isiTakMasukAkal > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠️ <b>{terbaca.isiTakMasukAkal}</b> baris punya <b>isi</b> nol atau negatif. Isi
                adalah pembagi harga (harga beli ÷ isi), jadi nol tak bisa dipakai — kolom itu
                dilewati untuk baris tersebut, bukan diisi angka karangan. Bahan lama tetap
                memakai isinya yang sekarang; bahan baru memakai <b>1</b>.
              </div>
            )}
          </div>

          {/* Langkah 3: pilih mode */}
          {terbaca && (
            <div className="rounded-lg border border-stone-200 p-3">
              <div className="mb-2 text-sm font-semibold text-stone-700">3. Pilih cara impor</div>
              <ErrorText error={impor.error} />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => impor.mutate("perbarui")}
                  disabled={impor.isPending}
                  className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-left hover:border-orange-500 disabled:opacity-50"
                >
                  <div className="text-sm font-bold text-orange-800">🔄 Perbarui semua</div>
                  <div className="text-xs text-stone-500">
                    Bahan yang sudah ada ditimpa dgn data CSV; yang baru ditambah.
                  </div>
                </button>
                <button
                  onClick={() => impor.mutate("tambah")}
                  disabled={impor.isPending}
                  className="rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-left hover:border-green-500 disabled:opacity-50"
                >
                  <div className="text-sm font-bold text-green-800">➕ Tambah yang baru</div>
                  <div className="text-xs text-stone-500">
                    Hanya bahan yang belum ada yang ditambah; yang lama tak disentuh.
                  </div>
                </button>
              </div>
              {impor.isPending && (
                <div className="mt-2 text-center text-xs text-stone-400">Mengimpor…</div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={onClose} className={btnSecondary}>
              Tutup
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
