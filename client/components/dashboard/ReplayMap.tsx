"use client";

import { useEffect, useMemo, useState } from "react";
import { CashMap, type MapData } from "@/components/map/CashMap";
import { getRingGeo } from "@/lib/api";
import { count } from "@/lib/format";
import { history } from "@/lib/replay";
import { useDashboard } from "@/lib/store";
import type { RingGeo } from "@/lib/types";

/**
 * The dashboard's map view: cash withdrawals appearing city by city as the
 * replay runs. Once a ring is detected its withdrawals are picked out and
 * joined to the home branches of the accounts that made them.
 */
export function ReplayMap() {
  const rings = useDashboard((s) => s.rings);
  const focus = useDashboard((s) => s.focusRing);
  // Redrawing on every clock tick would be wasteful; a few times a second is plenty.
  const beat = useDashboard((s) => (s.clock === null ? 0 : Math.floor(s.counts.txns / 40)));
  const ended = useDashboard((s) => s.status === "ended" || s.status === "paused");
  const [geo, setGeo] = useState<Record<string, RingGeo>>({});

  useEffect(() => {
    for (const id of Object.keys(rings)) {
      if (geo[id]) continue;
      void getRingGeo(id)
        .then((g) => setGeo((all) => ({ ...all, [id]: g })))
        .catch(() => undefined);
    }
  }, [rings, geo]);

  const data = useMemo<MapData>(() => {
    void beat;
    void ended;
    const ringOf = new Map(
      Object.values(rings).flatMap((r) => r.nodes.filter((n) => n.type === "account").map((n) => [n.id, r.id] as const)),
    );
    const cities = new Map<string, MapData["cities"][number]>();
    const cashouts: MapData["cashouts"] = [];
    for (const t of history.txns) {
      if (!t.location) continue;
      const ring = ringOf.get(t.from);
      if (ring) {
        cashouts.push({ ...t.location, txn_id: t.id, account_id: t.from, amount: t.amount, ring_id: ring });
        continue;
      }
      const c = cities.get(t.location.city) ?? { ...t.location, withdrawals: 0, amount: 0 };
      c.withdrawals++;
      c.amount += t.amount;
      cities.set(t.location.city, c);
    }
    const homes = Object.keys(rings).flatMap((id) => (geo[id]?.homes ?? []).map((h) => ({ ...h, ring_id: id })));
    return { cities: [...cities.values()], homes, cashouts };
  }, [beat, ended, rings, geo]);

  const withdrawals = data.cities.reduce((n, c) => n + c.withdrawals, 0) + data.cashouts.length;
  return (
    <div className="relative h-full">
      <CashMap data={data} focus={focus} live className="h-full" />
      <p className="pointer-events-none absolute left-14 top-3 z-[600] rounded-full bg-ink px-3.5 py-1.5 text-on-ink shadow-[0_8px_20px_-8px_rgb(0_0_0/0.7)]">
        <span className="fig">{count(withdrawals)}</span> cash withdrawals so far
        {data.cashouts.length > 0 && (
          <>
            , <span className="fig text-turmeric">{count(data.cashouts.length)}</span> by ring accounts
          </>
        )}
      </p>
    </div>
  );
}
