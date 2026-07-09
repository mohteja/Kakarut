import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  const [uploadError, setUploadError] = useState<unknown>(null);

  useEffect(() => {
    if (!company) return;
    setNama(company.nama);
    setAlamat(company.alamat ?? "");
    setTelepon(company.telepon ?? "");
    setLogoUrl(company.logoUrl);
    setPb1Enabled(company.pb1Enabled);
    setPb1Rate(String(company.pb1Rate));
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
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company"] }),
  });

  async function uploadLogo(file: File) {
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await api<{ url: string }>("/upload?tujuan=logo", {
        method: "POST",
        formData: fd,
      });
      setLogoUrl(url);
    } catch (e) {
      setUploadError(e);
    }
  }

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
          <div className="flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-lg object-cover" />}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadLogo(f);
              }}
              className="text-sm"
            />
          </div>
          <ErrorText error={uploadError} />
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
