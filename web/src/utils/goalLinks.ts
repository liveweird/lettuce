// Builder for the goal create-flow URL, so the query-string shape (and encodeURIComponent)
// lives in one place instead of being hand-assembled at every call site — the oneOnOneLinks
// pattern. `subordinateName` and `back` are each appended only when given.
export function goalCreateLink(
  subordinateId: number,
  subordinateName?: string | null,
  back?: string,
): string {
  let url = `/goals/new?subordinateId=${subordinateId}`;
  if (subordinateName) url += `&subordinateName=${encodeURIComponent(subordinateName)}`;
  if (back) url += `&back=${encodeURIComponent(back)}`;
  return url;
}
