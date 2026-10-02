import { ROLES } from "@/lib/constants";
import { buildFormation, GATE, gateStart, nodePoint } from "@/lib/formation";
import type { RingDetail } from "@/lib/types";

const TAU = Math.PI * 2;

function arcPath(radius: number, start: number) {
  const end = start + TAU - GATE;
  const p = (a: number) => `${(Math.cos(a) * radius).toFixed(2)} ${(Math.sin(a) * radius).toFixed(2)}`;
  return `M ${p(start)} A ${radius} ${radius} 0 1 1 ${p(end)}`;
}

/**
 * The formation as a small drawing: gated concentric layers, and when a ring is
 * given, its accounts standing on them in their role colours.
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
  const count = formation?.layers ?? layers;
  const radius = 44;
  return (
    <svg
      viewBox="-50 -50 100 100"
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
      className={className}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <path
          key={i}
          d={arcPath((radius * (i + 1)) / count, gateStart(i + 1))}
          fill="none"
          stroke="currentColor"
          strokeWidth={ring ? 1.6 : 0.7}
          strokeLinecap="round"
        />
      ))}
      {formation?.nodes.map((n) => {
        const p = nodePoint(n, formation.layers, radius);
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
          return <circle key={n.id} cx={p.x} cy={p.y} r="3.2" fill="none" stroke={ROLES.member.color} strokeWidth="1.8" />;
        }
        return <circle key={n.id} cx={p.x} cy={p.y} r="4" fill={n.role ? ROLES[n.role].color : "#f3ecdd"} />;
      })}
    </svg>
  );
}
