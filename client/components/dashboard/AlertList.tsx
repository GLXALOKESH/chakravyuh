"use client";

import Link from "next/link";
import { FormationGlyph } from "@/components/graph/FormationGlyph";
import { ArrowIcon } from "@/components/ui/icons";
import { P2Chip } from "@/components/ui/P2Chip";
import { ringHref, ringLabel } from "@/lib/constants";
import { count, inr, pct, shortTime } from "@/lib/format";
import { useDashboard } from "@/lib/store";
import type { Alert } from "@/lib/types";

/** P2 (F13): time left before the ring is expected to start withdrawing cash. */
function Countdown({ alert }: { alert: Alert }) {
  const clock = useDashboard((s) => s.clock);
  if (alert.cashout_eta_min === undefined || clock === null) return null;
  const left = Math.ceil((Date.parse(alert.fired_at) + alert.cashout_eta_min * 60_000 - clock) / 60_000);
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {left > 0 ? (
        <>
          Cash-out in about <b className="fig text-base text-stage">{left} min</b>
        </>
      ) : (
        <b className="text-stage">Cash-out has started</b>
      )}
      <P2Chip />
    </span>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const ring = useDashboard((s) => s.rings[alert.ring_id]);
  const view = useDashboard((s) => s.view);
  const setFocusRing = useDashboard((s) => s.setFocusRing);
  return (
    <li className="alert-in">
      <Link
        href={ringHref(alert.ring_id, view)}
        onPointerEnter={() => setFocusRing(alert.ring_id)}
        onPointerLeave={() => setFocusRing(null)}
        onFocus={() => setFocusRing(alert.ring_id)}
        onBlur={() => setFocusRing(null)}
        className="group block rounded-xl border border-stone-lo bg-stone-hi px-3 py-2.5 transition-[border-color,box-shadow] duration-200 hover:border-stage hover:shadow-[0_0.6rem_1.5rem_-0.9rem_rgb(63_9_20/0.7)]"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-17 shrink-0 place-items-center rounded-full bg-stage text-turmeric">
            <FormationGlyph ring={ring} size={62} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xl font-bold leading-tight">{ringLabel(alert.ring_id)}</h3>
              <span className="fig text-base font-medium text-on-stone-2">{shortTime(Date.parse(alert.fired_at))}</span>
            </div>
            <div className="fig text-[1.75rem] leading-none text-stage">
              {pct(alert.risk)} <span className="text-base text-on-stone-2">risk</span>
            </div>
            <div className="fig mt-1 text-base font-semibold">
              {count(alert.members)} accounts · {inr(alert.volume)}
            </div>
          </div>
        </div>
        <p className="mt-2 text-base leading-snug text-on-stone-2">{alert.reason}</p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-base text-on-stone-2">
          <Countdown alert={alert} />
          <span className="ml-auto text-stage">
            <ArrowIcon className="size-5 transition-transform duration-200 group-hover:translate-x-0.5" />
            <span className="sr-only">Open ring</span>
          </span>
        </div>
      </Link>
    </li>
  );
}

export function AlertList() {
  const alerts = useDashboard((s) => s.alerts);
  const status = useDashboard((s) => s.status);
  const total = useDashboard((s) => Object.keys(s.rings).length);
  return (
    <section aria-labelledby="alerts-heading" className="flex min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-4 pb-3 pt-4">
        <h2 id="alerts-heading" className="text-xl font-bold">
          Alerts
        </h2>
        <span className="fig text-base text-on-stone-2" aria-live="polite">
          {alerts.length} fired
        </span>
      </div>
      {alerts.length ? (
        <ul className="rail-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {alerts.map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-4 px-6 pt-14 text-center text-on-stone-2">
          <FormationGlyph size={132} layers={4} className="text-stone-lo" />
          <p className="text-base">
            {status === "idle"
              ? "No alerts yet. Start the replay and rings will appear here as they are detected."
              : status === "ended" && total === 0
                ? "The replay finished without an alert."
                : "Watching. No ring has crossed the risk line yet."}
          </p>
        </div>
      )}
    </section>
  );
}
