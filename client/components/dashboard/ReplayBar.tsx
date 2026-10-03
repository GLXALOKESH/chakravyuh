"use client";

import { PauseIcon, PlayIcon, RestartIcon, StopIcon } from "@/components/ui/icons";
import { SPEEDS } from "@/lib/constants";
import { clockDate, clockTime, count, shortDate, shortTime } from "@/lib/format";
import { pause, play, restart, setSpeed } from "@/lib/replay";
import { clearLive, LIVE_RATES, setMode, startLive, stopLive } from "@/lib/stream";
import { useDashboard } from "@/lib/store";
import { TickStrip } from "./TickStrip";

const speedLabel = (s: number) => `${s}x`;
const edge = (at: number, span: number) => (span > 86_400_000 ? shortDate(at) : shortTime(at));

const chip = (on: boolean) =>
  `fig h-8 min-w-12 rounded-full px-2.5 text-lg transition-colors ${on ? "bg-stone text-on-stone" : "text-on-ink-2 enabled:hover:text-on-ink"}`;

/** Replay of the stored data, or a live run generated and scored as it plays. */
function ModeSwitch() {
  const mode = useDashboard((s) => s.mode);
  const replayAvailable = useDashboard((s) => s.replayAvailable);
  const liveAvailable = useDashboard((s) => s.liveAvailable);
  const options = [
    { id: "replay" as const, label: "Replay", on: replayAvailable, why: "The server has no stored data to replay." },
    {
      id: "live" as const,
      label: "Live",
      on: liveAvailable,
      why: "Live mode needs the server and the ML service; this page is running on the built-in demo.",
    },
  ];
  return (
    <div role="radiogroup" aria-label="What to play" className="flex rounded-full bg-ink-hi p-1 ring-1 ring-ink-line">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          disabled={!o.on}
          title={o.on ? undefined : o.why}
          onClick={() => setMode(o.id)}
          className={`h-8 rounded-full px-3.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
            mode === o.id ? "bg-stone text-on-stone" : "text-on-ink-2 enabled:hover:text-on-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ReplayControls() {
  const ready = useDashboard((s) => s.ready);
  const status = useDashboard((s) => s.status);
  const speed = useDashboard((s) => s.speed);
  const live = useDashboard((s) => s.source === "live");
  const playing = status === "playing";
  // The server's replay cannot pause or change speed mid-run: stopping ends
  // the run, and the next play starts from the first transaction.
  const speedLocked = live && playing;
  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={playing ? pause : play}
          className="grid size-12 place-items-center rounded-full bg-turmeric text-ink transition-[transform,background-color] duration-200 hover:bg-turmeric-hi active:scale-95 disabled:opacity-40"
        >
          {playing ? live ? <StopIcon className="size-5" /> : <PauseIcon className="size-6" /> : <PlayIcon className="size-6 translate-x-px" />}
          <span className="sr-only">
            {playing
              ? live
                ? "Stop replay"
                : "Pause replay"
              : status === "ended" || (live && status === "paused")
                ? "Play again from the start"
                : status === "paused"
                  ? "Resume replay"
                  : "Play replay"}
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

      <div
        role="radiogroup"
        aria-label="Replay speed"
        aria-disabled={speedLocked}
        title={speedLocked ? "The server sets the speed when a run starts. Stop the replay to change it." : undefined}
        className={`flex rounded-full bg-ink-hi p-1 ring-1 ring-ink-line ${speedLocked ? "opacity-50" : ""}`}
      >
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            aria-label={`${s} times speed`}
            disabled={speedLocked}
            onClick={() => setSpeed(s)}
            className={chip(speed === s)}
          >
            {speedLabel(s)}
          </button>
        ))}
      </div>
    </>
  );
}

const PREDICTOR: Record<string, { label: string; dot: string }> = {
  ok: { label: "Model live", dot: "bg-turmeric" },
  starting: { label: "Model starting", dot: "bg-on-ink-2" },
  lagging: { label: "Model catching up", dot: "bg-on-ink-2" },
  down: { label: "Model unreachable", dot: "bg-stage-line" },
  idle: { label: "Model idle", dot: "bg-on-ink-2" },
};

function LiveControls() {
  const ready = useDashboard((s) => s.ready);
  const state = useDashboard((s) => s.live);
  const rate = useDashboard((s) => s.liveRate);
  const running = !!state?.running;
  const predictor = PREDICTOR[running ? state!.predictor.status : "idle"] ?? PREDICTOR.idle;
  return (
    <>
      <button
        type="button"
        disabled={!ready}
        onClick={running ? stopLive : () => startLive(rate)}
        className="grid size-12 shrink-0 place-items-center rounded-full bg-turmeric text-ink transition-[transform,background-color] duration-200 hover:bg-turmeric-hi active:scale-95 disabled:opacity-40"
      >
        {running ? <StopIcon className="size-5" /> : <PlayIcon className="size-6 translate-x-px" />}
        <span className="sr-only">{running ? "Stop the live run" : "Start a live run with a new random seed"}</span>
      </button>
      <button
        type="button"
        disabled={!ready || !state?.run_id}
        onClick={clearLive}
        title="Stop the run and clear everything it found"
        className="grid size-10 shrink-0 place-items-center rounded-full text-on-ink-2 ring-1 ring-ink-line transition-colors hover:text-on-ink disabled:opacity-40"
      >
        <RestartIcon className="size-5" />
        <span className="sr-only">Reset: stop the run and clear its data</span>
      </button>

      <div
        role="radiogroup"
        aria-label="Live speed, simulated seconds per real second"
        aria-disabled={running}
        title={running ? "The speed is set when a run starts. Stop the run to change it." : undefined}
        className={`flex rounded-full bg-ink-hi p-1 ring-1 ring-ink-line ${running ? "opacity-50" : ""}`}
      >
        {LIVE_RATES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={rate === r}
            aria-label={`${r} times real time`}
            disabled={running}
            onClick={() => useDashboard.setState({ liveRate: r })}
            className={chip(rate === r)}
          >
            {r}×
          </button>
        ))}
      </div>

      <div className="w-36 shrink-0 leading-tight">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-on-ink" title={state?.predictor.last_error ?? undefined}>
          <span aria-hidden="true" className={`size-2 rounded-full ${predictor.dot}`} />
          {predictor.label}
        </div>
        <div className="fig text-sm text-on-ink-2">
          {state?.seed != null ? `Seed ${state.seed}` : "New random seed"}
          {running && state ? ` · ${count(state.counts.high_risk)} flagged` : ""}
        </div>
      </div>
    </>
  );
}

export function ReplayBar() {
  const mode = useDashboard((s) => s.mode);
  const clock = useDashboard((s) => s.clock);
  const win = useDashboard((s) => s.window);
  const progress = win && clock !== null ? (clock - win.start) / (win.end - win.start) : 0;

  return (
    <section aria-label={mode === "live" ? "Live run" : "Replay"} className="flex h-18 items-center gap-4 px-5">
      <ModeSwitch />
      {mode === "live" ? <LiveControls /> : <ReplayControls />}

      <div className="w-34 shrink-0 leading-none">
        <div className="fig text-[2rem]">{clock !== null ? clockTime(clock) : "--:--:--"}</div>
        <div className="mt-1 text-base text-on-ink-2">{clock !== null ? clockDate(clock) : mode === "live" ? "Not started" : "Loading"}</div>
      </div>

      <div
        role="progressbar"
        aria-label={mode === "live" ? "Live run so far" : "Replay progress"}
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
