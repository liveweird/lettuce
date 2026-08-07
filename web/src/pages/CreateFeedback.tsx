import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createFeedback,
  getUserId,
  hasFeature,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import DuplicateFeedbackAlert from "../components/DuplicateFeedbackAlert";
import FeedbackForm from "../components/FeedbackForm";
import { useFeedbackDuplicate } from "../hooks/useFeedbackDuplicate";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

export default function CreateFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);

  const subjectId = Number(searchParams.get("subjectId"));
  const subjectName = searchParams.get("subjectName");
  // An explicit `back` (e.g. the per-manager feedbacks screen) overrides the default return to "/".
  const backTo = searchParams.get("back") ?? "/";
  const providerId = getUserId();

  const subjectIdIsValid = Number.isFinite(subjectId) && subjectId > 0;
  // Warn about an in-progress duplicate before the user types anything (hook order: before
  // the redirect early-return).
  const duplicate = useFeedbackDuplicate(
    subjectIdIsValid && providerId != null ? { subjectId, providerId } : null,
  );
  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;
  if (!subjectIdIsValid || providerId == null) return <Navigate to="/" replace />;

  async function submit(
    status: FeedbackStatus,
    values: { visibility: FeedbackVisibility; content: string },
  ) {
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
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      // A create may mint notifications (e.g. SENT → subject/requester) — refresh the bell badge.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
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
      subjectDisplay={
        // A URL-crafted self target is a valid self-reflection create — keep the
        // app-wide plain "You" instead of rendering the caller's own chip.
        subjectId === providerId ? t("common.state.you") : (subjectName ?? `#${subjectId}`)
      }
      initialVisibility="PROVIDER_SUBJECT"
      initialContent=""
      submitting={submitting}
      error={error}
      onSubmit={submit}
      cancelTo={backTo}
      showTemplateInsert
      discardTitle={t("feedback.discardCreateTitle")}
      discardMessage={t("feedback.discardCreateMessage")}
      duplicate={
        duplicate.existingId != null ? (
          // The caller is the provider, so the edit route (or its triage screen) is theirs.
          <DuplicateFeedbackAlert
            status={duplicate.existingStatus ?? "DRAFT"}
            to={`/feedback/${duplicate.existingId}/edit`}
          />
        ) : undefined
      }
    />
  );
}
