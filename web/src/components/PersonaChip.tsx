import { Avatar, Group, Text } from "@mantine/core";

// A compact person rendering for table cells: initials avatar + name — the same avatar
// language as the dashboard person cards. Callers decide when a plain-text fallback is more
// appropriate ("You", deleted users, absent values).
export default function PersonaChip({ name }: { name: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Avatar name={name} color="initials" size={22} radius="xl" />
      {/* minWidth 0 lets the flex child actually shrink so `truncate` can engage. */}
      <Text size="sm" truncate style={{ minWidth: 0 }}>
        {name}
      </Text>
    </Group>
  );
}
