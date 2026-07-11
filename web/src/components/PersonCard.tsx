import { type ReactNode } from "react";
import { Avatar, Badge, Divider, Group, Paper, Stack, Text } from "@mantine/core";

// One person card in the dashboard grids (managers / peers / subordinates): initials avatar,
// name, dimmed email, team badges, an optional caller-supplied stats block, and the actions
// row under a divider. Rendered as <li> — the grids are semantic <ul> lists.
export default function PersonCard({
  name,
  email,
  teamNames,
  stats,
  actions,
}: {
  name: string;
  email: string;
  teamNames: string[];
  stats?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Paper component="li" withBorder radius="md" p="md">
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
        {stats}
        <Divider mt="auto" />
        <Group gap="xs" wrap="wrap">
          {actions}
        </Group>
      </Stack>
    </Paper>
  );
}
