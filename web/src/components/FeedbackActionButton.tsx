import type { ReactNode } from "react";
import { Button } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";

// The shared chrome for the per-row "Provide / Ask / Request feedback" link-buttons (used across
// the Users, TeamMembers, TeamMembersTable and ManagersTable screens). Callers supply the target
// URL (built via utils/feedbackLinks), the icon, and the already-translated label/aria-label — the
// i18n keys differ by screen (users.* vs teams.*), so they stay with the caller.
export default function FeedbackActionButton({
  to,
  icon,
  label,
  ariaLabel,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  ariaLabel: string;
}) {
  return (
    <Button
      component={RouterLink}
      to={to}
      color="blue"
      variant="subtle"
      size="xs"
      leftSection={icon}
      aria-label={ariaLabel}
    >
      {label}
    </Button>
  );
}
