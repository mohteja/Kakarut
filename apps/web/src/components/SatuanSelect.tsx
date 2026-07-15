import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { SatuanDto } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary, inputClass } from "./ui";
import { api } from "../lib/api";

interface SatuanSelectProps {
  value: string;
  onChange: (satuan: string) => void;
  /** tampilkan opsi kosong "—" (nilai "") di paling atas — utk satuan beli */
  bolehKosong?: boolean;
  selectClassName?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Dropdown satuan dari Master Satuan + tombol "＋" untuk menambah satuan baru
 * tanpa meninggalkan form: tersimpan ke master (POST /satuan) dan langsung
 * terpilih di dropdown ini (dropdown satuan lain ikut terbarui via query
 * ["satuan"]). Satuan yang sudah ada → langsung dipilih saja.
 */
export function SatuanSelect({
  value,
  onChange,
  bolehKosong,
  selectClassName,
  disabled,
  "aria-label": ariaLabel,
}: SatuanSelectProps) {
  const queryClient = useQueryClient();
  const { data: satuanList } = useQuery({
    queryKey: ["satuan"],
    queryFn: () => api<SatuanDto[]>("/satuan"),
  });
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState("");

  const selesai = (satuan: string) => {
    queryClient.invalidateQueries({ queryKey: ["satuan"] });
    onChange(satuan);
    setOpen(false);
    setNama("");
  };
  const tambah = useMutation({
    mutationFn: (n: string) => api<SatuanDto>("/satuan", { method: "POST", body: { nama: n } }),
    onSuccess: (s) => selesai(s.nama),
    onError: (e, n) => {
      // sudah ada di master → cukup pilih (bukan kesalahan bagi pengguna)
      if (e instanceof Error && /sudah ada/i.test(e.message)) selesai(n);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = nama.trim();
    if (n) tambah.mutate(n);
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClassName ?? inputClass}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {bolehKosong && <option value="">—</option>}
        {!satuanList?.some((s) => s.nama === value) && value && (
          <option value={value}>{value}</option>
        )}
        {(satuanList ?? []).map((s) => (
          <option key={s.id} value={s.nama}>
            {s.nama}
          </option>
        ))}
      </select>
      {!disabled && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Tambah satuan baru (tersimpan ke Master Satuan)"
          aria-label="Tambah satuan baru"
          className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg border border-stone-300 text-sm font-bold text-stone-400 hover:border-orange-500 hover:text-orange-600"
        >
          ＋
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Tambah Satuan" lebar="max-w-sm">
        <form onSubmit={onSubmit} className="space-y-3">
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-stone-600">
            Satuan baru tersimpan ke <b>Master Satuan</b> dan langsung bisa dipakai di semua
            dropdown satuan.
          </p>
          <input
            autoFocus
            required
            maxLength={20}
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            placeholder="mis. dus, pack, botol, kg"
            className={inputClass}
            aria-label="Nama satuan baru"
          />
          {!(tambah.error instanceof Error && /sudah ada/i.test(tambah.error.message)) && (
            <ErrorText error={tambah.error} />
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
              Batal
            </button>
            <button type="submit" disabled={tambah.isPending} className={btnPrimary}>
              {tambah.isPending ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
