import { useLocation } from "react-router-dom";

/**
 * The current in-app URL as a return target (v4.6.0): `pathname + search`, no hash. The "current
 * URL as back" idiom every origin-emitting surface (PersonCell, TeamBadges, the hub header
 * "New …" buttons) sends as `?back=` / `?cancel=`, so the destination lands exactly where the
 * user was — tab and filters included. Always feed it through a link builder, which encodes it.
 */
export function useCurrentPath(): string {
  const { pathname, search } = useLocation();
  return `${pathname}${search}`;
}
