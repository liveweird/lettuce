import { Alert, Badge, Group, Progress, Select, Skeleton, Stack, Text, Title } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { IconUsersGroup } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { getUserId, isHr } from "../api/session";
import { getPulseParticipationStatus, listPulseCycles } from "../api/pulse";
import EmptyState from "../components/EmptyState";
import PersonCell from "../components/PersonCell";
import { formatIsoDate } from "../utils/datetime";

/**
 * The managers' "Participation" tab: per person, submitted yes/no — never any answers. Works
 * while a cycle is OPEN (the nudging window) and after it closes; defaults to the open cycle.
 * Non-managers see an empty state (the server returns no teams for them).
 */
export default function PulseParticipation() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const currentUserId = getUserId();

  const cycles = useQuery({ queryKey: ["pulseCycles"], queryFn: listPulseCycles });
  const candidates = (cycles.data ?? [])
    .filter((c) => c.status === "OPEN" || c.status === "CLOSED")
    .sort((a, b) => b.id - a.id);
  const options = candidates.map((c) => ({
    value: String(c.id),
    label: `${t(`pulse.status.${c.status}`)} · ${formatIsoDate(c.plannedOpenDate, locale)}`,
  }));
  const defaultCycle = candidates.find((c) => c.status === "OPEN") ?? candidates[0];
  const selectedId =
    picked != null && candidates.some((c) => String(c.id) === picked)
      ? Number(picked)
      : (defaultCycle?.id ?? null);

  const status = useQuery({
    queryKey: ["pulseParticipation", selectedId],
    queryFn: () => getPulseParticipationStatus(selectedId!),
    enabled: selectedId != null,
    retry: false,
  });

  if (cycles.isLoading) return <Skeleton height={220} radius="md" />;
  if (cycles.isError) {
    return (
      <Alert color="red" variant="light">
        {t("pulse.error.loadFailed")}
      </Alert>
    );
  }
  if (selectedId == null) {
    return <EmptyState icon={<IconUsersGroup size={32} />} label={t("pulse.participation.noCycle")} />;
  }

  const teams = status.data?.teams ?? [];
  // The team picker (client-side over the already-returned teams — a monitored/org-wide list
  // is already bounded, so no new request): "All teams" plus each team by name, offered only
  // once there is more than one to pick from. A stale pick (a team that dropped out of a
  // narrower cycle's response) falls back to "All teams" rather than showing an empty table.
  const selectedTeamId =
    pickedTeam != null && teams.some((tm) => String(tm.teamId) === pickedTeam) ? pickedTeam : null;
  const visibleTeams =
    selectedTeamId == null ? teams : teams.filter((tm) => String(tm.teamId) === selectedTeamId);
  const teamOptions = [
    { value: "", label: t("pulse.participation.allTeams") },
    ...teams.map((tm) => ({ value: String(tm.teamId), label: tm.teamName })),
  ];
  const all = visibleTeams.flatMap((team) => team.members);
  const submitted = all.filter((m) => m.responded).length;
  const rate = all.length === 0 ? 0 : Math.round((submitted / all.length) * 1000) / 10;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Select
          label={t("pulse.results.cycle")}
          data={options}
          value={String(selectedId)}
          onChange={(v) => {
            setPicked(v);
            // A team picked under the previous cycle may not exist (or mean the same roster)
            // in the new one — reset to "All teams" rather than silently carrying a stale pick.
            setPickedTeam(null);
          }}
          allowDeselect={false}
          w={260}
        />
        {status.isSuccess && teams.length > 1 && (
          <Select
            label={t("pulse.participation.team")}
            data={teamOptions}
            value={selectedTeamId ?? ""}
            onChange={(v) => setPickedTeam(v || null)}
            allowDeselect={false}
            w={260}
          />
        )}
        <Text size="sm" c="dimmed">
          {t(isHr() ? "pulse.participation.hintAudit" : "pulse.participation.hint")}
        </Text>
      </Group>

      {status.isLoading && <Skeleton height={160} radius="md" />}
      {status.isError && (
        <Alert color="red" variant="light">
          {t("pulse.participation.loadError")}
        </Alert>
      )}
      {status.isSuccess && teams.length === 0 && (
        <EmptyState icon={<IconUsersGroup size={32} />} label={t("pulse.participation.noTeams")} />
      )}

      {status.isSuccess && teams.length > 0 && (
        <>
          <div>
            <Text size="sm" c="dimmed">
              {t("pulse.participation.summary", { submitted, total: all.length, rate })}
            </Text>
            <Progress value={all.length === 0 ? 0 : (submitted / all.length) * 100} size="sm" mt={4} />
          </div>
          {visibleTeams.map((team) => (
            <Stack key={team.teamId} gap="xs">
              <Title order={5} style={{ minWidth: 0, overflowWrap: "break-word" }}>{team.teamName}</Title>
              <ResponsiveTable density="normal">
                <ResponsiveTable.Thead>
                  <ResponsiveTable.Tr>
                    <ResponsiveTable.Th>{t("pulse.participation.person")}</ResponsiveTable.Th>
                    <ResponsiveTable.Th>{t("common.field.status")}</ResponsiveTable.Th>
                  </ResponsiveTable.Tr>
                </ResponsiveTable.Thead>
                <ResponsiveTable.Tbody>
                  {team.members.map((member) => (
                    <ResponsiveTable.Tr key={member.userId}>
                      <ResponsiveTable.Td label={t("pulse.participation.person")}>
                        <PersonCell
                          userId={member.userId}
                          name={member.name}
                          currentUserId={currentUserId}
                        />
                      </ResponsiveTable.Td>
                      <ResponsiveTable.Td label={t("common.field.status")}>
                        <Badge
                          color={member.responded ? "teal" : "gray"}
                          variant="light"
                          style={{ minWidth: "max-content" }}
                        >
                          {member.responded
                            ? t("pulse.participation.submitted")
                            : t("pulse.participation.notSubmitted")}
                        </Badge>
                      </ResponsiveTable.Td>
                    </ResponsiveTable.Tr>
                  ))}
                </ResponsiveTable.Tbody>
              </ResponsiveTable>
            </Stack>
          ))}
        </>
      )}
    </Stack>
  );
}
