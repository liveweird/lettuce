import { Badge, Group } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { teamDetailsLink } from "../utils/teamLinks";
import type { TeamRef } from "../utils/teamRows";

/**
 * The house TeamRef badge idiom (Checkup #36 M4 — extracted from PersonCard/FeatureFlags, the
 * two places that already got it right, into the one component every team-badge row now shares):
 * each badge links to that team's details view (the v2.5.4 convention) with the
 * `teams.detailsForAria` accessible name. Used by PersonCard, the feature-flags Teams column,
 * and the days-off Team columns (which previously hand-rolled a non-linking gray-badge variant).
 * Renders nothing for an empty list, so callers can embed it unconditionally.
 */
export default function TeamBadges({ teams }: { teams: TeamRef[] }) {
  const { t } = useTranslation();
  if (teams.length === 0) return null;
  return (
    <Group gap="xs" wrap="wrap">
      {teams.map((team) => (
        <Badge
          key={team.id}
          component={RouterLink}
          to={teamDetailsLink(team.id)}
          aria-label={t("teams.detailsForAria", { name: team.name })}
          variant="light"
          size="sm"
          style={{ cursor: "pointer" }}
        >
          {team.name}
        </Badge>
      ))}
    </Group>
  );
}
