import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ImageUpload } from "../../components/ImageUpload";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  inputClass,
} from "../../components/ui";
import { api } from "../../lib/api";

interface Company {
  id: string;
  nama: string;
  alamat: string | null;
  telepon: string | null;
  logoUrl: string | null;
  pb1Enabled: boolean;
  pb1Rate: number;
  plan: string;
  receiptFooter: string | null;
  receiptShowAlamat: boolean;
}

export function PerusahaanPage() {
  const queryClient = useQueryClient();
  const { data: company, isLoading } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<Company>("/company"),
  });

  const [nama, setNama] = useState("");
  const [alamat, setAlamat] = useState("");
  const [telepon, setTelepon] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pb1Enabled, setPb1Enabled] = useState(false);
  const [pb1Rate, setPb1Rate] = useState("10");
  const [receiptFooter, setReceiptFooter] = useState("");
  const [receiptShowAlamat, setReceiptShowAlamat] = useState(true);

  useEffect(() => {
    if (!company) return;
    setNama(company.nama);
    setAlamat(company.alamat ?? "");
    setTelepon(company.telepon ?? "");
    setLogoUrl(company.logoUrl);
    setPb1Enabled(company.pb1Enabled);
    setPb1Rate(String(company.pb1Rate));
    setReceiptFooter(company.receiptFooter ?? "");
    setReceiptShowAlamat(company.receiptShowAlamat);
  }, [company]);

  const simpan = useMutation({
    mutationFn: () =>
      api("/company", {
        method: "PATCH",
        body: {
          nama,
          alamat: alamat || null,
          telepon: telepon || null,
          logo_url: logoUrl,
          pb1_enabled: pb1Enabled,
          pb1_rate: Number(pb1Rate),
          receipt_footer: receiptFooter || null,
          receipt_show_alamat: receiptShowAlamat,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company"] });
      queryClient.invalidateQueries({ queryKey: ["me"] }); // PB1 dipakai kasir
    },
  });

  if (isLoading || !company) return <Spinner />;

  return (
    <div className="max-w-2xl">
      <PageTitle>Pengaturan Perusahaan</PageTitle>
      <Card className="space-y-4 p-5">
        <div className="text-sm text-stone-500">
          Paket langganan: <span className="font-semibold uppercase">{company.plan}</span>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Nama perusahaan</label>
          <input value={nama} onChange={(e) => setNama(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Alamat</label>
          <input value={alamat} onChange={(e) => setAlamat(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Telepon</label>
          <input value={telepon} onChange={(e) => setTelepon(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Logo</label>
          <ImageUpload value={logoUrl} onChange={setLogoUrl} tujuan="logo" placeholder="🏪" />
        </div>
        <div className="rounded-lg border border-stone-200 p-3">
          <div className="mb-2 text-sm font-semibold text-stone-700">Struk</div>
          <label className="mb-1 block text-sm font-medium">Teks footer struk</label>
          <input
            value={receiptFooter}
            onChange={(e) => setReceiptFooter(e.target.value)}
            maxLength={200}
            placeholder="mis. Terima kasih! Ikuti IG @basooopa"
            className={inputClass}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={receiptShowAlamat}
              onChange={(e) => setReceiptShowAlamat(e.target.checked)}
            />
            Tampilkan alamat &amp; telepon di struk
          </label>
        </div>
        <div className="rounded-lg border border-stone-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={pb1Enabled}
              onChange={(e) => setPb1Enabled(e.target.checked)}
            />
            Aktifkan PB1 (pajak restoran) pada transaksi
          </label>
          {pb1Enabled && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              Tarif:
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={pb1Rate}
                onChange={(e) => setPb1Rate(e.target.value)}
                className="w-20 rounded-lg border border-stone-300 px-2 py-1 text-right"
              />
              %
            </div>
          )}
        </div>
        <ErrorText error={simpan.error} />
        <button onClick={() => simpan.mutate()} disabled={simpan.isPending} className={btnPrimary}>
          {simpan.isPending ? "Menyimpan…" : "Simpan"}
        </button>
        {simpan.isSuccess && <span className="ml-3 text-sm text-green-600">Tersimpan ✓</span>}
      </Card>
    </div>
  );
}
