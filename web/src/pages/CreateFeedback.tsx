import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createFeedback,
  getUserId,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import FeedbackForm from "../components/FeedbackForm";
import { saveErrorMessage } from "../utils/saveError";

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
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "feedback.error.providePermission",
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
    />
  );
}
