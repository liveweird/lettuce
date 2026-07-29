import { Alert, Button, SimpleGrid, Skeleton } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  IconCalendarEvent,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconTargetArrow,
  IconUsersGroup,
} from "@tabler/icons-react";
import { listTeamMembers } from "../api/client";
import EmptyState from "../components/EmptyState";
import PersonCard from "../components/PersonCard";
import PersonCardStats from "../components/PersonCardStats";
import { feedbackAskLink, feedbackProvideLink, userFeedbacksLink } from "../utils/feedbackLinks";
import { userGoalsLink } from "../utils/goalLinks";
import { userOneOnOnesLink } from "../utils/oneOnOneLinks";
import { groupTeamRows } from "../utils/teamRows";

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
              stats={<PersonCardStats person={m} />}
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
                    to={userFeedbacksLink(m.userId, m.name)}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconMessages size={14} />}
                    aria-label={t("users.feedbacksWith", { name: m.name })}
                  >
                    {t("users.feedbacks")}
                  </Button>
                  <Button
                    component={RouterLink}
                    to={userOneOnOnesLink(m.userId, m.name, "managers")}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconCalendarEvent size={14} />}
                    aria-label={t("users.oneOnOnesWith", { name: m.name })}
                  >
                    {t("users.oneOnOnes")}
                  </Button>
                  <Button
                    component={RouterLink}
                    to={userGoalsLink(m.userId, m.name, "managers")}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconTargetArrow size={14} />}
                    aria-label={t("users.goalsWith", { name: m.name })}
                  >
                    {t("users.goals")}
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
