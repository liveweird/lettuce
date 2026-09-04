import type { ParseKeys } from "i18next";
import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Center,
  ColorSwatch,
  Container,
  Fieldset,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import EmojiTextarea from "../components/EmojiTextarea";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { deletePerformanceReview, getPerformanceReview, submitPerformanceReview, updatePerformanceReview } from "../api/reviews";
import ConfirmActionModal from "../components/ConfirmActionModal";
import FormFooter from "../components/FormFooter";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import PerformanceReviewHistory from "../components/PerformanceReviewHistory";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import PersonaChip from "../components/PersonaChip";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { formatMonthRange, isCurrentPeriod } from "../utils/datetime";
import { reviewViewLink } from "../utils/performanceReviewLinks";
import { invalidatePerformanceReview } from "../utils/performanceReviewQueries";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";
import {
  isReviewComplete,
  MAX_REVIEW_SUMMARY_LENGTH,
  ratingColor,
  ratingOptions,
  REVIEW_CATEGORIES,
  reviewFormValidation,
  reviewSaveErrorMessage,
  toReviewBody,
  toReviewFormValues,
  type ReviewFormValues,
} from "../utils/reviewRatings";

const EMPTY_VALUES: ReviewFormValues = {
  attitude: { rating: "", summary: "" },
  delivery: { rating: "", summary: "" },
  skills: { rating: "", summary: "" },
  overall: { rating: "", summary: "" },
};

/**
 * The manager's assessment editor — DRAFT and CALIBRATION only (a PUBLISHED review is
 * read-only; anyone who is not the manager lands on the view screen). While DRAFT, ratings may
 * be left unset and Save & submit gates on completeness; in CALIBRATION every value must stay
 * filled (the server's never-blank rule, mirrored client-side by the validation).
 */
export default function EditPerformanceReview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const currentUserId = getUserId();

  const from = searchParams.get("from") ?? undefined;
  const backOverride = safeBackParam(searchParams);
  const backTo = backOverride ?? "/performance";

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "submit" | "delete" | null>(null);
  const [deleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["performanceReview", id],
    queryFn: () => getPerformanceReview(id),
    enabled: idIsValid,
  });

  const isCalibration = data?.status === "CALIBRATION";
  // Bounds-only form validation (static — useForm captures `validate` at creation); the
  // status-dependent completeness rule runs in save() instead, against the live status.
  const form = useForm<ReviewFormValues>({
    initialValues: EMPTY_VALUES,
    validate: reviewFormValidation(t, false),
  });
  // The one cancel guard (v3.5.0) — eight scalar fields, so `isDirty` is exact.
  const { requestCancel, modalProps } = useDiscardGuard({
    isDirty: () => form.isDirty(),
    to: backTo,
    title: t("performanceReview.discardTitle"),
    message: t("performanceReview.discardMessage"),
  });
  // One-shot seed once the document arrives (the EditGoal idiom).
  if (data && data.status !== "PUBLISHED" && !form.initialized) {
    form.initialize(toReviewFormValues(data));
  }

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("PERFORMANCE_REVIEWS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Redirects to the read-only view keep the originating context (`from` / `back` override).
  const viewLink = reviewViewLink(id, from, backOverride ?? undefined);
  // Only the manager edits; anyone else who can read lands on the view screen.
  if (data && currentUserId !== data.managerId) return <Navigate to={viewLink} replace />;
  // A PUBLISHED review is read-only — its only action (Unpublish) lives on the view screen.
  if (data && data.status === "PUBLISHED") return <Navigate to={viewLink} replace />;

  async function afterSave(successKey: ParseKeys) {
    await invalidatePerformanceReview(queryClient, id);
    showSuccessToast(t(successKey));
    navigate(backTo, { replace: true });
  }

  async function save(values: ReviewFormValues, andSubmit: boolean) {
    // Completeness gates client-side, mirroring the server: Save & submit would strand a
    // half-submitted flow (the save succeeds, the submit 400s), and a CALIBRATION save may
    // never blank a value (the server would 400 the PUT itself).
    if ((andSubmit || isCalibration) && !isReviewComplete(values)) {
      setError(t("performanceReview.error.incomplete"));
      return;
    }
    setSubmitting(andSubmit ? "submit" : "save");
    setError(null);
    try {
      await updatePerformanceReview(id, toReviewBody(values));
      if (andSubmit) await submitPerformanceReview(id);
      await afterSave(andSubmit ? "performanceReview.toast.submitted" : "performanceReview.toast.saved");
    } catch (err) {
      setError(reviewSaveErrorMessage(err, t));
      setSubmitting(null);
    }
  }

  async function remove() {
    setSubmitting("delete");
    setError(null);
    try {
      await deletePerformanceReview(id);
      queryClient.removeQueries({ queryKey: ["performanceReview", id] });
      await invalidatePerformanceReview(queryClient);
      showSuccessToast(t("performanceReview.toast.deleted"));
      navigate(backTo, { replace: true });
    } catch (err) {
      closeDelete();
      setError(reviewSaveErrorMessage(err, t));
      setSubmitting(null);
    }
  }

  const isDraft = data?.status === "DRAFT";

  return (
    <>
      <PageHeader
        title={t("performanceReview.editTitle")}
        badge={data && <PerformanceReviewStatusBadge status={data.status} />}
        mb="lg"
      />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          {isLoading && (
            <Center py="xl">
              <Loader />
            </Center>
          )}
          {isError && (
            <Stack gap="md">
              <Alert color="red" variant="light">
                {t("performanceReview.loadError")}
              </Alert>
              <FormFooter>
                <Button component={RouterLink} to={backTo} variant="default">
                  {t("common.action.close")}
                </Button>
              </FormFooter>
            </Stack>
          )}

          {data && (
            <form onSubmit={form.onSubmit((values) => void save(values, false))}>
              <Stack gap="md">
                {/* The context line (v3.5.0): the pair and the reviewed period. */}
                <MetaStrip
                  items={[
                    {
                      key: "manager",
                      label: t("performanceReview.manager"),
                      value: <Text size="sm">{t("common.state.you")}</Text>,
                    },
                    {
                      key: "subordinate",
                      label: t("performanceReview.subordinate"),
                      value: <PersonaChip name={data.subordinateName} />,
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
                  ]}
                />

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("performanceReview.history")}</Tabs.Tab>
                  </Tabs.List>
                  <Tabs.Panel value="content" pt="md">
                    <Stack gap="lg">
                      {isCalibration && (
                        <Text size="sm" c="dimmed">
                          {t("performanceReview.calibrationEditHint")}
                        </Text>
                      )}
                      {/* One Fieldset per rated category (v3.5.0): the legend names the category,
                          so the rating Select carries the category as its aria-label only
                          (the accessible name the tests and e2e key on stays "Attitude", …). */}
                      {REVIEW_CATEGORIES.map((category) => (
                        <Fieldset key={category} legend={t(`performanceReview.section.${category}`)}>
                          <Stack gap="xs">
                            <Select
                              aria-label={t(`performanceReview.category.${category}`)}
                              placeholder={t("performanceReview.pickRating")}
                              data={ratingOptions(t)}
                              // The consistent rating color scale, visible while picking.
                              renderOption={({ option }) => (
                                <Group gap="xs" wrap="nowrap">
                                  <ColorSwatch
                                    color={`var(--mantine-color-${ratingColor(Number(option.value)).replace(".", "-")})`}
                                    size={12}
                                  />
                                  <span>{option.label}</span>
                                </Group>
                              )}
                              // While DRAFT a rating may be cleared back to unset; from
                              // CALIBRATION onward values may change but never blank.
                              clearable={!isCalibration}
                              allowDeselect={false}
                              w={340}
                              {...form.getInputProps(`${category}.rating`)}
                            />
                            <EmojiTextarea
                              label={t("performanceReview.summary")}
                              maxLength={MAX_REVIEW_SUMMARY_LENGTH}
                              autosize
                              minRows={2}
                              maxRows={8}
                              {...form.getInputProps(`${category}.summary`)}
                            />
                          </Stack>
                        </Fieldset>
                      ))}
                    </Stack>
                  </Tabs.Panel>
                  <Tabs.Panel value="history" pt="md">
                    <PerformanceReviewHistory reviewId={id} />
                  </Tabs.Panel>
                </Tabs>

                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}

                <FormFooter sticky>
                  {isDraft && (
                    <Button
                      color="red"
                      variant="light"
                      mr="auto"
                      onClick={openDelete}
                      loading={submitting === "delete"}
                      disabled={submitting != null && submitting !== "delete"}
                    >
                      {t("common.action.delete")}
                    </Button>
                  )}
                  <Button variant="default" onClick={requestCancel}>
                    {t("common.action.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    variant={isDraft ? "light" : "filled"}
                    loading={submitting === "save"}
                    disabled={submitting != null && submitting !== "save"}
                  >
                    {isDraft ? t("performanceReview.saveDraft") : t("common.action.save")}
                  </Button>
                  {isDraft && (
                    <Button
                      loading={submitting === "submit"}
                      disabled={submitting != null && submitting !== "submit"}
                      onClick={() => form.onSubmit((values) => void save(values, true))()}
                    >
                      {t("performanceReview.saveAndSubmit")}
                    </Button>
                  )}
                </FormFooter>
              </Stack>
            </form>
          )}
        </Paper>
      </Container>

      {/* An eight-field editor qualifies as long-form — Cancel is guarded (house convention). */}
      <ConfirmActionModal {...modalProps} />
      <ConfirmActionModal
        opened={deleteOpen}
        onClose={closeDelete}
        title={t("performanceReview.deleteTitle")}
        message={t("performanceReview.deleteMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.delete")}
        onConfirm={() => void remove()}
        loading={submitting === "delete"}
      />
    </>
  );
}
