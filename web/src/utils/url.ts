/**
 * The sanitized `?back=` return target (v2.35.0, monkey-test SPA-2). The param is
 * attacker-influencable (a crafted link), and React Router renders an absolute cross-origin
 * `to` as a real external anchor — so a raw value turns Cancel/Close into an open redirect.
 * Only an in-app pathname is accepted: exactly one leading "/" (a protocol-relative
 * "//evil.example" is NOT in-app), anything else — schemes, encoded variants, junk — is null
 * and the caller falls back to its default. Every reader of `back` goes through this.
 */
export function safeBackParam(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("back");
  return raw != null && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

// Reduce a notification link to its in-app relative path so navigation preserves
// this app's protocol/host/port. An absolute or cross-origin URL is stripped to
// path + query + hash; a relative value is returned (root-normalized).
export function toRelativePath(link: string): string {
  try {
    const u = new URL(link, window.location.origin);
    return u.pathname + u.search + u.hash;
  } catch {
    return link.startsWith("/") ? link : `/${link}`;
  }
}
