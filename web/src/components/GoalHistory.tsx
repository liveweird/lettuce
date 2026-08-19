import { dynamicKey } from "../utils/i18nKey";
import { Alert, Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listGoalEvents, type GoalEvent } from "../api/goals";
import { formatIsoDate, formatTimestamp } from "../utils/datetime";
import { loadErrorMessage } from "../utils/saveError";

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
      return t("goal.event.created", { type: t(dynamicKey(`goal.type.${p.type}`)) });
    case "TITLE_CHANGED":
      return t("goal.event.titleChanged");
    case "DESCRIPTION_CHANGED":
      return t("goal.event.descriptionChanged");
    case "TYPE_CHANGED":
      return t("goal.event.typeChanged", {
        from: t(dynamicKey(`goal.type.${p.from}`)),
        to: t(dynamicKey(`goal.type.${p.to}`)),
      });
    case "TARGET_CHANGED":
      // An empty side means "no target" (the PLAN side of a type change).
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
      // Historical only: the pre-v2.9.0 BINARY type's flag flip — stored rows still render.
      return p.to === "true" ? t("goal.event.achievedYes") : t("goal.event.achievedNo");
    case "MILESTONE_ADDED":
      return t("goal.event.milestoneAdded", { position: p.position });
    case "MILESTONE_EDITED":
      return t("goal.event.milestoneEdited", { position: p.position });
    case "MILESTONE_REMOVED":
      return t("goal.event.milestoneRemoved", { position: p.position });
    case "MILESTONE_COMPLETED":
      return t("goal.event.milestoneCompleted", { position: p.position });
    case "MILESTONE_REOPENED":
      return t("goal.event.milestoneReopened", { position: p.position });
    case "STATUS_CHANGED":
      return t("goal.event.statusChanged", {
        from: t(dynamicKey(`goal.status.${p.from}`)),
        to: t(dynamicKey(`goal.status.${p.to}`)),
      });
    case "DELETED":
      return t("goal.event.deleted");
    default:
      // Forward-compat: an event kind this client build doesn't know yet — show the raw type.
      return e.type;
  }
}

/** The goal's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function GoalHistory({ goalId }: { goalId: number }) {
  const { t, i18n } = useTranslation();
  const { data: events, isError, error } = useQuery({
    queryKey: ["goalEvents", goalId],
    queryFn: () => listGoalEvents(goalId),
  });

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
