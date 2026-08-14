import { Alert, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getPulseTeamComparison,
  type PulseDriverResult,
  type PulseTeamResults,
} from "../api/client";
import { deltaColor, enpsBandColor, formatSigned } from "../utils/pulseResults";
import { HintIcon } from "./PulseTeamResultCard";

const QUESTIONS = ["Q2", "Q3", "Q4", "Q5", "ROTATING"] as const;

/**
 * The packed per-sub-team comparison for one parent team (v2.10.0): a row for the parent's
 * own members (direct scope — includes the sub-team managers) and one subtree-scoped row per
 * direct sub-team, each carrying responses, the band-colored eNPS with its vs-previous delta,
 * and the favorable share per driver question. Every row is independently k-withheld (the
 * responses count stays visible, the metrics don't). Deliberately no comments and no trend —
 * this is the concise side-by-side view; the other modes keep the full cards.
 */
export default function PulseTeamComparisonCard({
  cycleId,
  teamId,
  teamName,
  rotatingTextEn,
  rotatingTextPl,
}: {
  cycleId: number;
  teamId: number;
  teamName: string;
  /** The cycle's snapshotted rotating-question text (the Rotating header's tooltip) — passed
   *  from the cached cycle object, since withheld rows carry no driver rows to read it from. */
  rotatingTextEn?: string | null;
  rotatingTextPl?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["pulseComparison", cycleId, teamId],
    queryFn: () => getPulseTeamComparison(cycleId, teamId),
    retry: false,
  });

  const rotatingHint = (i18n.resolvedLanguage === "pl" ? rotatingTextPl : rotatingTextEn) ?? "";
  const questionHint = (question: (typeof QUESTIONS)[number]) =>
    question === "ROTATING" ? rotatingHint : t(`pulse.${question.toLowerCase()}`);
  const favorableOf = (row: PulseTeamResults, question: (typeof QUESTIONS)[number]) =>
    row.drivers?.find((driver: PulseDriverResult) => driver.question === question)?.favorablePct;

  const rows = data
    ? [
        { key: "own", label: t("pulse.results.comparison.ownMembers"), row: data.ownMembers },
        ...data.subTeams.map((subTeam) => ({
          key: `team-${subTeam.teamId}`,
          label: subTeam.teamName,
          row: subTeam,
        })),
      ]
    : [];

  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Stack gap="sm">
        <Title order={4}>{teamName}</Title>

        {isLoading && <Skeleton height={120} radius="sm" />}
        {isError && (
          <Alert color="red" variant="light">
            {t("pulse.results.loadError")}
          </Alert>
        )}

        {data && data.subTeams.length === 0 && (
          <Text c="dimmed" py="md">
            {t("pulse.results.comparison.noSubTeams")}
          </Text>
        )}

        {data && data.subTeams.length > 0 && (
          <>
            <Table.ScrollContainer minWidth={760}>
              <Table
                verticalSpacing="xs"
                aria-label={t("pulse.results.comparison.tableAria", { team: teamName })}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("pulse.results.comparison.team")}</Table.Th>
                    <Table.Th>{t("pulse.results.comparison.responses")}</Table.Th>
                    <Table.Th>
                      <Group gap={4} wrap="nowrap">
                        {t("pulse.results.enps")}
                        <HintIcon label={t("pulse.results.hint.enps")} />
                      </Group>
                    </Table.Th>
                    {QUESTIONS.map((question) => (
                      <Table.Th key={question}>
                        <Group gap={4} wrap="nowrap">
                          {question === "ROTATING"
                            ? t("pulse.results.comparison.rotating")
                            : question}
                          <HintIcon label={questionHint(question)} />
                        </Group>
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map(({ key, label, row }) => (
                    <Table.Tr key={key}>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {label}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {t("pulse.results.responses", {
                            completed: row.responseCount,
                            participants: row.participantCount,
                            rate: row.responseRate,
                          })}
                        </Text>
                      </Table.Td>
                      {row.insufficientResponses || row.enps == null ? (
                        <Table.Td colSpan={1 + QUESTIONS.length}>
                          <Text size="sm" c="dimmed">
                            {t("pulse.results.notEnoughResponses")}
                          </Text>
                        </Table.Td>
                      ) : (
                        <>
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              <Text size="sm" fw={600} c={enpsBandColor(row.enps.score)}>
                                {row.enps.score > 0 ? `+${row.enps.score}` : row.enps.score}
                              </Text>
                              {row.previous && (
                                <Text size="xs" c={deltaColor(row.previous.enpsDelta)}>
                                  {formatSigned(row.previous.enpsDelta)}
                                </Text>
                              )}
                            </Group>
                          </Table.Td>
                          {QUESTIONS.map((question) => {
                            const favorable = favorableOf(row, question);
                            return (
                              <Table.Td key={question}>
                                <Text size="sm">
                                  {favorable != null ? `${favorable.toFixed(1)}%` : "—"}
                                </Text>
                              </Table.Td>
                            );
                          })}
                        </>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Text size="xs" c="dimmed">
              {t("pulse.results.comparison.valuesNote")}
            </Text>
          </>
        )}
      </Stack>
    </Paper>
  );
}
