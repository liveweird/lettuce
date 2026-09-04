/** Whether an ISO `YYYY-MM-DD` day falls outside an optional inclusive [min, max] window
 *  (ISO strings compare lexicographically) — the DateField calendar's excluded days. */
export function isOutsideIsoRange(iso: string, minIso?: string, maxIso?: string): boolean {
  return (minIso != null && minIso !== "" && iso < minIso) || (maxIso != null && maxIso !== "" && iso > maxIso);
}
