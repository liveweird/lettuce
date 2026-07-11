import { Alert, Badge, Button, Group, SimpleGrid, Skeleton, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  IconCalendarEvent,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconUsersGroup,
} from "@tabler/icons-react";
import { listTeamMembers } from "../api/client";
import EmptyState from "../components/EmptyState";
import PersonCard from "../components/PersonCard";
import { formatIsoDate, formatRelativeTime, formatTimestamp } from "../utils/datetime";
import { feedbackAskLink, feedbackProvideLink } from "../utils/feedbackLinks";
import { groupTeamRows, type PersonCard as PersonCardData } from "../utils/teamRows";

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

function ManagerStats({ m }: { m: PersonCardData }) {
  const { t, i18n } = useTranslation();
  return (
    <Stack gap={4}>
      <StatRow label={t("users.lastOneOnOne")}>
        {m.lastOneOnOneDate != null ? (
          <>
            <Text size="xs" title={formatIsoDate(m.lastOneOnOneDate, i18n.language)}>
              {formatRelativeTime(new Date(`${m.lastOneOnOneDate}T00:00:00`).getTime(), i18n.language)}
            </Text>
            <Badge
              size="sm"
              variant="light"
              color={(m.lastOneOnOneOpenItems ?? 0) > 0 ? "yellow" : "green"}
              style={{ minWidth: "max-content" }}
            >
              {t("users.openItemsBadge", { count: m.lastOneOnOneOpenItems ?? 0 })}
            </Badge>
          </>
        ) : (
          <Text size="xs" c="dimmed">
            {t("users.statNever")}
          </Text>
        )}
      </StatRow>
      <StatRow label={t("users.lastFeedback")}>
        {m.lastFeedbackAt != null ? (
          <Text size="xs" title={formatTimestamp(m.lastFeedbackAt)}>
            {formatRelativeTime(m.lastFeedbackAt, i18n.language)}
          </Text>
        ) : (
          <Text size="xs" c="dimmed">
            {t("users.statNever")}
          </Text>
        )}
      </StatRow>
    </Stack>
  );
}

// The dashboard "My managers" view: a person-card grid (not a table) — typically 1–3 people,
// so narrow cards use the width far better than full-width spreadsheet rows.
export default function ManagersTable() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["managers"],
    queryFn: () => listTeamMembers({ view: "managers", page: 1, pageSize: 100 }),
  });

  const gridCols = { base: 1, sm: 2, lg: 3 };

  if (isLoading && !data) {
    return (
      <SimpleGrid cols={gridCols} spacing="md">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={150} radius="md" />
        ))}
      </SimpleGrid>
    );
  }

  const managers = groupTeamRows(data?.items ?? []);

  return (
    <>
      {isError && (
        <Alert color="red" variant="light" title={t("users.loadManagersFailed")}>
          {error instanceof Error ? error.message : t("users.unknownError")}
        </Alert>
      )}

      {managers.length > 0 ? (
        <SimpleGrid component="ul" m={0} p={0} style={{ listStyle: "none" }} cols={gridCols} spacing="md">
          {managers.map((m) => (
            <PersonCard
              key={m.userId}
              name={m.name}
              email={m.email}
              teamNames={m.teamNames}
              stats={<ManagerStats m={m} />}
              actions={
                <>
                  <Button
                    component={RouterLink}
                    to={feedbackProvideLink(m.userId, m.name, "/?tab=managers")}
                    variant="light"
                    size="xs"
                    leftSection={<IconMessagePlus size={14} />}
                    aria-label={t("users.provideFeedbackTo", { name: m.name })}
                  >
                    {t("users.provideFeedback")}
                  </Button>
                  <Button
                    component={RouterLink}
                    to={feedbackAskLink(m.userId, m.name, "/?tab=managers")}
                    variant="light"
                    size="xs"
                    leftSection={<IconMessageQuestion size={14} />}
                    aria-label={t("users.askForFeedbackFrom", { name: m.name })}
                  >
                    {t("users.askForFeedback")}
                  </Button>
                  <Button
                    component={RouterLink}
                    to={`/users/${m.userId}/feedbacks?name=${encodeURIComponent(m.name)}`}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconMessages size={14} />}
                    aria-label={t("users.feedbacksWith", { name: m.name })}
                  >
                    {t("users.feedbacks")}
                  </Button>
                  <Button
                    component={RouterLink}
                    to={`/users/${m.userId}/one-on-ones?name=${encodeURIComponent(m.name)}&from=managers`}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconCalendarEvent size={14} />}
                    aria-label={t("users.oneOnOnesWith", { name: m.name })}
                  >
                    {t("users.oneOnOnes")}
                  </Button>
                </>
              }
            />
          ))}
        </SimpleGrid>
      ) : (
        !isError && (
          <EmptyState
            icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
            label={t("users.noManagers")}
          />
        )
      )}
    </>
  );
}
