import type { TFunction } from "i18next";
import { formatIsoDate } from "./datetime";
import type { OneOnOneEvent } from "../api/oneonones";

// Render a structured 1:1 audit event in the current language. Params carry positions/dates/
// owner enum names only (never item text), so the wording is position-anchored.
export function describeOneOnOneEvent(
  e: Pick<OneOnOneEvent, "type" | "params">,
  t: TFunction,
  locale: string,
  ownerName: (owner: string) => string,
): string {
  const p = e.params ?? {};
  const date = (iso: string | undefined) => (iso ? formatIsoDate(iso, locale) : "");
  switch (e.type) {
    case "CREATED":
      return t("oneOnOne.event.created", {
        date: date(p.date),
        count: Number(p.carriedOver ?? 0),
      });
    case "DELETED":
      return t("oneOnOne.event.deleted");
    case "DATE_CHANGED":
      return t("oneOnOne.event.dateChanged", { from: date(p.from), to: date(p.to) });
    case "POINT_ADDED":
      return t("oneOnOne.event.pointAdded", { position: p.position });
    case "POINT_EDITED":
      return t("oneOnOne.event.pointEdited", { position: p.position });
    case "POINT_REMOVED":
      return t("oneOnOne.event.pointRemoved", { position: p.position });
    case "DECISION_ADDED":
      return t("oneOnOne.event.decisionAdded", { position: p.position });
    case "DECISION_EDITED":
      return t("oneOnOne.event.decisionEdited", { position: p.position });
    case "DECISION_REMOVED":
      return t("oneOnOne.event.decisionRemoved", { position: p.position });
    case "ACTION_ITEM_ADDED":
      return t("oneOnOne.event.actionItemAdded", { position: p.position });
    case "ACTION_ITEM_EDITED":
      return t("oneOnOne.event.actionItemEdited", { position: p.position });
    case "ACTION_ITEM_REMOVED":
      return t("oneOnOne.event.actionItemRemoved", { position: p.position });
    case "ACTION_ITEM_RESOLVED":
      return t("oneOnOne.event.actionItemResolved", { position: p.position });
    case "ACTION_ITEM_UNRESOLVED":
      return t("oneOnOne.event.actionItemUnresolved", { position: p.position });
    case "ACTION_ITEM_DUE_DATE_CHANGED":
      // An empty from/to side means "no due date" — the i18next context picks the wording.
      if (!p.to) return t("oneOnOne.event.dueDateCleared", { position: p.position });
      if (!p.from) {
        return t("oneOnOne.event.dueDateSet", { position: p.position, to: date(p.to) });
      }
      return t("oneOnOne.event.dueDateChanged", {
        position: p.position,
        from: date(p.from),
        to: date(p.to),
      });
    case "ACTION_ITEM_OWNER_CHANGED":
      return t("oneOnOne.event.ownerChanged", {
        position: p.position,
        from: ownerName(p.from ?? ""),
        to: ownerName(p.to ?? ""),
      });
    default:
      // Forward-compat: an event kind this client build doesn't know yet — show the raw type.
      return e.type;
  }
}
