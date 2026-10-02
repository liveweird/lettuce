import { Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listGoalEvents } from "../api/goals";
import EventTimeline from "./EventTimeline";
import { describeGoalEvent } from "../utils/goalEventText";


/** The goal's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function GoalHistory({ goalId }: { goalId: number }) {
  const { t, i18n } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["goalEvents", goalId],
    queryFn: () => listGoalEvents(goalId),
  });

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("goal.noHistory")}
      renderTitle={(e) => describeGoalEvent(e, t, i18n.language)}
      renderBody={(e) =>
        e.comment != null && e.comment !== "" ? (
          // The progress update's optional context comment (v2.8.0) — plain text, pre-wrap
          // like the archive summary (it is captured in a plain textarea, not markdown).
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {e.comment}
          </Text>
        ) : null
      }
    />
  );
}
