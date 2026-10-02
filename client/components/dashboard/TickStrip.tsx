"use client";

import { useEffect, useRef } from "react";
import { COLORS } from "@/lib/constants";
import { BIN_COUNT, bins } from "@/lib/replay";
import { useDashboard } from "@/lib/store";

/**
 * Every transaction of the replay as a strip of ticks, filling in as the clock
 * runs. A ring's transfers turn turmeric once its alert has fired; alerts are
 * the diamonds above the strip.
 */
export function TickStrip() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const { window: win, clock, alerts } = useDashboard.getState();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const top = 12;
      const base = h - 1;
      const step = w / BIN_COUNT;
      const peak = Math.max(48, ...bins.all);
      const firedRings = alerts.map((a) => bins.byRing[a.ring_id]).filter(Boolean);

      ctx.fillStyle = "#47352f";
      ctx.fillRect(0, base, w, 1);

      for (let i = 0; i < BIN_COUNT; i++) {
        if (!bins.all[i]) continue;
        const height = 3 + (bins.all[i] / peak) * (base - top - 3);
        const flagged = firedRings.some((b) => b[i] > 0);
        ctx.fillStyle = flagged ? COLORS.turmeric : "#8d7b70";
        ctx.fillRect(i * step, base - (flagged ? base - top : height), Math.max(1, step - 1), flagged ? base - top : height);
      }

      if (!win) return;
      const at = (t: number) => ((t - win.start) / (win.end - win.start)) * w;
      ctx.fillStyle = COLORS.turmeric;
      for (const a of alerts) {
        const x = at(Date.parse(a.fired_at));
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 5, 5);
        ctx.lineTo(x, 10);
        ctx.lineTo(x - 5, 5);
        ctx.fill();
      }
      if (clock !== null) {
        ctx.fillStyle = COLORS.stone;
        ctx.fillRect(Math.min(w - 2, at(clock)), top - 2, 2, base - top + 2);
      }
    };

    draw();
    const unsubscribe = useDashboard.subscribe(draw);
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvas} aria-hidden="true" className="h-10 w-full" />;
}
