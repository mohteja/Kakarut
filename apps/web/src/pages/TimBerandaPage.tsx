import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { StokRowDto } from "@kakarut/shared";
import { Card, PageTitle, Spinner, StatusBadge, tdClass, thClass } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useBranch } from "../context/BranchContext";
import { api } from "../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../lib/format";

/** Status faktur pengadaan yang BELUM selesai (belum masuk stok / belum dibatalkan). */
const BELUM_SELESAI = new Set(["rencana", "dikerjakan", "menunggu"]);

type ProdRow = { faktur_id: string; status: string };
type PenRow = { status: string };

/**
 * Kartu "perlu perhatian": angka + tautan; menyala (oranye) bila jumlah > 0.
 * Meniru gaya beranda owner agar tim melihat notifikasi yang sama relevannya.
 */
function AttnCard({
  to,
  ikon,
  label,
  jumlah,
  satuan,
  aktif,
}: {
  to: string;
  ikon: string;
  label: string;
  jumlah: number;
  satuan: string;
  aktif: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-xl border p-4 shadow-sm transition hover:shadow ${
        aktif ? "border-orange-300 bg-orange-50" : "border-stone-200 bg-white"
      }`}
    >
      <span className="text-2xl">{ikon}</span>
      <div className="min-w-0">
        <div className={`text-2xl font-bold ${aktif ? "text-orange-600" : "text-stone-700"}`}>
          {formatAngka(jumlah)} <span className="text-sm font-normal text-stone-400">{satuan}</span>
        </div>
        <div className="truncate text-sm text-stone-500">{label}</div>
      </div>
    </Link>
  );
}

/**
 * Beranda ringkas untuk peran TIM — menyesuaikan lokasi:
 * - Tim CENTRAL KITCHEN: beli & produksi yang belum selesai + bahan menipis.
 * - Tim TOKO (store): barang datang (kiriman menunggu diterima) + bahan menipis.
 * Semua data terkunci ke cabang tim (server memaksa cabangnya).
 */
export function TimBerandaPage() {
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const hari = hariIniWIB();

  const branch = cabang.find((b) => b.id === auth?.user.branch_id);
  const diCk = branch?.tipe === "central_kitchen";

  const { data: stok } = useQuery({
    queryKey: ["stok", ""],
    queryFn: () => api<StokRowDto[]>("/stok"),
    refetchInterval: 120_000,
  });
  // Tim toko: kiriman yang menunggu diterima ("barang datang").
  const { data: pen } = useQuery({
    queryKey: ["penerimaan", ""],
    queryFn: () => api<{ rows: PenRow[] }>("/penerimaan"),
    enabled: !diCk,
    refetchInterval: 60_000,
  });
  // Tim CK: beli & produksi yang belum selesai.
  const { data: prod } = useQuery({
    queryKey: ["produksi-beranda"],
    queryFn: () => api<{ rows: ProdRow[] }>("/produksi?per_page=200"),
    enabled: diCk,
    refetchInterval: 60_000,
  });
  const { data: beli } = useQuery({
    queryKey: ["pembelian-beranda"],
    queryFn: () => api<{ rows: ProdRow[] }>("/pembelian?per_page=200"),
    enabled: diCk,
    refetchInterval: 60_000,
  });

  const kritis = (stok ?? [])
    .filter((r) => r.status !== "aman")
    .sort(
      (a, b) => (a.status === "habis" ? -1 : 1) - (b.status === "habis" ? -1 : 1) || a.saldo - b.saldo,
    );
  const jumlahKritis = kritis.length;
  const jumlahDatang = (pen?.rows ?? []).filter((r) => r.status === "menunggu").length;
  const fakturBelum = (rows: ProdRow[] | undefined) =>
    new Set((rows ?? []).filter((r) => BELUM_SELESAI.has(r.status)).map((r) => r.faktur_id)).size;
  const produksiBelum = fakturBelum(prod?.rows);
  const beliBelum = fakturBelum(beli?.rows);

  const loading = !stok || (diCk ? !prod || !beli : !pen);

  return (
    <div>
      <PageTitle>Beranda</PageTitle>
      <div className="mb-4 text-sm text-stone-500">
        {formatTanggal(hari)}
        {branch ? ` · ${branch.nama}` : ""} · Halo, {auth?.user.nama} 👋
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-lg font-semibold text-stone-700">Perlu perhatian</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {diCk ? (
                <>
                  <AttnCard
                    to="/pembelian"
                    ikon="🛒"
                    label="Beli bahan belum selesai"
                    jumlah={beliBelum}
                    satuan="faktur"
                    aktif={beliBelum > 0}
                  />
                  <AttnCard
                    to="/produksi"
                    ikon="🏭"
                    label="Produksi belum selesai"
                    jumlah={produksiBelum}
                    satuan="faktur"
                    aktif={produksiBelum > 0}
                  />
                </>
              ) : (
                <AttnCard
                  to="/penerimaan"
                  ikon="📥"
                  label="Barang datang menunggu diterima"
                  jumlah={jumlahDatang}
                  satuan="kiriman"
                  aktif={jumlahDatang > 0}
                />
              )}
              <AttnCard
                to="/stok"
                ikon="⚠️"
                label="Bahan menipis / habis"
                jumlah={jumlahKritis}
                satuan="bahan"
                aktif={jumlahKritis > 0}
              />
            </div>
          </div>

          {/* Daftar bahan menipis/habis */}
          {jumlahKritis > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-semibold text-stone-700">
                Bahan yang perlu segera diisi
              </h2>
              <Card className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className={thClass}>Bahan</th>
                      <th className={`${thClass} text-right`}>Saldo</th>
                      <th className={`${thClass} text-right`}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {kritis.slice(0, 8).map((r) => (
                      <tr key={r.ingredient_id}>
                        <td className={`${tdClass} font-medium`}>{r.nama}</td>
                        <td className={`${tdClass} text-right`}>
                          {formatAngka(r.saldo)} {r.satuan}
                        </td>
                        <td className={`${tdClass} text-right`}>
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {jumlahKritis > 8 && (
                  <div className="border-t border-stone-100 px-4 py-2 text-center text-sm">
                    <Link to="/stok/opname" className="font-medium text-orange-600 hover:underline">
                      Hitung lewat Stock Opname →
                    </Link>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
