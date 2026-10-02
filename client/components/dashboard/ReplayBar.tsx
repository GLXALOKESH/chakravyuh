"use client";

import { PauseIcon, PlayIcon, RestartIcon } from "@/components/ui/icons";
import { SPEEDS } from "@/lib/constants";
import { clockDate, clockTime, shortDate, shortTime } from "@/lib/format";
import { pause, play, restart, setSpeed } from "@/lib/replay";
import { useDashboard } from "@/lib/store";
import { TickStrip } from "./TickStrip";

const speedLabel = (s: number) => `${s}x`;
const edge = (at: number, span: number) => (span > 86_400_000 ? shortDate(at) : shortTime(at));

export function ReplayBar() {
  const ready = useDashboard((s) => s.ready);
  const status = useDashboard((s) => s.status);
  const speed = useDashboard((s) => s.speed);
  const clock = useDashboard((s) => s.clock);
  const win = useDashboard((s) => s.window);
  const playing = status === "playing";
  const progress = win && clock !== null ? (clock - win.start) / (win.end - win.start) : 0;

  return (
    <section aria-label="Replay" className="flex h-18 items-center gap-5 px-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={playing ? pause : play}
          className="grid size-12 place-items-center rounded-full bg-turmeric text-ink transition-[transform,background-color] duration-200 hover:bg-turmeric-hi active:scale-95 disabled:opacity-40"
        >
          {playing ? <PauseIcon className="size-6" /> : <PlayIcon className="size-6 translate-x-px" />}
          <span className="sr-only">
            {playing ? "Pause replay" : status === "ended" ? "Play again" : "Play replay"}
          </span>
        </button>
        <button
          type="button"
          disabled={!ready || status === "idle"}
          onClick={restart}
          className="grid size-10 place-items-center rounded-full text-on-ink-2 ring-1 ring-ink-line transition-colors hover:text-on-ink disabled:opacity-40"
        >
          <RestartIcon className="size-5" />
          <span className="sr-only">Restart replay</span>
        </button>
      </div>

      <div role="radiogroup" aria-label="Replay speed" className="flex rounded-full bg-ink-hi p-1 ring-1 ring-ink-line">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            aria-label={`${s} times speed`}
            onClick={() => setSpeed(s)}
            className={`fig h-8 min-w-12 rounded-full px-2.5 text-lg transition-colors ${
              speed === s ? "bg-stone text-on-stone" : "text-on-ink-2 hover:text-on-ink"
            }`}
          >
            {speedLabel(s)}
          </button>
        ))}
      </div>

      <div className="w-34 leading-none">
        <div className="fig text-[2rem]">{clock !== null ? clockTime(clock) : "--:--:--"}</div>
        <div className="mt-1 text-base text-on-ink-2">{clock !== null ? clockDate(clock) : "Loading"}</div>
      </div>

      <div
        role="progressbar"
        aria-label="Replay progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="min-w-0 flex-1"
      >
        <TickStrip />
        <div className="fig flex justify-between text-base font-medium leading-tight text-on-ink-2">
          {/* A window longer than a day is labelled by date, a shorter one by time. */}
          <span>{win ? edge(win.start, win.end - win.start) : ""}</span>
          <span>{win ? edge(win.end, win.end - win.start) : ""}</span>
        </div>
      </div>
    </section>
  );
}
