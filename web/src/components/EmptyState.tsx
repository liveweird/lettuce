import { type ReactNode } from "react";
import { Center, Stack, Text, ThemeIcon } from "@mantine/core";

// The shared empty-list treatment: the (page-supplied) dimmed icon in a soft neutral disc over
// the translated message — quiet, but visibly designed rather than a bare icon on whitespace.
export default function EmptyState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Center py={48}>
      <Stack align="center" gap="sm">
        <ThemeIcon variant="light" color="gray" size={64} radius="xl">
          {icon}
        </ThemeIcon>
        <Text c="dimmed" size="sm">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
