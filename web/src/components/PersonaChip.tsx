import { Anchor, Avatar, Group, Text } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";

// A compact person rendering for table cells: initials avatar + name — the same avatar
// language as the dashboard person cards. Callers decide when a plain-text fallback is more
// appropriate ("You", deleted users, absent values). With `to`, the name itself becomes the
// row's user-details link (self and deleted personas stay plain — the caller's rule).
export default function PersonaChip({
  name,
  to,
  ariaLabel,
}: {
  name: string;
  to?: string;
  ariaLabel?: string;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <Avatar name={name} color="initials" size={22} radius="xl" />
      {/* minWidth 0 lets the flex child actually shrink so `truncate` can engage. */}
      {to ? (
        <Anchor
          component={RouterLink}
          to={to}
          aria-label={ariaLabel}
          size="sm"
          truncate
          style={{ minWidth: 0 }}
        >
          {name}
        </Anchor>
      ) : (
        <Text size="sm" truncate style={{ minWidth: 0 }}>
          {name}
        </Text>
      )}
    </Group>
  );
}
