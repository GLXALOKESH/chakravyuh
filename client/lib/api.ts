// The only module views fetch data through. Each call goes to the Express
// server (lib/live/api.ts) or, when it is not available, to the in-browser
// demo (lib/mock/api.ts); both return the shapes in lib/types.ts. The demo is
// loaded only when it is used, so a live page does not download it.

import { dataSource } from "./source";
import type { EvidenceRequest, FreezeRequest } from "./types";

const impl = async () => ((await dataSource()) === "live" ? import("./live/api") : import("./mock/api"));

export const getAlerts = async () => (await impl()).getAlerts();
export const getRing = async (id: string) => (await impl()).getRing(id);
/** `live`: the account as the live run knows it, rather than from the stored data. */
export const getAccount = async (id: string, live = false) => (await impl()).getAccount(id, live);
export const getTaint = async (id: string, query: { txn?: string; as_of?: string } = {}) => (await impl()).getTaint(id, query);
export const postFreeze = async (id: string, body: FreezeRequest) => (await impl()).postFreeze(id, body);
export const getRecruits = async (id: string) => (await impl()).getRecruits(id);
export const getRingGeo = async (id: string) => (await impl()).getRingGeo(id);
export const getMetrics = async () => (await impl()).getMetrics();
export const getLedger = async (live = false) => (await impl()).getLedger(live);

/** The evidence pack PDF. Only the server can build one; the demo answers null. */
export async function postEvidence(id: string, body: EvidenceRequest): Promise<Blob | null> {
  if ((await dataSource()) !== "live") return null;
  return (await import("./live/api")).postEvidence(id, body);
}
