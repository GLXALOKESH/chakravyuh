"use client";

import { useEffect } from "react";
import { GraphLegend } from "@/components/graph/GraphLegend";
import { OverviewGraph } from "@/components/graph/OverviewGraph";
import { initDashboard } from "@/lib/replay";
import { AlertList } from "./AlertList";
import { ReplayBar } from "./ReplayBar";
import { ResultsPanel } from "./ResultsPanel";
import { TopBar } from "./TopBar";

export function Dashboard() {
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
          <div className="min-h-0 flex-1">
            <OverviewGraph />
          </div>
          <GraphLegend />
        </main>
        <aside className="on-stone flex min-h-0 flex-col overflow-y-auto bg-stone text-on-stone rail-scroll">
          <ResultsPanel />
        </aside>
      </div>
    </div>
  );
}
