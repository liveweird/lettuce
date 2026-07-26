import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import PersonaChip from "./PersonaChip";
import { feedbackPartyName } from "../utils/userDisplay";

/**
 * The table person cell: mini initials avatar + name (the dashboard cards' language). "You",
 * absent (—) and deleted users render as plain text — the avatar is for identifiable other
 * people. Shared by the feedback / 1:1 / goal tables; keep the rule here, not per-table.
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
  const display = feedbackPartyName(userId, name, deleted, currentUserId, t);
  const isSelf = currentUserId != null && userId === currentUserId;
  if (isSelf || name == null || deleted) {
    return (
      <Text size="sm" c={name == null ? "dimmed" : undefined}>
        {display}
      </Text>
    );
  }
  return <PersonaChip name={display} />;
}
