"use client";

import { P2Chip } from "@/components/ui/P2Chip";
import { count, inr } from "@/lib/format";
import { useDashboard } from "@/lib/store";
import type { MetricsRow } from "@/lib/types";

function LiveCounts() {
  const counts = useDashboard((s) => s.counts);
  const alerts = useDashboard((s) => s.alerts);
  const total = useDashboard((s) => Object.keys(s.rings).length);
  const rows: [string, string][] = [
    ["Transactions", count(counts.txns)],
    ["Accounts seen", count(counts.accounts)],
    ["Rings found", `${alerts.length} of ${total}`],
    ["Money in flagged rings", inr(alerts.reduce((sum, a) => sum + a.volume, 0))],
  ];
  return (
    <section aria-labelledby="live-heading" className="px-5 pt-4">
      <h2 id="live-heading" className="text-xl font-bold">
        Replay so far
      </h2>
      <dl className="mt-2 divide-y divide-stone-lo">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-on-stone-2">{label}</dt>
            <dd className="fig text-xl">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const MEASURES: { key: keyof Omit<MetricsRow, "model">; label: string; hint?: string; asPercent: boolean }[] = [
  { key: "pr_auc", label: "Detection quality", hint: "PR-AUC on a time-split test set", asPercent: false },
  { key: "ring_recall", label: "Ring members found", asPercent: true },
  { key: "pattern_d_recall", label: "Found in a pattern never trained on", asPercent: true },
];

const SERIES = [
  { tag: "V1", bar: "bg-on-stone-2" },
  { tag: "V2", bar: "bg-stage" },
  { tag: "V3", bar: "" },
];

function Results() {
  const metrics = useDashboard((s) => s.metrics);
  return (
    <section aria-labelledby="results-heading" className="flex min-h-0 flex-1 flex-col px-5 pb-3 pt-4">
      <h2 id="results-heading" className="text-xl font-bold">
        V1 against V2
      </h2>
      {!metrics ? (
        <p className="mt-3 text-on-stone-2">Loading results…</p>
      ) : (
        <>
          {/* Kept against the heading so the invented figures never show without it. */}
          <p className="mt-1 leading-snug text-on-stone-2">
            <b className="text-on-stone">Sample figures for layout, not results.</b> {metrics.note}
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-on-stone-2">
            {metrics.rows.map((row, i) => (
              <li key={row.model} className="flex items-center gap-2">
                <span
                  className={`size-3 rounded-sm ${SERIES[i]?.bar || "border border-dashed border-on-stone-2"}`}
                  aria-hidden="true"
                />
                {row.model}
                {row.pr_auc === null && (
                  <>
                    <span>not run</span>
                    <P2Chip />
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-2.5 space-y-2.5">
            {MEASURES.map((m) => (
              <div key={m.key}>
                <h3 className="font-semibold leading-tight" title={m.hint}>
                  {m.label}
                </h3>
                <div className="mt-1 space-y-1">
                  {metrics.rows.map((row, i) => {
                    const value = row[m.key];
                    // A model that has not been run is named once, in the key above.
                    if (value === null) return null;
                    return (
                      <div key={row.model} className="grid grid-cols-[1.75rem_1fr_3rem] items-center gap-2">
                        <span className="fig text-base text-on-stone-2">{SERIES[i]?.tag}</span>
                        <span className="h-3.5 rounded-sm bg-stone-lo">
                          <span
                            className={`bar-grow block h-full rounded-sm ${SERIES[i]?.bar}`}
                            style={{ width: `${value * 100}%`, animationDelay: `${i * 120}ms` }}
                          />
                        </span>
                        <span className={`fig text-right text-lg ${i === 1 ? "text-stage" : ""}`}>
                          {m.asPercent ? `${Math.round(value * 100)}%` : value.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

        </>
      )}
    </section>
  );
}

export function ResultsPanel() {
  return (
    <>
      <LiveCounts />
      <Results />
    </>
  );
}
