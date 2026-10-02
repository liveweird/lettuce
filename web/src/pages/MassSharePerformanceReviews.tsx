import { useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { MultiSelect, Select, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { listShareCandidates } from "../api/reviews";
import { getUserId, hasFeature } from "../api/session";
import MassSharePage, { type MassShareColumn, type MassShareExtraFilters } from "../components/MassSharePage";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import RatingBadge from "../components/RatingBadge";
import { useReviewPeriodOptions } from "../hooks/useReviewPeriodOptions";
import { isOneOf, isStringArray, useStoredState } from "../hooks/useStoredState";
import {
  buildReviewShareRows,
  EMPTY_MASS_SHARE_FILTERS,
  MASS_SHARE_STATUS_VALUES,
  reasonKey,
  type MassShareFilters,
  type MassShareRow,
  type MassShareStatus,
} from "../utils/massShare";
import { RATING_VALUES, ratingOptions } from "../utils/reviewRatings";

const SETTINGS_KEY = "massShare";
const BACK_TO = "/performance?tab=managed";

// "" (off) or one of the rating scale's values — a stale stored value must not silently hide everyone.
const MIN_OVERALL_VALUES = ["", ...RATING_VALUES.map(String)] as const;

const isStatusArray = (v: unknown): v is MassShareStatus[] =>
  isStringArray(v) && v.every((s) => (MASS_SHARE_STATUS_VALUES as readonly string[]).includes(s));

/** `periodId` from the URL: a positive integer or null (missing/malformed — the page bounces away). */
function parsePeriodId(raw: string | null): number | null {
  return raw != null && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/** Why a review cannot be shared, as the checkbox's accessible name and the Status cell's text. */
function reviewReasonText(row: MassShareRow, t: TFunction): string | null {
  const reason = reasonKey(row);
  return reason === "noReview"
    ? t("performanceReview.massShare.reason.noReview")
    : reason === "draftBy"
      ? t("performanceReview.massShare.reason.draftBy", { name: row.review?.managerName ?? "" })
      : null;
}

// The reviews' own columns after the six person columns — module-level so the memoized rows keep
// a stable prop across selection toggles.
const REVIEW_COLUMNS: readonly MassShareColumn[] = [
  {
    key: "status",
    header: (t) => t("common.field.status"),
    sortField: "status",
    cell: (row, t) => {
      const reasonText = reviewReasonText(row, t);
      return reasonText != null || row.review == null ? (
        <Text size="sm" c="dimmed">
          {reasonText ?? "—"}
        </Text>
      ) : (
        <PerformanceReviewStatusBadge status={row.review.status} />
      );
    },
  },
  {
    key: "overall",
    header: (t) => t("performanceReview.category.overall"),
    sortField: "overall",
    cell: (row) =>
      row.review?.overallRating != null ? (
        <RatingBadge rating={row.review.overallRating} />
      ) : (
        <Text size="sm" c="dimmed">
          —
        </Text>
      ),
  },
];

/**
 * The reviews mass-share page (v4.10.0, `/performance-reviews/mass-share?periodId=`): everyone in
 * the caller's reporting line for ONE review period — `MassSharePage` is the shell, this supplies
 * the period, the candidates read, the review status/rating facets and columns and the wording.
 * People the caller cannot share (no review, another manager's draft) stay listed, greyed out
 * with the reason.
 */
export default function MassSharePerformanceReviews() {
  const [searchParams] = useSearchParams();
  if (!hasFeature("PERFORMANCE_REVIEWS")) return <Navigate to="/" replace />;
  const periodId = parsePeriodId(searchParams.get("periodId"));
  if (periodId == null) return <Navigate to={BACK_TO} replace />;
  // Keyed by period so the selection (plain state, never persisted) cannot leak across periods.
  return <MassShareContent key={periodId} periodId={periodId} />;
}

function MassShareContent({ periodId }: { periodId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  const youLabel = t("sharing.massShare.you");

  const [statuses, setStatuses] = useStoredState<MassShareStatus[]>(`${SETTINGS_KEY}.filter.status`, [], isStatusArray);
  const [minOverall, setMinOverall] = useStoredState(
    `${SETTINGS_KEY}.filter.minOverall`, EMPTY_MASS_SHARE_FILTERS.minOverall, isOneOf(MIN_OVERALL_VALUES),
  );

  const { periods, options: periodOptions, isLoading: periodsLoading } = useReviewPeriodOptions();
  const periodLabel = periodOptions.find((o) => o.value === String(periodId))?.label;

  const candidatesKey = useMemo(() => ["performanceReviews", "shareCandidates", periodId] as const, [periodId]);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: candidatesKey,
    queryFn: () => listShareCandidates(periodId),
    // The grid must not reshuffle under a half-made selection on a window refocus.
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(
    () => buildReviewShareRows(data?.items ?? [], currentUserId, youLabel),
    [data, currentUserId, youLabel],
  );
  const statusOpts = MASS_SHARE_STATUS_VALUES.map((s) => ({
    value: s,
    label: s === "NO_REVIEW" ? t("performanceReview.massShare.statusNoReview") : t(`performanceReview.status.${s}`),
  }));

  const extraValues = useMemo<Partial<MassShareFilters>>(() => ({ statuses, minOverall }), [statuses, minOverall]);
  const extraFilters: MassShareExtraFilters = {
    values: extraValues,
    activeCount: statuses.length + (minOverall ? 1 : 0),
    deps: [statuses, minOverall],
    onClear: () => {
      setStatuses([]);
      setMinOverall("");
    },
    children: (
      <>
        <MultiSelect
          label={t("performanceReview.massShare.facet.status")}
          data={statusOpts}
          value={statuses}
          onChange={(v) => setStatuses(v as MassShareStatus[])}
          clearable
          w={220}
        />
        <Select
          label={t("performanceReview.massShare.facet.minOverall")}
          data={ratingOptions(t)}
          value={minOverall || null}
          onChange={(v) => setMinOverall(v ?? "")}
          clearable
          w={260}
        />
      </>
    ),
  };

  if (periods != null && !periodsLoading && periodLabel == null) {
    // A period that no longer exists (a stale link): the server would 400 the candidates read.
    return <Navigate to={BACK_TO} replace />;
  }

  return (
    <MassSharePage
      resourceType="PERFORMANCE_REVIEW"
      kind="reviews"
      settingsKey={SETTINGS_KEY}
      backTo={BACK_TO}
      backLabel={t("performanceReview.massShare.backLabel")}
      title={t("performanceReview.massShare.title")}
      description={t("performanceReview.massShare.description")}
      youLabel={youLabel}
      personLabel={t("performanceReview.subordinate")}
      rows={rows}
      ready={data != null}
      isLoading={isLoading}
      isError={isError}
      error={error}
      reasonText={reviewReasonText}
      extraMeta={[{ key: "period", label: t("performanceReview.period"), value: periodLabel ?? "—" }]}
      extraFilters={extraFilters}
      extraColumns={REVIEW_COLUMNS}
      onSettled={() => void queryClient.invalidateQueries({ queryKey: candidatesKey })}
    />
  );
}
