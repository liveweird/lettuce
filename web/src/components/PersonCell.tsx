import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import PersonaChip from "./PersonaChip";
import { partyDisplayName } from "../utils/userDisplay";
import { userDetailsLink } from "../utils/userLinks";

/**
 * The table person cell: mini initials avatar + name (the dashboard cards' language). "You",
 * absent (—) and deleted users render as plain text — the avatar is for identifiable other
 * people, and since v2.30.0 the name itself links to their user-details view (the v2.5.2
 * name-as-details-link rule, extended from the directory surfaces to every resource table).
 * No `from` origin — the details page's back link uses its default. Shared by the feedback /
 * 1:1 / goal / KPI / review / days-off tables; keep the rule here, not per-table.
 */
export default function PersonCell({
  userId,
  name,
  deleted = false,
  currentUserId,
}: {
  userId: number | null | undefined;
  name: string | null | undefined;
  deleted?: boolean;
  currentUserId: number | null;
}) {
  const { t } = useTranslation();
  const display = partyDisplayName(userId, name, deleted, currentUserId, t);
  const isSelf = currentUserId != null && userId === currentUserId;
  if (isSelf || name == null || deleted) {
    return (
      <Text size="sm" c={name == null ? "dimmed" : undefined}>
        {display}
      </Text>
    );
  }
  return (
    <PersonaChip
      name={display}
      to={userId != null ? userDetailsLink(userId, name) : undefined}
      ariaLabel={userId != null ? t("users.detailsFor", { name: display }) : undefined}
    />
  );
}
