"use client";

import Link from "next/link";
import { FlaskIcon } from "@/components/ui/icons";
import { P2Chip } from "@/components/ui/P2Chip";
import { useDashboard } from "@/lib/store";
import type { ViewMode } from "@/lib/types";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "police", label: "Police" },
  { id: "bank", label: "Bank" },
];

export function SyntheticBadge() {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-turmeric px-3 text-sm font-semibold text-turmeric">
      <FlaskIcon className="size-4" />
      Synthetic data
    </span>
  );
}

/** `compact` drops the Latin name on a phone, where the nav has no room for both scripts. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-baseline gap-2.5 rounded">
      <span lang="hi" className="font-deva text-2xl font-bold leading-none text-turmeric">
        चक्रव्यूह
      </span>
      <span className={`text-xl font-bold leading-none tracking-tight ${compact ? "max-sm:sr-only" : ""}`}>
        Chakravyuh
      </span>
    </Link>
  );
}

export function TopBar() {
  const view = useDashboard((s) => s.view);
  const setView = useDashboard((s) => s.setView);
  return (
    <header className="flex h-14 items-center justify-between border-b border-ink-line px-5">
      <div className="flex items-center gap-5">
        <Wordmark />
        <SyntheticBadge />
      </div>
      <div className="flex items-center gap-2.5">
        <P2Chip tone="ink" />
        <div role="radiogroup" aria-label="View" className="flex rounded-full bg-ink-hi p-1 ring-1 ring-ink-line">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={view === v.id}
              onClick={() => setView(v.id)}
              className={`h-8 rounded-full px-4 text-sm font-semibold transition-colors ${
                view === v.id ? "bg-stone text-on-stone" : "text-on-ink-2 hover:text-on-ink"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
