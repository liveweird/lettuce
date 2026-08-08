import { Alert, Badge, Group, Progress, Select, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { IconUsersGroup } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { getPulseParticipationStatus, listPulseCycles } from "../api/client";
import EmptyState from "../components/EmptyState";
import PersonaChip from "../components/PersonaChip";
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
  const all = teams.flatMap((team) => team.members);
  const submitted = all.filter((m) => m.responded).length;
  const rate = all.length === 0 ? 0 : Math.round((submitted / all.length) * 1000) / 10;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Select
          label={t("pulse.results.cycle")}
          data={options}
          value={String(selectedId)}
          onChange={setPicked}
          allowDeselect={false}
          w={260}
        />
        <Text size="sm" c="dimmed">
          {t("pulse.participation.hint")}
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
          {teams.map((team) => (
            <Stack key={team.teamId} gap="xs">
              <Title order={5}>{team.teamName}</Title>
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("pulse.participation.person")}</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {team.members.map((member) => (
                    <Table.Tr key={member.userId}>
                      <Table.Td>
                        <PersonaChip name={member.name} />
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={member.responded ? "teal" : "gray"}
                          variant="light"
                          style={{ minWidth: "max-content" }}
                        >
                          {member.responded
                            ? t("pulse.participation.submitted")
                            : t("pulse.participation.notSubmitted")}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          ))}
        </>
      )}
    </Stack>
  );
}
