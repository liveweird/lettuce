import type { ParseKeys } from "i18next";
import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useDashboardDrillDown, type DashboardOriginKey } from "../hooks/useDashboardDrillDown";
import { goalCreateLink } from "../utils/goalLinks";
import GoalTable from "./GoalTable";

// The origin also decides the direction of the list: from the managers grid the caller is the
// subordinate (goals the clicked manager set for them), from the subordinates grid or a
// team-scoped subordinates view the caller is the manager (goals they set for the clicked
// report — same wording either way).
const WORDING: Record<DashboardOriginKey, { titleKey: ParseKeys; hintKey: ParseKeys }> = {
  managers: { titleKey: "goal.goalsWith", hintKey: "goal.goalsWithHint" },
  subordinates: { titleKey: "goal.goalsFor", hintKey: "goal.goalsForHint" },
  team: { titleKey: "goal.goalsFor", hintKey: "goal.goalsForHint" },
  // The audit entry point (User details): wording is overridden by the audit block below.
  details: { titleKey: "goal.goalsAudit", hintKey: "goal.goalsAuditHint" },
};

// The per-person goals drill-down reached from Dashboard → My managers / My subordinates, or
// from a team-scoped subordinates view (`from=team&teamId=…`).
export default function UserGoals() {
  const { t } = useTranslation();
  const { userId, idIsValid, name, originKey, origin, callerManages, auditMode, backTo } =
    useDashboardDrillDown("goals");

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("GOALS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={origin.to} replace />;

  const who = name ?? t("goal.userFallback", { id: userId });
  const wording = auditMode
    ? ({ titleKey: "goal.goalsAudit", hintKey: "goal.goalsAuditHint" } as const)
    : WORDING[originKey];

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t(wording.titleKey, { who })}</Title>
        <Text size="sm" c="dimmed">
          {t(wording.hintKey, { who })}
        </Text>
      </Stack>

      {auditMode ? (
        // The HR auditor view: every goal this person is a party to, read-only.
        <GoalTable view="user" userId={userId} backTo={backTo} settingsKey="userGoals.audit" />
      ) : callerManages ? (
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

      {callerManages && (
        // The list's "New goal", with this direct report preselected (the prefilled create
        // flow) — the New-1:1 pattern; only the manager-side origins can create.
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
