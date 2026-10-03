"use client";

import { useEffect } from "react";
import { GraphLegend } from "@/components/graph/GraphLegend";
import { OverviewGraph } from "@/components/graph/OverviewGraph";
import { P2Chip } from "@/components/ui/P2Chip";
import { initDashboard } from "@/lib/replay";
import { useDashboard } from "@/lib/store";
import { AlertList } from "./AlertList";
import { ReplayBar } from "./ReplayBar";
import { ReplayMap } from "./ReplayMap";
import { ResultsPanel } from "./ResultsPanel";
import { TopBar } from "./TopBar";

const STAGES = [
  { id: "graph", label: "Graph" },
  { id: "map", label: "Map" },
] as const;

export function Dashboard() {
  const stage = useDashboard((s) => s.stage);
  const setStage = useDashboard((s) => s.setStage);
  useEffect(() => {
    initDashboard();
  }, []);

  return (
    <div className="grid h-dvh min-h-[560px] min-w-[1040px] grid-rows-[auto_auto_minmax(0,1fr)]">
      <TopBar />
      <ReplayBar />
      <div className="grid min-h-0 grid-cols-[18.75rem_minmax(0,1fr)_20rem]">
        <aside className="on-stone flex min-h-0 flex-col bg-stone text-on-stone">
          <AlertList />
        </aside>
        <main className="stage-ground flex min-h-0 flex-col">
          <h1 className="sr-only">Chakravyuh dashboard: live replay of transactions and detected fraud rings</h1>
          <div className="relative min-h-0 flex-1">
            {/* The graph stays mounted under the map, so its layout keeps settling while the map is up. */}
            <div className={stage === "graph" ? "h-full" : "invisible absolute inset-0"}>
              <OverviewGraph />
            </div>
            {stage === "map" && (
              <div className="absolute inset-0">
                <ReplayMap />
              </div>
            )}
            <div
              role="radiogroup"
              aria-label="Stage view"
              className="absolute right-3 top-3 z-[700] flex items-center gap-1 rounded-full bg-ink p-1 shadow-[0_8px_20px_-8px_rgb(0_0_0/0.7)]"
            >
              {STAGES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={stage === s.id}
                  onClick={() => setStage(s.id)}
                  className={`flex h-8 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors ${
                    stage === s.id ? "bg-stone text-on-stone" : "text-on-ink-2 hover:text-on-ink"
                  }`}
                >
                  {s.label}
                  {s.id === "map" && <P2Chip tone={stage === "map" ? "stone" : "ink"} />}
                </button>
              ))}
            </div>
          </div>
          {stage === "graph" ? (
            <GraphLegend />
          ) : (
            <ul
              aria-label="Map legend"
              className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-stage-line px-5 py-2.5 text-base font-medium text-on-stage"
            >
              <li className="flex items-center gap-2">
                <span className="size-3.5 rounded-full bg-stone/40" aria-hidden="true" />
                Ordinary cash withdrawals, by city
              </li>
              <li className="flex items-center gap-2">
                <span className="size-3.5 rounded-full border-[1.5px] border-ink bg-turmeric" aria-hidden="true" />
                Cash withdrawn by a ring, sized by amount
              </li>
              <li className="flex items-center gap-2">
                <span className="size-3.5 rounded-full border-2 border-stone bg-stage-deep" aria-hidden="true" />
                Ring account&apos;s home branch
              </li>
              <li className="flex items-center gap-2">
                <svg viewBox="0 0 22 12" className="h-3 w-5.5" aria-hidden="true">
                  <path d="M1 10Q11 -3 21 10" fill="none" stroke="#f4a915" strokeWidth="1.8" />
                </svg>
                Home branch to cash-out
              </li>
            </ul>
          )}
        </main>
        <aside className="on-stone flex min-h-0 flex-col overflow-y-auto bg-stone text-on-stone rail-scroll">
          <ResultsPanel />
        </aside>
      </div>
    </div>
  );
}
