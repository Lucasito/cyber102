"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

// Карта площадок. Два поставщика (выбор в админке):
//  • OpenStreetMap — Leaflet + плитки OSM, бесплатно, без ключа (по умолчанию);
//  • Яндекс Карты — JavaScript API v3, нужен ключ (developer.tech.yandex.ru).
// Точки — кружки цвета бренда; по нажатию — события площадки со ссылками.

export type MapPoint = { lat: number; lon: number; title: string; lines: { text: string; href?: string }[] };
export type MapConfig = { provider: "osm" | "yandex"; yandexKey?: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const popupHtml = (p: MapPoint) =>
  `<b>${esc(p.title)}</b>` + p.lines.map((l) => `<br>${l.href ? `<a href="${esc(l.href)}">${esc(l.text)}</a>` : esc(l.text)}`).join("");
const UFA = { lat: 54.7348, lon: 55.9579 };

export function VenueMap({ points, className = "h-80", me, config = { provider: "osm" } }: { points: MapPoint[]; className?: string; me?: { lat: number; lon: number } | null; config?: MapConfig }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup = () => {};
    let cancelled = false;
    const run = config.provider === "yandex" && config.yandexKey ? yandexMap : osmMap;
    void run(el, points, me ?? null, config.yandexKey ?? "").then((c) => {
      if (cancelled) c();
      else cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [points, me, config.provider, config.yandexKey]);

  return <div ref={ref} className={`relative z-0 w-full overflow-hidden rounded-3xl ring-1 ring-black/5 ${className}`} role="region" aria-label="Карта" />;
}

// ───────── OpenStreetMap (Leaflet) ─────────

async function osmMap(el: HTMLDivElement, points: MapPoint[], me: { lat: number; lon: number } | null) {
  const L = await import("leaflet");
  const map = L.map(el, { scrollWheelZoom: false });
  // Плитки OpenStreetMap (бесплатно, с указанием авторства); приглушены CSS-фильтром под спокойный дизайн
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    className: "osm-muted",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const bounds = L.latLngBounds([]);
  for (const p of points) {
    L.circleMarker([p.lat, p.lon], { radius: 9, color: "#fff", weight: 2, fillColor: "#0b7a55", fillOpacity: 1 }).addTo(map).bindPopup(popupHtml(p), { maxWidth: 260 });
    bounds.extend([p.lat, p.lon]);
  }
  if (me) {
    L.circleMarker([me.lat, me.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#1565c0", fillOpacity: 1 }).addTo(map).bindTooltip("Вы здесь");
    bounds.extend([me.lat, me.lon]);
  }
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  else map.setView([UFA.lat, UFA.lon], 11);
  return () => map.remove();
}

// ───────── Яндекс Карты (JavaScript API v3) ─────────

/* eslint-disable @typescript-eslint/no-explicit-any -- у API Яндекса нет пакета типов, используем минимально */
declare global {
  interface Window {
    ymaps3?: any;
  }
}

let ymapsLoading: Promise<any> | null = null;
function loadYmaps(key: string) {
  ymapsLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
    s.async = true;
    s.onload = () => window.ymaps3.ready.then(() => resolve(window.ymaps3), reject);
    s.onerror = () => {
      ymapsLoading = null;
      reject(new Error("Яндекс Карты не загрузились"));
    };
    document.head.appendChild(s);
  });
  return ymapsLoading;
}

function dot(color: string, size: number) {
  const d = document.createElement("div");
  d.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);transform:translate(-50%,-50%);cursor:pointer`;
  return d;
}

async function yandexMap(el: HTMLDivElement, points: MapPoint[], me: { lat: number; lon: number } | null, key: string) {
  let ymaps3: any;
  try {
    ymaps3 = await loadYmaps(key);
  } catch {
    // Ключ неверный или API недоступен — показываем OpenStreetMap, чтобы карта всё равно была
    return osmMap(el, points, me);
  }
  const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapMarker } = ymaps3;
  // В API Яндекса координаты — [долгота, широта]
  const all = [...points.map((p) => [p.lon, p.lat]), ...(me ? [[me.lon, me.lat]] : [])];
  const location = all.length
    ? (() => {
        const lons = all.map((c) => c[0]);
        const lats = all.map((c) => c[1]);
        const pad = 0.01;
        return all.length === 1
          ? { center: all[0], zoom: 15 }
          : { bounds: [[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]] };
      })()
    : { center: [UFA.lon, UFA.lat], zoom: 11 };
  const map = new YMap(el, { location, behaviors: ["drag", "pinchZoom", "dblClick"] });
  map.addChild(new YMapDefaultSchemeLayer({ theme: "light" }));
  map.addChild(new YMapDefaultFeaturesLayer({}));

  // Всплывающее окно — свой элемент поверх карты (в v3 нет готового балуна)
  const popup = document.createElement("div");
  popup.className = "ymap-popup";
  popup.style.cssText =
    "position:absolute;left:12px;right:12px;bottom:12px;z-index:10;max-width:320px;padding:10px 32px 10px 12px;background:#fff;border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,.18);font-size:13px;line-height:1.45;display:none";
  el.appendChild(popup);
  const close = () => (popup.style.display = "none");
  map.addChild(new ymaps3.YMapListener({ onClick: close }));

  for (const p of points) {
    const d = dot("#0b7a55", 18);
    d.title = p.title;
    d.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.innerHTML = `${popupHtml(p)}<button type="button" aria-label="Закрыть" style="position:absolute;top:6px;right:10px;font-size:18px;color:#78716c">×</button>`;
      popup.querySelector("button")!.addEventListener("click", close);
      popup.style.display = "block";
    });
    map.addChild(new YMapMarker({ coordinates: [p.lon, p.lat] }, d));
  }
  if (me) {
    const d = dot("#1565c0", 14);
    d.title = "Вы здесь";
    map.addChild(new YMapMarker({ coordinates: [me.lon, me.lat] }, d));
  }
  return () => {
    map.destroy();
    popup.remove();
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
