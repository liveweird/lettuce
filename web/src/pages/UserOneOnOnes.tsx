import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import { oneOnOneCreateLink } from "../utils/oneOnOneLinks";
import OneOnOneTable from "./OneOnOneTable";

// The per-person 1:1 drill-down reached from Dashboard → My managers / My subordinates:
// every meeting between the caller and this one person, in both role directions (the pair
// may have swapped manager/subordinate roles over time), as a single chronological table.
export default function UserOneOnOnes() {
  const { t } = useTranslation();
  const { userId, idIsValid, name, origin, callerManages, auditMode, backTo } =
    useDashboardDrillDown("one-on-ones");

  if (!idIsValid) return <Navigate to={origin.to} replace />;

  const who = name ?? t("oneOnOne.userFallback", { id: userId });

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>
          {t(auditMode ? "oneOnOne.oneOnOnesAudit" : "oneOnOne.oneOnOnesWith", { who })}
        </Title>
        <Text size="sm" c="dimmed">
          {t(auditMode ? "oneOnOne.oneOnOnesAuditHint" : "oneOnOne.oneOnOnesWithHint", { who })}
        </Text>
      </Stack>

      {auditMode ? (
        // The HR/ADMIN auditor view: every 1:1 this person is a party to, read-only.
        <OneOnOneTable
          view="user"
          userId={userId}
          backTo={backTo}
          settingsKey="userOneOnOnes.audit"
        />
      ) : (
        <OneOnOneTable
          view="with"
          counterpartId={userId}
          backTo={backTo}
          settingsKey="userOneOnOnes"
        />
      )}

      {callerManages && (
        // The meetings list's "New 1:1", with this person preselected (the prefilled create
        // flow). Only the manager-side origins: a 1:1 needs a direct report — reached from the
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
