import { type ReactNode } from "react";
import { Avatar, Group, Paper, Stack, Text } from "@mantine/core";
import TeamBadges from "./TeamBadges";
import type { TeamRef } from "../utils/teamRows";
import classes from "./PersonCard.module.css";

// Shared dashboard/detail identity: wrapping name and email, team badges below, followed
// by the relationship-aware body. Lists retain semantic <li> cards in their existing <ul>.
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
  return (
    <Paper component="li" withBorder radius="md" p="lg" className={classes.card}>
      <Stack gap="sm" h="100%">
        <Group wrap="nowrap" gap="sm" align="flex-start">
          <Avatar name={name} color="initials" radius="xl" size={40} />
          <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Stack gap={5}>
              <Text fw={600} size="md" className={classes.name}>
                {name}
              </Text>
            </Stack>
            <Text size="xs" c="dimmed" className={classes.email}>
              {email}
            </Text>
            <Group mt={7}><TeamBadges teams={teams} /></Group>
          </Stack>
        </Group>
        {body}
      </Stack>
    </Paper>
  );
}
