"use client";

import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { count, inr } from "@/lib/format";
import type { GeoPoint } from "@/lib/types";

export interface MapData {
  /** Ordinary cash withdrawals, added up per city. */
  cities: (GeoPoint & { withdrawals: number; amount: number })[];
  /** Home branches of ring accounts. */
  homes: (GeoPoint & { account_id: string })[];
  /** Cash withdrawn by ring accounts. */
  cashouts: (GeoPoint & { txn_id: string; account_id: string; amount: number })[];
}

/** The box that frames India, used until there is something more specific to frame. */
const INDIA: [[number, number], [number, number]] = [
  [8, 68.5],
  [34, 96.5],
];
const OXBLOOD = "#5b0f1e";
const QUIET = "#5a4640";

/**
 * Where cash came out, on a map. Ordinary withdrawals are a quiet disc per
 * city; a ring's withdrawals are solid oxblood discs sized by amount, joined
 * by a line to the hollow ring that marks the account's home branch.
 *
 * Map tiles need the internet. If they do not load, the same facts are shown
 * as a table of cities, so the view still works at a venue with no connection.
 */
export function CashMap({ data, className = "" }: { data: MapData; className?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const [tiles, setTiles] = useState<"loading" | "ok" | "failed">("loading");
  const [ready, setReady] = useState(false);
  /** What the map was last framed on, so it is only re-framed when that changes. */
  const framed = useRef("india");

  useEffect(() => {
    let dead = false;
    if (!navigator.onLine) {
      queueMicrotask(() => setTiles("failed"));
      return;
    }
    void import("leaflet").then((L) => {
      if (dead || !holder.current) return;
      leaflet.current = L;
      const m = L.map(holder.current, { minZoom: 3, maxZoom: 12, zoomControl: true, zoomSnap: 0.25 }).fitBounds(INDIA);
      let loaded = 0;
      let errors = 0;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
        .on("tileload", () => {
          loaded++;
          setTiles("ok");
        })
        .on("tileerror", () => {
          // A few failures with nothing loaded means there is no connection to the tile server.
          if (++errors >= 4 && loaded === 0) setTiles("failed");
        })
        .addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    });
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    const group = layer.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    const size = (amount: number) => Math.max(5, Math.min(18, Math.sqrt(amount) / 40));

    for (const c of data.cities) {
      L.circleMarker([c.lat, c.lng], { radius: size(c.amount), color: QUIET, weight: 1, fillColor: QUIET, fillOpacity: 0.22 })
        .bindTooltip(`${c.city}: ${count(c.withdrawals)} withdrawals, ${inr(c.amount)}`)
        .addTo(group);
    }
    const homeOf = new Map(data.homes.map((h) => [h.account_id, h]));
    for (const c of data.cashouts) {
      const home = homeOf.get(c.account_id);
      if (home) L.polyline([[home.lat, home.lng], [c.lat, c.lng]], { color: OXBLOOD, weight: 2, opacity: 0.75 }).addTo(group);
    }
    for (const h of data.homes) {
      L.circleMarker([h.lat, h.lng], { radius: 7, color: OXBLOOD, weight: 3, fillColor: "#f4efe3", fillOpacity: 1 })
        .bindTooltip(`${h.account_id} home branch, ${h.city}`)
        .addTo(group);
    }
    for (const c of data.cashouts) {
      L.circleMarker([c.lat, c.lng], { radius: size(c.amount), color: "#f4efe3", weight: 2, fillColor: OXBLOOD, fillOpacity: 0.92 })
        .bindTooltip(`${c.account_id} withdrew ${inr(c.amount)} in ${c.city}`)
        .addTo(group);
    }

    // With only a ring's own points on the map, frame those; otherwise keep the whole country.
    const ringPoints = [...data.homes, ...data.cashouts].map((p) => [p.lat, p.lng] as [number, number]);
    const frame = !data.cities.length && ringPoints.length ? ringPoints.join() : "india";
    if (frame !== framed.current) {
      framed.current = frame;
      map.current?.fitBounds(frame === "india" ? INDIA : L.latLngBounds(ringPoints).pad(0.25), { maxZoom: 7 });
    }
  }, [data, ready]);

  if (tiles === "failed") return <CityTable data={data} className={className} />;

  return (
    <div className={`cash-map relative isolate ${className}`}>
      <div ref={holder} className="absolute inset-0" />
      {tiles === "loading" && (
        <p className="absolute inset-0 z-[500] grid place-items-center bg-stone text-on-stone-2">Loading the map…</p>
      )}
    </div>
  );
}

/** The map's facts without the map, for when tiles cannot be fetched. */
function CityTable({ data, className }: { data: MapData; className: string }) {
  const rows = new Map<string, { withdrawals: number; amount: number; ring: number }>();
  for (const c of data.cities) rows.set(c.city, { withdrawals: c.withdrawals, amount: c.amount, ring: 0 });
  for (const c of data.cashouts) {
    const row = rows.get(c.city) ?? { withdrawals: 0, amount: 0, ring: 0 };
    rows.set(c.city, { ...row, ring: row.ring + c.amount });
  }
  const list = [...rows].sort(([, a], [, b]) => b.ring - a.ring || b.amount - a.amount);
  return (
    <div className={`on-stone overflow-auto bg-stone p-5 text-on-stone ${className}`}>
      <p className="text-on-stone-2">The map could not be loaded without a connection. The same cash-outs, by city:</p>
      {list.length ? (
        <table className="mt-3 w-full text-left">
          <thead>
            <tr className="border-b border-stone-lo text-on-stone-2">
              <th className="py-1.5 font-semibold">City</th>
              <th className="py-1.5 text-right font-semibold">Withdrawals</th>
              <th className="py-1.5 text-right font-semibold">Amount</th>
              <th className="py-1.5 text-right font-semibold">By ring accounts</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([city, r]) => (
              <tr key={city} className="border-b border-stone-lo">
                <td className="py-1.5 font-semibold">{city}</td>
                <td className="fig py-1.5 text-right">{count(r.withdrawals)}</td>
                <td className="fig py-1.5 text-right">{inr(r.amount)}</td>
                <td className={`fig py-1.5 text-right ${r.ring ? "text-stage" : "text-on-stone-2"}`}>{r.ring ? inr(r.ring) : "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-3">No cash has been withdrawn yet.</p>
      )}
    </div>
  );
}
