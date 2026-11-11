import { useEffect, useState } from "react";

/**
 * SUARA ALARM TENGGAT PESANAN — permintaan pemilik (2026-11-11): pesanan yang
 * lewat 10 menit berkedip merah DAN berbunyi sampai diselesaikan.
 *
 * Bunyinya disintesis Web Audio (dua nada pendek), bukan berkas suara: tak ada
 * aset yang harus dimuat, dan tetap bekerja di jaringan toko yang lambat.
 *
 * PERAMBAN MELARANG SUARA SEBELUM ADA KETUKAN. `AudioContext` lahir dalam
 * keadaan `suspended` sampai pemakai berinteraksi dengan halaman — jadi papan
 * yang dibuka lalu dibiarkan tak akan pernah berbunyi. Karena itu:
 *   - SUARANYA SELALU AKTIF dan tak bisa dimatikan (permintaan pemilik
 *     2026-11-11, "buat selalu on jangan bisa di off");
 *   - ketukan PERTAMA di mana pun di halaman membuka kunci peramban;
 *   - selama kuncinya belum terbuka, papan MENGATAKANNYA (`terkunci`), bukan
 *     diam — alarm yang tak berbunyi tanpa penjelasan lebih buruk daripada
 *     tak ada alarm.
 */
/** Jeda antar-bunyi selama masih ada pesanan terlambat. */
const JEDA_BUNYI_MS = 3000;

let konteks: AudioContext | null = null;
function ambilKonteks(): AudioContext | null {
  if (konteks) return konteks;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    konteks = Ctor ? new Ctor() : null;
  } catch {
    konteks = null;
  }
  return konteks;
}

/** Dua nada tinggi pendek — cukup tajam untuk terdengar di dapur. */
export function bunyikanAlarm(): void {
  const ctx = ambilKonteks();
  if (!ctx || ctx.state !== "running") return;
  const mulai = ctx.currentTime;
  for (const [i, frek] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = frek;
    const t = mulai + i * 0.22;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

/**
 * Loop bunyi alarm — SELALU aktif. `berbunyi` = ada pesanan terlambat.
 * Mengembalikan `terkunci` (peramban belum mengizinkan suara) dan `bukaKunci`
 * untuk tombol "aktifkan suara" — tombol itu hanya MEMBUKA kunci peramban,
 * tak bisa mematikan alarm.
 */
export function useAlarmPesanan(berbunyi: boolean) {
  const [terkunci, setTerkunci] = useState(() => ambilKonteks()?.state !== "running");

  // Ketukan pertama di mana pun membuka kunci suara (aturan autoplay).
  useEffect(() => {
    if (!terkunci) return;
    const buka = () => {
      const ctx = ambilKonteks();
      if (!ctx) return;
      void ctx.resume().then(() => setTerkunci(ctx.state !== "running"));
    };
    window.addEventListener("pointerdown", buka);
    window.addEventListener("keydown", buka);
    return () => {
      window.removeEventListener("pointerdown", buka);
      window.removeEventListener("keydown", buka);
    };
  }, [terkunci]);

  useEffect(() => {
    if (!berbunyi || terkunci) return;
    bunyikanAlarm();
    const t = setInterval(bunyikanAlarm, JEDA_BUNYI_MS);
    return () => clearInterval(t);
  }, [berbunyi, terkunci]);

  function bukaKunci() {
    const ctx = ambilKonteks();
    if (!ctx) return;
    void ctx.resume().then(() => {
      setTerkunci(ctx.state !== "running");
      bunyikanAlarm(); // contoh bunyi: orang tahu volumenya
    });
  }

  return { terkunci, bukaKunci };
}
