import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BahanDto, BahanImportMode, BahanImportResult, BahanImportRow } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary } from "../../components/ui";
import { api } from "../../lib/api";

/** Kolom template CSV — urutan tetap; header dipakai saat mengunduh & mem-parse. */
const KOLOM = [
  "kode",
  "nama",
  "kategori",
  "jenis",
  "harga_beli",
  "isi",
  "satuan",
  "satuan_beli",
  "stok_minimum",
  "boleh_eceran",
  "lacak_stok",
  "catatan",
] as const;

/** Bungkus satu sel CSV (kutip bila mengandung koma/kutip/baris baru). */
function selCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Susun CSV dari daftar bahan (untuk template — data lama bisa langsung diedit). */
function buatCsv(bahan: BahanDto[]): string {
  const baris = bahan.map((b) =>
    [
      b.kode ?? "",
      b.nama,
      b.kategori,
      b.pengadaan,
      String(b.harga_beli),
      String(b.isi),
      b.satuan,
      b.satuan_beli ?? "",
      String(b.stok_minimum),
      b.boleh_eceran ? "ya" : "tidak",
      b.track_stok ? "ya" : "tidak",
      b.catatan ?? "",
    ]
      .map(selCsv)
      .join(","),
  );
  // baris contoh bila belum ada bahan sama sekali
  const contoh =
    bahan.length === 0
      ? ['AMS,"Air Mineral 330 ml",minuman,beli,50000,24,botol,dus,5,tidak,ya,contoh — hapus baris ini']
      : [];
  return [KOLOM.join(","), ...baris, ...contoh].join("\n");
}

/** Parser CSV sederhana: dukung sel berkutip, koma & baris baru di dalam kutip. */
function parseCsv(teks: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  const t = teks.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((sel) => sel.trim() !== ""));
}

/**
 * Koersi angka dari sel CSV — toleran terhadap input pengguna/Excel:
 * - buang simbol mata uang ("Rp"), spasi, dan karakter lain ("Rp 10.000,-").
 * - titik/koma ribuan dibedakan dari desimal: bila keduanya ada, pemisah desimal
 *   adalah yang muncul TERAKHIR ("1.234,5" → 1234,5 · "1,234.5" → 1234.5). Bila
 *   hanya satu jenis, grup 3-digit dianggap ribuan ("10.000" → 10000), selain itu
 *   desimal ("1,5" → 1.5). Jadi harga ber-"Rp" tak lagi terbaca 0.
 */
function keAngka(v: string, fallback: number): number {
  let s = v.trim().replace(/rp/gi, "").replace(/[^0-9.,]/g, "");
  if (!s) return fallback;
  const adaTitik = s.includes(".");
  const adaKoma = s.includes(",");
  if (adaTitik && adaKoma) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".") // desimal koma (ID)
        : s.replace(/,/g, ""); // desimal titik (EN)
  } else if (adaKoma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (adaTitik && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // titik ribuan (mis. 10.000)
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}
function keBool(v: string, fallback: boolean): boolean {
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  return ["ya", "1", "true", "y", "yes", "aktif", "eceran"].includes(s);
}

interface Terbaca {
  rows: BahanImportRow[];
  dilewatiTanpaNama: number;
}

/** Ubah tabel CSV (baris pertama = header) menjadi baris impor bertipe. */
function keRows(tabel: string[][]): Terbaca {
  if (tabel.length === 0) return { rows: [], dilewatiTanpaNama: 0 };
  const header = tabel[0].map((h) => h.trim().toLowerCase());
  const idx = (nama: string) => header.indexOf(nama);
  const iKode = idx("kode");
  const iNama = idx("nama");
  const iKat = idx("kategori");
  const iJenis = idx("jenis");
  const iHarga = idx("harga_beli");
  const iIsi = idx("isi");
  const iSatuan = idx("satuan");
  const iSatuanBeli = idx("satuan_beli");
  const iMin = idx("stok_minimum");
  const iEceran = idx("boleh_eceran");
  const iLacak = idx("lacak_stok");
  const iCat = idx("catatan");
  const amb = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const rows: BahanImportRow[] = [];
  let dilewatiTanpaNama = 0;
  for (const r of tabel.slice(1)) {
    const nama = amb(r, iNama);
    if (!nama) {
      dilewatiTanpaNama++;
      continue;
    }
    const jenisRaw = amb(r, iJenis).toLowerCase();
    rows.push({
      kode: amb(r, iKode) || null,
      nama,
      kategori: amb(r, iKat) || "lain",
      jenis: jenisRaw.includes("produksi") ? "produksi" : "beli",
      harga_beli: keAngka(amb(r, iHarga), 0),
      isi: Math.max(keAngka(amb(r, iIsi), 1), 0.0001),
      satuan: amb(r, iSatuan) || "pcs",
      satuan_beli: amb(r, iSatuanBeli) || null,
      stok_minimum: keAngka(amb(r, iMin), 0),
      boleh_eceran: keBool(amb(r, iEceran), false),
      lacak_stok: keBool(amb(r, iLacak), true),
      catatan: amb(r, iCat) || null,
    });
  }
  return { rows, dilewatiTanpaNama };
}

function unduh(nama: string, isi: string) {
  const blob = new Blob([`﻿${isi}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nama;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Impor bahan baku dari CSV: unduh template (berisi data lama) → edit → unggah →
 * pilih "Perbarui semua" (upsert) atau "Tambah yang baru" (insert-only).
 */
export function ImporBahanModal({ bahan, onClose }: { bahan: BahanDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [terbaca, setTerbaca] = useState<Terbaca | null>(null);
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
        const t = keRows(tabel);
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
              Kolom <b>jenis</b>: beli / produksi. <b>boleh_eceran</b> & <b>lacak_stok</b>: ya /
              tidak.
            </p>
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              💡 Tulis <b>harga_beli</b> sebagai angka saja <b>tanpa "Rp"</b> — contoh{" "}
              <code className="rounded bg-white px-1">10000</code>, bukan{" "}
              <code className="rounded bg-white px-1">Rp 10.000</code>. (Titik/koma ribuan tetap
              terbaca, tapi lebih aman ditulis polos.)
            </p>
            <button
              onClick={() => unduh("template-bahan-baku.csv", buatCsv(bahan))}
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
