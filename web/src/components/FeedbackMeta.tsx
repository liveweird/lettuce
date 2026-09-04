import { Fragment } from "react";
import { Group, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { FeedbackStatus, FeedbackVisibility } from "../api/feedbacks";
import { formatDateTime } from "../utils/datetime";
import { StatusBadge, VisibilityBadge } from "./FeedbackBadges";
import PersonaChip from "./PersonaChip";

/** One party in the people line: its display name, and whether it is the current user. */
export type PartyDisplay = { display: string; isYou?: boolean };

/**
 * The compact metadata header shared by the feedback view and edit screens: title with
 * status/visibility badges, a one-line "who" summary (provider → recipients, requested by …),
 * and a dimmed last-modified line. Replaces the old 2×3 grid of disabled inputs so the
 * Content tab below gets the bulk of the viewport.
 *
 * `visibility` is display-only — the edit screen omits it here (its interactive Select
 * lives with the editor) while the view screen shows it as a badge.
 */
export default function FeedbackMeta({
  title,
  status,
  visibility,
  providerDisplay,
  providerIsYou,
  subjects,
  requesterDisplay,
  requesterIsYou,
  lastModified,
}: {
  title: string;
  status?: FeedbackStatus;
  visibility?: FeedbackVisibility;
  providerDisplay: string;
  providerIsYou?: boolean;
  // The recipients in position order (up to four, v3.1.0). Omitted or empty while none is
  // resolved yet (the create flows before a pick) — the arrow and the slot are skipped.
  subjects?: PartyDisplay[];
  requesterDisplay?: string;
  requesterIsYou?: boolean;
  lastModified?: number;
}) {
  const { t, i18n } = useTranslation();
  // The app-wide person convention: PersonaChip for a named party, plain text for the
  // current user — driven by the explicit *IsYou flags, never by comparing the display
  // string against the translated "You" (a locale collision would mis-render). Deleted
  // parties still chip here: the single-feedback response carries no *Deleted flags
  // (unlike the list rows), so the view/edit screens cannot know.
  const party = (display: string, isYou?: boolean) =>
    isYou ? <Text size="sm">{display}</Text> : <PersonaChip name={display} />;
  return (
    <Stack gap={4}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Title order={2}>{title}</Title>
        <Group gap="xs" wrap="nowrap">
          {status && <StatusBadge status={status} />}
          {visibility && <VisibilityBadge visibility={visibility} />}
        </Group>
      </Group>
      <Group gap={8} wrap="wrap">
        {party(providerDisplay, providerIsYou)}
        {subjects != null && subjects.length > 0 && (
          <>
            <Text size="sm" c="dimmed">
              →
            </Text>
            {subjects.map((s, index) => (
              // Position is the identity here (a name may legitimately repeat).
              <Fragment key={index}>{party(s.display, s.isYou)}</Fragment>
            ))}
          </>
        )}
        {requesterDisplay != null && (
          <>
            <Text size="sm" c="dimmed">
              ·
            </Text>
            <Text size="sm" c="dimmed">
              {t("feedback.requestedBy")}
            </Text>
            {party(requesterDisplay, requesterIsYou)}
          </>
        )}
      </Group>
      {lastModified != null && (
        <Text size="sm" c="dimmed">
          {t("feedback.lastModifiedLine", { when: formatDateTime(lastModified, i18n.language) })}
        </Text>
      )}
    </Stack>
  );
}
