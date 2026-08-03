import { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, createPerformanceReview, listTeamMembers } from "../api/client";
import PersonaField from "../components/PersonaField";
import { renderPeriodOption, useReviewPeriodOptions } from "../hooks/useReviewPeriodOptions";
import { reviewEditLink, reviewViewLink } from "../utils/performanceReviewLinks";
import { reviewSaveErrorMessage } from "../utils/reviewRatings";
import { groupTeamRows } from "../utils/teamRows";

const BACK_TO = "/?tab=reviews";
const PICKER_PAGE_SIZE = 100;

// The occupied-slot 409 carries the existing review's API path in ProblemDetail.instance —
// surface it as a link so the manager lands on the record instead of hunting for it.
function conflictReviewId(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const instance = (err.body as { instance?: string } | null)?.instance;
  const match = instance?.match(/\/performance-reviews\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * Deliberately minimal (the CreateOneOnOne idiom): pick the direct report (skipped when a card
 * prefilled it) and the period, create the empty DRAFT, and land straight in the editor where
 * the four assessments are filled in. A subordinate has at most one review per period — an
 * occupied slot is a 409 with a link to the existing review.
 */
export default function CreatePerformanceReview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const preselectedId = Number(searchParams.get("subordinateId"));
  const preselected = Number.isFinite(preselectedId) && preselectedId > 0;
  const subordinateName = searchParams.get("subordinateName");
  const backParam = searchParams.get("back");
  const backTo = backParam ?? BACK_TO;

  const [subordinate, setSubordinate] = useState<string | null>(
    preselected ? String(preselectedId) : null,
  );
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: reports } = useQuery({
    queryKey: ["teamMembers", "reviewPicker"],
    queryFn: () =>
      listTeamMembers({ view: "managed", page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
    enabled: !preselected,
  });
  const options = useMemo(
    () =>
      groupTeamRows(reports?.items ?? []).map((p) => ({
        value: String(p.userId),
        label: p.name,
      })),
    [reports],
  );

  // Newest first. A not-yet-started period is not assessable (the server 400s it), so its
  // option renders disabled and the default is the newest STARTED period — usually the
  // currently-running one. With every period still in the future there is no valid choice:
  // effectivePeriod stays null, which keeps Create disabled (the alert below explains).
  const { periods, options: rawPeriodOptions } = useReviewPeriodOptions();
  const periodOptions = useMemo(
    () => rawPeriodOptions.map((o) => ({ ...o, disabled: o.future === true })),
    [rawPeriodOptions],
  );
  const effectivePeriod = periodId ?? periodOptions.find((o) => !o.disabled)?.value ?? null;
  const allPeriodsFuture = periodOptions.length > 0 && periodOptions.every((o) => o.disabled);

  async function save() {
    if (!subordinate || !effectivePeriod) return;
    setSubmitting(true);
    setError(null);
    setConflictId(null);
    try {
      const created = await createPerformanceReview({
        subordinateId: Number(subordinate),
        periodId: Number(effectivePeriod),
      });
      await queryClient.invalidateQueries({ queryKey: ["performanceReviews"] });
      // Straight into the editor — the DRAFT is empty and waiting for its assessments.
      navigate(reviewEditLink(created.id, undefined, backTo), { replace: true });
    } catch (err) {
      setConflictId(conflictReviewId(err));
      setError(
        err instanceof ApiError && err.status === 409
          ? t("performanceReview.error.duplicate")
          : reviewSaveErrorMessage(err, t),
      );
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack gap="md">
          <Title order={2}>{t("performanceReview.newReview")}</Title>
          <Text size="sm" c="dimmed">
            {t("performanceReview.createHint")}
          </Text>

          <Group gap="xl" align="flex-start">
            <PersonaField label={t("performanceReview.manager")} you />
            {preselected ? (
              <PersonaField
                label={t("performanceReview.subordinate")}
                name={subordinateName ?? `#${preselectedId}`}
              />
            ) : (
              <Select
                label={t("performanceReview.subordinate")}
                placeholder={t("performanceReview.pickSubordinate")}
                data={options}
                value={subordinate}
                onChange={setSubordinate}
                searchable
                clearable
                nothingFoundMessage={t("performanceReview.noReports")}
              />
            )}
            <Select
              label={t("performanceReview.period")}
              data={periodOptions}
              value={effectivePeriod}
              onChange={setPeriodId}
              allowDeselect={false}
              renderOption={renderPeriodOption}
              w={260}
            />
          </Group>

          {periods != null && periods.length === 0 && (
            <Alert color="orange" variant="light">
              {t("performanceReview.noPeriods")}
            </Alert>
          )}
          {allPeriodsFuture && (
            <Alert color="orange" variant="light">
              {t("performanceReview.noStartedPeriods")}
            </Alert>
          )}
          {error && (
            <Alert color="red" variant="light">
              <Stack gap={4}>
                <Text size="sm">{error}</Text>
                {conflictId != null && (
                  <Anchor component={RouterLink} to={reviewViewLink(conflictId, undefined, backTo)} size="sm">
                    {t("performanceReview.openExisting")}
                  </Anchor>
                )}
              </Stack>
            </Alert>
          )}

          <Group justify="flex-end">
            {/* A two-Select form holds nothing worth a discard confirm — plain Cancel. */}
            <Button component={RouterLink} to={backTo} variant="default">
              {t("common.action.cancel")}
            </Button>
            <Button
              onClick={() => void save()}
              loading={submitting}
              disabled={!subordinate || !effectivePeriod}
            >
              {t("common.action.create")}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
