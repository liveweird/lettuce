import { useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Select } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { createFeedback, type FeedbackStatus, type FeedbackVisibility } from "../api/feedbacks";
import { invalidateFeedback } from "../utils/feedbackQueries";
import DuplicateFeedbackAlert from "../components/DuplicateFeedbackAlert";
import FeedbackForm from "../components/FeedbackForm";
import { useAllUsers } from "../hooks/useAllUsers";
import { useFeedbackDuplicate } from "../hooks/useFeedbackDuplicate";
import { feedbackEditLink } from "../utils/feedbackLinks";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

export default function CreateFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);
  const [subjectPick, setSubjectPick] = useState<string | null>(null);

  const urlSubjectId = Number(searchParams.get("subjectId"));
  const subjectName = searchParams.get("subjectName");
  // An explicit `back` (e.g. the per-manager feedbacks screen) overrides the default return to "/".
  const backTo = searchParams.get("back") ?? "/";
  const providerId = getUserId();

  // Two modes (v2.28.0): a valid subjectId in the URL fixes the subject (the deep-link path —
  // users-row actions, person cards); without one the page renders the subject picker instead
  // of redirecting (the /feedback header's "New feedback" entry).
  const urlSubjectIsValid = Number.isFinite(urlSubjectId) && urlSubjectId > 0;
  const pickerMode = !urlSubjectIsValid;
  const { userPool, usersError } = useAllUsers(pickerMode);
  const subjectId = urlSubjectIsValid
    ? urlSubjectId
    : subjectPick != null
      ? Number(subjectPick)
      : null;

  // Warn about an in-progress duplicate before the user types anything; in picker mode the
  // probe re-keys per picked subject (null while nothing is picked). Hook order: before the
  // redirect early-return.
  const duplicate = useFeedbackDuplicate(
    subjectId != null && providerId != null ? { subjectId, providerId } : null,
  );

  // Picking praises/reviews OTHERS: the caller is excluded (the Self-reflection screen covers
  // self — the kudos-picker decision; a URL-crafted self subjectId still works below).
  const subjectOptions = useMemo(
    () =>
      (userPool ?? [])
        .filter((u) => u.id !== providerId)
        .map((u) => ({ value: String(u.id), label: u.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [userPool, providerId],
  );

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;
  if (providerId == null) return <Navigate to="/" replace />;

  const subjectDisplay = urlSubjectIsValid
    ? // A URL-crafted self target is a valid self-reflection create — keep the
      // app-wide plain "You" instead of rendering the caller's own chip.
      urlSubjectId === providerId
      ? t("common.state.you")
      : (subjectName ?? `#${urlSubjectId}`)
    : subjectId != null
      ? (userPool ?? []).find((u) => u.id === subjectId)?.name
      : undefined;

  async function submit(
    status: FeedbackStatus,
    values: { visibility: FeedbackVisibility; content: string },
  ) {
    if (subjectId == null) return;
    setError(null);
    setSubmitting(status);
    try {
      await createFeedback({
        subjectId,
        providerId: providerId!,
        visibility: values.visibility,
        status,
        content: values.content,
      });
      await invalidateFeedback(queryClient);
      showSuccessToast(t(status === "SENT" ? "feedback.toast.sent" : "feedback.toast.draftSaved"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "feedback.error.providePermission",
          conflict: "feedback.error.duplicate",
          invalid: "feedback.error.validation",
          failedStatus: "feedback.error.createFailedStatus",
          failed: "feedback.error.createFailed",
        }),
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <FeedbackForm
      title={t("feedback.provideTitle")}
      subjectDisplay={subjectDisplay}
      initialVisibility="PROVIDER_SUBJECT"
      initialContent=""
      submitting={submitting}
      error={error}
      onSubmit={submit}
      cancelTo={backTo}
      showTemplateInsert
      discardTitle={t("feedback.discardCreateTitle")}
      discardMessage={t("feedback.discardCreateMessage")}
      subjectControl={
        pickerMode ? (
          <Select
            label={t("common.field.subject")}
            placeholder={t("feedback.pickUser")}
            data={subjectOptions}
            value={subjectPick}
            onChange={setSubjectPick}
            searchable
            clearable
            nothingFoundMessage={t("feedback.noUsersAvailable")}
            error={usersError ? t("common.error.optionsFailed") : undefined}
            w={280}
          />
        ) : undefined
      }
      submitDisabled={subjectId == null}
      duplicate={
        duplicate.existingId != null ? (
          // The caller is the provider, so the edit route (or its triage screen) is theirs.
          <DuplicateFeedbackAlert
            status={duplicate.existingStatus ?? "DRAFT"}
            to={feedbackEditLink(duplicate.existingId)}
          />
        ) : undefined
      }
    />
  );
}
