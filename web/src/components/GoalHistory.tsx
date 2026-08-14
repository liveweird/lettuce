import { Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listGoalEvents, type GoalEvent } from "../api/client";
import { formatIsoDate, formatTimestamp } from "../utils/datetime";

// Render a structured goal audit event in the current language. Params carry enum names and
// numeric values only (never title/description/summary text), so the wording names the aspect,
// not the content.
function describeEvent(e: GoalEvent, t: TFunction, locale: string): string {
  const p = e.params ?? {};
  // Server values are raw Double strings ("40.0"); format per locale, pass anything odd through.
  const num = (raw: string | undefined) => {
    const parsed = Number(raw);
    return raw && Number.isFinite(parsed) ? new Intl.NumberFormat(locale).format(parsed) : (raw ?? "");
  };
  switch (e.type) {
    case "CREATED":
      return t("goal.event.created", { type: t(`goal.type.${p.type}`) });
    case "TITLE_CHANGED":
      return t("goal.event.titleChanged");
    case "DESCRIPTION_CHANGED":
      return t("goal.event.descriptionChanged");
    case "TYPE_CHANGED":
      return t("goal.event.typeChanged", {
        from: t(`goal.type.${p.from}`),
        to: t(`goal.type.${p.to}`),
      });
    case "TARGET_CHANGED":
      // An empty side means "no target" (the BINARY side of a type change).
      if (!p.to) return t("goal.event.targetCleared");
      if (!p.from) return t("goal.event.targetSet", { to: num(p.to) });
      return t("goal.event.targetChanged", { from: num(p.from), to: num(p.to) });
    case "DUE_DATE_CHANGED":
      return t("goal.event.dueDateChanged", {
        from: formatIsoDate(p.from ?? "", locale),
        to: formatIsoDate(p.to ?? "", locale),
      });
    case "PROGRESS_UPDATED":
      // An empty `from` = no previous value (the goal's first update — the targetSet idiom).
      if (!p.from) return t("goal.event.progressSet", { to: num(p.to) });
      return t("goal.event.progressUpdated", { from: num(p.from), to: num(p.to) });
    case "PROGRESS_COMMENTED":
      // A comment-only progress update (v2.8.0) — the comment itself renders below the title.
      return t("goal.event.progressCommented");
    case "ACHIEVED_CHANGED":
      return p.to === "true" ? t("goal.event.achievedYes") : t("goal.event.achievedNo");
    case "STATUS_CHANGED":
      return t("goal.event.statusChanged", {
        from: t(`goal.status.${p.from}`),
        to: t(`goal.status.${p.to}`),
      });
    case "DELETED":
      return t("goal.event.deleted");
    default:
      // Forward-compat: an event kind this client build doesn't know yet — show the raw type.
      return e.type;
  }
}

/** The goal's audit history as a timeline (oldest first), or an empty-state note. */
export default function GoalHistory({ goalId }: { goalId: number }) {
  const { t, i18n } = useTranslation();
  const { data: events } = useQuery({
    queryKey: ["goalEvents", goalId],
    queryFn: () => listGoalEvents(goalId),
  });

  if (!events || events.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("goal.noHistory")}
      </Text>
    );
  }

  return (
    <Timeline bulletSize={12} lineWidth={2}>
      {events.map((e) => (
        <Timeline.Item key={e.id} title={describeEvent(e, t, i18n.language)}>
          {/* The progress update's optional context comment (v2.8.0) — plain text, pre-wrap
              like the archive summary (it is captured in a plain textarea, not markdown). */}
          {e.comment != null && e.comment !== "" && (
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {e.comment}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {e.userName} · {formatTimestamp(e.timestamp)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
