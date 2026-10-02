"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowIcon, FitIcon, MinusIcon, PlayIcon, PlusIcon } from "@/components/ui/icons";
import { ringHref, ringLabel, ROLES } from "@/lib/constants";
import { count, inr, pct } from "@/lib/format";
import { history, play } from "@/lib/replay";
import { socket } from "@/lib/socket";
import { useDashboard } from "@/lib/store";
import { FormationGlyph } from "./FormationGlyph";
import { FormationScene, type NodeHit, type RingAnchor } from "./FormationScene";

export function OverviewGraph() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<FormationScene | null>(null);
  const [anchors, setAnchors] = useState<RingAnchor[]>([]);
  const [tip, setTip] = useState<(NodeHit & { alerted: boolean }) | null>(null);
  const [failed, setFailed] = useState(false);

  const ready = useDashboard((s) => s.ready);
  const error = useDashboard((s) => s.error);
  const rings = useDashboard((s) => s.rings);
  const accounts = useDashboard((s) => s.accounts);
  const alerts = useDashboard((s) => s.alerts);
  const status = useDashboard((s) => s.status);
  const view = useDashboard((s) => s.view);
  const focusRing = useDashboard((s) => s.focusRing);
  const setFocusRing = useDashboard((s) => s.setFocusRing);

  useEffect(() => {
    if (!ready || !wrap.current || !canvas.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let s: FormationScene;
    try {
      s = new FormationScene(canvas.current, reduced, () => setAnchors(s.anchors()));
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    scene.current = s;
    const el = wrap.current;
    s.resize(el.clientWidth, el.clientHeight);
    s.setData(
      accounts,
      Object.values(rings).sort((a, b) => a.id.localeCompare(b.id)),
    );
    // Catch up with a replay that started before this graph was mounted.
    for (const t of history.txns) s.addTxn(t, true);
    for (const a of history.alerts) s.fireAlert(a.ring_id, true);

    const observer = new ResizeObserver(() => s.resize(el.clientWidth, el.clientHeight));
    observer.observe(el);

    // Wheel zooms about the pointer. React's wheel listener is passive, so the
    // page scroll is stopped here instead.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      s.zoomAt(e.clientX - box.left, e.clientY - box.top, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    const off = [
      socket.on("txn", (t) => s.addTxn(t)),
      socket.on("alert", (a) => s.fireAlert(a.ring_id)),
      socket.on("replay:reset", () => s.reset()),
      socket.on("replay:end", () => s.fit()),
      useDashboard.subscribe((state) => s.setFocus(state.focusRing)),
    ];
    return () => {
      off.forEach((f) => f());
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
      s.dispose();
      scene.current = null;
    };
  }, [ready, rings, accounts]);

  // Drag to pan. A drag that starts on a ring tag is left to the link.
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const steer = (move: "in" | "out" | "fit") => {
    if (move === "fit") scene.current?.fit();
    else scene.current?.zoomBy(move === "in" ? 1.4 : 1 / 1.4);
  };

  const fired = new Map(alerts.map((a) => [a.ring_id, a]));
  const idle = ready && status === "idle";

  return (
    <div
      ref={wrap}
      tabIndex={0}
      role="application"
      aria-label="Overview graph. Drag to pan, scroll or use plus and minus to zoom, 0 to see everything."
      className={`relative h-full min-h-0 touch-none overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("a, button")) return;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setTip(null);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d && d.id === e.pointerId) {
          scene.current?.panBy(e.clientX - d.x, e.clientY - d.y);
          d.x = e.clientX;
          d.y = e.clientY;
          return;
        }
        const box = e.currentTarget.getBoundingClientRect();
        setTip(scene.current?.pick(e.clientX - box.left, e.clientY - box.top) ?? null);
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerLeave={() => setTip(null)}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        const box = e.currentTarget.getBoundingClientRect();
        scene.current?.zoomAt(e.clientX - box.left, e.clientY - box.top, 1.8);
      }}
      onKeyDown={(e) => {
        const s = scene.current;
        if (!s || e.target !== e.currentTarget) return;
        const step = 80;
        if (e.key === "+" || e.key === "=") s.zoomBy(1.3);
        else if (e.key === "-") s.zoomBy(1 / 1.3);
        else if (e.key === "0") s.fit();
        else if (e.key === "ArrowLeft") s.panBy(step, 0);
        else if (e.key === "ArrowRight") s.panBy(-step, 0);
        else if (e.key === "ArrowUp") s.panBy(0, step);
        else if (e.key === "ArrowDown") s.panBy(0, -step);
        else return;
        e.preventDefault();
      }}
    >
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      <p className="sr-only" aria-live="polite">
        {alerts.length} of {Object.keys(rings).length} rings detected so far.
      </p>

      {anchors.map((a) => {
        const alert = fired.get(a.ringId);
        if (!alert) return null;
        const dim = focusRing && focusRing !== a.ringId;
        return (
          <div key={a.ringId} className={`transition-opacity duration-300 ${dim ? "opacity-20" : ""}`}>
            <Link
              href={ringHref(a.ringId, view)}
              onPointerEnter={() => setFocusRing(a.ringId)}
              onPointerLeave={() => setFocusRing(null)}
              onFocus={() => setFocusRing(a.ringId)}
              onBlur={() => setFocusRing(null)}
              style={{ left: a.x, top: a.tagBelow ? a.y + a.r + 14 : a.y - a.r - 14 }}
              className={`ring-tag absolute flex -translate-x-1/2 ${a.tagBelow ? "" : "-translate-y-full"} items-center gap-2 whitespace-nowrap rounded-full bg-stone-hi py-1 pl-3.5 pr-2.5 text-on-stone shadow-[0_6px_18px_-6px_rgb(0_0_0/0.6)] transition-colors hover:bg-turmeric`}
            >
              <span className="font-bold">{ringLabel(a.ringId)}</span>
              <span className="fig">{count(alert.members)} accounts</span>
              <span className="fig">{inr(alert.volume)}</span>
              <ArrowIcon className="size-4" />
              <span className="sr-only">Open ring</span>
            </Link>
            {a.specials.map((sp) => (
              <span
                key={sp.id}
                style={{ left: sp.x, top: sp.y }}
                className={`ring-tag pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-base font-semibold leading-tight text-on-stage ${sp.above ? "-translate-y-full" : ""}`}
              >
                {sp.label}
              </span>
            ))}
          </div>
        );
      })}

      {tip && (
        <div
          role="status"
          style={{ left: tip.x, top: tip.y - 10 }}
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink px-3 py-1.5 text-base text-on-ink shadow-[0_8px_20px_-8px_rgb(0_0_0/0.7)]"
        >
          {tip.kind === "victim" ? (
            <b>Victim&apos;s account</b>
          ) : tip.kind === "cash" ? (
            <b>Cash withdrawn</b>
          ) : tip.kind === "other" ? (
            <>
              <b className="fig">{tip.id}</b> · not in a ring
            </>
          ) : (
            <>
              <b className="fig">{tip.id}</b>
              {tip.alerted && tip.role ? (
                <>
                  {" "}
                  · {ROLES[tip.role].label} · <span className="fig">{pct(tip.risk ?? 0)}</span> risk
                </>
              ) : (
                " · not flagged yet"
              )}
            </>
          )}
        </div>
      )}

      {ready && !failed && (
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-full bg-ink text-on-ink-2 shadow-[0_8px_20px_-8px_rgb(0_0_0/0.7)]">
          {(
            [
              ["Zoom in", PlusIcon, "in"],
              ["Zoom out", MinusIcon, "out"],
              ["Show everything", FitIcon, "fit"],
            ] as const
          ).map(([label, Icon, move]) => (
            <button
              key={label}
              type="button"
              title={label}
              onClick={() => steer(move)}
              className="grid size-10 place-items-center transition-colors hover:bg-ink-hi hover:text-on-ink"
            >
              <Icon className="size-5" />
              <span className="sr-only">{label}</span>
            </button>
          ))}
        </div>
      )}

      {(idle || !ready || failed) && (
        <div className="absolute inset-0 grid cursor-default place-items-center">
          <FormationGlyph size={500} layers={6} className="absolute text-stage-line" />
          <div className="relative flex flex-col items-center gap-5 text-center">
            {failed ? (
              <p className="max-w-sm text-lg text-on-stage">
                The graph needs WebGL, which this browser has turned off. Alerts and results still work.
              </p>
            ) : error ? (
              <p className="max-w-sm text-lg text-on-stage">
                The case data did not load: {error} Reload the page to try again.
              </p>
            ) : !ready ? (
              <p className="text-lg text-on-stage-2">Loading the case data…</p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={play}
                  className="grid size-24 place-items-center rounded-full bg-turmeric text-ink shadow-[0_14px_40px_-12px_rgb(0_0_0/0.7)] transition-transform duration-300 ease-out-expo hover:scale-105 active:scale-95"
                >
                  <PlayIcon className="size-11 translate-x-0.5" />
                  <span className="sr-only">Start replay</span>
                </button>
                <p className="text-xl font-semibold text-on-stage">Start the replay</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
