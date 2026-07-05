import { type ReactNode } from "react";
import { Center, Stack, Text } from "@mantine/core";

// The shared empty-list treatment: a dimmed icon over the (page-supplied, translated) message.
export default function EmptyState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Center py="xl">
      <Stack align="center" gap="xs">
        {icon}
        <Text c="dimmed">{label}</Text>
      </Stack>
    </Center>
  );
}
