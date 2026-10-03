import { dynamicKey } from "../utils/i18nKey";
import { pickLocalized } from "../utils/localized";
import {
  Alert,
  Badge,
  Blockquote,
  Divider,
  Group,
  Paper,
  Progress,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import ResponsiveTable from "./ResponsiveTable";
import { IconInfoCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getPulseComments, getPulseResults, getPulseTrend, type PulseAggregationMode, type PulseDriverResult } from "../api/pulse";
import { isShareLapse } from "../utils/shareLapse";
import ShareButton from "./ShareButton";
import {
  PULSE_SMALL_SAMPLE,
  buildTrendSeries,
  deltaColor,
  enpsBandColor,
  enpsBandKey,
  formatSigned,
} from "../utils/pulseResults";

const PulseTrendChart = lazy(() => import("./PulseTrendChart"));

/** The methodology hint (v2.6.4): the DashboardHero info-icon idiom — the tooltip text doubles
 *  as the icon's accessible name, so the explanation is also reachable without a pointer.
 *  Exported for the Trend tab (PulseTrend.tsx), which reuses it beside its metric picker. */
export function HintIcon({ label }: { label: string }) {
  return (
    <Tooltip label={label} multiline w={280}>
      <IconInfoCircle
        size={14}
        color="var(--mantine-color-dimmed)"
        style={{ flexShrink: 0 }}
        role="img"
        aria-label={label}
      />
    </Tooltip>
  );
}

function DriverRow({ driver, questionLabel }: { driver: PulseDriverResult; questionLabel: string }) {
  const { t } = useTranslation();
  return (
    <ResponsiveTable.Tr>
      <ResponsiveTable.Td label={t("pulse.results.question")}>{questionLabel}</ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("pulse.results.mean")}>{driver.mean != null ? driver.mean.toFixed(1) : "—"}</ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("pulse.results.favorable")}>{driver.favorablePct != null ? `${driver.favorablePct.toFixed(1)}%` : "—"}</ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("pulse.results.unfavorable")}>{driver.unfavorablePct != null ? `${driver.unfavorablePct.toFixed(1)}%` : "—"}</ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("pulse.results.validCount")}>{driver.validCount}</ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("pulse.results.meanDelta")}>
        {driver.meanDelta != null ? (
          <Text size="sm" c={deltaColor(driver.meanDelta)}>
            {formatSigned(driver.meanDelta, 1)}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("pulse.results.favorableDelta")}>
        {/* The favorable-share change vs the previous cycle, in percentage points (v2.6.2 —
            the wire always carried it; the table finally shows it). */}
        {driver.favorableDeltaPp != null ? (
          <Text size="sm" c={deltaColor(driver.favorableDeltaPp)}>
            {formatSigned(driver.favorableDeltaPp, 1)} {t("pulse.results.ppUnit")}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </ResponsiveTable.Td>
    </ResponsiveTable.Tr>
  );
}

/**
 * One team's results block for a closed cycle: the eNPS headline with its previous-cycle
 * delta, the promoter/passive/detractor split, the per-question table (fixed Q2-Q5 localized,
 * the rotating question in the server's snapshotted wording), the trend chart, and — for
 * callers who monitor this team — the anonymized comments. The response count is always
 * visible, and nothing is ever framed as statistically significant. A scope under the
 * k-anonymity floor renders the withheld state instead of numbers.
 *
 * Sharing (v4.12.0): the Share button follows the server's `canShare` ONLY (never `sharedBy`);
 * `sharedBy` names whoever's share granted this read, on whichever view it arrives; comments are
 * fetched for a monitor or when the server says `canReadComments`; a lapse 403 (the sharer sat this
 * cycle out, or lost the team) reads as a neutral note, not a red load error.
 */
export default function PulseTeamResultCard({
  cycleId,
  teamId,
  teamName,
  mode,
  canMonitor,
  commentsOnly = false,
  highlighted = false,
  sharedByFallback,
}: {
  cycleId: number;
  teamId: number;
  teamName: string;
  mode: PulseAggregationMode;
  canMonitor: boolean;
  /** A fill-gated monitor (a manager who didn't respond): skip the aggregate/trend queries
   *  and render only the comments section their monitoring right still covers. */
  commentsOnly?: boolean;
  /** The deep link's `?team=` target: marked (aria-current + accent bar) and scrolled into view. */
  highlighted?: boolean;
  /** The sharer named by the "Shared with me" list — shown when the read itself carries no
   *  `sharedBy` (not loaded yet, or lapsed). */
  sharedByFallback?: string;
}) {
  const { t, i18n } = useTranslation();
  const paperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // happy-dom (and very old browsers) lack scrollIntoView; the highlight itself still renders.
    if (highlighted) paperRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted]);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["pulseResults", cycleId, teamId, mode],
    queryFn: () => getPulseResults(cycleId, teamId, mode),
    retry: false,
    enabled: !commentsOnly,
  });
  // "Would GET comments succeed": a monitor, or the server-computed flag (HR, or a share whose
  // sharer monitors the team).
  const showComments = canMonitor || data?.canReadComments === true;
  const trend = useQuery({
    queryKey: ["pulseTrend", teamId, mode],
    queryFn: () => getPulseTrend(teamId, mode),
    retry: false,
    enabled: !commentsOnly,
  });
  const comments = useQuery({
    queryKey: ["pulseComments", cycleId, teamId, mode],
    queryFn: () => getPulseComments(cycleId, teamId, mode),
    enabled: showComments,
    retry: false,
  });

  const lapsed = isError && isShareLapse(error);
  const sharedBy = data?.sharedBy ?? sharedByFallback;
  const trendSeries = trend.data ? buildTrendSeries(trend.data.points) : [];
  const questionLabel = (driver: PulseDriverResult) =>
    driver.question === "ROTATING"
      ? (driver.rotatingText ? pickLocalized(driver.rotatingText, i18n.resolvedLanguage) : "")
      : t(dynamicKey(`pulse.${driver.question.toLowerCase()}`));

  return (
    <Paper ref={paperRef} withBorder shadow="sm" p="lg" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="baseline" style={{ minWidth: 0 }}>
          <Title
            order={4}
            aria-current={highlighted ? "true" : undefined}
            style={{
              minWidth: 0,
              overflowWrap: "break-word",
              ...(highlighted
                ? {
                    background: "var(--mantine-primary-color-light)",
                    boxShadow: "inset 3px 0 0 var(--mantine-primary-color-filled)",
                    paddingLeft: "var(--mantine-spacing-xs)",
                  }
                : {}),
            }}
          >
            {teamName}
          </Title>
          <Group gap="sm" align="center">
            {data && (
              <Text size="sm" c="dimmed">
                {t("pulse.results.responses", {
                  completed: data.responseCount,
                  participants: data.participantCount,
                  rate: data.responseRate,
                })}
              </Text>
            )}
            <ShareButton canShare={data?.canShare} resourceType="PULSE_TEAM_RESULTS" resourceId={teamId} />
          </Group>
        </Group>
        {sharedBy != null && sharedBy !== "" && (
          <Text size="xs" c="dimmed">
            {t("sharing.sharedBy", { name: sharedBy })}
          </Text>
        )}

        {!commentsOnly && isLoading && <Skeleton height={120} radius="sm" />}
        {!commentsOnly && isError && (
          <Alert color={lapsed ? "gray" : "red"} variant="light">
            {lapsed ? t("pulse.results.sharedUnavailable") : t("pulse.results.loadError")}
          </Alert>
        )}

        {data?.insufficientResponses && (
          <Text c="dimmed" py="md">
            {t("pulse.results.notEnoughResponses")}
          </Text>
        )}

        {data && !data.insufficientResponses && data.enps && (
          <>
            {/* Small scopes are volatile — at n=3 one person switching bands moves the score
                by ±33 points. Say so rather than letting swings be over-read (v2.6.2). */}
            {data.responseCount < PULSE_SMALL_SAMPLE && (
              <Text size="xs" c="dimmed">
                {t("pulse.results.smallSample")}
              </Text>
            )}
            <Group align="baseline" gap="md">
              {/* Contextual band color + caption (v2.6.2) — approximate industry framing,
                  deliberately coarse: red below 0, neutral to +20, teal above. */}
              <Text fz={40} fw={600} lh={1} c={enpsBandColor(data.enps.score)}>
                {data.enps.score > 0 ? `+${data.enps.score}` : data.enps.score}
              </Text>
              <Stack gap={0}>
                <Group gap={4} wrap="nowrap">
                  <Text size="sm" c="dimmed">
                    {t("pulse.results.enps")}
                  </Text>
                  <HintIcon label={t("pulse.results.hint.enps")} />
                </Group>
                <Text size="xs" c="dimmed">
                  {t(`pulse.results.band.${enpsBandKey(data.enps.score)}`)}
                </Text>
              </Stack>
              {data.previous && (
                <Badge color={deltaColor(data.previous.enpsDelta)} variant="light">
                  {formatSigned(data.previous.enpsDelta)} {t("pulse.results.deltaVsPrevious")}
                </Badge>
              )}
            </Group>
            <Progress.Root size="lg">
              <Progress.Section aria-label={t("pulse.results.promoters")} value={data.enps.promoterPct} color="teal" />
              <Progress.Section aria-label={t("pulse.results.passives")} value={data.enps.passivePct} color="gray" />
              <Progress.Section aria-label={t("pulse.results.detractors")} value={data.enps.detractorPct} color="red" />
            </Progress.Root>
            <Group gap="lg">
              <Text size="xs" c="dimmed">
                {t("pulse.results.promoters")} {data.enps.promoterPct.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {t("pulse.results.passives")} {data.enps.passivePct.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {t("pulse.results.detractors")} {data.enps.detractorPct.toFixed(1)}%
              </Text>
            </Group>

            {data.drivers && (
              <ResponsiveTable mode="matrix" density="normal" minWidth={900}>
                <ResponsiveTable.Thead>
                  <ResponsiveTable.Tr>
                    <ResponsiveTable.Th>{t("pulse.results.question")}</ResponsiveTable.Th>
                    {/* Every metric header carries a how-is-this-computed hint (v2.6.4). */}
                    {(["mean", "favorable", "unfavorable", "validCount", "meanDelta", "favorableDelta"] as const).map(
                      (metric) => (
                        <ResponsiveTable.Th key={metric}>
                          <Group gap={4} wrap="nowrap">
                            {t(`pulse.results.${metric}`)}
                            <HintIcon label={t(`pulse.results.hint.${metric}`)} />
                          </Group>
                        </ResponsiveTable.Th>
                      ),
                    )}
                  </ResponsiveTable.Tr>
                </ResponsiveTable.Thead>
                <ResponsiveTable.Tbody>
                  {data.drivers.map((driver) => (
                    <DriverRow key={driver.question} driver={driver} questionLabel={questionLabel(driver)} />
                  ))}
                </ResponsiveTable.Tbody>
              </ResponsiveTable>
            )}
          </>
        )}

        {!commentsOnly && !lapsed && (
          <>
            <Divider label={t("pulse.results.trendTitle")} labelPosition="left" />
            {trendSeries.length >= 2 ? (
              <Suspense fallback={<Skeleton height={200} radius="sm" />}>
                <PulseTrendChart
                  data={trendSeries}
                  series={[{ name: "enps", label: t("pulse.results.enps"), color: "lettuce.6" }]}
                />
              </Suspense>
            ) : (
              <Text size="sm" c="dimmed">
                {t(trend.isError ? "pulse.results.trendUnavailable" : "pulse.results.trendPending")}
              </Text>
            )}
          </>
        )}

        {showComments && comments.data && !comments.data.insufficientResponses && comments.data.items.length > 0 && (
          <>
            <Divider label={t("pulse.results.commentsTitle")} labelPosition="left" />
            <Text size="xs" c="dimmed">
              {t("pulse.results.commentsAnonymized")}
            </Text>
            <Stack gap="xs">
              {comments.data.items.map((comment, index) => (
                <Blockquote key={index} p="sm">
                  {comment}
                </Blockquote>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}
