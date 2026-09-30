/**
 * The in-app-path predicate behind every return-target param (`back`, `cancel`): exactly one
 * leading "/" — a protocol-relative "//evil.example" is NOT in-app — and no "/\" either (v4.6.0:
 * browsers normalise a backslash to a slash, so "/\evil.example" resolves to the same
 * protocol-relative URL). Anything else — schemes, encoded variants, junk — is null.
 */
export function inAppPath(raw: string | null): string | null {
  return raw != null && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")
    ? raw
    : null;
}

/**
 * The sanitized `?back=` return target (v2.35.0, monkey-test SPA-2). The param is
 * attacker-influencable (a crafted link), and React Router renders an absolute cross-origin
 * `to` as a real external anchor — so a raw value turns Cancel/Close into an open redirect.
 * Only an in-app path is accepted (see [inAppPath]); everything else is null and the caller
 * falls back to its default. Every reader of `back` goes through this.
 */
export function safeBackParam(searchParams: URLSearchParams): string | null {
  return inAppPath(searchParams.get("back"));
}

/**
 * The sanitized `?cancel=` target (v4.6.0) — the create screens' Cancel/discard destination
 * where it legitimately differs from `back` (the Save landing). Same rules as `back`.
 */
export function safeCancelParam(searchParams: URLSearchParams): string | null {
  return inAppPath(searchParams.get("cancel"));
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
