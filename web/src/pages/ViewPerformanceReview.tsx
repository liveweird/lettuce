import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Center,
  Container,
  Group,
  Input,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  getPerformanceReview,
  getUserId,
  publishPerformanceReview,
  revertPerformanceReview,
  submitPerformanceReview,
  unpublishPerformanceReview,
  type CategoryAssessment,
  type PerformanceReviewStatus,
} from "../api/client";
import PerformanceReviewHistory from "../components/PerformanceReviewHistory";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import PersonaField from "../components/PersonaField";
import RatingBadge from "../components/RatingBadge";
import ProseBox from "../components/ProseBox";
import ReadOnlyField from "../components/ReadOnlyField";
import { formatDate, formatMonthRange, isCurrentPeriod } from "../utils/datetime";
import { reviewEditLink } from "../utils/performanceReviewLinks";
import { invalidatePerformanceReview } from "../utils/performanceReviewQueries";
import { showSuccessToast } from "../utils/toast";
import { ratingLabel, REVIEW_CATEGORIES } from "../utils/reviewRatings";

// The manager's lifecycle actions per status (the ViewGoal ACTIONS idiom). Every edge is
// bodyless — no close-modal analogue; publish is the "deliver" primary, unpublish the
// deliberate retraction.
const ACTIONS: Record<
  PerformanceReviewStatus,
  { labelKey: string; successKey: string; run: (id: number) => Promise<void>; primary: boolean }[]
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

function CategoryBlock({ category, assessment }: { category: string; assessment: CategoryAssessment }) {
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

export default function ViewPerformanceReview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const currentUserId = getUserId();

  // Bare visits (notification links) return to My performance; drill-downs' explicit back wins.
  const from = searchParams.get("from") ?? undefined;
  const backOverride = searchParams.get("back");
  const backTo = backOverride ?? "/my-performance";

  const [error, setError] = useState<string | null>(null);
  // The in-flight action's labelKey, so only its button spins.
  const [submitting, setSubmitting] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["performanceReview", id],
    queryFn: () => getPerformanceReview(id),
    enabled: idIsValid,
  });

  async function runAction(labelKey: string, run: (id: number) => Promise<void>, successKey: string) {
    setSubmitting(labelKey);
    setError(null);
    try {
      await run(id);
      await invalidatePerformanceReview(queryClient, id);
      showSuccessToast(t(successKey));
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(t("performanceReview.error.incomplete"));
      } else if (err instanceof ApiError && err.status === 409) {
        setError(t("performanceReview.error.invalidTransition"));
      } else if (err instanceof ApiError && err.status === 403) {
        setError(t("performanceReview.error.savePermission"));
      } else {
        setError(t("performanceReview.error.updateFailed"));
      }
      setSubmitting(null);
    }
  }

  const isManager = data != null && currentUserId != null && data.managerId === currentUserId;
  const canEdit = isManager && data != null && data.status !== "PUBLISHED";

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={2}>{t("performanceReview.viewTitle")}</Title>
            {data && <PerformanceReviewStatusBadge status={data.status} />}
          </Group>

          {isLoading && (
            <Center py="xl">
              <Loader />
            </Center>
          )}
          {isError && (
            <Alert color="red" variant="light">
              {t("performanceReview.loadError")}
            </Alert>
          )}

          {data && (
            <>
              <Group gap="xl" align="flex-start">
                <PersonaField
                  label={t("performanceReview.manager")}
                  name={data.managerName}
                  you={currentUserId === data.managerId}
                />
                <PersonaField
                  label={t("performanceReview.subordinate")}
                  name={data.subordinateName}
                  you={currentUserId === data.subordinateId}
                />
                <ReadOnlyField label={t("performanceReview.period")}>
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
                </ReadOnlyField>
                <ReadOnlyField label={t("performanceReview.createdAt")}>
                  <Text size="sm">{formatDate(data.createdAt, i18n.language)}</Text>
                </ReadOnlyField>
              </Group>

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
            </>
          )}

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <Group justify="flex-end">
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
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
