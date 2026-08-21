import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { createDaysOff, listDaysOffBudgets, listPublicHolidays, type DaysOffType } from "../api/daysoff";
import { todayIsoDate } from "../utils/datetime";
import { costHalfDays, formatDays } from "../utils/daysOffCost";
import { daysOffListLink } from "../utils/daysOffLinks";
import { toReportOptions, useManagedReports } from "../hooks/useManagedReports";
import { invalidateDaysOff } from "../utils/daysOffQueries";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const TYPES = ["PAID", "UNPAID"] as const;

/**
 * The create-request form: one consecutive period, optional half-day edges, PAID (budgeted) or
 * UNPAID. The cost preview mirrors the server's working-day math over the live holiday
 * registry; a PAID request that would not fit the remaining budget is blocked client-side (the
 * server enforces the same rule with a 409).
 *
 * With `?onBehalf=1` (v2.29.0, the CreateFeedback picker-mode precedent — no separate route)
 * the same form becomes the manager-side recording screen: a direct-report picker, the budget
 * preview reading the PICKED report's managed-budget row, and a "Submit auto-accepted" submit —
 * the entry is born ACCEPTED with the caller as resolver (the vacation-history population flow).
 */
export default function CreateDaysOff() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const onBehalf = searchParams.get("onBehalf") === "1";
  const rawBack = searchParams.get("back");
  const backTo =
    rawBack && rawBack.startsWith("/") ? rawBack : daysOffListLink(onBehalf ? "team" : "requests");

  const [type, setType] = useState<DaysOffType>("PAID");
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [startHalf, setStartHalf] = useState(false);
  const [endHalf, setEndHalf] = useState(false);
  const [subjectPick, setSubjectPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const subjectId = onBehalf && subjectPick != null ? Number(subjectPick) : null;

  // On-behalf mode's picker pool: the caller's direct reports, minus the caller — a manager
  // on their own roster is 403'd server-side (nobody records on their own behalf).
  const { reports, reportsError } = useManagedReports(onBehalf);
  const reportOptions = toReportOptions(reports.filter((p) => p.userId !== getUserId()));

  const holidaysQuery = useQuery({
    queryKey: ["publicHolidays"],
    queryFn: listPublicHolidays,
  });
  const year = Number(startDate.slice(0, 4)) || new Date().getFullYear();
  // The budget preview follows the mode: the caller's own row, or — on behalf — the PICKED
  // report's row out of the managed-budgets view (the UserDaysOff client-side-filter idiom).
  const budgetView = onBehalf ? "managed" : "own";
  const budgetQuery = useQuery({
    queryKey: ["daysOffBudgets", budgetView, year],
    queryFn: () => listDaysOffBudgets(budgetView, year),
    enabled: Number.isFinite(year),
  });
  const budget = onBehalf
    ? budgetQuery.data?.find((b) => b.userId === subjectId)
    : budgetQuery.data?.[0];

  const singleDay = startDate === endDate;
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  const ordered = startDate <= endDate;
  const holidays = new Set((holidaysQuery.data ?? []).map((h) => h.date));
  const costH =
    ordered && sameYear
      ? costHalfDays(startDate, endDate, startHalf, singleDay ? false : endHalf, holidays)
      : null;
  const costDays = costH != null ? costH / 2 : null;
  const overBudget =
    type === "PAID" && costDays != null && budget != null && costDays > budget.remaining;
  const zeroCost = costH === 0;
  const submittable =
    ordered && sameYear && costH != null && costH > 0 && !overBudget && !submitting &&
    (!onBehalf || subjectId != null);

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await createDaysOff({
        type,
        startDate,
        endDate,
        startHalf,
        endHalf: singleDay ? false : endHalf,
        ...(subjectId != null ? { userId: subjectId } : {}),
      });
      await invalidateDaysOff(queryClient);
      showSuccessToast(t(onBehalf ? "daysOff.toast.recorded" : "daysOff.toast.requested"));
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // The overlap 409 carries the conflicting request in ProblemDetail.instance; the
        // budget 409 does not — distinct messages, no detail page to link to. On-behalf
        // wording points at the report's requests/budget, not "yours".
        setError(
          t(
            err.instance
              ? onBehalf ? "daysOff.error.overlapOnBehalf" : "daysOff.error.overlap"
              : onBehalf ? "daysOff.error.overBudgetOnBehalf" : "daysOff.error.overBudget",
          ),
        );
      } else {
        setError(
          saveErrorMessage(err, t, {
            invalid: "daysOff.error.invalid",
            failedStatus: "daysOff.error.saveFailedStatus",
            failed: "daysOff.error.saveFailed",
          }),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack gap="md">
          <Title order={2}>{t(onBehalf ? "daysOff.recordTitle" : "daysOff.createTitle")}</Title>
          <Text size="sm" c="dimmed">
            {t(onBehalf ? "daysOff.recordHint" : "daysOff.createHint")}
          </Text>

          {onBehalf && (
            <Select
              label={t("daysOff.onBehalfLabel")}
              placeholder={t("daysOff.pickReport")}
              data={reportOptions}
              value={subjectPick}
              onChange={setSubjectPick}
              searchable
              clearable
              nothingFoundMessage={t("daysOff.budget.noReports")}
              error={reportsError ? t("common.error.optionsFailed") : undefined}
              w={320}
            />
          )}

          <Select
            label={t("daysOff.type.label")}
            data={TYPES.map((v) => ({ value: v, label: t(`daysOff.type.${v}`) }))}
            value={type}
            onChange={(v) => v && setType(v as DaysOffType)}
            allowDeselect={false}
            w={220}
          />

          <Group align="flex-end" gap="md" wrap="wrap">
            <TextInput
              type="date"
              label={t("daysOff.column.startDate")}
              value={startDate}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setStartDate(v);
                // Keep the range ordered as the user moves the start forward.
                if (v > endDate) setEndDate(v);
              }}
              w={180}
            />
            <TextInput
              type="date"
              label={t("daysOff.column.endDate")}
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.currentTarget.value)}
              w={180}
            />
          </Group>
          <Group gap="xl">
            <Checkbox
              label={t("daysOff.startHalfLabel")}
              checked={startHalf}
              onChange={(e) => setStartHalf(e.currentTarget.checked)}
            />
            <Checkbox
              label={t("daysOff.endHalfLabel")}
              checked={singleDay ? false : endHalf}
              onChange={(e) => setEndHalf(e.currentTarget.checked)}
              disabled={singleDay}
            />
          </Group>

          {!ordered && (
            <Alert color="red" variant="light">
              {t("daysOff.validation.order")}
            </Alert>
          )}
          {ordered && !sameYear && (
            <Alert color="red" variant="light">
              {t("daysOff.validation.sameYear")}
            </Alert>
          )}
          {zeroCost && (
            <Alert color="orange" variant="light">
              {t("daysOff.validation.zeroCost")}
            </Alert>
          )}

          {/* The live preview: the request's working-day cost and, for PAID, what remains. */}
          {costDays != null && costDays > 0 && (
            <Paper withBorder p="sm" radius="md">
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  {/* count drives the plural form (PL: dzień/dni robocze/dni roboczych, with
                      fractional halves on the genitive "dnia roboczego"); days is the
                      locale-formatted display value. */}
                  {t("daysOff.costPreview", {
                    count: costDays,
                    days: formatDays(costDays, i18n.language),
                  })}
                </Text>
                {type === "PAID" && budget != null && (
                  <Text size="sm" c={overBudget ? "red" : "dimmed"}>
                    {t("daysOff.remainingPreview", {
                      days: formatDays(budget.remaining, i18n.language),
                      year,
                    })}
                  </Text>
                )}
                {type === "PAID" && budget != null && budget.allowance == null && (
                  <Text size="xs" c="orange">
                    {t(onBehalf ? "daysOff.budget.noAllowanceOnBehalf" : "daysOff.budget.noAllowance")}
                  </Text>
                )}
              </Stack>
            </Paper>
          )}
          {overBudget && (
            <Alert color="red" variant="light">
              {t(onBehalf ? "daysOff.error.overBudgetOnBehalf" : "daysOff.error.overBudget")}
            </Alert>
          )}

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button component={RouterLink} to={backTo} variant="default" disabled={submitting}>
              {t("common.action.cancel")}
            </Button>
            <Button onClick={() => void submit()} loading={submitting} disabled={!submittable}>
              {t(onBehalf ? "daysOff.action.submitAutoAccepted" : "daysOff.action.submitRequest")}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
