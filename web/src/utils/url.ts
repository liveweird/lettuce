/** Longest return target accepted at all — far above anything [boundedReturnPath] emits. */
const MAX_IN_APP_PATH_LENGTH = 2048;

/**
 * The in-app-path predicate behind every return-target param (`back`, `cancel`): exactly one
 * leading "/" — a protocol-relative "//evil.example" is NOT in-app — with no backslash and no
 * ASCII control character anywhere (v4.6.0): browsers normalise "\" to "/" and STRIP tab, CR
 * and LF while resolving a URL, so "/\evil.example" and "/<TAB>/evil.example" both become
 * "//evil.example"; React Router would treat them as relative paths, history.pushState rejects
 * the cross-origin result, and the router falls back to location.assign — a real open redirect.
 * As a belt-and-braces check the value must also resolve to the same origin against a sentinel
 * base. Over-long values are refused too. Anything else — schemes, junk — is null.
 */
export function inAppPath(raw: string | null): string | null {
  if (raw == null || raw.length > MAX_IN_APP_PATH_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  try {
    const sentinel = "http://in-app.invalid";
    return new URL(raw, sentinel).origin === sentinel ? raw : null;
  } catch {
    return null;
  }
}

/** A return path longer than this drops its own nested `back`/`cancel` (see [boundedReturnPath]). */
export const MAX_RETURN_PATH_LENGTH = 1024;

/**
 * Keeps nested return chains bounded (v4.6.0). A return path carries the page's whole query —
 * including ITS `back` — so a round trip (user → team badge → roster person → team badge …)
 * wraps and re-encodes the previous URL at every hop, growing quadratically (~4 KB after ten
 * cycles, past Netty's request-line limit on a reload or shared link). Past
 * [MAX_RETURN_PATH_LENGTH] the path drops its own `back`/`cancel`: the chain resets one level up
 * — that page's Back falls to its default parent — instead of compounding.
 */
export function boundedReturnPath(path: string): string {
  if (path.length <= MAX_RETURN_PATH_LENGTH) return path;
  const queryStart = path.indexOf("?");
  if (queryStart < 0) return path;
  const params = new URLSearchParams(path.slice(queryStart + 1));
  params.delete("back");
  params.delete("cancel");
  const query = params.toString();
  return query ? `${path.slice(0, queryStart)}?${query}` : path.slice(0, queryStart);
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
