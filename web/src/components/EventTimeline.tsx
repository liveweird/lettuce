import type { ReactNode } from "react";
import { Alert, Loader, Text, Timeline } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../utils/datetime";
import { loadErrorMessage } from "../utils/saveError";

// userName null = a system-originated event (no acting user) — see infra/db/EventLog.kt.
type TimelineEvent = { id: number; userName: string | null; timestamp: number };

/**
 * The shared audit-history timeline shell behind the seven per-area histories (feedback,
 * goals, 1:1s, team KPIs, reviews, impact log, succession plans): loading spinner, load-error
 * Alert, empty-state note, then the newest-first Timeline with a `who · when` meta line per
 * event. The per-area components keep their query and `describeEvent` renderer and pass them
 * in — only the shell is shared (2026-08 review round; it was near-copied five times, and only
 * the review history had a loading state).
 *
 * A null `userName` (v3.11.0/V80 — the seven `*_events` tables' nullable `user_id`) means the
 * event was system-originated (e.g. the feedback expiry sweep's REQUEST_EXPIRED); the meta line
 * then renders the generic `common.systemActor` label instead of a resolved name.
 */
export default function EventTimeline<E extends TimelineEvent>({
  events,
  isLoading,
  isError,
  error,
  emptyMessage,
  renderTitle,
  renderBody,
}: {
  events: E[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  emptyMessage: string;
  renderTitle: (e: E) => string;
  // Optional per-event content under the title (the goal progress comment) — most areas omit it.
  renderBody?: (e: E) => ReactNode;
}) {
  const { t, i18n } = useTranslation();

  if (isLoading) return <Loader size="sm" />;
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
        {emptyMessage}
      </Text>
    );
  }

  return (
    <Timeline bulletSize={12} lineWidth={2}>
      {events.map((e) => (
        <Timeline.Item key={e.id} title={renderTitle(e)}>
          {renderBody?.(e)}
          <Text size="xs" c="dimmed">
            {e.userName ?? t("common.systemActor")} · {formatDateTime(e.timestamp, i18n.language)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
