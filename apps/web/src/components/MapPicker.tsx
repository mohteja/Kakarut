import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Pemilih titik di peta (Leaflet + OpenStreetMap). Klik peta / geser pin untuk
 * memilih koordinat; lingkaran menampilkan radius. Dua arah dengan input manual
 * lat/lng lewat prop. Pin memakai divIcon (emoji) agar tak butuh berkas gambar
 * marker bawaan Leaflet (yang rusak di bundler). Ubin peta butuh internet —
 * bila terblokir, pin & koordinat tetap berfungsi (peta abu-abu saja).
 */
const PIN = L.divIcon({
  className: "kakarut-pin",
  html: '<div style="font-size:30px;line-height:1;transform:translate(-50%,-95%);filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))">📍</div>',
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

export function MapPicker({
  lat,
  lng,
  radius,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  radius: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const start: [number, number] = [lat ?? -6.2, lng ?? 106.816666];
    const map = L.map(elRef.current).setView(start, lat != null && lng != null ? 17 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    const marker = L.marker(start, { draggable: true, icon: PIN }).addTo(map);
    const circle = L.circle(start, {
      radius,
      color: "#ea580c",
      fillColor: "#ea580c",
      fillOpacity: 0.12,
      weight: 1,
    }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onChangeRef.current(p.lat, p.lng);
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;
    // Di dalam modal, kontainer bisa berukuran 0 saat init → hitung ulang.
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sinkronkan pin & lingkaran saat lat/lng/radius diubah dari luar (input
  // manual / "pakai lokasi saya"). Tidak memanggil onChange → tak ada loop.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle) return;
    if (lat != null && lng != null) {
      const pos: [number, number] = [lat, lng];
      marker.setLatLng(pos);
      circle.setLatLng(pos);
      if (!map.getBounds().contains(pos)) map.setView(pos, Math.max(map.getZoom(), 16));
    }
    circle.setRadius(radius > 0 ? radius : 1);
  }, [lat, lng, radius]);

  return <div ref={elRef} className="h-64 w-full overflow-hidden rounded-lg border border-stone-200" />;
}
