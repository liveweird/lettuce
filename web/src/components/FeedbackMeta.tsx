import { Badge, Group, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { FeedbackStatus, FeedbackVisibility } from "../api/client";
import { formatTimestamp } from "../utils/datetime";

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  REQUESTED: "blue",
  DRAFT: "gray",
  SENT: "green",
  WITHDRAWN: "orange",
  REJECTED: "red",
};

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
  return (
    <Stack gap={4}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Title order={2}>{title}</Title>
        <Group gap="xs" wrap="nowrap">
          {status && (
            <Badge color={STATUS_COLOR[status]} variant="filled" aria-label={t("common.field.status")}>
              {t(`common.status.${status}`)}
            </Badge>
          )}
          {visibility && (
            <Badge variant="light" aria-label={t("common.field.visibility")}>
              {t(`common.visibility.${visibility}`)}
            </Badge>
          )}
        </Group>
      </Group>
      <Text>
        {requesterDisplay
          ? t("feedback.peopleLineRequested", {
              provider: providerDisplay,
              subject: subjectDisplay,
              requester: requesterDisplay,
            })
          : t("feedback.peopleLine", { provider: providerDisplay, subject: subjectDisplay })}
      </Text>
      {lastModified != null && (
        <Text size="sm" c="dimmed">
          {t("feedback.lastModifiedLine", { when: formatTimestamp(lastModified) })}
        </Text>
      )}
    </Stack>
  );
}
