/**
 * The Shared screen's Open target: the server-derived `link` (the document's view path) plus
 * `back=` — the current URL, tab and filters included — so the view page's Close returns to the
 * exact list the click came from. The `link` is a bare in-app path today; a `?` in it is
 * tolerated all the same.
 */
export function shareOpenLink(link: string, back: string): string {
  return `${link}${link.includes("?") ? "&" : "?"}back=${encodeURIComponent(back)}`;
}
