import {
  Alert,
  Avatar,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconUsersGroup,
} from "@tabler/icons-react";
import { listTeamMembers } from "../api/client";
import { feedbackAskLink, feedbackProvideLink } from "../utils/feedbackLinks";

type ManagerCard = {
  userId: number;
  name: string;
  email: string;
  teamNames: string[];
};

// The API returns one row per (manager, team); someone managing two of the caller's teams
// arrives twice. Collapse to one card per person, collecting their team names.
function groupByManager(rows: { userId: number; name: string; email: string; teamName: string }[]): ManagerCard[] {
  const byId = new Map<number, ManagerCard>();
  for (const r of rows) {
    const existing = byId.get(r.userId);
    if (existing) {
      if (!existing.teamNames.includes(r.teamName)) existing.teamNames.push(r.teamName);
    } else {
      byId.set(r.userId, { userId: r.userId, name: r.name, email: r.email, teamNames: [r.teamName] });
    }
  }
  return [...byId.values()];
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

  const managers = groupByManager(data?.items ?? []);

  return (
    <>
      {isError && (
        <Alert color="red" title={t("users.loadManagersFailed")}>
          {error instanceof Error ? error.message : t("users.unknownError")}
        </Alert>
      )}

      {managers.length > 0 ? (
        <SimpleGrid cols={gridCols} spacing="md">
          {managers.map((m) => (
            <Paper key={m.userId} withBorder radius="md" p="md">
              <Stack gap="sm" h="100%">
                <Group wrap="nowrap" gap="sm" align="flex-start">
                  <Avatar name={m.name} color="initials" radius="xl" size="md" />
                  <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                    <Text fw={600} truncate>
                      {m.name}
                    </Text>
                    <Text size="sm" c="dimmed" truncate>
                      {m.email}
                    </Text>
                    <Group gap={4}>
                      {m.teamNames.map((team) => (
                        <Badge key={team} variant="light" size="sm">
                          {team}
                        </Badge>
                      ))}
                    </Group>
                  </Stack>
                </Group>
                <Divider mt="auto" />
                <Group gap="xs" justify="space-between" wrap="wrap">
                  <Group gap="xs">
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
                  </Group>
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
                </Group>
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      ) : (
        !isError && (
          <Center py="xl">
            <Stack align="center" gap="xs">
              <IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">{t("users.noManagers")}</Text>
            </Stack>
          </Center>
        )
      )}
    </>
  );
}
