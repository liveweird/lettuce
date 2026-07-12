// Builder for the 1:1 create-flow URL, so the query-string shape (and encodeURIComponent) lives in
// one place instead of being hand-assembled at every call site. `subordinateName` and `back` are
// each appended only when given, matching the per-person drill-down link that omits the name.
export function oneOnOneCreateLink(
  subordinateId: number,
  subordinateName?: string | null,
  back?: string,
): string {
  let url = `/one-on-ones/new?subordinateId=${subordinateId}`;
  if (subordinateName) url += `&subordinateName=${encodeURIComponent(subordinateName)}`;
  if (back) url += `&back=${encodeURIComponent(back)}`;
  return url;
}
