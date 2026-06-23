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
