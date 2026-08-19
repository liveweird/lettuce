import { Alert, Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listOneOnOneEvents, type OneOnOneEvent } from "../api/oneonones";
import { formatIsoDate, formatTimestamp } from "../utils/datetime";
import { loadErrorMessage } from "../utils/saveError";

// Render a structured 1:1 audit event in the current language. Params carry positions/dates/
// owner enum names only (never item text), so the wording is position-anchored.
function describeEvent(
  e: OneOnOneEvent,
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

/** The 1:1 meeting's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function OneOnOneHistory({
  meetingId,
  managerName,
  subordinateName,
}: {
  meetingId: number;
  managerName: string;
  subordinateName: string;
}) {
  const { t, i18n } = useTranslation();
  const { data: events, isError, error } = useQuery({
    queryKey: ["oneOnOneEvents", meetingId],
    queryFn: () => listOneOnOneEvents(meetingId),
  });

  const ownerName = (owner: string) =>
    owner === "MANAGER" ? managerName : owner === "SUBORDINATE" ? subordinateName : owner;

  if (isError) {
    // A failed history load must not masquerade as an empty history (v2.24.0).
    return (
      <Alert color="red" variant="light">
        {loadErrorMessage(error, t)}
      </Alert>
    );
  }

  if (!events || events.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("oneOnOne.noHistory")}
      </Text>
    );
  }

  return (
    <Timeline bulletSize={12} lineWidth={2}>
      {events.map((e) => (
        <Timeline.Item key={e.id} title={describeEvent(e, t, i18n.language, ownerName)}>
          <Text size="xs" c="dimmed">
            {e.userName} · {formatTimestamp(e.timestamp)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
