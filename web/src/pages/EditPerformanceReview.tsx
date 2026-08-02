import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  ColorSwatch,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  deletePerformanceReview,
  getPerformanceReview,
  getUserId,
  submitPerformanceReview,
  updatePerformanceReview,
} from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import PerformanceReviewHistory from "../components/PerformanceReviewHistory";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import PersonaField from "../components/PersonaField";
import ReadOnlyField from "../components/ReadOnlyField";
import { formatMonthRange } from "../utils/datetime";
import { reviewViewLink } from "../utils/performanceReviewLinks";
import { invalidatePerformanceReview } from "../utils/performanceReviewQueries";
import {
  isReviewComplete,
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
  const backOverride = searchParams.get("back");
  const backTo = backOverride ?? "/my-performance";

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "submit" | "delete" | null>(null);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
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
  // One-shot seed once the document arrives (the EditGoal idiom).
  if (data && data.status !== "PUBLISHED" && !form.initialized) {
    form.initialize(toReviewFormValues(data));
  }

  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Redirects to the read-only view keep the originating context (`from` / `back` override).
  const viewLink = reviewViewLink(id, from, backOverride ?? undefined);
  // Only the manager edits; anyone else who can read lands on the view screen.
  if (data && currentUserId !== data.managerId) return <Navigate to={viewLink} replace />;
  // A PUBLISHED review is read-only — its only action (Unpublish) lives on the view screen.
  if (data && data.status === "PUBLISHED") return <Navigate to={viewLink} replace />;

  async function afterSave() {
    await invalidatePerformanceReview(queryClient, id);
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
      await afterSave();
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
      navigate(backTo, { replace: true });
    } catch (err) {
      closeDelete();
      setError(reviewSaveErrorMessage(err, t));
      setSubmitting(null);
    }
  }

  const isDraft = data?.status === "DRAFT";

  return (
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
            <Group justify="flex-end">
              <Button component={RouterLink} to={backTo} variant="default">
                {t("common.action.close")}
              </Button>
            </Group>
          </Stack>
        )}

        {data && (
          <form onSubmit={form.onSubmit((values) => void save(values, false))}>
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={2}>{t("performanceReview.editTitle")}</Title>
                <PerformanceReviewStatusBadge status={data.status} />
              </Group>

              <Group gap="xl" align="flex-start">
                <PersonaField label={t("performanceReview.manager")} you />
                <PersonaField
                  label={t("performanceReview.subordinate")}
                  name={data.subordinateName}
                />
                <ReadOnlyField label={t("performanceReview.period")}>
                  <Text size="sm">
                    {formatMonthRange(data.periodStartMonth, data.periodEndMonth, i18n.language)}
                  </Text>
                </ReadOnlyField>
              </Group>

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
                    {REVIEW_CATEGORIES.map((category) => (
                      <Stack key={category} gap="xs">
                        <Select
                          label={t(`performanceReview.category.${category}`)}
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
                        <Textarea
                          label={t("performanceReview.summary")}
                          autosize
                          minRows={2}
                          maxRows={8}
                          {...form.getInputProps(`${category}.summary`)}
                        />
                      </Stack>
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

              <Group justify="space-between">
                <Group>
                  {isDraft && (
                    <Button
                      color="red"
                      variant="light"
                      onClick={openDelete}
                      loading={submitting === "delete"}
                      disabled={submitting != null && submitting !== "delete"}
                    >
                      {t("common.action.delete")}
                    </Button>
                  )}
                </Group>
                <Group>
                  <Button
                    variant="default"
                    onClick={() => (form.isDirty() ? openCancel() : navigate(backTo))}
                  >
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
                </Group>
              </Group>
            </Stack>
          </form>
        )}
      </Paper>

      {/* An eight-field editor qualifies as long-form — Cancel is guarded (house convention). */}
      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("performanceReview.discardTitle")}
        message={t("performanceReview.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
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
    </Container>
  );
}
