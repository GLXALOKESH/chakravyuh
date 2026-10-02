import { ROLES } from "@/lib/constants";
import { buildFormation, GATE, gateStart } from "@/lib/formation";
import type { RingDetail } from "@/lib/types";

const TAU = Math.PI * 2;

function arcPath(radius: number, start: number) {
  const end = start + TAU - GATE;
  const p = (a: number) => `${(Math.cos(a) * radius).toFixed(2)} ${(Math.sin(a) * radius).toFixed(2)}`;
  return `M ${p(start)} A ${radius} ${radius} 0 1 1 ${p(end)}`;
}

/**
 * A small drawing. Given a ring, its money flow in miniature: accounts in
 * their role colours, joined by the transfers between them. Given none, the
 * Chakravyuh mark of gated concentric layers.
 */
export function FormationGlyph({
  ring,
  size,
  layers = 5,
  className,
}: {
  ring?: RingDetail;
  size: number;
  layers?: number;
  className?: string;
}) {
  const formation = ring ? buildFormation(ring) : null;
  const radius = 44;
  // The flow is shrunk to sit inside the disc it is shown on.
  const k = formation ? Math.min(62 / (formation.width || 1), 52 / (formation.height || 1), 0.5) : 1;
  const at = new Map(formation?.nodes.map((n) => [n.id, { x: n.x * k, y: n.y * k }]));
  return (
    <svg
      viewBox="-50 -50 100 100"
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
      className={className}
      aria-hidden="true"
    >
      {!formation &&
        Array.from({ length: layers }, (_, i) => (
          <path
            key={i}
            d={arcPath((radius * (i + 1)) / layers, gateStart(i + 1))}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            strokeLinecap="round"
          />
        ))}
      {formation?.flows.map((f) => {
        const p = at.get(f.from);
        const q = at.get(f.to);
        return p && q ? (
          <line key={`${f.from}>${f.to}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#f3ecdd" strokeOpacity="0.5" strokeWidth="1" />
        ) : null;
      })}
      {formation?.nodes.map((n) => {
        const p = at.get(n.id)!;
        if (n.type !== "account") {
          return (
            <rect
              key={n.id}
              x={p.x - 3.2}
              y={p.y - 3.2}
              width="6.4"
              height="6.4"
              transform={n.type === "victim" ? `rotate(45 ${p.x} ${p.y})` : undefined}
              fill={n.type === "victim" ? "#f3ecdd" : "#f4a915"}
            />
          );
        }
        if (n.role === "member") {
          return <circle key={n.id} cx={p.x} cy={p.y} r="3.2" fill="#5b0f1e" stroke={ROLES.member.color} strokeWidth="1.8" />;
        }
        return <circle key={n.id} cx={p.x} cy={p.y} r="4" fill={n.role ? ROLES[n.role].color : "#f3ecdd"} />;
      })}
    </svg>
  );
}
