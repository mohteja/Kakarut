import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { StokRowDto } from "@kakarut/shared";
import { angkaDari } from "@kakarut/shared";
import { ErrorText, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../../lib/format";

interface StokAwalTersimpan {
  tanggal: string;
  items: { ingredient_id: string; qty: number; tanggal: string }[];
}

/**
 * Stok Awal (saldo pembuka): catat stok yang SUDAH ADA sebelum memakai
 * aplikasi. Bukan "tambah stok" — ini SATU saldo pembuka per bahan yang
 * TERKUNCI pada satu tanggal. Nilai yang diisi MENJADI saldo bahan (baseline)
 * per tanggal itu — bukan ditambah. Ubah nilai / tanggal = simpan ulang
 * (mengganti, bukan menumpuk). Owner/admin. Mobile-first, layar penuh.
 */
export function StokAwalPage() {
  const { auth } = useAuth();
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Daftar bahan (nama + satuan) — saldo live TIDAK ditampilkan di sini.
  const { data: stok } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  // Nilai stok awal tersimpan (untuk mengisi ulang / edit) + tanggal terkunci.
  const { data: tersimpan } = useQuery({
    queryKey: ["stok-awal", branchQuery],
    queryFn: () => api<StokAwalTersimpan>(`/stok/awal${branchQuery}`),
  });

  const [awal, setAwal] = useState<Record<string, string>>({});
  const [tanggal, setTanggal] = useState<string>(hariIniWIB());
  const [cari, setCari] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [selesai, setSelesai] = useState(false);

  // Isi ulang form dari nilai tersimpan (sekali, saat data tiba) → owner bisa
  // melihat & mengedit saldo pembuka yang ada beserta tanggalnya.
  const terisiAwal = useRef(false);
  useEffect(() => {
    if (terisiAwal.current || !tersimpan) return;
    terisiAwal.current = true;
    setTanggal(tersimpan.tanggal || hariIniWIB());
    if (tersimpan.items.length > 0) {
      const map: Record<string, string> = {};
      for (const it of tersimpan.items) map[it.ingredient_id] = String(it.qty);
      setAwal(map);
    }
  }, [tersimpan]);

  const { cabang } = useBranch();
  const namaCabang =
    cabang.find((b) => b.id === branchId)?.nama ??
    auth?.branch?.nama ??
    auth?.company?.nama ??
    "Cabang";

  const tampil = useMemo(
    () => (stok ?? []).filter((s) => s.nama.toLowerCase().includes(cari.toLowerCase())),
    [stok, cari],
  );
  const satuanById = useMemo(
    () => new Map((stok ?? []).map((s) => [s.ingredient_id, s.satuan])),
    [stok],
  );
  const namaById = useMemo(
    () => new Map((stok ?? []).map((s) => [s.ingredient_id, s.nama])),
    [stok],
  );
  const terisi = Object.values(awal).filter((v) => v !== "").length;

  const simpan = useMutation({
    mutationFn: () => {
      const items = Object.entries(awal)
        .filter(([, v]) => v !== "")
        .map(([ingredient_id, v]) => ({ ingredient_id, qty: angkaDari(v) }));
      return api<{ ok: true; jumlah: number; tanggal: string }>("/stok/awal", {
        method: "POST",
        body: { ...(branchId ? { branch_id: branchId } : {}), tanggal, items },
      });
    },
    onSuccess: () => {
      setKonfirmasi(false);
      setSelesai(true);
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["stok-awal"] });
      queryClient.invalidateQueries({ queryKey: ["kartu"] });
    },
  });

  return (
    <div className="flex min-h-screen flex-col bg-stone-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 shadow-sm">
        <Link to="/stok" className="text-2xl text-stone-500" aria-label="Kembali">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-stone-800">Stok Awal — {namaCabang}</div>
          <div className="text-xs text-stone-500">{terisi} bahan diisi</div>
        </div>
      </header>

      <div className="border-b border-stone-200 bg-blue-50 px-4 py-2 text-xs text-blue-800">
        <b>Saldo pembuka</b>: stok yang sudah ada sebelum memakai aplikasi. Nilai yang diisi{" "}
        <b>menjadi saldo</b> bahan pada <b>tanggal di bawah</b> (bukan ditambah). Ini{" "}
        <b>satu saldo pembuka per bahan</b> — menyimpan ulang <b>mengganti</b> nilai/tanggalnya,
        bukan menumpuk. Bahan yang dikosongkan tidak berubah.
      </div>

      {/* Tanggal saldo pembuka (terkunci) — ubah di sini untuk memindah tanggalnya */}
      <div className="flex items-center gap-2 border-b border-stone-200 bg-white px-4 py-2">
        <label htmlFor="tgl-awal" className="text-sm font-medium text-stone-700">
          Tanggal saldo pembuka
        </label>
        <input
          id="tgl-awal"
          type="date"
          value={tanggal}
          max={hariIniWIB()}
          onChange={(e) => setTanggal(e.target.value)}
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
        />
      </div>

      <div className="sticky top-[57px] z-10 border-b border-stone-200 bg-white px-4 py-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan…"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
        />
      </div>

      <main className="flex-1 p-3 pb-28">
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          {tampil.map((s) => (
            <div
              key={s.ingredient_id}
              className="flex items-center gap-2 border-b border-stone-100 px-3 py-1.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
                {s.nama}
              </div>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={awal[s.ingredient_id] ?? ""}
                onChange={(e) => setAwal({ ...awal, [s.ingredient_id]: e.target.value })}
                placeholder="0"
                aria-label={`Stok awal ${s.nama}`}
                className="h-9 w-24 rounded-lg border border-stone-300 px-2 text-right text-base font-semibold focus:border-orange-500 focus:outline-none"
              />
              <span className="w-10 shrink-0 text-xs text-stone-500">{s.satuan}</span>
            </div>
          ))}
          {tampil.length === 0 && (
            <div className="py-10 text-center text-sm text-stone-400">Tidak ada bahan.</div>
          )}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
        <button
          onClick={() => setKonfirmasi(true)}
          disabled={terisi === 0}
          className={`${btnPrimary} w-full py-3 text-base`}
        >
          Simpan Stok Awal ({terisi} bahan)
        </button>
      </div>

      {konfirmasi && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setKonfirmasi(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-stone-800">Konfirmasi Stok Awal</h2>
            <p className="mb-3 text-sm text-stone-600">
              Saldo pembuka <b>{terisi} bahan</b> ditetapkan per{" "}
              <b>{formatTanggal(tanggal)}</b>. Bahan yang tidak diisi tidak berubah.
            </p>
            <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              {Object.entries(awal)
                .filter(([, v]) => v !== "")
                .map(([id, v]) => (
                  <div key={id} className="flex justify-between text-sm">
                    <span className="text-stone-700">{namaById.get(id) ?? id}</span>
                    <span className="font-semibold text-stone-800">
                      {formatAngka(angkaDari(v))} {satuanById.get(id) ?? ""}
                    </span>
                  </div>
                ))}
            </div>
            <ErrorText error={simpan.error} />
            <div className="flex gap-2">
              <button onClick={() => setKonfirmasi(false)} className={`${btnSecondary} flex-1`}>
                Batal
              </button>
              <button
                onClick={() => simpan.mutate()}
                disabled={simpan.isPending}
                className={`${btnPrimary} flex-1`}
              >
                {simpan.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selesai && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="mt-2 text-lg font-bold text-stone-800">Stok Awal Tersimpan</h2>
            <p className="mt-2 text-sm text-stone-500">
              Saldo pembuka ditetapkan per <b>{formatTanggal(tanggal)}</b>. Untuk mengubahnya, buka
              lagi halaman ini dan simpan ulang (nilai / tanggal).
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setSelesai(false)} className={`${btnSecondary} flex-1`}>
                Tutup
              </button>
              <button onClick={() => navigate("/stok")} className={`${btnPrimary} flex-1`}>
                Ke Stok
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
