import type { WorkshopStatus } from "../../server/status";

export type FlowPhase = "setup" | "create" | "summoning" | "reveal";

export function flowPhase(status: WorkshopStatus | null): FlowPhase {
  if (!status) return "setup";
  const keysOk = Object.values(status.keys).every((k) => k.present && k.valid === true);
  if (!keysOk) return "setup";
  if (status.model.status === "done") return "reveal";
  if (status.model.status === "running") return "summoning";
  return "create";
}
