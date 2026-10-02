"use client";

import { useEffect, useRef } from "react";
import { COLORS, ROLE_ORDER, ROLES } from "@/lib/constants";
import { GATE } from "@/lib/formation";

const TAU = Math.PI * 2;
/** Each layer is this much larger than the one inside it; tighter on a phone so several stay in frame. */
const GROWTH_WIDE = 1.24;
const GROWTH_NARROW = 1.13;
/** Layers that pass the visitor per section. Not a whole number, so no two sections rest on the same frame. */
const LAYERS_PER_SECTION = 2.6;
/** How far the clearing closes in around the play control on the last section. */
const ARRIVAL_CLOSE = 0.27;
/** Height of the fixed nav in rem; the formation is centred in what is left. */
const NAV_REM = 3.5;

const fract = (n: number) => n - Math.floor(n);
/** A stable pseudo-random number for a layer and a slot on it. */
const hash = (layer: number, slot: number) => fract(Math.sin(layer * 127.1 + slot * 311.7) * 43758.5453);
const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function accounts(layer: number) {
  const n = 3 + Math.floor(hash(layer, 0) * 3);
  const turn = hash(layer, 1) * TAU;
  return Array.from({ length: n }, (_, i) => ({
    angle: turn + (i / n) * TAU + (hash(layer, i + 2) - 0.5) * 0.5,
    color: ROLES[ROLE_ORDER[Math.floor(hash(layer, i + 20) * (ROLE_ORDER.length - 1))]].color,
    size: 0.8 + hash(layer, i + 40) * 0.5,
  }));
}

/**
 * The landing page's backdrop: one endless formation, centred on a dark
 * clearing where the copy sits. Scrolling moves inward, so layers grow past the
 * frame while new ones emerge from the clearing. It also fades each section's
 * copy as it leaves the clearing, so text never sits on top of a layer.
 */
export function FormationTunnel() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gates = [...document.querySelectorAll<HTMLElement>("[data-gate]")];
    const dots = [...document.querySelectorAll<HTMLElement>("[data-gate-dot]")];
    const began = performance.now();
    let w = 0;
    let h = 0;
    let depth = 0;
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const nav = NAV_REM * rem;
      const cx = w / 2;
      const cy = nav + (h - nav) / 2;
      const short = Math.min(w, h - nav);
      // The clearing holds the copy. On a tall phone it widens past the screen
      // edges so the text column still fits inside it.
      const open = Math.max(0.46 * short, Math.min(0.36 * (h - nav), 0.72 * w));
      const reach = Math.hypot(w, h) / 2 + 40;
      const GROWTH = w < 640 ? GROWTH_NARROW : GROWTH_WIDE;

      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const end = (gates.length - 1) * LAYERS_PER_SECTION;
      const at = scrollable <= 0 ? 0 : window.scrollY / scrollable;
      depth += ((reduced ? 0 : at * end) - depth) * 0.1;
      const seconds = reduced ? 0 : (now - began) / 1000;
      // Arrival: over the last section the clearing closes in, so the
      // formation tightens around the control at its centre.
      const arrival = clamp01((at * (gates.length - 1) - (gates.length - 2)) / 0.8);
      const clearing = open * (1 - ARRIVAL_CLOSE * arrival * arrival * (3 - 2 * arrival));

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.stageDeep;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, clearing, 0, TAU);
      ctx.fill();

      const radiusOf = (layer: number) => clearing * Math.pow(GROWTH, depth - layer + 1);
      // A layer appears almost at once as it leaves the clearing, so a resting
      // frame never holds a half-faded one.
      const presence = (r: number) => clamp01((r - clearing * 1.015) / (clearing * 0.035));
      const innermost = Math.floor(depth + 1);
      const outermost = Math.ceil(depth + 1 - Math.log(reach / clearing) / Math.log(GROWTH));
      const unit = Math.max(1, short / 520);

      for (let layer = innermost; layer >= outermost; layer--) {
        const r = radiusOf(layer);
        const alpha = presence(r);
        if (alpha <= 0 || r > reach) continue;
        const scale = r / clearing;
        const stroke = Math.max(3.4, Math.min(9, 2.6 * scale) * unit);

        // On load the layers draw closed from the rim inwards.
        const order = layer - outermost;
        const closed = reduced ? 1 : easeOutExpo(clamp01((now - began - 150 - (order < 6 ? order : 6) * 130) / 1300));
        const spin = (layer % 2 ? 1 : -1) * seconds * 0.03;
        const start = layer * 2.1 + GATE / 2 + spin;
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = COLORS.turmeric;
        ctx.lineWidth = stroke;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, start + (TAU - GATE) * Math.max(0.001, closed));
        ctx.stroke();

        // Accounts stand on the layer; money moves out to it from the layer inside.
        const inner = accounts(layer + 1);
        const innerR = radiusOf(layer + 1);
        const innerAlpha = presence(innerR);
        accounts(layer).forEach((a, i) => {
          const x = cx + Math.cos(a.angle) * r;
          const y = cy + Math.sin(a.angle) * r;
          // Money comes from the nearest account on the layer inside. A payer
          // too far round would draw its line across the clearing and the copy.
          const turnTo = (b: { angle: number }) => Math.abs(Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle)));
          const from = inner.reduce((best, b) => (turnTo(b) < turnTo(best) ? b : best));
          const fx = cx + Math.cos(from.angle) * innerR;
          const fy = cy + Math.sin(from.angle) * innerR;
          const link = turnTo(from) < 0.75 ? alpha * innerAlpha * closed : 0;
          if (link > 0) {
            ctx.globalAlpha = link * 0.4;
            ctx.strokeStyle = COLORS.stone;
            ctx.lineWidth = Math.max(1, stroke * 0.45);
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(x, y);
            ctx.stroke();
            if (!reduced) {
              const at = fract(seconds * 0.22 + hash(layer, i + 60));
              ctx.globalAlpha = link * Math.sin(at * Math.PI);
              ctx.fillStyle = COLORS.turmeric;
              ctx.beginPath();
              ctx.arc(fx + (x - fx) * at, fy + (y - fy) * at, stroke * 1.1, 0, TAU);
              ctx.fill();
            }
          }
          ctx.globalAlpha = alpha * closed;
          ctx.fillStyle = a.color;
          ctx.beginPath();
          ctx.arc(x, y, stroke * 2.4 * a.size, 0, TAU);
          ctx.fill();
        });
      }
      ctx.globalAlpha = 1;

      // Copy is fully visible while its section is centred and gone before it
      // reaches the layers above or below the clearing.
      let nearest = 0;
      let nearestGap = Infinity;
      gates.forEach((gate, i) => {
        const box = gate.getBoundingClientRect();
        const gap = Math.abs(box.top + box.height / 2 - window.innerHeight / 2) / window.innerHeight;
        if (gap < nearestGap) {
          nearestGap = gap;
          nearest = i;
        }
        const body = gate.firstElementChild as HTMLElement | null;
        if (body) body.style.opacity = String(clamp01(1 - (gap - 0.1) / 0.28));
      });
      dots.forEach((dot, i) => {
        if (i === nearest) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvas} aria-hidden="true" className="stage-ground fixed inset-0 h-full w-full" />;
}
