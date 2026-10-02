import { ROLE_ORDER, ROLES } from "@/lib/constants";

function Mark({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <svg viewBox="0 0 20 14" className="h-3.5 w-5" aria-hidden="true">
        {children}
      </svg>
      {label}
    </li>
  );
}

/** Colour is never the only cue: every role and mark on the stage is named here. */
export function GraphLegend() {
  return (
    <ul
      aria-label="Graph legend"
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-stage-line px-5 py-2.5 text-base font-medium text-on-stage"
    >
      {ROLE_ORDER.map((role) => (
        <Mark key={role} label={ROLES[role].label}>
          {role === "member" ? (
            <circle cx="10" cy="7" r="4.800" fill="none" stroke={ROLES[role].color} strokeWidth="2.400" />
          ) : (
            <circle cx="10" cy="7" r="6" fill={ROLES[role].color} />
          )}
        </Mark>
      ))}
      <Mark label="Victim">
        <rect x="5.500" y="2.500" width="9" height="9" transform="rotate(45 10 7)" fill="#f3ecdd" />
      </Mark>
      <Mark label="Cash withdrawn">
        <rect x="5" y="2" width="10" height="10" fill="#f4a915" />
      </Mark>
      <Mark label="Money moving">
        <path d="M0 7h13" stroke="#f3ecdd" strokeOpacity="0.6" strokeWidth="2" />
        <path d="M13 2.500 20 7l-7 4.500Z" fill="#f3ecdd" fillOpacity="0.6" />
        <circle cx="6" cy="7" r="3.500" fill="#f4a915" />
      </Mark>
      <Mark label="Shared device or phone">
        <path d="M0 7h20" stroke="#f3ecdd" strokeWidth="1.500" strokeDasharray="4 3" />
      </Mark>
      <Mark label="Other accounts and their transfers">
        <path d="M4 4.500 16 9.500" stroke="#d9a9a4" strokeOpacity="0.6" strokeWidth="1.200" />
        <circle cx="4" cy="4.500" r="2.200" fill="#d9a9a4" />
        <circle cx="16" cy="9.500" r="2.200" fill="#d9a9a4" />
      </Mark>
    </ul>
  );
}
