"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PlayIcon, ArrowIcon } from "@/components/ui/icons";
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
      s = new FormationScene(canvas.current, reduced);
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    scene.current = s;
    s.setRings(Object.values(rings).sort((a, b) => a.id.localeCompare(b.id)));
    // Catch up with a replay that started before this graph was mounted.
    for (const t of history.txns) s.addTxn(t, true);
    for (const a of history.alerts) s.fireAlert(a.ring_id, true);

    const el = wrap.current;
    const observer = new ResizeObserver(() => {
      s.resize(el.clientWidth, el.clientHeight);
      setAnchors(s.anchors());
    });
    observer.observe(el);

    const off = [
      socket.on("txn", (t) => s.addTxn(t)),
      socket.on("alert", (a) => s.fireAlert(a.ring_id)),
      socket.on("replay:reset", () => s.reset()),
      useDashboard.subscribe((state) => s.setFocus(state.focusRing)),
    ];
    return () => {
      off.forEach((f) => f());
      observer.disconnect();
      s.dispose();
      scene.current = null;
    };
  }, [ready, rings]);

  const fired = new Map(alerts.map((a) => [a.ring_id, a]));
  const idle = ready && status === "idle";

  return (
    <div
      ref={wrap}
      className="relative h-full min-h-0 overflow-hidden"
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        setTip(scene.current?.pick(e.clientX - box.left, e.clientY - box.top) ?? null);
      }}
      onPointerLeave={() => setTip(null)}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Overview graph. ${alerts.length} of ${Object.keys(rings).length} rings detected so far.`}
        className="absolute inset-0 h-full w-full"
      />

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
              style={{ left: a.x, top: a.tagBelow ? a.y + a.r + 14 : Math.max(44, a.y - a.r - 14) }}
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

      {(idle || !ready || failed) && (
        <div className="absolute inset-0 grid place-items-center">
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
