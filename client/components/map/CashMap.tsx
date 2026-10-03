"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import { ringLabel } from "@/lib/constants";
import { count, inr } from "@/lib/format";
import type { GeoPoint } from "@/lib/types";

export interface MapData {
  /** Ordinary cash withdrawals, added up per city. */
  cities: (GeoPoint & { withdrawals: number; amount: number })[];
  /** Home branches of ring accounts. */
  homes: (GeoPoint & { account_id: string; ring_id?: string })[];
  /** Cash withdrawn by ring accounts. */
  cashouts: (GeoPoint & { txn_id: string; account_id: string; amount: number; ring_id?: string })[];
}

/** With nothing to show yet, the whole inhabited world. */
const WORLD: [[number, number], [number, number]] = [
  [-45, -130],
  [65, 150],
];
const C = {
  stone: "#e8e1d1",
  deep: "#3f0914",
  turmeric: "#f4a915",
  ink: "#17100e",
};
/**
 * Esri's dark grey canvas: land, sea and borders for the whole world, and
 * place names in English on a layer of their own. Neither needs a key.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const TILES = `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const TILE_LABELS = `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";

/** Points along a gentle arc from a to b, so routes that share a city do not lie on top of each other. */
function arc(a: GeoPoint, b: GeoPoint): [number, number][] {
  const mx = (a.lng + b.lng) / 2;
  const my = (a.lat + b.lat) / 2;
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  // The bend sits to the left of the direction of travel, a fifth of the distance out.
  const cx = mx - dy * 0.2;
  const cy = my + dx * 0.2;
  const points: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    points.push([u * u * a.lat + 2 * u * t * cy + t * t * b.lat, u * u * a.lng + 2 * u * t * cx + t * t * b.lng]);
  }
  return points;
}

const discSize = (amount: number) => Math.max(5, Math.min(20, 3 + Math.sqrt(amount) / 45));
const citySize = (withdrawals: number) => Math.max(2.5, Math.min(14, 1.6 * Math.sqrt(withdrawals)));

/** How each kind of ring mark looks, in full and when another ring is picked out. */
const LOOK = {
  route: { on: { opacity: 0.75 }, off: { opacity: 0.1 } },
  home: { on: { opacity: 1, fillOpacity: 1 }, off: { opacity: 0.22, fillOpacity: 0.3 } },
  cash: { on: { opacity: 1, fillOpacity: 0.95 }, off: { opacity: 0.2, fillOpacity: 0.16 } },
};

interface Layers {
  cities: Map<string, Leaflet.CircleMarker>;
  routes: Map<string, Leaflet.Polyline>;
  homes: Map<string, Leaflet.CircleMarker>;
  cashouts: Map<string, Leaflet.CircleMarker>;
  /** What each mark belongs to, so a focused ring can be picked out. */
  ringOf: Map<Leaflet.Path, { ring?: string; kind: keyof typeof LOOK }>;
  seen: Map<string, number>;
}

/**
 * Where cash came out, on a dark world map that frames wherever the data is,
 * in any country. Ordinary withdrawals are quiet stone dots per
 * city, sized by count. A ring's withdrawals are turmeric discs, tainted cash,
 * sized by amount, each joined by an arc to the hollow mark of the account's
 * home branch. With `live`, a withdrawal that has just happened ripples.
 *
 * Map tiles need the internet. If they do not load, the same facts are shown
 * as a table of cities, so the view still works at a venue with no connection.
 */
export function CashMap({
  data,
  focus = null,
  live = false,
  className = "",
}: {
  data: MapData;
  /** A ring to pick out; the others are dimmed. */
  focus?: string | null;
  live?: boolean;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layers = useRef<Layers | null>(null);
  const groups = useRef<{ base: Leaflet.LayerGroup; marks: Leaflet.LayerGroup; labels: Leaflet.LayerGroup } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "ok" | "failed">("loading");
  /** What the map was last framed on, so it is only re-framed when that changes. */
  const framed = useRef("");

  /** Set once the person moves the map themselves; from then on it is not re-framed under them. */
  const steered = useRef(false);
  /** True while the map is moving because this code moved it. */
  const framing = useRef(false);

  useEffect(() => {
    let dead = false;
    if (!navigator.onLine) {
      queueMicrotask(() => setState("failed"));
      return;
    }
    void import("leaflet")
      .then((leaflet) => {
        if (dead || !holder.current) return;
        L.current = leaflet;
        const m = leaflet.map(holder.current, {
          renderer: leaflet.canvas({ padding: 0.4 }),
          zoomControl: true,
          zoomSnap: 0.25,
          minZoom: 2,
          maxZoom: 16,
          worldCopyJump: true,
          attributionControl: true,
        });
        m.attributionControl.setPrefix(false);
        m.fitBounds(WORLD);
        framed.current = "world";

        let loaded = 0;
        let errors = 0;
        leaflet
          .tileLayer(TILES, { attribution: ATTRIBUTION, maxNativeZoom: 16, className: "map-tiles" })
          .on("tileload", () => {
            loaded++;
            setState("ok");
          })
          .on("tileerror", () => {
            // A few failures with nothing loaded means there is no connection to the tile server.
            if (++errors >= 4 && loaded === 0) setState("failed");
          })
          .addTo(m);
        // Place names sit above the marks, as the reference layer is designed to, so a mark never hides its city.
        m.createPane("names").style.zIndex = "450";
        m.getPane("names")!.style.pointerEvents = "none";
        leaflet.tileLayer(TILE_LABELS, { maxNativeZoom: 16, pane: "names", className: "map-names" }).addTo(m);

        m.on("dragstart", () => (steered.current = true));
        m.on("zoomstart", () => {
          if (!framing.current) steered.current = true;
        });
        m.on("moveend", () => (framing.current = false));

        groups.current = {
          base: leaflet.layerGroup().addTo(m),
          marks: leaflet.layerGroup().addTo(m),
          labels: leaflet.layerGroup().addTo(m),
        };
        layers.current = {
          cities: new Map(),
          routes: new Map(),
          homes: new Map(),
          cashouts: new Map(),
          ringOf: new Map(),
          seen: new Map(),
        };
        map.current = m;
        // Marks can go on before the first tile arrives.
        setState((s) => (s === "failed" ? s : "ready"));
      })
      .catch(() => !dead && setState("failed"));
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);

  // Marks are kept and updated in place as the replay runs, not redrawn.
  useEffect(() => {
    const leaflet = L.current;
    const m = map.current;
    const ls = layers.current;
    const g = groups.current;
    if ((state !== "ok" && state !== "ready") || !leaflet || !m || !ls || !g) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ripple = (at: GeoPoint, tone: "stone" | "turmeric") => {
      if (!live || reduced) return;
      const marker = leaflet
        .marker([at.lat, at.lng], {
          interactive: false,
          keyboard: false,
          icon: leaflet.divIcon({ className: `map-ripple map-ripple-${tone}`, iconSize: [40, 40] }),
        })
        .addTo(g.labels);
      window.setTimeout(() => marker.remove(), 1400);
    };
    /** Keeps exactly the marks in `wanted`, making and updating them with the callbacks. */
    function sync<T, M extends Leaflet.Layer>(
      store: Map<string, M>,
      wanted: Map<string, T>,
      make: (item: T) => M,
      update: (mark: M, item: T) => void,
    ) {
      for (const [key, mark] of store) {
        if (wanted.has(key)) continue;
        mark.remove();
        store.delete(key);
        ls!.ringOf.delete(mark as unknown as Leaflet.Path);
      }
      for (const [key, item] of wanted) {
        let mark = store.get(key);
        if (!mark) {
          mark = make(item);
          mark.addTo(g!.marks);
          store.set(key, mark);
        }
        update(mark, item);
      }
    }

    // Ordinary withdrawals, per city.
    sync(
      ls.cities,
      new Map(data.cities.map((c) => [c.city, c])),
      (c) =>
        leaflet.circleMarker([c.lat, c.lng], { color: C.stone, weight: 0, fillColor: C.stone, fillOpacity: 0.32, radius: 3 }).bindTooltip(""),
      (mark, c) => {
        mark.setRadius(citySize(c.withdrawals));
        mark.setTooltipContent(`<b>${c.city}</b><br>${count(c.withdrawals)} ordinary withdrawals, ${inr(c.amount)}`);
        if ((ls.seen.get(`city:${c.city}`) ?? 0) < c.withdrawals && ls.seen.has(`city:${c.city}`)) ripple(c, "stone");
        ls.seen.set(`city:${c.city}`, c.withdrawals);
      },
    );

    // A ring's cash, per ring and city.
    const cash = new Map<string, { at: GeoPoint; ring?: string; amount: number; times: number; accounts: Set<string> }>();
    for (const c of data.cashouts) {
      const key = `${c.ring_id ?? ""}|${c.city}`;
      const row = cash.get(key) ?? { at: c, ring: c.ring_id, amount: 0, times: 0, accounts: new Set<string>() };
      row.amount += c.amount;
      row.times++;
      row.accounts.add(c.account_id);
      cash.set(key, row);
    }
    const homeOf = new Map(data.homes.map((h) => [h.account_id, h]));
    const routes = new Map<string, { from: GeoPoint; to: GeoPoint; ring?: string }>();
    for (const c of data.cashouts) {
      const home = homeOf.get(c.account_id);
      if (home && (home.lat !== c.lat || home.lng !== c.lng)) {
        routes.set(`${c.account_id}|${c.city}`, { from: home, to: c, ring: c.ring_id });
      }
    }
    sync(
      ls.routes,
      routes,
      (r) => {
        const line = leaflet.polyline(arc(r.from, r.to), { color: C.turmeric, weight: 1.6, opacity: 0.75, interactive: false });
        ls.ringOf.set(line, { ring: r.ring, kind: "route" });
        return line;
      },
      () => undefined,
    );
    const homes = new Map<string, { at: GeoPoint; ring?: string; accounts: string[] }>();
    for (const h of data.homes) {
      const key = `${h.ring_id ?? ""}|${h.city}`;
      const row = homes.get(key) ?? { at: h, ring: h.ring_id, accounts: [] };
      row.accounts.push(h.account_id);
      homes.set(key, row);
    }
    sync(
      ls.homes,
      homes,
      (h) => {
        const mark = leaflet
          .circleMarker([h.at.lat, h.at.lng], { radius: 5.5, color: C.stone, weight: 2.4, fillColor: C.deep, fillOpacity: 1 })
          .bindTooltip("");
        ls.ringOf.set(mark, { ring: h.ring, kind: "home" });
        return mark;
      },
      (mark, h) =>
        mark.setTooltipContent(
          `<b>${h.at.city}</b>${h.ring ? ` · ${ringLabel(h.ring)}` : ""}<br>Home branch of ${h.accounts.length === 1 ? h.accounts[0] : `${h.accounts.length} ring accounts`}`,
        ),
    );
    sync(
      ls.cashouts,
      cash,
      (c) => {
        const mark = leaflet
          .circleMarker([c.at.lat, c.at.lng], { color: C.ink, weight: 1.5, fillColor: C.turmeric, fillOpacity: 0.95, radius: 5 })
          .bindTooltip("");
        ls.ringOf.set(mark, { ring: c.ring, kind: "cash" });
        return mark;
      },
      (mark, c) => {
        mark.setRadius(discSize(c.amount));
        mark.setTooltipContent(
          `<b>${c.at.city}</b>${c.ring ? ` · ${ringLabel(c.ring)}` : ""}<br>${inr(c.amount)} withdrawn in ${count(c.times)} ${c.times === 1 ? "withdrawal" : "withdrawals"} by ${[...c.accounts].join(", ")}`,
        );
        mark.bringToFront();
        const key = `cash:${c.ring ?? ""}|${c.at.city}`;
        if ((ls.seen.get(key) ?? 0) < c.times) ripple(c.at, "turmeric");
        ls.seen.set(key, c.times);
      },
    );

    // Frame wherever the cash came out, in whatever country. The frame only
    // widens when something new falls outside it, and never once the person
    // has moved the map themselves. An empty map (a restarted replay) starts over.
    const points = [...data.cities, ...data.homes, ...data.cashouts].map((p) => [p.lat, p.lng] as [number, number]);
    if (!points.length) {
      steered.current = false;
      if (framed.current !== "world") {
        framed.current = "world";
        framing.current = true;
        m.fitBounds(WORLD);
      }
    } else if (!steered.current) {
      const view = m.getBounds();
      const outside = framed.current === "world" || points.some((p) => !view.contains(p));
      if (outside) {
        framed.current = "data";
        framing.current = true;
        m.fitBounds(leaflet.latLngBounds(points), { padding: [48, 48], maxZoom: 11 });
      }
    }
  }, [data, live, state]);

  // Pick out one ring.
  useEffect(() => {
    const ls = layers.current;
    if ((state !== "ok" && state !== "ready") || !ls) return;
    for (const [mark, { ring, kind }] of ls.ringOf) {
      mark.setStyle(focus !== null && ring !== focus ? LOOK[kind].off : LOOK[kind].on);
    }
  }, [focus, data, state]);

  if (state === "failed") return <CityTable data={data} className={className} />;

  return (
    <div className={`cash-map relative isolate ${className}`}>
      <div ref={holder} className="absolute inset-0" />
      {state !== "ok" && (
        <p className="pointer-events-none absolute inset-0 z-[500] grid place-items-center bg-stage-deep text-on-stage-2">Loading the map…</p>
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
