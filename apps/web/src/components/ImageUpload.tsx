import { useRef, useState } from "react";
import { api } from "../lib/api";
import { btnSecondary } from "./ui";

/**
 * Upload gambar dengan preview yang jelas — pengganti <input type="file">
 * bawaan browser yang membingungkan. Dipakai untuk foto menu & logo.
 *
 * `compact` menyisakan kotak pratinjaunya saja (tanpa tombol & teks bantu),
 * untuk daftar panjang yang butuh satu foto per baris — mis. checklist
 * kebersihan; pipa unggahnya tetap sama persis.
 */
export function ImageUpload({
  value,
  onChange,
  tujuan,
  placeholder = "🖼",
  compact = false,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  tujuan: "menu" | "logo" | "bukti" | "resep";
  placeholder?: string;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await api<{ url: string }>(`/upload?tujuan=${tujuan}`, {
        method: "POST",
        formData: fd,
      });
      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const berkas = (
    <input
      ref={fileRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void upload(f);
      }}
    />
  );

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-stone-300 bg-stone-50 text-lg transition hover:border-orange-400"
          title={value ? "Klik untuk ganti foto" : "Lampirkan foto"}
        >
          {uploading ? (
            <span className="text-[10px] text-stone-400">…</span>
          ) : value ? (
            <img src={value} alt="bukti" className="h-full w-full object-cover" />
          ) : (
            <span className="text-stone-300">{placeholder}</span>
          )}
        </button>
        {value && !uploading && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Hapus foto"
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white"
          >
            ×
          </button>
        )}
        {error && <div className="mt-1 text-[10px] text-red-600">{error}</div>}
        {berkas}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 text-2xl transition hover:border-orange-400"
          title={value ? "Klik untuk ganti foto" : "Klik untuk pilih foto"}
        >
          {uploading ? (
            <span className="text-xs text-stone-400">Unggah…</span>
          ) : value ? (
            <img src={value} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <span className="text-stone-300">{placeholder}</span>
          )}
        </button>
        <div className="space-y-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={btnSecondary}
            >
              {uploading ? "Mengunggah…" : value ? "🔄 Ganti Foto" : "📷 Pilih Foto"}
            </button>
            {value && !uploading && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50"
              >
                Hapus
              </button>
            )}
          </div>
          <div className="text-xs text-stone-400">JPEG/PNG/WebP, maks 5 MB</div>
        </div>
      </div>
      {error && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {berkas}
    </div>
  );
}
