import { useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Group,
  Input,
  Paper,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconCalendarStats, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { hasFeature, isAdmin } from "../api/session";
import { createReviewPeriod, deleteReviewPeriod } from "../api/reviews";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import RowActions from "../components/RowActions";
import StatusPill from "../components/StatusPill";
import TableLoadingRow from "../components/TableLoadingRow";
import { useReviewPeriodOptions } from "../hooks/useReviewPeriodOptions";
import {
  addIsoMonths,
  formatIsoMonth,
  formatMonthRange,
  isCurrentPeriod,
  monthOptions,
  nextIsoMonth,
  yearOptions,
} from "../utils/datetime";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

type MonthChoice = { month: string; year: string };

const currentMonthChoice = (): MonthChoice => {
  const now = new Date();
  return { month: String(now.getMonth() + 1).padStart(2, "0"), year: String(now.getFullYear()) };
};

const toIso = (c: MonthChoice) => `${c.year}-${c.month}`;

/**
 * The global review-period timeline — readable by every authenticated user (v1.34.1, the
 * Templates precedent: the registry GET is open, so the page renders read-only for
 * non-admins), while appending and deleting stay ADMIN-only. The timeline is append-only and
 * gapless: once any period exists, the next one's start is fixed to the month after the latest
 * end (shown as plain text with the rule spelled out — not an input); the period's end is
 * picked from month + year dropdowns whose options exclude anything before the start, so a
 * gap or overlap is unpickable, not merely validated. Only the latest, review-free period can
 * be deleted. Periods are immutable — there is no edit. Since v3.4.0 the page wears the
 * registry list-page shape: the append strip above the timeline table.
 */
export default function ReviewPeriods() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  // The first period's start is a free choice (defaulting to the current month); every later
  // period's start is dictated by the timeline and these two are ignored.
  const [startChoice, setStartChoice] = useState<MonthChoice>(currentMonthChoice);
  // null = "the default": a 6-month period from the start. An explicit pick that a later
  // start change would invalidate falls back to the default rather than lingering invalid.
  const [endChoice, setEndChoice] = useState<MonthChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const deleteConfirm = useDeleteConfirm<number>({
    mutationFn: (periodId) => deleteReviewPeriod(periodId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reviewPeriods"] }),
    successMessage: t("performanceReview.toast.periodDeleted"),
  });

  const admin = isAdmin();
  const { periods, isLoading, isError } = useReviewPeriodOptions();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("PERFORMANCE_REVIEWS")) return <Navigate to="/" replace />;

  const latest = periods && periods.length > 0 ? periods[periods.length - 1] : null;
  // Append-only: with a latest period the next start is not a choice.
  const requiredStart = latest ? nextIsoMonth(latest.endMonth) : null;
  const startIso = requiredStart ?? toIso(startChoice);
  const defaultEndIso = addIsoMonths(startIso, 5); // a 6-month period, the common case
  const chosenEndIso = endChoice ? toIso(endChoice) : null;
  const endIso = chosenEndIso != null && chosenEndIso >= startIso ? chosenEndIso : defaultEndIso;
  const [endYear, endMonth] = endIso.split("-");
  const [startYearNum, startMonthValue] = [Number(startIso.slice(0, 4)), startIso.slice(5)];

  const months = monthOptions(i18n.language);
  // End-month options: when the end year equals the start year, months before the start are
  // simply not offered — an end-before-start period cannot be picked.
  const endMonthOpts =
    Number(endYear) === startYearNum
      ? months.filter((m) => m.value >= startMonthValue)
      : months;
  const endYearOpts = yearOptions(startYearNum, startYearNum + 5);
  const now = new Date().getFullYear();
  const startYearOpts = yearOptions(now - 3, now + 3);
  const columnCount = admin ? 3 : 2;

  async function append() {
    setSubmitting(true);
    setError(null);
    try {
      await createReviewPeriod({ startMonth: startIso, endMonth: endIso });
      await queryClient.invalidateQueries({ queryKey: ["reviewPeriods"] });
      showSuccessToast(t("performanceReview.toast.periodAdded"));
      setEndChoice(null); // back to the default length for the next append
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t("performanceReview.periods.adjacencyConflict")
          : saveErrorMessage(err, t, {
              forbidden: "performanceReview.error.savePermission",
              invalid: "performanceReview.periods.invalidMonths",
              failedStatus: "performanceReview.error.updateFailedStatus",
              failed: "performanceReview.error.updateFailed",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md">
      <PageHeader
        title={t("performanceReview.periods.title")}
        tourId="config-review-periods"
        description={t(admin ? "performanceReview.periods.hint" : "performanceReview.periods.hintReadOnly")}
      />

      {/* The append strip (an in-form adder, hence "Add …" wording) — ADMIN-only; the
          timeline never renders an invalid choice: the fixed start is plain text, and
          the end pickers only offer months at or after it. */}
      {admin && periods && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group align="flex-end" gap="md" wrap="wrap">
              {requiredStart != null ? (
                <Input.Wrapper
                  label={t("performanceReview.periods.startMonth")}
                  description={t("performanceReview.periods.startLocked")}
                  w={220}
                >
                  <Box mih={36} display="flex" style={{ alignItems: "center" }}>
                    <Text size="sm" fw={500}>
                      {formatIsoMonth(requiredStart, i18n.language)}
                    </Text>
                  </Box>
                </Input.Wrapper>
              ) : (
                <>
                  <Select
                    label={t("performanceReview.periods.startMonth")}
                    data={months}
                    value={startChoice.month}
                    onChange={(v) => v && setStartChoice((c) => ({ ...c, month: v }))}
                    allowDeselect={false}
                    w={160}
                  />
                  <Select
                    label={t("performanceReview.periods.year")}
                    data={startYearOpts}
                    value={startChoice.year}
                    onChange={(v) => v && setStartChoice((c) => ({ ...c, year: v }))}
                    allowDeselect={false}
                    w={110}
                  />
                </>
              )}
              <Select
                label={t("performanceReview.periods.endMonth")}
                data={endMonthOpts}
                value={endMonth}
                onChange={(v) => v && setEndChoice({ month: v, year: endYear })}
                allowDeselect={false}
                w={160}
              />
              <Select
                label={t("performanceReview.periods.year")}
                data={endYearOpts}
                value={endYear}
                onChange={(v) => {
                  if (!v) return;
                  // Pulling the year down to the start year clamps a now-too-early month up
                  // to the start month — the selection stays valid instead of snapping back.
                  const clamped =
                    Number(v) === startYearNum && endMonth < startMonthValue
                      ? startMonthValue
                      : endMonth;
                  setEndChoice({ month: clamped, year: v });
                }}
                allowDeselect={false}
                w={110}
              />
              <Group gap="md" align="center" wrap="nowrap" ml="auto" mih={36}>
                {/* The exact period the Add button will create — no format guesswork. */}
                <Text size="sm" fw={500}>
                  {t("performanceReview.periods.preview", {
                    range: formatMonthRange(startIso, endIso, i18n.language),
                  })}
                </Text>
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={() => void append()}
                  loading={submitting}
                >
                  {t("performanceReview.periods.addPeriod")}
                </Button>
              </Group>
            </Group>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      {isError && (
        <Alert color="red" variant="light" title={t("performanceReview.periods.loadError")}>
          {t("performanceReview.unknownError")}
        </Alert>
      )}

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("performanceReview.periods.column.period")}</Table.Th>
            <Table.Th>{t("common.field.status")}</Table.Th>
            {admin && <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : periods && periods.length > 0 ? (
            periods.map((p, index) => {
              const isLatest = index === periods.length - 1;
              const range = formatMonthRange(p.startMonth, p.endMonth, i18n.language);
              return (
                <Table.Tr key={p.id}>
                  {/* The fluid column (v3.4.0): takes the table's slack. */}
                  <Table.Td style={{ width: "100%" }}>
                    <Text size="sm" fw={500}>
                      {range}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {isCurrentPeriod(p.startMonth, p.endMonth) && (
                      <StatusPill color="teal" size="sm" dot>
                        {t("performanceReview.periods.currentBadge")}
                      </StatusPill>
                    )}
                  </Table.Td>
                  {admin && (
                    <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                      {/* Only the LATEST period is deletable — the append-only timeline. */}
                      {isLatest && (
                        <RowActions
                          name={range}
                          primary={{
                            icon: <IconTrash size={16} />,
                            label: t("common.action.delete"),
                            ariaLabel: t("performanceReview.periods.deleteAria", { range }),
                            color: "red",
                            onClick: () => deleteConfirm.requestDelete(p.id),
                          }}
                        />
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconCalendarStats size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t(
                    admin ? "performanceReview.periods.empty" : "performanceReview.periods.emptyReadOnly",
                  )}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("performanceReview.periods.deleteTitle")}
        errorTitle={t("performanceReview.periods.deleteFailed")}
        body={() => t("performanceReview.periods.deleteMessage")}
        errorMessage={(err) =>
          err instanceof ApiError && err.status === 409
            ? t("performanceReview.periods.deleteConflict")
            : saveErrorMessage(err, t, {
                forbidden: "performanceReview.error.savePermission",
                notFound: "performanceReview.error.gone",
                failedStatus: "performanceReview.error.updateFailedStatus",
                failed: "performanceReview.error.updateFailed",
              })
        }
      />
    </Stack>
  );
}
