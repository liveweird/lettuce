import { Stack, Text, Title } from "@mantine/core";

export default function Users() {
  return (
    <Stack gap="xs">
      <Title order={2}>Users</Title>
      <Text c="dimmed">User management lives here.</Text>
    </Stack>
  );
}
