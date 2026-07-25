import { Anchor, Stack, Text, Title } from "@mantine/core";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import GoalTable from "./GoalTable";

// Which dashboard tab this screen was opened from, so the "Back to …" link and the invalid-id
// redirect return there. Today only the managers grid links here; the map keeps the `from`
// machinery so future origins (a subordinates-card button) slot in like UserOneOnOnes'.
const ORIGIN = {
  managers: { labelKey: "feedback.origin.managers", to: "/?tab=managers" },
} as const;

type OriginKey = keyof typeof ORIGIN;

function isOriginKey(value: string | null): value is OriginKey {
  return value != null && value in ORIGIN;
}

// The per-manager goals drill-down reached from Dashboard → My managers: the goals this
// manager set for the caller (the caller is always the subordinate here).
export default function UserGoals() {
  const { t } = useTranslation();
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const origin = ORIGIN[isOriginKey(fromParam) ? fromParam : "managers"];

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  if (!idIsValid) return <Navigate to={origin.to} replace />;

  const who = name ?? t("goal.userFallback", { id: userId });
  // Where the View/Edit detail pages return to: this very screen, keeping the origin so the
  // "Back to …" link stays correct after a round-trip.
  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (isOriginKey(fromParam)) query.set("from", fromParam);
  const queryString = query.toString();
  const backTo = `/users/${userId}/goals${queryString ? `?${queryString}` : ""}`;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t("goal.goalsWith", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t("goal.goalsWithHint", { who })}
        </Text>
      </Stack>

      <GoalTable view="own" managerId={userId} backTo={backTo} settingsKey="userGoals" />
    </Stack>
  );
}
