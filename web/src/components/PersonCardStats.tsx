import { Badge, Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatIsoDate, formatRelativeTime, formatTimestamp } from "../utils/datetime";
import type { PersonCard as PersonCardData } from "../utils/teamRows";

// A stat line: dimmed label + value (relative phrase with the exact date in the title),
// or a dimmed "never" when there is nothing yet.
function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {children}
    </Group>
  );
}

// An epoch-ms stat value: relative phrase (exact timestamp in the title), or a dimmed "never".
function TimeStat({ at }: { at: number | null }) {
  const { t, i18n } = useTranslation();
  return at != null ? (
    <Text size="xs" title={formatTimestamp(at)}>
      {formatRelativeTime(at, i18n.language)}
    </Text>
  ) : (
    <Text size="xs" c="dimmed">
      {t("users.statNever")}
    </Text>
  );
}

// The dashboard-card stats block shared by the "My managers" and "My subordinates" grids.
// The labels are deliberately direction-neutral — each card is about the pictured person,
// so "Last 1:1" / "Last feedback" read correctly whichever party ran/provided it.
export default function PersonCardStats({ person }: { person: PersonCardData }) {
  const { t, i18n } = useTranslation();
  return (
    <Stack gap={4}>
      <StatRow label={t("users.lastOneOnOne")}>
        {person.lastOneOnOneDate != null ? (
          <>
            <Text size="xs" title={formatIsoDate(person.lastOneOnOneDate, i18n.language)}>
              {formatRelativeTime(new Date(`${person.lastOneOnOneDate}T00:00:00`).getTime(), i18n.language)}
            </Text>
            <Badge
              size="sm"
              variant="light"
              color={(person.lastOneOnOneOpenItems ?? 0) > 0 ? "yellow" : "green"}
              style={{ minWidth: "max-content" }}
            >
              {t("users.openItemsBadge", { count: person.lastOneOnOneOpenItems ?? 0 })}
            </Badge>
          </>
        ) : (
          <Text size="xs" c="dimmed">
            {t("users.statNever")}
          </Text>
        )}
      </StatRow>
      <StatRow label={t("users.lastFeedback")}>
        <TimeStat at={person.lastFeedbackAt} />
      </StatRow>
    </Stack>
  );
}

// The peers-grid variant: no 1:1 row (peers don't run 1:1s with each other) — instead the
// two feedback directions between the caller and the pictured person.
export function PeerCardStats({ person }: { person: PersonCardData }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <StatRow label={t("users.feedbackFromMe")}>
        <TimeStat at={person.lastFeedbackGivenAt} />
      </StatRow>
      <StatRow label={t("users.feedbackFromThem")}>
        <TimeStat at={person.lastFeedbackReceivedAt} />
      </StatRow>
    </Stack>
  );
}
