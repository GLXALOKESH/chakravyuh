import type { Role } from "./types";

const ROLES: Role[] = ["source", "mule", "relay", "cashout", "coordinator", "member"];

/**
 * A role as the client names it. The server writes "cash-out"; older notes
 * call a coordinator a "controller"; anything else unnamed is a plain member.
 */
export function toRole(value: string | null | undefined): Role {
  const role = (value ?? "").replace(/[^a-z]/gi, "").toLowerCase();
  if (role === "controller") return "coordinator";
  return ROLES.includes(role as Role) ? (role as Role) : "member";
}
