import { Group, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { FeedbackStatus, FeedbackVisibility } from "../api/feedbacks";
import { formatTimestamp } from "../utils/datetime";
import { StatusBadge, VisibilityBadge } from "./FeedbackBadges";
import PersonaChip from "./PersonaChip";

/**
 * The compact metadata header shared by the feedback view and edit screens: title with
 * status/visibility badges, a one-line "who" summary (provider → subject, requested by …),
 * and a dimmed last-modified line. Replaces the old 2×3 grid of disabled inputs so the
 * Content tab below gets the bulk of the viewport.
 *
 * `visibility` is display-only — the edit screen omits it here (its interactive Select
 * lives with the editor) while the view screen shows it as a badge.
 */
export default function FeedbackMeta({
  title,
  status,
  visibility,
  providerDisplay,
  subjectDisplay,
  requesterDisplay,
  lastModified,
}: {
  title: string;
  status?: FeedbackStatus;
  visibility?: FeedbackVisibility;
  providerDisplay: string;
  subjectDisplay: string;
  requesterDisplay?: string;
  lastModified?: number;
}) {
  const { t } = useTranslation();
  // The app-wide person convention: PersonaChip for a named party, plain text for the
  // current user. Both callers resolve self to t("common.state.you"), so that literal is
  // the chip-vs-plain discriminator.
  const party = (display: string) =>
    display === t("common.state.you") ? (
      <Text size="sm">{display}</Text>
    ) : (
      <PersonaChip name={display} />
    );
  return (
    <Stack gap={4}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Title order={2}>{title}</Title>
        <Group gap="xs" wrap="nowrap">
          {status && <StatusBadge status={status} />}
          {visibility && <VisibilityBadge visibility={visibility} />}
        </Group>
      </Group>
      <Group gap={8} wrap="wrap">
        {party(providerDisplay)}
        <Text size="sm" c="dimmed">
          →
        </Text>
        {party(subjectDisplay)}
        {requesterDisplay != null && (
          <>
            <Text size="sm" c="dimmed">
              ·
            </Text>
            <Text size="sm" c="dimmed">
              {t("feedback.requestedBy")}
            </Text>
            {party(requesterDisplay)}
          </>
        )}
      </Group>
      {lastModified != null && (
        <Text size="sm" c="dimmed">
          {t("feedback.lastModifiedLine", { when: formatTimestamp(lastModified) })}
        </Text>
      )}
    </Stack>
  );
}
