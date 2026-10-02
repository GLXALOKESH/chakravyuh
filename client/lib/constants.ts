import type { Role, ViewMode } from "./types";

// Role colours are placeholders kept in one place (PRODUCT.md). They are tuned
// to read on the oxblood stage; turmeric is reserved for money and live state.
export const ROLES: Record<Role, { label: string; color: string }> = {
  source: { label: "Source", color: "#f6f0e0" },
  mule: { label: "Mule", color: "#ff9db5" },
  relay: { label: "Relay", color: "#3ccbb8" },
  cashout: { label: "Cash-out", color: "#6fb8ff" },
  coordinator: { label: "Coordinator", color: "#c6e24a" },
  // Drawn hollow, so it differs from the other roles by shape as well as colour.
  member: { label: "Member", color: "#f3ecdd" },
};

export const ROLE_ORDER: Role[] = ["source", "mule", "relay", "cashout", "coordinator", "member"];

export const COLORS = {
  stone: "#f3ecdd",
  turmeric: "#f4a915",
  stageDeep: "#3f0914",
  crowd: "#d9a9a4",
  crowdHot: "#fff6e6",
} as const;

/** Tab a ring opens on, by view (PRODUCT.md: Police opens Taint, Bank opens Freeze). */
export const VIEW_TAB: Record<ViewMode, string> = { police: "taint", bank: "freeze" };

export const SPEEDS = [0.5, 1, 2, 4] as const;

/** Replay seconds per real second at 1x: the three-hour demo window in about 60 s. */
export const BASE_SPEED = 180;

export function ringHref(ringId: string, view: ViewMode) {
  return `/rings/${ringId}?tab=${VIEW_TAB[view]}`;
}

export function ringLabel(ringId: string) {
  return `Ring ${ringId.replace(/\D/g, "")}`;
}
