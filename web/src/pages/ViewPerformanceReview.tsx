import type { ParseKeys } from "i18next";
import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Container, Group, Input, Paper, Stack, Tabs, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { getPerformanceReview, publishPerformanceReview, revertPerformanceReview, submitPerformanceReview, unpublishPerformanceReview, type CategoryAssessment, type PerformanceReviewStatus } from "../api/reviews";
import CenteredLoader from "../components/CenteredLoader";
import DateCell from "../components/DateCell";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import PerformanceReviewHistory from "../components/PerformanceReviewHistory";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import PersonCell from "../components/PersonCell";
import RatingBadge from "../components/RatingBadge";
import ProseBox from "../components/ProseBox";
import { formatMonthRange, isCurrentPeriod } from "../utils/datetime";
import { reviewEditLink } from "../utils/performanceReviewLinks";
import { invalidatePerformanceReview } from "../utils/performanceReviewQueries";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";
import { ratingLabel, REVIEW_CATEGORIES } from "../utils/reviewRatings";
import { safeBackParam } from "../utils/url";

// The manager's lifecycle actions per status (the ViewGoal ACTIONS idiom). Every edge is
// bodyless — no close-modal analogue; publish is the "deliver" primary, unpublish the
// deliberate retraction.
const ACTIONS: Record<
  PerformanceReviewStatus,
  { labelKey: ParseKeys; successKey: ParseKeys; run: (id: number) => Promise<void>; primary: boolean }[]
> = {
  DRAFT: [
    { labelKey: "performanceReview.action.submit", successKey: "performanceReview.toast.submitted", run: submitPerformanceReview, primary: true },
  ],
  CALIBRATION: [
    { labelKey: "performanceReview.action.revert", successKey: "performanceReview.toast.reverted", run: revertPerformanceReview, primary: false },
    { labelKey: "performanceReview.action.publish", successKey: "performanceReview.toast.published", run: publishPerformanceReview, primary: true },
  ],
  PUBLISHED: [
    { labelKey: "performanceReview.action.unpublish", successKey: "performanceReview.toast.unpublished", run: unpublishPerformanceReview, primary: false },
  ],
};

function CategoryBlock({ category, assessment }: { category: "attitude" | "delivery" | "skills" | "overall"; assessment: CategoryAssessment }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Input.Wrapper label={t(`performanceReview.category.${category}`)}>
        {assessment.rating != null ? (
          <Group gap="xs" wrap="nowrap">
            <RatingBadge rating={assessment.rating} />
            <Text size="sm" fw={500}>
              {ratingLabel(t, assessment.rating)}
            </Text>
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            {t("performanceReview.notRated")}
          </Text>
        )}
      </Input.Wrapper>
      {assessment.summary ? (
        <ProseBox minHeightLines={2}>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {assessment.summary}
          </Text>
        </ProseBox>
      ) : (
        <Text size="sm" c="dimmed">
          {t("performanceReview.noSummary")}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The performance-review document (the v3.5.0 detail layout): the page header carries the
 * status pill and every action — Close, the manager's Edit link, the lifecycle actions — over
 * the identity strip and the Content/History tabs.
 */
export default function ViewPerformanceReview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const currentUserId = getUserId();

  // Bare visits (notification links) return to the Performance page; drill-downs' explicit back wins.
  const from = searchParams.get("from") ?? undefined;
  const backOverride = safeBackParam(searchParams);
  const backTo = backOverride ?? "/performance";

  const [error, setError] = useState<string | null>(null);
  // The in-flight action's labelKey, so only its button spins.
  const [submitting, setSubmitting] = useState<string | null>(null);

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["performanceReview", id],
    queryFn: () => getPerformanceReview(id),
    enabled: idIsValid,
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("PERFORMANCE_REVIEWS")) return <Navigate to="/" replace />;
  // Malformed id → back to the list (the ViewGoal idiom, v2.35.0 — this page used to render
  // a silent blank panel instead).
  if (!idIsValid) return <Navigate to={backTo} replace />;

  // Status-specific load failures (the ViewGoal shape, v2.35.0 — 404/403/other used to
  // collapse into one generic message here, alone among the detail pages).
  const errorStatus = loadError instanceof ApiError ? loadError.status : null;
  const loadErrorText =
    errorStatus === 404
      ? t("performanceReview.error.notFound")
      : errorStatus === 403
        ? t("performanceReview.error.viewPermission")
        : t("performanceReview.loadError");

  async function runAction(labelKey: string, run: (id: number) => Promise<void>, successKey: ParseKeys) {
    setSubmitting(labelKey);
    setError(null);
    try {
      await run(id);
      await invalidatePerformanceReview(queryClient, id);
      showSuccessToast(t(successKey));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          invalid: "performanceReview.error.incomplete",
          conflict: "performanceReview.error.invalidTransition",
          forbidden: "performanceReview.error.savePermission",
          failed: "performanceReview.error.updateFailed",
        }),
      );
      setSubmitting(null);
    }
  }

  const isManager = data != null && currentUserId != null && data.managerId === currentUserId;
  const canEdit = isManager && data != null && data.status !== "PUBLISHED";

  // Close · Edit · the secondary lifecycle actions (light, the retraction hue) · the primary.
  const actions = (
    <>
      <Button component={RouterLink} to={backTo} variant="default">
        {t("common.action.close")}
      </Button>
      {canEdit && (
        <Button
          component={RouterLink}
          to={reviewEditLink(id, from, backOverride ?? undefined)}
          variant="light"
        >
          {t("common.action.edit")}
        </Button>
      )}
      {isManager &&
        data &&
        ACTIONS[data.status].map((action) => (
          <Button
            key={action.labelKey}
            variant={action.primary ? "filled" : "light"}
            color={action.primary ? undefined : "orange"}
            loading={submitting === action.labelKey}
            disabled={submitting != null && submitting !== action.labelKey}
            onClick={() => void runAction(action.labelKey, action.run, action.successKey)}
          >
            {t(action.labelKey)}
          </Button>
        ))}
    </>
  );

  return (
    <Stack gap="md">
      <PageHeader
        title={t("performanceReview.viewTitle")}
        badge={data && <PerformanceReviewStatusBadge status={data.status} />}
        actions={actions}
      />

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Container size="md" px={0} w="100%">
        <Paper withBorder radius="md" p="md">
          {isLoading && <CenteredLoader />}
          {isError && (
            <Alert color="red" variant="light">
              {loadErrorText}
            </Alert>
          )}

          {data && (
            <Stack gap="md">
              <MetaStrip
                items={[
                  {
                    key: "manager",
                    label: t("performanceReview.manager"),
                    value: <PersonCell userId={data.managerId} name={data.managerName} currentUserId={currentUserId} />,
                  },
                  {
                    key: "subordinate",
                    label: t("performanceReview.subordinate"),
                    value: (
                      <PersonCell userId={data.subordinateId} name={data.subordinateName} currentUserId={currentUserId} />
                    ),
                  },
                  {
                    key: "period",
                    label: t("performanceReview.period"),
                    value: (
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm">
                          {formatMonthRange(data.periodStartMonth, data.periodEndMonth, i18n.language)}
                        </Text>
                        {isCurrentPeriod(data.periodStartMonth, data.periodEndMonth) && (
                          <Badge size="xs" variant="light" color="lettuce">
                            {t("performanceReview.periods.currentBadge")}
                          </Badge>
                        )}
                      </Group>
                    ),
                  },
                  {
                    key: "created",
                    label: t("performanceReview.createdAt"),
                    value: <DateCell value={data.createdAt} mode="date" />,
                  },
                ]}
              />

              <Tabs defaultValue="content" keepMounted={false}>
                <Tabs.List>
                  <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("performanceReview.history")}</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="content" pt="md">
                  <Stack gap="lg">
                    {REVIEW_CATEGORIES.map((c) => (
                      <CategoryBlock key={c} category={c} assessment={data[c]} />
                    ))}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="history" pt="md">
                  <PerformanceReviewHistory reviewId={id} />
                </Tabs.Panel>
              </Tabs>
            </Stack>
          )}
        </Paper>
      </Container>
    </Stack>
  );
}
