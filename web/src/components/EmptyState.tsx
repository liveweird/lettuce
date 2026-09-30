import { type ReactNode } from "react";
import { Center, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import classes from "./EmptyState.module.css";

/**
 * The shared empty-list treatment: the (page-supplied) dimmed icon in a soft neutral disc over
 * the translated message — quiet, but visibly designed rather than a bare icon on whitespace.
 * `action` (v3.3.0) is the optional call to action under the text. Its accessible name must
 * NEVER repeat the page header's action ("New goal") — Playwright strict mode would then find
 * two links; phrase it as its own verb ("Create your first goal").
 */
export default function EmptyState({
  icon,
  label,
  description,
  action,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Center py={48} className={classes.root}>
      <Stack align="center" gap="sm">
        <ThemeIcon variant="light" color="lettuce" size={56} radius="md" className={classes.icon}>
          {icon}
        </ThemeIcon>
        <Text size="sm" fw={600} ta="center">
          {label}
        </Text>
        {description && (
          <Text c="dimmed" size="sm" ta="center" maw={420} className={classes.description}>
            {description}
          </Text>
        )}
        {action && <Group justify="center">{action}</Group>}
      </Stack>
    </Center>
  );
}
