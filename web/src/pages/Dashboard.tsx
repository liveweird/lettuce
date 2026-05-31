import { Stack, Text, Title } from "@mantine/core";

export default function Dashboard() {
  return (
    <Stack gap="xs">
      <Title order={2}>Dashboard</Title>
      <Text c="dimmed">Welcome to Lettuce.</Text>
    </Stack>
  );
}
