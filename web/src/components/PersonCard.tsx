import { type ReactNode } from "react";
import { Avatar, Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { teamDetailsLink } from "../utils/teamLinks";
import type { TeamRef } from "../utils/teamRows";
import classes from "./PersonCard.module.css";

// One person card in the dashboard grids (managers / peers / subordinates) and the
// user-details view: initials avatar, name, dimmed email, team badges, and an optional
// caller-supplied body — the labeled-section stats block plus the icon action footer
// (PersonCardBody in PersonCardStats.tsx), which owns everything below the header since
// v1.46.0. Compact header since v3.4.0: small avatar, the team badges inline with the name.
// Rendered as <li> — the grids are semantic <ul> lists.
export default function PersonCard({
  name,
  email,
  teams,
  body,
}: {
  name: string;
  email: string;
  teams: TeamRef[];
  body?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Paper component="li" withBorder radius="md" p="md" shadow="xs" className={classes.card}>
      <Stack gap="sm" h="100%">
        <Group wrap="nowrap" gap="sm" align="flex-start">
          <Avatar name={name} color="initials" radius="xl" size="sm" />
          <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Group gap={6} wrap="wrap" align="center">
              <Text fw={600} size="sm" truncate style={{ minWidth: 0 }}>
                {name}
              </Text>
              {/* Each badge links to that team's details view (the v2.5.4 convention). */}
              {teams.map((team) => (
                <Badge
                  key={team.id}
                  component={RouterLink}
                  to={teamDetailsLink(team.id)}
                  aria-label={t("teams.detailsForAria", { name: team.name })}
                  variant="light"
                  size="sm"
                  style={{ cursor: "pointer" }}
                >
                  {team.name}
                </Badge>
              ))}
            </Group>
            <Text size="xs" c="dimmed" truncate>
              {email}
            </Text>
          </Stack>
        </Group>
        {body}
      </Stack>
    </Paper>
  );
}
