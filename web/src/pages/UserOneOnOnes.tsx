import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { oneOnOneCreateLink } from "../utils/oneOnOneLinks";
import OneOnOneTable from "./OneOnOneTable";

// Which dashboard tab this screen was opened from, so the "Back to …" link and the
// invalid-id redirect return there. Only the managers and subordinates grids link here
// (peers never do); defaults to managers for older links lacking `from`.
const ORIGIN = {
  managers: { labelKey: "feedback.origin.managers", to: "/?tab=managers" },
  subordinates: { labelKey: "feedback.origin.subordinates", to: "/?tab=subordinates" },
} as const;

type OriginKey = keyof typeof ORIGIN;

function isOriginKey(value: string | null): value is OriginKey {
  return value != null && value in ORIGIN;
}

// The per-person 1:1 drill-down reached from Dashboard → My managers / My subordinates:
// every meeting between the caller and this one person, in both role directions (the pair
// may have swapped manager/subordinate roles over time), as a single chronological table.
export default function UserOneOnOnes() {
  const { t } = useTranslation();
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const origin = ORIGIN[isOriginKey(fromParam) ? fromParam : "managers"];

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  if (!idIsValid) return <Navigate to={origin.to} replace />;

  const who = name ?? t("oneOnOne.userFallback", { id: userId });
  // Where the Edit/View detail pages return to: this very screen, keeping the origin so
  // the "Back to …" link stays correct after a round-trip.
  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (isOriginKey(fromParam)) query.set("from", fromParam);
  const queryString = query.toString();
  const backTo = `/users/${userId}/one-on-ones${queryString ? `?${queryString}` : ""}`;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t("oneOnOne.oneOnOnesWith", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t("oneOnOne.oneOnOnesWithHint", { who })}
        </Text>
      </Stack>

      <OneOnOneTable
        view="with"
        counterpartId={userId}
        backTo={backTo}
        settingsKey="userOneOnOnes"
      />

      {fromParam === "subordinates" && (
        // The meetings list's "New 1:1", with this person preselected (the prefilled create
        // flow). Only the subordinates origin: a 1:1 needs a direct report — reached from the
        // managers card, the counterpart is the caller's own manager. Cancel returns here.
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to={oneOnOneCreateLink(userId, name, backTo)}
            leftSection={<IconPlus size={16} />}
          >
            {t("oneOnOne.newMeeting")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
