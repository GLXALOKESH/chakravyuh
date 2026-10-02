"use client";

import { useMemo } from "react";
import { ROLES } from "@/lib/constants";
import { inr } from "@/lib/format";
import { CASH } from "@/lib/ring";
import type { RingDetail, TaintResult } from "@/lib/types";
import { shortId } from "./RingCanvas";

const VICTIM = "VICTIM";
const W = 760;
const H = 300;
const BAR = 14;
const PAD_X = 64;

interface Box {
  id: string;
  column: number;
  value: number;
  held: number;
  x: number;
  y: number;
  h: number;
}

/**
 * Lays the tainted flows out left to right, one column per hop from the
 * victim, with cash on the far right. Written here, not taken from a Sankey
 * library, because real flows can loop back and those libraries refuse loops.
 */
function layout(taint: TaintResult) {
  const held = new Map(taint.accounts.map((a) => [a.id, a.tainted]));
  const links = taint.links.map((l) => ({ ...l }));
  const ids = new Set<string>([...links.flatMap((l) => [l.source, l.target]), ...held.keys()]);
  const into = (id: string) => links.filter((l) => l.target === id).reduce((s, l) => s + l.value, 0);
  const outOf = (id: string) => links.filter((l) => l.source === id).reduce((s, l) => s + l.value, 0);

  // The victim pays whoever holds or passes on tainted money that no one in the picture paid them.
  for (const id of [...ids]) {
    if (id === CASH) continue;
    const owed = outOf(id) + (held.get(id) ?? 0) - into(id);
    if (owed > 0.5) links.unshift({ source: VICTIM, target: id, value: owed });
  }
  ids.add(VICTIM);

  const column = new Map<string, number>([[VICTIM, 0]]);
  let frontier = [VICTIM];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const l of links) {
        if (l.source !== id || l.target === CASH || column.has(l.target)) continue;
        column.set(l.target, column.get(id)! + 1);
        next.push(l.target);
      }
    }
    frontier = next;
  }
  const last = Math.max(...column.values()) + 1;
  for (const id of ids) if (!column.has(id)) column.set(id, id === CASH ? last : 1);
  const columns = ids.has(CASH) ? last + 1 : last;

  const boxes: Box[] = [...ids].map((id) => ({
    id,
    column: column.get(id)!,
    value: Math.max(into(id), outOf(id) + (held.get(id) ?? 0)),
    held: held.get(id) ?? 0,
    x: 0,
    y: 0,
    h: 0,
  }));
  const gap = 12;
  const byColumn = Array.from({ length: columns }, (_, c) => boxes.filter((b) => b.column === c).sort((a, b) => a.id.localeCompare(b.id)));
  const scale = Math.min(...byColumn.filter((c) => c.length).map((c) => (H - 44 - gap * (c.length - 1)) / c.reduce((s, b) => s + b.value, 0)));
  byColumn.forEach((list, c) => {
    const total = list.reduce((s, b) => s + Math.max(3, b.value * scale), 0) + gap * (list.length - 1);
    let y = (H - total) / 2;
    for (const b of list) {
      b.h = Math.max(3, b.value * scale);
      b.x = PAD_X + (columns > 1 ? (c * (W - 2 * PAD_X - BAR)) / (columns - 1) : 0);
      b.y = y;
      y += b.h + gap;
    }
  });

  const box = new Map(boxes.map((b) => [b.id, b]));
  const used = new Map<string, number>();
  const take = (key: string, amount: number) => {
    const at = used.get(key) ?? 0;
    used.set(key, at + amount);
    return at;
  };
  const ribbons = links
    .slice()
    .sort((a, b) => box.get(a.target)!.y - box.get(b.target)!.y)
    .map((l) => {
      const s = box.get(l.source)!;
      const t = box.get(l.target)!;
      const width = Math.max(1.5, l.value * scale);
      const y0 = s.y + take(`out:${s.id}`, width) + width / 2;
      const y1 = t.y + take(`in:${t.id}`, width) + width / 2;
      const x0 = s.x + BAR;
      const x1 = t.x;
      const mid = (x0 + x1) / 2;
      return { ...l, width, d: `M${x0} ${y0} C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}` };
    });
  return { boxes, ribbons };
}

/** F8: where the victim's money went, and how much of each balance to hold. */
export function TaintTab({
  ring,
  taint,
  selected,
  onSelect,
}: {
  ring: RingDetail;
  taint: TaintResult | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const flow = useMemo(() => (taint && taint.victim_amount > 0 ? layout(taint) : null), [taint]);
  if (!taint) return <p className="p-5 text-on-stone-2">Tracing the money…</p>;
  if (!flow) return <p className="p-5">No tainted money has reached this ring at this point in the replay.</p>;

  const roleOf = new Map(ring.nodes.map((n) => [n.id, n.role]));
  const inRing = taint.accounts.reduce((s, a) => s + a.tainted, 0);
  const lien = taint.accounts.reduce((s, a) => s + a.lien, 0);
  const figures: [string, number, boolean][] = [
    ["Taken from the victim", taint.victim_amount, false],
    ["Still in the ring", inRing, false],
    ["Can be held by lien", lien, true],
    ["Withdrawn as cash", taint.lost_to_cash, false],
  ];

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_19rem]">
      <div className="stage-ground flex min-h-0 flex-col">
        <dl className="flex gap-7 px-5 pt-3 text-on-stage">
          {figures.map(([label, value, strong]) => (
            <div key={label}>
              <dt className="text-on-stage-2">{label}</dt>
              <dd className={`fig text-2xl ${strong ? "text-turmeric" : ""}`}>{inr(value)}</dd>
            </div>
          ))}
        </dl>
        <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" role="img" aria-label="Flow of the victim's money through the ring's accounts">
          {flow.ribbons.map((r) => (
            <path key={`${r.source}>${r.target}`} d={r.d} fill="none" stroke="#f4a915" strokeOpacity="0.5" strokeWidth={r.width}>
              <title>{`${r.source === VICTIM ? "Victim" : r.source} to ${r.target === CASH ? "cash" : r.target}: ${inr(r.value)}`}</title>
            </path>
          ))}
          {flow.boxes.map((b) => {
            const account = b.id !== VICTIM && b.id !== CASH;
            const role = roleOf.get(b.id);
            const fill = b.id === CASH ? "#f4a915" : account && role ? ROLES[role].color : "#f3ecdd";
            const label = b.id === VICTIM ? "Victim" : b.id === CASH ? "Cash" : shortId(b.id);
            const left = b.id === VICTIM;
            return (
              <g
                key={b.id}
                role={account ? "button" : undefined}
                tabIndex={account ? 0 : undefined}
                className={account ? "ring-node cursor-pointer outline-none" : undefined}
                onClick={account ? () => onSelect(b.id) : undefined}
                onKeyDown={account ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(b.id) : undefined}
              >
                <rect x={b.x - 4} y={b.y - 4} width={BAR + 8} height={b.h + 8} fill="transparent" className="ring-node-halo" />
                <rect x={b.x} y={b.y} width={BAR} height={b.h} fill={fill} stroke={selected === b.id ? "#f3ecdd" : "none"} strokeWidth="2.5" />
                <text
                  x={left ? b.x - 7 : b.x + BAR + 7}
                  y={b.y + b.h / 2 + 4.5}
                  textAnchor={left ? "end" : "start"}
                  className="fig fill-on-stage text-[13px]"
                  style={{ paintOrder: "stroke", stroke: "#3f0914", strokeWidth: 3 }}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="rail-scroll min-h-0 overflow-y-auto border-l border-stone-lo px-4 py-3">
        <h3 className="font-bold">Recommended lien per account</h3>
        <table className="mt-1 w-full">
          <thead>
            <tr className="border-b border-stone-lo text-left text-on-stone-2">
              <th className="py-1 font-semibold">Account</th>
              <th className="py-1 text-right font-semibold">Balance</th>
              <th className="py-1 text-right font-semibold">Lien</th>
            </tr>
          </thead>
          <tbody>
            {taint.accounts
              .slice()
              .sort((a, b) => b.lien - a.lien)
              .map((a) => (
                <tr key={a.id} className={`border-b border-stone-lo ${selected === a.id ? "bg-stone-lo" : ""}`}>
                  <td className="py-1">
                    <button type="button" onClick={() => onSelect(a.id)} className="fig rounded font-semibold underline-offset-4 hover:underline">
                      {a.id}
                    </button>
                  </td>
                  <td className="fig py-1 text-right font-medium text-on-stone-2">{inr(a.balance)}</td>
                  <td className="fig py-1 text-right text-stage">{inr(a.lien)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
