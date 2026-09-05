"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Loads the UK postcode-area GeoJSON and projects it into a fixed SVG viewBox.
 * Shared by the interactive UKMap and the static product-page visual so the
 * projection maths lives in exactly one place.
 */

export const MAP_W = 760;
export const MAP_H = 920;

export interface GeoFeature {
  properties: { area: string };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface AreaPath {
  area: string; // postcode area, uppercase
  d: string;
}

// One in-flight/settled load per page, however many maps mount.
let geoPromise: Promise<GeoFeature[]> | null = null;
function loadGeo(): Promise<GeoFeature[]> {
  if (!geoPromise) {
    geoPromise = fetch("/data/uk-postcode-areas.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => d.features as GeoFeature[])
      .catch((err) => {
        geoPromise = null; // allow a retry on the next mount
        throw err;
      });
  }
  return geoPromise;
}

export function useUkGeo(): { features: GeoFeature[] | null; paths: AreaPath[]; failed: boolean } {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGeo()
      .then((f) => alive && setFeatures(f))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const project = useMemo(() => {
    if (!features) return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of features)
      for (const poly of f.geometry.coordinates)
        for (const ring of poly)
          for (const [lng, lat] of ring) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
    const latMid = (minLat + maxLat) / 2;
    const cos = Math.cos((latMid * Math.PI) / 180);
    const spanX = (maxLng - minLng) * cos;
    const spanY = maxLat - minLat;
    const pad = 16;
    const k = Math.min((MAP_W - 2 * pad) / spanX, (MAP_H - 2 * pad) / spanY);
    const offX = (MAP_W - spanX * k) / 2;
    const offY = (MAP_H - spanY * k) / 2;
    return (lng: number, lat: number): [number, number] => [
      offX + (lng - minLng) * cos * k,
      offY + (maxLat - lat) * k,
    ];
  }, [features]);

  const paths = useMemo<AreaPath[]>(() => {
    if (!features || !project) return [];
    return features.map((f) => {
      let d = "";
      for (const poly of f.geometry.coordinates)
        for (const ring of poly) {
          ring.forEach(([lng, lat], i) => {
            const [x, y] = project(lng, lat);
            d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
          });
          d += "Z";
        }
      return { area: f.properties.area.toUpperCase(), d };
    });
  }, [features, project]);

  return { features, paths, failed };
}
