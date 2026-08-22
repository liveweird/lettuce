// Shared query/route-param parsing helpers.

/** A strictly positive integer from a URL/search param, or null for anything else. */
export function parsePositiveInt(value: string | null): number | null {
  const n = Number(value);
  return value != null && Number.isInteger(n) && n > 0 ? n : null;
}
