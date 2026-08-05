import { type ReactNode } from "react";
import { Avatar, Badge, Group, Paper, Stack, Text } from "@mantine/core";
import classes from "./PersonCard.module.css";

// One person card in the dashboard grids (managers / peers / subordinates) and the
// user-details view: initials avatar, name, dimmed email, team badges, and an optional
// caller-supplied body — the labeled-section stats+buttons block (PersonCardBody in
// PersonCardStats.tsx), which owns everything below the header since v1.46.0.
// Rendered as <li> — the grids are semantic <ul> lists.
export default function PersonCard({
  name,
  email,
  teamNames,
  body,
}: {
  name: string;
  email: string;
  teamNames: string[];
  body?: ReactNode;
}) {
  return (
    <Paper component="li" withBorder radius="md" p="md" shadow="xs" className={classes.card}>
      <Stack gap="sm" h="100%">
        <Group wrap="nowrap" gap="sm" align="flex-start">
          <Avatar name={name} color="initials" radius="xl" size="md" />
          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} truncate>
              {name}
            </Text>
            <Text size="sm" c="dimmed" truncate>
              {email}
            </Text>
            <Group gap={4}>
              {teamNames.map((team) => (
                <Badge key={team} variant="light" size="sm">
                  {team}
                </Badge>
              ))}
            </Group>
          </Stack>
        </Group>
        {body}
      </Stack>
    </Paper>
  );
}
