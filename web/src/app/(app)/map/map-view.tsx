"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = { lat: number; lng: number; label: string; total: number; won: number; lost: number; open: number; approx: boolean };

export function MapView({ points, tileUrl }: { points: MapPoint[]; tileUrl: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false }).setView([22.5, 79], 4.6);
      L.tileLayer(tileUrl, { maxZoom: 12, attribution: "© OpenStreetMap contributors" }).addTo(map);
      const top = Math.max(1, ...points.map((p) => p.total));
      const cyan = getComputedStyle(document.documentElement).getPropertyValue("--cyan-dk").trim() || "#0b86ac";
      for (const p of points) {
        const r = 4 + Math.sqrt(p.total / top) * 18;
        L.circleMarker([p.lat, p.lng], {
          radius: r, color: cyan, weight: 2, fillColor: cyan, fillOpacity: p.approx ? 0 : 0.35,
        })
          .bindTooltip(`<b>${escapeHtml(p.label)}</b><br>${p.total} enquiries · ${p.open} open · ${p.won} won · ${p.lost} lost`)
          .addTo(map);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points, tileUrl]);
  return <div ref={el} className="h-[520px] w-full rounded-xl" role="img" aria-label={`Map of ${points.length} places with enquiries`} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
