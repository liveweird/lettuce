import { Stack, Text, Title } from "@mantine/core";

export default function Feedback() {
  return (
    <Stack gap="xs">
      <Title order={2}>Feedback</Title>
      <Text c="dimmed">Feedback entries live here.</Text>
    </Stack>
  );
}
