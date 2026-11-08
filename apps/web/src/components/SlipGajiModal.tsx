import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { lolosHtml, type GajiRincian, type GajiSlipDetailDto } from "@kakarut/shared";
import { api } from "../lib/api";
import { formatRupiah, formatTanggal } from "../lib/format";
import { unduhPdf } from "../lib/pdf";
import { ErrorText, Modal, SpinnerAtauGalat, btnPrimary } from "./ui";

/**
 * SLIP GAJI — satu tampilan untuk dua pintu:
 *   - `gaji`   : HRD/owner membuka slip siapa pun (`GET /gaji/slip/:id`)
 *   - `profil` : karyawan membuka slipnya sendiri (`GET /profil/slip-gaji/:id`)
 * Angka dibaca dari `rincian` yang tersimpan di server — layar tak menghitung.
 */
export function SlipGajiModal({
  sumber,
  slipId,
  onClose,
}: {
  sumber: "gaji" | "profil";
  slipId: string | null;
  onClose: () => void;
}) {
  const { data, error, refetch } = useQuery({
    queryKey: ["slip-gaji", sumber, slipId],
    queryFn: () =>
      api<GajiSlipDetailDto>(sumber === "gaji" ? `/gaji/slip/${slipId}` : `/profil/slip-gaji/${slipId}`),
    enabled: !!slipId,
  });
  const [galatPdf, setGalatPdf] = useState<unknown>(null);
  const [memuatPdf, setMemuatPdf] = useState(false);

  async function pdf() {
    if (!data) return;
    setGalatPdf(null);
    setMemuatPdf(true);
    try {
      await unduhPdf({
        bodyHtml: htmlSlip(data),
        css: CSS_SLIP,
        namaBerkas: `slip-gaji-${data.slip.nama.replace(/\s+/g, "-")}-${data.periode.mulai}`,
      });
    } catch (e) {
      setGalatPdf(e);
    } finally {
      setMemuatPdf(false);
    }
  }

  return (
    <Modal open={!!slipId} onClose={onClose} title="Slip Gaji" lebar="max-w-xl">
      {!data ? (
        <SpinnerAtauGalat error={error} apa="Slip gaji" onCoba={() => refetch()} />
      ) : (
        <div data-testid="slip-gaji">
          <div className="mb-3 text-sm text-stone-600">
            <div className="text-base font-bold text-stone-800">{data.slip.nama}</div>
            <div>
              {data.perusahaan} · Periode {formatTanggal(data.periode.mulai)} – {formatTanggal(data.periode.selesai)}
            </div>
          </div>
          <TabelRincian r={data.rincian} />
          {data.slip.catatan && (
            <p className="mt-2 text-sm italic text-stone-600">Catatan: {data.slip.catatan}</p>
          )}
          <HariBermasalah r={data.rincian} />
          <ErrorText error={galatPdf} />
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={pdf} disabled={memuatPdf} className={btnPrimary}>
              {memuatPdf ? "Menyiapkan…" : "⬇ Unduh PDF"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Baris pendapatan & potongan — dipakai layar DAN PDF (lewat `barisSlip`). */
function barisSlip(r: GajiRincian): { label: string; nilai: number; minus?: boolean; tebal?: boolean }[] {
  const keterangan =
    r.dasar === "bulanan"
      ? r.hari_aktif < r.hari_periode
        ? `Gaji pokok (prorata ${r.hari_aktif}/${r.hari_periode} hari)`
        : "Gaji pokok"
      : `Upah harian × ${r.hadir + r.cuti_dibayar} hari`;
  const baris: { label: string; nilai: number; minus?: boolean; tebal?: boolean }[] = [
    { label: keterangan, nilai: r.gaji_pokok },
    ...r.tunjangan.map((t) => ({ label: `Tunjangan ${t.nama}`, nilai: t.nominal })),
  ];
  if (r.upah_lembur > 0) baris.push({ label: `Lembur ${jamMenit(r.lembur_menit)}`, nilai: r.upah_lembur });
  if (r.bonus > 0) baris.push({ label: "Bonus", nilai: r.bonus });
  if (r.penyesuaian !== 0) baris.push({ label: "Penyesuaian", nilai: Math.abs(r.penyesuaian), minus: r.penyesuaian < 0 });
  if (r.potongan_alpa > 0) baris.push({ label: `Potongan alpa ${r.alpa} hari`, nilai: r.potongan_alpa, minus: true });
  if (r.potongan_cuti_tak_dibayar > 0)
    baris.push({ label: `Cuti tak dibayar ${r.cuti_tak_dibayar} hari`, nilai: r.potongan_cuti_tak_dibayar, minus: true });
  if (r.potongan_telat > 0) baris.push({ label: `Potongan telat ${r.telat_kali}×`, nilai: r.potongan_telat, minus: true });
  if (r.potongan_kasbon > 0) baris.push({ label: "Cicilan kasbon", nilai: r.potongan_kasbon, minus: true });
  baris.push({ label: "Gaji diterima", nilai: r.total, tebal: true });
  return baris;
}

function jamMenit(menit: number): string {
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  return m ? `${j} jam ${m} mnt` : `${j} jam`;
}

function TabelRincian({ r }: { r: GajiRincian }) {
  return (
    <div>
      <div className="mb-2 grid grid-cols-4 gap-2 text-center text-xs">
        {[
          ["Hadir", r.hadir],
          ["Alpa", r.alpa],
          ["Cuti", r.cuti_dibayar + r.cuti_tak_dibayar],
          ["Telat", r.telat_kali],
        ].map(([l, n]) => (
          <div key={l} className="rounded-lg bg-stone-50 py-1.5">
            <div className="text-stone-500">{l}</div>
            <div className="text-base font-bold text-stone-800">{n}</div>
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {barisSlip(r).map((b) => (
            <tr key={b.label} className={b.tebal ? "border-t border-stone-300 font-bold" : ""}>
              <td className="py-1 text-stone-700">{b.label}</td>
              <td className={`py-1 text-right ${b.minus ? "text-red-600" : "text-stone-800"}`}>
                {b.minus ? "− " : ""}
                {formatRupiah(b.nilai)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.kurang > 0 && (
        <p className="mt-1 text-xs text-amber-700">
          Potongan melebihi gaji — {formatRupiah(r.kurang)} tidak terpotong periode ini.
        </p>
      )}
    </div>
  );
}

/** Hari yang perlu diperhatikan: alpa, telat, lupa absen pulang. */
function HariBermasalah({ r }: { r: GajiRincian }) {
  const hari = r.harian.filter((h) => h.status === "alpa" || h.telat_menit > 0 || h.lupa_pulang);
  if (hari.length === 0) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-stone-600">Rincian hari ({hari.length})</summary>
      <ul className="mt-1 space-y-0.5 text-stone-600">
        {hari.map((h) => (
          <li key={h.tanggal}>
            {formatTanggal(h.tanggal)} —{" "}
            {h.status === "alpa"
              ? "alpa"
              : [h.telat_menit > 0 ? `telat ${h.telat_menit} mnt` : null, h.lupa_pulang ? "lupa absen pulang" : null]
                  .filter(Boolean)
                  .join(", ")}
          </li>
        ))}
      </ul>
    </details>
  );
}

const CSS_SLIP = `
.dok{font-family:Arial,sans-serif;color:#1c1917;padding:24px;font-size:13px}
.dok h1{font-size:18px;margin:0 0 2px}
.dok .sub{color:#57534e;margin-bottom:14px}
.dok table{width:100%;border-collapse:collapse}
.dok td{padding:5px 0;border-bottom:1px solid #e7e5e4}
.dok td.n{text-align:right}
.dok tr.total td{font-weight:bold;border-top:2px solid #1c1917;border-bottom:none}
.dok .minus{color:#b91c1c}
.dok .kecil{color:#78716c;font-size:11px;margin-top:16px}
`;

function htmlSlip(d: GajiSlipDetailDto): string {
  const r = d.rincian;
  const baris = barisSlip(r)
    .map(
      (b) =>
        `<tr class="${b.tebal ? "total" : ""}"><td>${lolosHtml(b.label)}</td><td class="n ${b.minus ? "minus" : ""}">${b.minus ? "− " : ""}${lolosHtml(formatRupiah(b.nilai))}</td></tr>`,
    )
    .join("");
  return `<div class="dok">
<h1>Slip Gaji — ${lolosHtml(d.perusahaan)}</h1>
<div class="sub">${lolosHtml(d.slip.nama)}${d.slip.employee_code ? ` (${lolosHtml(d.slip.employee_code)})` : ""} · Periode ${lolosHtml(formatTanggal(d.periode.mulai))} – ${lolosHtml(formatTanggal(d.periode.selesai))}</div>
<div class="sub">Hadir ${lolosHtml(String(r.hadir))} · Alpa ${lolosHtml(String(r.alpa))} · Cuti ${lolosHtml(String(r.cuti_dibayar + r.cuti_tak_dibayar))} · Telat ${lolosHtml(String(r.telat_kali))}× · Lembur ${lolosHtml(jamMenit(r.lembur_menit))}</div>
<table>${baris}</table>
${d.slip.catatan ? `<p>Catatan: ${lolosHtml(d.slip.catatan)}</p>` : ""}
<div class="kecil">Status periode: ${lolosHtml(d.periode.status)}</div>
</div>`;
}
