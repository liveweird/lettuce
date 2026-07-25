import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { goalCreateLink } from "../utils/goalLinks";
import GoalTable from "./GoalTable";

// Which dashboard tab this screen was opened from — it decides both the "Back to …" link and
// the direction of the list: from the managers grid the caller is the subordinate (goals the
// clicked manager set for them), from the subordinates grid the caller is the manager (goals
// they set for the clicked report). Defaults to managers for older links lacking `from`.
const ORIGIN = {
  managers: {
    labelKey: "feedback.origin.managers",
    to: "/?tab=managers",
    titleKey: "goal.goalsWith",
    hintKey: "goal.goalsWithHint",
  },
  subordinates: {
    labelKey: "feedback.origin.subordinates",
    to: "/?tab=subordinates",
    titleKey: "goal.goalsFor",
    hintKey: "goal.goalsForHint",
  },
} as const;

type OriginKey = keyof typeof ORIGIN;

function isOriginKey(value: string | null): value is OriginKey {
  return value != null && value in ORIGIN;
}

// The per-person goals drill-down reached from Dashboard → My managers / My subordinates.
export default function UserGoals() {
  const { t } = useTranslation();
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const originKey: OriginKey = isOriginKey(fromParam) ? fromParam : "managers";
  const origin = ORIGIN[originKey];

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  if (!idIsValid) return <Navigate to={origin.to} replace />;

  const who = name ?? t("goal.userFallback", { id: userId });
  // Where the View/Edit/Create pages return to: this very screen, keeping the origin so the
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
        <Title order={2}>{t(origin.titleKey, { who })}</Title>
        <Text size="sm" c="dimmed">
          {t(origin.hintKey, { who })}
        </Text>
      </Stack>

      {originKey === "subordinates" ? (
        // The caller is the manager: their goals for this direct report, editable per status.
        <GoalTable
          view="managed"
          subordinateId={userId}
          backTo={backTo}
          settingsKey="userGoals.managed"
        />
      ) : (
        // The caller is the subordinate: the clicked manager's goals for them, read-only.
        <GoalTable view="own" managerId={userId} backTo={backTo} settingsKey="userGoals" />
      )}

      {originKey === "subordinates" && (
        // The list's "New goal", with this direct report preselected (the prefilled create
        // flow) — the New-1:1 pattern; only the manager-side origin can create.
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to={goalCreateLink(userId, name, backTo)}
            leftSection={<IconPlus size={16} />}
          >
            {t("goal.newGoal")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
