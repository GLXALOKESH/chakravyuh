"use client";

import { useMemo } from "react";
import { ROLES } from "@/lib/constants";
import { buildFormation, COL, ROW } from "@/lib/formation";
import { inr, pct } from "@/lib/format";
import type { Recruit, RingDetail } from "@/lib/types";

/** The short form of an account id that fits under a node: its last four characters. */
export const shortId = (id: string) => id.slice(-4);

/**
 * One ring as a flow diagram, read left to right: the victim, then one column
 * per hop of the money, then the cash withdrawn. Every account can be
 * selected, the freeze set carries a heavy turmeric outline, and likely
 * recruits wait in a row underneath with a dashed outline.
 */
export function RingCanvas({
  ring,
  selected,
  onSelect,
  frozen,
  recruits,
}: {
  ring: RingDetail;
  selected: string | null;
  onSelect: (id: string | null) => void;
  frozen: string[];
  recruits: Recruit[];
}) {
  const formation = useMemo(() => buildFormation(ring), [ring]);
  const at = new Map(formation.nodes.map((n) => [n.id, n]));
  const size = (id: string) => {
    const n = at.get(id);
    return !n ? 0 : n.type === "account" ? 9 + n.risk * 4 : 10;
  };
  const peak = Math.max(...formation.flows.map((f) => f.amount), 1);
  const freeze = new Set(frozen);

  const hw = formation.width / 2;
  const hh = formation.height / 2;
  const recruitY = hh + ROW * 1.3;
  const bottom = recruits.length ? recruitY + 24 : hh + 44;
  // Room at the sides for the role key on the left and the "Cash withdrawn" caption on the right.
  const box = { x: -hw - 150, y: -hh - 46, w: formation.width + 300, h: bottom + hh + 46 };

  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-full w-full" role="group" aria-label="Money flow through the ring">
      <defs>
        <marker id="ring-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M0 0 10 5 0 10Z" fill="#f3ecdd" fillOpacity="0.8" />
        </marker>
      </defs>

      {formation.links.map(([a, b], i) => {
        const p = at.get(a);
        const q = at.get(b);
        return p && q ? (
          <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#f3ecdd" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="5 5" />
        ) : null;
      })}

      {formation.flows.map((f) => {
        const p = at.get(f.from);
        const q = at.get(f.to);
        if (!p || !q) return null;
        const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const ux = (q.x - p.x) / d;
        const uy = (q.y - p.y) / d;
        const a = size(f.from) + 3;
        const b = size(f.to) + 5;
        return (
          <line
            key={`${f.from}>${f.to}`}
            x1={p.x + ux * a}
            y1={p.y + uy * a}
            x2={q.x - ux * b}
            y2={q.y - uy * b}
            stroke="#f3ecdd"
            strokeOpacity="0.55"
            strokeWidth={1.2 + 3.4 * Math.sqrt(f.amount / peak)}
            markerEnd="url(#ring-arrow)"
          >
            <title>{inr(f.amount)}</title>
          </line>
        );
      })}

      {formation.nodes.map((n) => {
        if (n.type !== "account") {
          const s = 9;
          return (
            <g key={n.id}>
              <rect
                x={n.x - s}
                y={n.y - s}
                width={s * 2}
                height={s * 2}
                transform={n.type === "victim" ? `rotate(45 ${n.x} ${n.y})` : undefined}
                fill={n.type === "victim" ? "#f3ecdd" : "#f4a915"}
              />
              <text x={n.x} y={n.y + 31} textAnchor="middle" className="fill-on-stage text-[15px] font-semibold">
                {n.type === "victim" ? "Victim" : "Cash withdrawn"}
              </text>
            </g>
          );
        }
        const r = size(n.id);
        const role = n.role ?? "member";
        const isSelected = selected === n.id;
        return (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`${n.id}, ${ROLES[role].label}, ${pct(n.risk)} risk${freeze.has(n.id) ? ", recommended to freeze" : ""}`}
            className="ring-node cursor-pointer outline-none"
            onClick={() => onSelect(isSelected ? null : n.id)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onSelect(isSelected ? null : n.id);
            }}
          >
            {/* a generous target, and the focus ring */}
            <circle cx={n.x} cy={n.y} r={r + 9} fill="transparent" className="ring-node-halo" />
            {freeze.has(n.id) && <circle cx={n.x} cy={n.y} r={r + 5.5} fill="none" stroke="#f4a915" strokeWidth="4" />}
            {isSelected && <circle cx={n.x} cy={n.y} r={r + (freeze.has(n.id) ? 11 : 6)} fill="none" stroke="#f3ecdd" strokeWidth="2" />}
            {role === "member" ? (
              <circle cx={n.x} cy={n.y} r={r - 2.5} fill="#3f0914" stroke={ROLES.member.color} strokeWidth="5" />
            ) : (
              <circle cx={n.x} cy={n.y} r={r} fill={ROLES[role].color} />
            )}
            <text x={n.x} y={n.y + r + 15} textAnchor="middle" className="fig fill-on-stage text-[14px]" style={{ paintOrder: "stroke", stroke: "#5b0f1e", strokeWidth: 4 }}>
              {shortId(n.id)}
            </text>
          </g>
        );
      })}

      {recruits.map((c, i) => {
        const x = (i - (recruits.length - 1) / 2) * COL * 0.7;
        return (
          <g
            key={c.id}
            role="button"
            tabIndex={0}
            aria-label={`${c.id}, likely recruit, ${pct(c.probability)}`}
            className="ring-node cursor-pointer outline-none"
            onClick={() => onSelect(c.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(c.id);
            }}
          >
            <circle cx={x} cy={recruitY} r="20" fill="transparent" className="ring-node-halo" />
            <circle cx={x} cy={recruitY} r="11" fill="none" stroke="#f3ecdd" strokeWidth="2.5" strokeDasharray="6 5" />
          </g>
        );
      })}
    </svg>
  );
}
