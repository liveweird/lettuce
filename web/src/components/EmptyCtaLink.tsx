import { type ReactNode } from "react";
import { Button } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink } from "react-router-dom";

/**
 * The empty state's call to action (v3.4.0): a quiet creation link the hub pages hand their
 * tables via `emptyAction`. Its caption is the area's `emptyCta` key — deliberately NOT the
 * page header's "New …" (Playwright strict mode would then find two links by that name).
 */
export default function EmptyCtaLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button component={RouterLink} to={to} variant="light" size="xs" leftSection={<IconPlus size={14} />}>
      {children}
    </Button>
  );
}
