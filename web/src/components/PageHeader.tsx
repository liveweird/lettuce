import type { ReactNode } from "react";
import { Anchor, Box, Group, Stack, Text, Title, type MantineSpacing } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";
import classes from "./PageHeader.module.css";

export type PageHeaderProps = {
  title: ReactNode;
  /** Becomes `data-tour` on the heading — the Config pages' tour anchors ride the title. */
  tourId?: string;
  /** A dimmed one-liner under the title (the page's purpose, not instructions). */
  description?: ReactNode;
  /** The drill-down "← Back to …" link above the title; the page passes its exact label. */
  back?: { to: string; label: string };
  /** A status pill beside the title (detail pages). */
  badge?: ReactNode;
  /** The right-hand slot: the primary "New …" button first, secondaries `variant="default"`. */
  actions?: ReactNode;
  /** Pins the header under the app header while the page scrolls (the Kudos wall). */
  sticky?: boolean;
  mb?: MantineSpacing;
};

/**
 * The one page header (v3.3.0): back link → h2 title (+ badge) with the actions on the right →
 * description. Pages title themselves with `order={2}` — tests pin the level — and the
 * primary action always lives here, never below the list. Rendered as `<header>` inside
 * `<main>`, so it is not a landmark (the app header keeps the `banner` role).
 */
export default function PageHeader({ title, tourId, description, back, badge, actions, sticky = false, mb }: PageHeaderProps) {
  return (
    <Box component="header" className={sticky ? classes.sticky : undefined} mb={mb}>
      <Stack gap={4}>
        {back && (
          <Anchor component={RouterLink} to={back.to} size="sm">
            {back.label}
          </Anchor>
        )}
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Group gap="sm" align="center" wrap="wrap">
            <Title order={2} data-tour={tourId} className={classes.title}>
              {title}
            </Title>
            {badge}
          </Group>
          {actions && (
            <Group gap="sm" className={classes.actions}>
              {actions}
            </Group>
          )}
        </Group>
        {description && (
          <Text size="sm" c="dimmed" maw={720}>
            {description}
          </Text>
        )}
      </Stack>
    </Box>
  );
}
