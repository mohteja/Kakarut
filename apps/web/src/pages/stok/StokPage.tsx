import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ExpLotRow, MenuDto, MenuStokDto, PenyimpananDto, StokRowDto } from "@kakarut/shared";
import {
  Card,
  PageTitle,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { CabangDataBar } from "../../components/CabangDataBar";
import { CatatWasteModal } from "./CatatWasteModal";
import { StokPerlengkapanTab } from "./StokPerlengkapanTab";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import {
  formatAngka,
  formatRupiah,
  labelTahapPembelian,
  labelTahapProduksi,
} from "../../lib/format";

export function StokPage() {
  const { auth } = useAuth();
  // Stok bersifat fisik per cabang — dari Kantor pilih cabang datanya.
  const { id: dataId, query: branchQuery } = useCabangData();
  const { cabang } = useBranch();
  // Jenis lokasi data terpilih menentukan stok apa yang relevan:
  //  - store          → simpan bahan + jual menu (Stok Bahan + Stok Menu)
  //  - central_kitchen → produksi bahan, TIDAK jual menu (Stok Bahan saja)
  //  - kantor          → kantor tak menyimpan stok fisik (tak ada keduanya)
  const selTipe = cabang.find((b) => b.id === dataId)?.tipe;
  const isKantorData = selTipe === "kantor";
  const bolehStokMenu = selTipe !== "central_kitchen" && selTipe !== "kantor";
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  // Dua tampilan: stok BAHAN (baris per bahan baku) & stok MENU (sisa porsi
  // per menu, diturunkan dari saldo bahan — selalu berkorelasi otomatis).
  const [tab, setTab] = useState<"bahan" | "menu" | "perlengkapan">("bahan");
  // Pindah ke tab bahan bila Stok Menu tak relevan (CK/kantor) supaya tak
  // menampilkan tab kosong saat lokasi data berganti.
  useEffect(() => {
    if (tab === "menu" && !bolehStokMenu) setTab("bahan");
  }, [tab, bolehStokMenu]);

  const { data: stok, isLoading } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  // Sisa porsi per menu — query key sama dengan kasir agar cache berbagi.
  const { data: ketersediaan = [] } = useQuery({
    queryKey: ["menu-ketersediaan", branchQuery],
    queryFn: () => api<MenuStokDto[]>(`/menu/ketersediaan${branchQuery}`),
    enabled: tab === "menu",
  });
  const { data: menus = [] } = useQuery({
    queryKey: ["menu", branchQuery],
    queryFn: () => api<MenuDto[]>(`/menu${branchQuery}`),
    enabled: tab === "menu",
  });
  const { data: tempatList = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  // PERINGATAN EXP: lot hampir/lewat tanggal kedaluwarsa (7 hari ke depan)
  const { data: expLots = [] } = useQuery({
    queryKey: ["stok-exp", branchQuery],
    queryFn: () =>
      api<ExpLotRow[]>(`/stok/exp${branchQuery ? `${branchQuery}&hari=7` : "?hari=7"}`),
    enabled: !isKantorData,
  });
  const [bukaExp, setBukaExp] = useState(false);
  const [wasteLot, setWasteLot] = useState<ExpLotRow | null>(null);
  // sisa hari exp TERDEKAT per bahan → badge per baris tabel
  const expByIng = new Map<string, number>();
  for (const l of expLots) {
    const ada = expByIng.get(l.ingredient_id);
    if (ada == null || l.sisa_hari < ada) expByIng.set(l.ingredient_id, l.sisa_hari);
  }
  const adaLewat = expLots.some((l) => l.sisa_hari < 0);

  const [cari, setCari] = useState("");
  const [filterTempat, setFilterTempat] = useState<string>("semua");

  const tampil = (stok ?? [])
    .filter((s) => s.nama.toLowerCase().includes(cari.toLowerCase()))
    .filter((s) =>
      filterTempat === "semua"
        ? true
        : filterTempat === "tanpa"
          ? s.tempat_id === null
          : s.tempat_id === filterTempat,
    );

  // Stok Menu: gabungkan katalog menu aktif dengan sisa porsi + bahan pembatas
  const porsiByMenu = new Map(ketersediaan.map((k) => [k.menu_id, k]));
  const menuTampil = menus
    .filter(
      (m) =>
        m.nama.toLowerCase().includes(cari.toLowerCase()) ||
        (m.kode?.toLowerCase().includes(cari.toLowerCase()) ?? false),
    )
    .map((m) => ({ menu: m, stok: porsiByMenu.get(m.id) }))
    .sort((a, b) => {
      const pa = a.stok?.porsi ?? Number.POSITIVE_INFINITY;
      const pb = b.stok?.porsi ?? Number.POSITIVE_INFINITY;
      return pa - pb; // porsi paling sedikit di atas (paling butuh perhatian)
    });

  return (
    <div>
      <CabangDataBar />
      <PageTitle
        aksi={
          !isKantorData && tab !== "menu" ? (
            <div className="flex flex-wrap gap-2">
              {/* ACC/Tolak selisih kini per produk di dalam Riwayat Stock Opname. */}
              {tab === "bahan" && (
                <Link to="/stok/opname/riwayat" className={btnSecondary}>
                  🕑 Riwayat
                </Link>
              )}
              {/* Stok Awal = saldo pembuka stok yang sudah ada (onboarding) */}
              {tab === "bahan" && isManajemen && (
                <Link to="/stok/awal" className={btnSecondary}>
                  📦 Stok Awal
                </Link>
              )}
              {/* DUA jalur opname terpisah — bahan baku vs perlengkapan; keduanya
                  dilakukan staf cabang & CK dari halaman Stok ini */}
              <Link
                to="/stok/opname"
                className={tab === "bahan" ? btnPrimary : btnSecondary}
              >
                📋 Opname Bahan Baku
              </Link>
              <Link
                to="/stok/opname-perlengkapan"
                className={tab === "perlengkapan" ? btnPrimary : btnSecondary}
              >
                🧰 Opname Perlengkapan
              </Link>
            </div>
          ) : undefined
        }
      >
        {isKantorData
          ? "Stok"
          : tab === "bahan"
            ? "Stok Bahan"
            : tab === "perlengkapan"
              ? "Stok Perlengkapan"
              : "Stok Menu"}
      </PageTitle>

      {/* Kantor tak menyimpan stok fisik — arahkan ke lokasi yang menyimpan */}
      {isKantorData && (
        <Card className="p-6 text-center text-sm text-stone-500">
          🏢 <b>Kantor</b> tidak menyimpan stok. Pilih cabang <b>store</b> (menyimpan bahan &
          menjual menu) atau <b>Central Kitchen</b> (menyimpan bahan produksi) di pemilih
          <b> "Dari Kantor — data cabang"</b> di atas.
        </Card>
      )}

      {/* Tab: stok per bahan baku vs sisa porsi per menu. Stok Menu hanya untuk
          store (menu dijual di store; CK memproduksi bahan, tak menjual menu). */}
      {!isKantorData && (
        <div className="mb-3 flex overflow-hidden rounded-lg border border-stone-300 text-sm w-fit">
          <button
            type="button"
            onClick={() => setTab("bahan")}
            className={`px-3 py-1.5 font-medium ${
              tab === "bahan" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            🥩 Stok Bahan
          </button>
          {bolehStokMenu && (
            <button
              type="button"
              onClick={() => setTab("menu")}
              className={`px-3 py-1.5 font-medium ${
                tab === "menu" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              🍜 Stok Menu
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab("perlengkapan")}
            className={`px-3 py-1.5 font-medium ${
              tab === "perlengkapan" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            🧰 Perlengkapan
          </button>
        </div>
      )}

      {isKantorData ? null : tab === "menu" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari menu / kode…"
              className={`${inputClass} max-w-56`}
            />
            <span className="text-xs text-stone-400">
              Sisa porsi dihitung otomatis dari saldo stok bahan (resep per porsi).
            </span>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={thClass}>Kode</th>
                  <th className={thClass}>Menu</th>
                  <th className={thClass}>Kategori</th>
                  <th className={`${thClass} text-right`}>Harga</th>
                  <th className={`${thClass} text-right`}>Sisa Porsi</th>
                  <th className={thClass}>Bahan Pembatas</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {menuTampil.map(({ menu: m, stok: st }) => {
                  const porsi = st?.porsi ?? null;
                  const status =
                    porsi == null ? null : porsi <= 0 ? "habis" : porsi <= 5 ? "menipis" : "aman";
                  return (
                    <tr key={m.id} className="hover:bg-stone-50">
                      <td className={tdClass}>
                        {m.kode ? (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-700">
                            {m.kode}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${tdClass} font-medium`}>{m.nama}</td>
                      <td className={`${tdClass} text-stone-500`}>{m.kategori}</td>
                      <td className={`${tdClass} text-right`}>{formatRupiah(m.harga_jual)}</td>
                      <td className={`${tdClass} text-right text-lg font-bold`}>
                        {porsi == null ? "∞" : formatAngka(porsi)}
                      </td>
                      <td className={`${tdClass} text-stone-600`}>
                        {st?.pembatas ? (
                          <span title={`${formatAngka(st.pembatas.qty_per_porsi)} ${st.pembatas.satuan}/porsi`}>
                            {st.pembatas.nama}
                            <span className="ml-1 text-xs text-stone-400">
                              (sisa {formatAngka(st.pembatas.saldo)} {st.pembatas.satuan})
                            </span>
                          </span>
                        ) : (
                          <span className="text-stone-400">tidak dibatasi bahan</span>
                        )}
                      </td>
                      <td className={tdClass}>
                        {status ? (
                          <StatusBadge status={status} />
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
                            tak terbatas
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {menuTampil.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`${tdClass} py-8 text-center text-stone-400`}>
                      {cari ? `Menu "${cari}" tidak ditemukan.` : "Belum ada menu aktif."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      ) : tab === "perlengkapan" ? (
        <StokPerlengkapanTab
          branchQuery={branchQuery}
          dataId={dataId}
          isManajemen={isManajemen}
          cari={cari}
          setCari={setCari}
        />
      ) : isLoading ? (
        <Spinner />
      ) : (
        <>
      {/* PERINGATAN EXP: lot hampir/lewat kedaluwarsa → daftar + Catat waste.
          Aproksimasi: qty = saat lot masuk (ledger agregat, bukan sisa lot). */}
      {expLots.length > 0 && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            adaLewat ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <button
            type="button"
            onClick={() => setBukaExp((v) => !v)}
            className={`flex w-full items-center justify-between font-semibold ${
              adaLewat ? "text-red-800" : "text-amber-800"
            }`}
          >
            <span>
              ⏳ {expLots.length} lot bahan {adaLewat ? "lewat/hampir" : "hampir"} kedaluwarsa
              (≤ 7 hari)
            </span>
            <span>{bukaExp ? "▴" : "▾"}</span>
          </button>
          {bukaExp && (
            <div className="mt-2 space-y-1.5">
              {expLots.map((l) => (
                <div
                  key={l.production_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5"
                >
                  <div className="min-w-0 text-xs text-stone-700">
                    <b>{l.nama}</b> · masuk {formatAngka(l.qty_masuk)} {l.satuan}
                    {l.nomor && <> · {l.nomor}</>}
                    {l.tempat && <> · 🗄 {l.tempat}</>}
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        l.sisa_hari < 0
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {l.sisa_hari < 0
                        ? `❌ lewat ${-l.sisa_hari} hr (exp ${l.exp_date})`
                        : l.sisa_hari === 0
                          ? "⚠ exp HARI INI"
                          : `⚠ exp ${l.sisa_hari} hr lagi (${l.exp_date})`}
                    </span>
                    <div className="text-[10px] text-stone-400">
                      qty saat masuk — saldo bahan kini {formatAngka(l.saldo)} {l.satuan}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWasteLot(l)}
                    disabled={l.saldo <= 0}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                    title={
                      l.saldo <= 0
                        ? "Saldo bahan sudah 0 — tidak ada yang bisa di-waste"
                        : "Catat waste (masuk alur ACC Riwayat SO)"
                    }
                  >
                    🗑 Catat waste
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan…"
          className={`${inputClass} max-w-56`}
        />
        <select
          value={filterTempat}
          onChange={(e) => setFilterTempat(e.target.value)}
          className={`${inputClass} max-w-56`}
          aria-label="Filter tempat penyimpanan"
        >
          <option value="semua">Semua tempat penyimpanan</option>
          {tempatList.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nama}
            </option>
          ))}
          <option value="tanpa">Tanpa tempat</option>
        </select>
        {filterTempat !== "semua" && (
          <button
            onClick={() => setFilterTempat("semua")}
            className="text-sm font-medium text-orange-600 hover:underline"
          >
            Reset filter
          </button>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Bahan</th>
              <th className={thClass}>Tempat</th>
              <th className={`${thClass} text-right`}>Stok Awal</th>
              <th className={`${thClass} text-right`} title="Produksi + pembelian setelah opname terakhir">
                Masuk
              </th>
              <th className={`${thClass} text-right`}>Terpakai</th>
              <th className={`${thClass} text-right`}>Saldo</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {tampil.map((s) => (
              <tr key={s.ingredient_id} className="hover:bg-stone-50">
                <td className={`${tdClass} font-medium`}>
                  {s.nama}
                  {s.produksi_berjalan && (
                    <span
                      className="ml-2 whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800"
                      title={`Direncanakan ${formatAngka(s.produksi_berjalan.rencana)} · Dikerjakan ${formatAngka(s.produksi_berjalan.dikerjakan)} · Menunggu konfirmasi ${formatAngka(s.produksi_berjalan.menunggu)}`}
                    >
                      🏭 +{formatAngka(s.produksi_berjalan.qty)} ·{" "}
                      {labelTahapProduksi(s.produksi_berjalan)}
                    </span>
                  )}
                  {s.pembelian_berjalan && (
                    <span
                      className="ml-2 whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
                      title={`RAB ${formatAngka(s.pembelian_berjalan.rencana)} · Diproses ${formatAngka(s.pembelian_berjalan.dikerjakan)} · Dikirim ${formatAngka(s.pembelian_berjalan.menunggu)}`}
                    >
                      🛒 +{formatAngka(s.pembelian_berjalan.qty)} ·{" "}
                      {labelTahapPembelian(s.pembelian_berjalan)}
                    </span>
                  )}
                  {expByIng.has(s.ingredient_id) && (
                    <span
                      className={`ml-2 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                        expByIng.get(s.ingredient_id)! < 0
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                      title="Ada lot bahan ini yang hampir/lewat tanggal kedaluwarsa — lihat peringatan di atas"
                    >
                      {expByIng.get(s.ingredient_id)! < 0
                        ? "⏳ lewat exp"
                        : `⏳ exp ${expByIng.get(s.ingredient_id)} hr`}
                    </span>
                  )}
                </td>
                <td className={`${tdClass} text-stone-500`}>{s.tempat ?? "—"}</td>
                <td className={`${tdClass} text-right`}>{formatAngka(s.stok_awal)}</td>
                <td className={`${tdClass} text-right text-green-700`}>
                  {s.produksi > 0 ? `+${formatAngka(s.produksi)}` : "—"}
                </td>
                <td className={`${tdClass} text-right text-red-600`}>
                  {s.terpakai > 0 ? `−${formatAngka(s.terpakai)}` : "—"}
                </td>
                <td className={`${tdClass} text-right font-bold`}>{formatAngka(s.saldo)}</td>
                <td className={tdClass}>
                  <StatusBadge status={s.status} />
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <a
                    href={`/stok/kartu/${s.ingredient_id}${branchQuery}`}
                    target="_blank"
                    rel="noopener"
                    className="text-sm font-medium text-orange-600 hover:underline"
                    title="Buka kartu stok di tab baru"
                  >
                    📄 Kartu
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
        </>
      )}

      {wasteLot && (
        <CatatWasteModal lot={wasteLot} branchId={dataId} onClose={() => setWasteLot(null)} />
      )}
    </div>
  );
}
