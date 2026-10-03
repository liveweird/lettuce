import type { DaysOffType } from "../api/daysoff";

/**
 * The days-off list's multi-select Type filter (v4.13.0). One flat set of picks over a grouped
 * control: `PAID` = "All paid", `pool:<kind id>` = one paid pool, `UNPAID`. A pick is a string
 * token so the whole selection persists as a plain string array.
 */
export const POOL_PICK_PREFIX = "pool:";

export const isTypePick = (v: unknown): v is string =>
  v === "PAID" || v === "UNPAID" || (typeof v === "string" && /^pool:\d+$/.test(v));

const poolIdOf = (pick: string): number | null =>
  pick.startsWith(POOL_PICK_PREFIX) ? Number(pick.slice(POOL_PICK_PREFIX.length)) : null;

/**
 * Last pick wins between "All paid" and an individual pool (the two overlap: all-paid subsumes
 * every pool, and the server narrows ONLY the paid branch by pool): adding "All paid" drops the
 * pool picks, adding a pool drops "All paid". UNPAID is independent.
 */
export function nextTypePicks(previous: readonly string[], next: string[]): string[] {
  const added = next.find((pick) => !previous.includes(pick));
  if (added === "PAID") return next.filter((pick) => poolIdOf(pick) == null);
  if (added != null && poolIdOf(added) != null) return next.filter((pick) => pick !== "PAID");
  return next;
}

/** Drops pool picks whose kind was archived since (the registry lists active kinds only) —
 * once the registry has loaded; until then the stored picks stand. */
export function livePicks(picks: readonly string[], activePoolIds: readonly number[] | undefined): string[] {
  if (activePoolIds == null) return [...picks];
  return picks.filter((pick) => {
    const id = poolIdOf(pick);
    return id == null || activePoolIds.includes(id);
  });
}

/** True when any pick names a pool — the request then waits for the registry to validate it. */
export const hasPoolPick = (picks: readonly string[]): boolean => picks.some((pick) => poolIdOf(pick) != null);

/**
 * The picks as the list's query params: `type` is the set over PAID/UNPAID (PAID when "All paid"
 * OR any pool is picked), `poolTypeId` the picked pools — only when "All paid" is NOT picked
 * (the server narrows just the paid branch; a pool set beside a PAID-less type set is a 400, and
 * a pool pick always brings PAID into `type`, so that combination is unreachable).
 */
export function typePicksToQuery(picks: readonly string[]): { type?: DaysOffType[]; poolTypeId?: number[] } {
  const pools = picks.map(poolIdOf).filter((id): id is number => id != null);
  const paidAll = picks.includes("PAID");
  const type: DaysOffType[] = [
    ...(paidAll || pools.length > 0 ? (["PAID"] as const) : []),
    ...(picks.includes("UNPAID") ? (["UNPAID"] as const) : []),
  ];
  return {
    type: type.length > 0 ? type : undefined,
    poolTypeId: !paidAll && pools.length > 0 ? pools : undefined,
  };
}
